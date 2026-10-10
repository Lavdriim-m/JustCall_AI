import { formatChf, formatIban } from "@justcall/core";
import { asc, eq, getPlatformSettings, invoiceLines, invoices, restaurants } from "@justcall/db";
import Link from "next/link";
import { notFound } from "next/navigation";
import { InvoiceDetailActions } from "@/components/invoice-actions";
import { InvoiceStatusBadge } from "@/components/status";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { formatDate, formatDateTime } from "@/lib/utils";
import { db } from "@/server/db";
import { InvoiceNotes } from "./notes";

export const metadata = { title: "Invoice" };

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [row] = await db
    .select({ invoice: invoices, restaurantName: restaurants.name, restaurantId: restaurants.id })
    .from(invoices)
    .innerJoin(restaurants, eq(restaurants.id, invoices.restaurantId))
    .where(eq(invoices.id, id))
    .limit(1);
  if (!row) notFound();
  const inv = row.invoice;
  const [lines, settings] = await Promise.all([
    db
      .select()
      .from(invoiceLines)
      .where(eq(invoiceLines.invoiceId, id))
      .orderBy(asc(invoiceLines.sortOrder)),
    getPlatformSettings(db),
  ]);
  return (
    <>
      <PageHeader
        breadcrumb={<Link href="/admin/invoices">Invoices</Link>}
        title={`Invoice ${inv.number}`}
        description={
          <>
            <Link
              href={`/admin/restaurants/${row.restaurantId}/billing`}
              className="hover:underline"
            >
              {row.restaurantName}
            </Link>{" "}
            · {formatDate(inv.periodStart)} – {formatDate(inv.periodEnd)}
          </>
        }
        actions={<InvoiceStatusBadge status={inv.status} />}
      />
      <div className="mb-6">
        <InvoiceDetailActions id={inv.id} status={inv.status} />
      </div>
      <div className="grid gap-6 xl:grid-cols-5">
        <div className="space-y-6 xl:col-span-2">
          <Card>
            <CardHeader title="Lines" />
            <Table>
              <THead>
                <tr>
                  <TH>Description</TH>
                  <TH className="text-right">Amount</TH>
                </tr>
              </THead>
              <TBody>
                {lines.map((l) => (
                  <TR key={l.id}>
                    <TD>
                      {l.description}
                      {l.quantity > 1 ? (
                        <div className="text-xs text-muted">
                          {l.quantity} × {formatChf(l.unitPriceCents)}
                        </div>
                      ) : null}
                    </TD>
                    <TD className="text-right tabular-nums">{formatChf(l.amountCents)}</TD>
                  </TR>
                ))}
                <TR>
                  <TD className="text-muted">Subtotal</TD>
                  <TD className="text-right tabular-nums">{formatChf(inv.subtotalCents)}</TD>
                </TR>
                {inv.vatRateBps ? (
                  <TR>
                    <TD className="text-muted">VAT {(inv.vatRateBps / 100).toFixed(1)}%</TD>
                    <TD className="text-right tabular-nums">{formatChf(inv.vatCents)}</TD>
                  </TR>
                ) : null}
                <TR>
                  <TD className="font-semibold">Total</TD>
                  <TD className="text-right font-semibold tabular-nums">
                    {formatChf(inv.totalCents)}
                  </TD>
                </TR>
              </TBody>
            </Table>
          </Card>
          <Card>
            <CardHeader title="Details" />
            <CardBody className="space-y-2 text-sm">
              <Row
                label="Bill to"
                value={[
                  inv.billTo.name,
                  inv.billTo.street,
                  [inv.billTo.postalCode, inv.billTo.city].filter(Boolean).join(" "),
                ]
                  .filter(Boolean)
                  .join(", ")}
              />
              <Row label="Email" value={inv.billTo.email ?? "– (missing)"} />
              <Row label="Issued" value={formatDate(inv.issueDate)} />
              <Row label="Due" value={formatDate(inv.dueDate)} />
              <Row label="Reference" value={inv.paymentReference ?? "–"} />
              <Row
                label="Pay to"
                value={settings.iban ? formatIban(settings.iban) : "IBAN missing (Settings)"}
              />
              <Row label="Sent" value={formatDateTime(inv.sentAt)} />
              <Row label="Paid" value={formatDateTime(inv.paidAt)} />
            </CardBody>
          </Card>
          <InvoiceNotes id={inv.id} notes={inv.notes ?? ""} />
        </div>
        <Card className="overflow-hidden xl:col-span-3">
          <iframe
            src={`/api/invoices/${inv.id}/pdf`}
            title="Invoice PDF"
            className="h-[900px] w-full bg-white"
          />
        </Card>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}
