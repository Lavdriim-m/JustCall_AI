"use server";

import { eq, generateInvoice, generateMonthlyInvoices, invoices } from "@justcall/db";
import { sendInvoice } from "@justcall/services";
import { revalidatePath } from "next/cache";
import { audit } from "../audit";
import { db } from "../db";
import { requireAdmin } from "../session";
import { fail, ok, type ActionResult } from "./helpers";

function refresh(restaurantId?: string) {
  revalidatePath("/admin/invoices");
  if (restaurantId) revalidatePath(`/admin/restaurants/${restaurantId}/billing`);
}

/** Generates draft invoices for a month ("YYYY-MM") – for one restaurant or all. Idempotent. */
export async function generateInvoicesAction(
  yearMonth: string,
  restaurantId?: string,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!/^\d{4}-\d{2}$/.test(yearMonth)) return fail("Choose a month");
  if (restaurantId) {
    const res = await generateInvoice(db, restaurantId, yearMonth);
    await audit(admin.id, "invoice.generate", {
      restaurantId,
      data: { yearMonth, status: res.status },
    });
    refresh(restaurantId);
    if (res.status === "skipped") return fail(`Nothing generated: ${res.reason}`);
    return ok(
      res.status === "exists"
        ? `Invoice ${res.invoice.number} already exists for this month`
        : `Invoice ${res.invoice.number} created`,
    );
  }
  const results = await generateMonthlyInvoices(db, yearMonth);
  await audit(admin.id, "invoice.generate_all", { data: { yearMonth, count: results.length } });
  refresh();
  const created = results.filter((r) => r.result.status === "created").length;
  const exists = results.filter((r) => r.result.status === "exists").length;
  const skipped = results.filter((r) => r.result.status === "skipped").length;
  return ok(`${created} created, ${exists} already existed, ${skipped} skipped (nothing to bill)`);
}

export async function sendInvoiceAction(invoiceId: string): Promise<ActionResult> {
  const admin = await requireAdmin();
  try {
    const res = await sendInvoice(db, invoiceId);
    await audit(admin.id, "invoice.send", { entity: "invoice", entityId: invoiceId, data: res });
    refresh();
    revalidatePath(`/admin/invoices/${invoiceId}`);
    return ok(
      res.delivered
        ? `Sent to ${res.to}`
        : `SMTP not configured – email logged on the server (to ${res.to}); marked as sent`,
    );
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

export async function setInvoiceStatus(
  invoiceId: string,
  status: "paid" | "void" | "sent" | "draft",
): Promise<ActionResult> {
  const admin = await requireAdmin();
  const [inv] = await db.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
  if (!inv) return fail("Invoice not found");
  if (inv.status === "void") return fail("Voided invoices cannot be changed");
  await db
    .update(invoices)
    .set({
      status,
      paidAt: status === "paid" ? new Date() : inv.paidAt,
      voidedAt: status === "void" ? new Date() : null,
    })
    .where(eq(invoices.id, invoiceId));
  await audit(admin.id, `invoice.${status}`, {
    restaurantId: inv.restaurantId,
    entity: "invoice",
    entityId: invoiceId,
  });
  refresh(inv.restaurantId);
  revalidatePath(`/admin/invoices/${invoiceId}`);
  return ok(
    status === "void"
      ? "Invoice voided – you can generate a new one for the period"
      : `Marked as ${status}`,
  );
}

export async function updateInvoiceNotes(invoiceId: string, notes: string): Promise<ActionResult> {
  await requireAdmin();
  await db
    .update(invoices)
    .set({ notes: notes.trim() || null })
    .where(eq(invoices.id, invoiceId));
  revalidatePath(`/admin/invoices/${invoiceId}`);
  return ok("Notes saved");
}
