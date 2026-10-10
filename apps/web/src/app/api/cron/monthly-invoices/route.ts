import { getLocalParts, previousMonth } from "@justcall/core";
import { generateMonthlyInvoices } from "@justcall/db";
import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { db } from "@/server/db";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Alternative trigger for monthly invoice generation (e.g. Vercel Cron, GitHub Actions, any
 * scheduler). Idempotent: running it twice does not create duplicate invoices.
 *   GET /api/cron/monthly-invoices?month=2026-09   Authorization: Bearer $CRON_SECRET
 */
export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  if (!env.cronSecret || auth !== `Bearer ${env.cronSecret}`)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const month =
    new URL(req.url).searchParams.get("month") ??
    previousMonth(getLocalParts(new Date(), "Europe/Zurich").date);
  if (!/^\d{4}-\d{2}$/.test(month))
    return NextResponse.json({ error: "invalid month" }, { status: 400 });
  const results = await generateMonthlyInvoices(db, month);
  return NextResponse.json({
    month,
    results: results.map((r) => ({
      restaurant: r.name,
      status: r.result.status,
      invoice: "invoice" in r.result ? r.result.invoice.number : null,
    })),
  });
}
