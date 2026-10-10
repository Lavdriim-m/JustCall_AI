import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestRestaurant, resetTestDatabase, TEST_DB_URL } from "./helpers";

process.env.DATABASE_URL = TEST_DB_URL;
const {
  createDb,
  createOrder,
  eq,
  generateInvoice,
  invoiceLines,
  invoices,
  jobRuns,
  restaurants,
  platformSettings,
  sql,
} = await import("@justcall/db");
const { runOnce } = await import("../src/jobs/scheduler");

const { db, client } = createDb({ url: TEST_DB_URL, max: 2 });

beforeAll(async () => {
  await resetTestDatabase();
  await db
    .insert(platformSettings)
    .values({ id: 1, vatRateBps: 810, invoicePrefix: "JC" })
    .onConflictDoUpdate({ target: platformSettings.id, set: { vatRateBps: 810 } });
});
afterAll(async () => {
  await client.end();
});

function draft(restaurantId: string, totalCents: number) {
  return {
    restaurantId,
    lines: [
      {
        lineId: "L1",
        itemId: "x",
        name: "Pizza",
        quantity: 1,
        basePriceCents: totalCents,
        options: [],
        notes: null,
        unitPriceCents: totalCents,
        lineTotalCents: totalCents,
      },
    ],
    subtotalCents: totalCents,
    deliveryFeeCents: 0,
    totalCents,
    fulfillment: "pickup" as const,
    requestedFor: null,
    estimatedReadyAt: new Date(),
    customerName: "Test",
    customerPhone: null,
    deliveryAddress: null,
    paymentMethod: "cash" as const,
    notes: null,
  };
}

describe("monthly invoices", () => {
  it("bills commission on billable orders only, plus monthly fee and VAT – idempotently", async () => {
    const r = await createTestRestaurant("+41445550100", {
      commissionBps: 500,
      monthlyFeeCents: 4900,
    });
    await db
      .update(restaurants)
      .set({ createdAt: new Date("2026-08-15T10:00:00Z") })
      .where(eq(restaurants.id, r.id));
    const sept = new Date("2026-09-12T12:00:00Z");
    await createOrder(db, { draft: draft(r.id, 4000), timezone: "Europe/Zurich", now: sept });
    await createOrder(db, { draft: draft(r.id, 6000), timezone: "Europe/Zurich", now: sept });
    await createOrder(db, {
      draft: draft(r.id, 9900),
      timezone: "Europe/Zurich",
      now: sept,
      isTest: true,
    });
    const cancelled = await createOrder(db, {
      draft: draft(r.id, 5000),
      timezone: "Europe/Zurich",
      now: sept,
    });
    await db.execute(sql`update orders set status = 'cancelled' where id = ${cancelled.id}`);
    await createOrder(db, {
      draft: draft(r.id, 7000),
      timezone: "Europe/Zurich",
      now: new Date("2026-10-01T08:00:00Z"),
    });

    const res = await generateInvoice(db, r.id, "2026-09", {
      today: new Date("2026-10-01T06:00:00Z"),
    });
    expect(res.status).toBe("created");
    if (res.status !== "created") return;
    const inv = res.invoice;
    expect(inv.orderCount).toBe(2);
    expect(inv.orderVolumeCents).toBe(10000);
    // 5% of 100.00 = 5.00 + 49.00 monthly fee = 54.00, VAT 8.1% = 4.37
    expect(inv.subtotalCents).toBe(5400);
    expect(inv.vatCents).toBe(437);
    expect(inv.totalCents).toBe(5837);
    expect(inv.number).toMatch(/^JC-2026-\d{4}$/);
    expect(inv.paymentReference).toMatch(/^RF\d{2}/);
    const lines = await db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, inv.id));
    expect(lines).toHaveLength(2);

    const again = await generateInvoice(db, r.id, "2026-09");
    expect(again.status).toBe("exists");
    expect((await db.select().from(invoices).where(eq(invoices.restaurantId, r.id))).length).toBe(
      1,
    );
  });

  it("does not bill months before the restaurant existed", async () => {
    const r = await createTestRestaurant("+41445550101", { monthlyFeeCents: 4900 });
    const res = await generateInvoice(db, r.id, "2026-01");
    expect(res).toMatchObject({ status: "skipped" });
  });

  it("runs a job once per key and retries failed runs", async () => {
    let calls = 0;
    const ok = async () => {
      calls += 1;
      return { done: true };
    };
    expect(await runOnce(db, "test-job", "k1", ok)).toEqual({ done: true });
    expect(await runOnce(db, "test-job", "k1", ok)).toBeNull();
    expect(calls).toBe(1);

    await expect(
      runOnce(db, "test-job", "k2", async () => Promise.reject(new Error("boom"))),
    ).rejects.toThrow("boom");
    const [failed] = await db.select().from(jobRuns).where(eq(jobRuns.runKey, "k2"));
    expect(failed!.status).toBe("failed");
    expect(await runOnce(db, "test-job", "k2", ok)).toEqual({ done: true });
    expect(calls).toBe(2);
  });
});
