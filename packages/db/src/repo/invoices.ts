import {
  computeInvoice,
  createScorReference,
  formatInvoiceNumber,
  getLocalParts,
  monthPeriod,
} from "@justcall/core";
import { and, eq, gte, lte, ne, sql } from "drizzle-orm";
import type { Database } from "../client";
import {
  invoiceCounters,
  invoiceLines,
  invoices,
  orders,
  platformSettings,
  restaurants,
  type Invoice,
} from "../schema";

export async function getPlatformSettings(db: Database) {
  const [row] = await db.select().from(platformSettings).where(eq(platformSettings.id, 1)).limit(1);
  if (row) return row;
  const [created] = await db
    .insert(platformSettings)
    .values({ id: 1 })
    .onConflictDoNothing()
    .returning();
  if (created) return created;
  const [again] = await db
    .select()
    .from(platformSettings)
    .where(eq(platformSettings.id, 1))
    .limit(1);
  return again!;
}

/** Billable order count and volume for a restaurant within [start, end] (local business dates). */
export async function billableOrderStats(
  db: Database,
  restaurantId: string,
  start: string,
  end: string,
) {
  const [row] = await db
    .select({
      count: sql<number>`count(*)::int`,
      volume: sql<number>`coalesce(sum(${orders.totalCents}), 0)::int`,
    })
    .from(orders)
    .where(
      and(
        eq(orders.restaurantId, restaurantId),
        gte(orders.orderDate, start),
        lte(orders.orderDate, end),
        eq(orders.isBillable, true),
        eq(orders.isTest, false),
        ne(orders.status, "cancelled"),
      ),
    );
  return { count: row?.count ?? 0, volumeCents: row?.volume ?? 0 };
}

export type GenerateInvoiceResult =
  | { status: "created"; invoice: Invoice }
  | { status: "exists"; invoice: Invoice }
  | { status: "skipped"; reason: string };

/**
 * Creates a draft invoice for one restaurant and month ("YYYY-MM"). Idempotent: an existing,
 * non-void invoice for the same period is returned instead of creating a duplicate.
 */
export async function generateInvoice(
  db: Database,
  restaurantId: string,
  yearMonth: string,
  { today = new Date() }: { today?: Date } = {},
): Promise<GenerateInvoiceResult> {
  const period = monthPeriod(yearMonth);
  const [restaurant] = await db
    .select()
    .from(restaurants)
    .where(eq(restaurants.id, restaurantId))
    .limit(1);
  if (!restaurant) return { status: "skipped", reason: "Restaurant not found" };

  const [existing] = await db
    .select()
    .from(invoices)
    .where(
      and(
        eq(invoices.restaurantId, restaurantId),
        eq(invoices.periodStart, period.start),
        ne(invoices.status, "void"),
      ),
    )
    .limit(1);
  if (existing) return { status: "exists", invoice: existing };

  if (getLocalParts(restaurant.createdAt, "Europe/Zurich").date > period.end) {
    return { status: "skipped", reason: "Restaurant was created after this period" };
  }
  if (restaurant.billingStartsOn && restaurant.billingStartsOn > period.end) {
    return { status: "skipped", reason: "Billing starts after this period" };
  }
  const start =
    restaurant.billingStartsOn && restaurant.billingStartsOn > period.start
      ? restaurant.billingStartsOn
      : period.start;
  const stats = await billableOrderStats(db, restaurantId, start, period.end);
  const settings = await getPlatformSettings(db);
  const computed = computeInvoice({
    terms: {
      commissionBps: restaurant.commissionBps,
      monthlyFeeCents: restaurant.monthlyFeeCents,
      perOrderFeeCents: restaurant.perOrderFeeCents,
    },
    orderCount: stats.count,
    orderVolumeCents: stats.volumeCents,
    vatRateBps: settings.vatRateBps,
    periodLabel: period.label,
  });
  if (computed.totalCents <= 0) {
    return { status: "skipped", reason: "Nothing to invoice for this period" };
  }

  const issue = getLocalParts(today, "Europe/Zurich").date;
  const dueDate = new Date(`${issue}T00:00:00Z`);
  dueDate.setUTCDate(dueDate.getUTCDate() + settings.paymentTermsDays);
  const year = Number(issue.slice(0, 4));

  try {
    return await db.transaction(async (tx) => {
      const [counter] = await tx
        .insert(invoiceCounters)
        .values({ year, lastNumber: 1 })
        .onConflictDoUpdate({
          target: invoiceCounters.year,
          set: { lastNumber: sql`${invoiceCounters.lastNumber} + 1` },
        })
        .returning();
      const number = formatInvoiceNumber(settings.invoicePrefix, year, counter!.lastNumber);
      const [invoice] = await tx
        .insert(invoices)
        .values({
          restaurantId,
          number,
          periodStart: period.start,
          periodEnd: period.end,
          status: "draft",
          issueDate: issue,
          dueDate: dueDate.toISOString().slice(0, 10),
          orderCount: stats.count,
          orderVolumeCents: stats.volumeCents,
          subtotalCents: computed.subtotalCents,
          vatRateBps: computed.vatRateBps,
          vatCents: computed.vatCents,
          totalCents: computed.totalCents,
          billTo: {
            name: restaurant.billingName || restaurant.legalName || restaurant.name,
            street: restaurant.billingStreet ?? restaurant.street,
            postalCode: restaurant.billingPostalCode ?? restaurant.postalCode,
            city: restaurant.billingCity ?? restaurant.city,
            country: restaurant.billingCountry ?? restaurant.country,
            email: restaurant.billingEmail ?? restaurant.contactEmail,
          },
          paymentReference: createScorReference(number.replace(/[^A-Z0-9]/gi, "")),
        })
        .returning();
      await tx.insert(invoiceLines).values(
        computed.lines.map((l, i) => ({
          invoiceId: invoice!.id,
          description: l.description,
          quantity: l.quantity,
          unitPriceCents: l.unitPriceCents,
          amountCents: l.amountCents,
          sortOrder: i,
        })),
      );
      return { status: "created" as const, invoice: invoice! };
    });
  } catch (err) {
    // Unique index race (two instances generating at once): return the winner.
    const [winner] = await db
      .select()
      .from(invoices)
      .where(
        and(
          eq(invoices.restaurantId, restaurantId),
          eq(invoices.periodStart, period.start),
          ne(invoices.status, "void"),
        ),
      )
      .limit(1);
    if (winner) return { status: "exists", invoice: winner };
    throw err;
  }
}

/** Generates draft invoices for all billable restaurants for a month. */
export async function generateMonthlyInvoices(db: Database, yearMonth: string) {
  const rows = await db
    .select({ id: restaurants.id, name: restaurants.name })
    .from(restaurants)
    .where(sql`${restaurants.status} in ('active','paused')`);
  const results: { restaurantId: string; name: string; result: GenerateInvoiceResult }[] = [];
  for (const r of rows) {
    results.push({
      restaurantId: r.id,
      name: r.name,
      result: await generateInvoice(db, r.id, yearMonth),
    });
  }
  return results;
}
