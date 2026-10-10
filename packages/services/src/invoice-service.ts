import { formatChf, MONTHS_DE } from "@justcall/core";
import {
  asc,
  eq,
  getPlatformSettings,
  invoiceLines,
  invoices,
  restaurants,
  type Database,
} from "@justcall/db";
import { renderInvoicePdf } from "./invoice-pdf";
import { sendMail } from "./mailer";

export async function loadInvoiceBundle(db: Database, invoiceId: string) {
  const [invoice] = await db.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
  if (!invoice) return null;
  const [lines, [restaurant], settings] = await Promise.all([
    db
      .select()
      .from(invoiceLines)
      .where(eq(invoiceLines.invoiceId, invoiceId))
      .orderBy(asc(invoiceLines.sortOrder)),
    db.select().from(restaurants).where(eq(restaurants.id, invoice.restaurantId)).limit(1),
    getPlatformSettings(db),
  ]);
  return { invoice, lines, restaurant: restaurant!, settings };
}

export async function invoicePdf(db: Database, invoiceId: string) {
  const bundle = await loadInvoiceBundle(db, invoiceId);
  if (!bundle) return null;
  const pdf = await renderInvoicePdf({
    invoice: bundle.invoice,
    lines: bundle.lines,
    settings: bundle.settings,
    restaurantName: bundle.restaurant.name,
  });
  return { pdf, ...bundle };
}

/** Emails the invoice PDF to the restaurant's billing address and marks it as sent. */
export async function sendInvoice(db: Database, invoiceId: string) {
  const result = await invoicePdf(db, invoiceId);
  if (!result) throw new Error("Invoice not found");
  const { invoice, restaurant, settings, pdf } = result;
  if (invoice.status === "void") throw new Error("Voided invoices cannot be sent");
  const to = invoice.billTo.email || restaurant.billingEmail || restaurant.contactEmail;
  if (!to) throw new Error("No billing email address for this restaurant");
  const [y, m] = invoice.periodStart.split("-").map(Number) as [number, number];
  const period = `${MONTHS_DE[m - 1]} ${y}`;
  const text = [
    `Guten Tag`,
    ``,
    `Im Anhang erhalten Sie die Rechnung ${invoice.number} für JustCall (${period}).`,
    ``,
    `Bestellungen über JustCall: ${invoice.orderCount}`,
    `Bestellvolumen: ${formatChf(invoice.orderVolumeCents)}`,
    `Rechnungsbetrag: ${formatChf(invoice.totalCents)}`,
    `Zahlbar bis: ${invoice.dueDate.split("-").reverse().join(".")}`,
    ``,
    `Bei Fragen antworten Sie einfach auf diese E-Mail.`,
    ``,
    `Freundliche Grüsse`,
    settings.companyName,
  ].join("\n");
  const sent = await sendMail({
    to,
    subject: `Rechnung ${invoice.number} – JustCall ${period}`,
    text,
    replyTo: settings.email ?? undefined,
    attachments: [
      { filename: `Rechnung-${invoice.number}.pdf`, content: pdf, contentType: "application/pdf" },
    ],
  });
  await db
    .update(invoices)
    .set({ status: invoice.status === "paid" ? "paid" : "sent", sentAt: new Date() })
    .where(eq(invoices.id, invoiceId));
  return { to, delivered: sent.delivered };
}
