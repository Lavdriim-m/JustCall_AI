import {
  PAYMENT_LABELS_DE,
  formatChf,
  formatSwissNumber,
  type PaymentMethod,
} from "@justcall/core";
import { asc, eq, orderItems, orders, restaurants } from "@justcall/db";
import Link from "next/link";
import { notFound } from "next/navigation";
import { OrderStatusBadge } from "@/components/status";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { formatDateTime, formatTime } from "@/lib/utils";
import { db } from "@/server/db";
import { OrderAdminActions } from "./order-actions";

export const metadata = { title: "Order" };

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [row] = await db
    .select({ order: orders, restaurantName: restaurants.name, timezone: restaurants.timezone })
    .from(orders)
    .innerJoin(restaurants, eq(restaurants.id, orders.restaurantId))
    .where(eq(orders.id, id))
    .limit(1);
  if (!row) notFound();
  const o = row.order;
  const items = await db
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, id))
    .orderBy(asc(orderItems.sortOrder));
  return (
    <>
      <PageHeader
        breadcrumb={<Link href="/admin/orders">Orders</Link>}
        title={`Order #${o.orderNumber} · ${row.restaurantName}`}
        description={`Placed ${formatDateTime(o.createdAt)}`}
        actions={
          <>
            {o.isTest ? <Badge tone="purple">Test</Badge> : null}
            {!o.isBillable ? <Badge>Not billed</Badge> : null}
            <OrderStatusBadge status={o.status} />
          </>
        }
      />
      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Items" />
          <Table>
            <THead>
              <tr>
                <TH>Qty</TH>
                <TH>Item</TH>
                <TH className="text-right">Unit</TH>
                <TH className="text-right">Total</TH>
              </tr>
            </THead>
            <TBody>
              {items.map((i) => (
                <TR key={i.id}>
                  <TD className="tabular-nums">{i.quantity}×</TD>
                  <TD>
                    <div className="font-medium">{i.name}</div>
                    {i.options.length ? (
                      <div className="text-xs text-muted">
                        {i.options
                          .map(
                            (op) =>
                              `${op.optionName}${op.priceDeltaCents ? ` (+${formatChf(op.priceDeltaCents, { withCurrency: false })})` : ""}`,
                          )
                          .join(", ")}
                      </div>
                    ) : null}
                    {i.notes ? (
                      <div className="text-xs text-amber-700 dark:text-amber-400">{i.notes}</div>
                    ) : null}
                  </TD>
                  <TD className="text-right tabular-nums">{formatChf(i.unitPriceCents)}</TD>
                  <TD className="text-right tabular-nums">{formatChf(i.lineTotalCents)}</TD>
                </TR>
              ))}
              {o.deliveryFeeCents ? (
                <TR>
                  <TD />
                  <TD>Delivery fee</TD>
                  <TD />
                  <TD className="text-right tabular-nums">{formatChf(o.deliveryFeeCents)}</TD>
                </TR>
              ) : null}
              <TR>
                <TD />
                <TD className="font-semibold">Total</TD>
                <TD />
                <TD className="text-right font-semibold tabular-nums">{formatChf(o.totalCents)}</TD>
              </TR>
            </TBody>
          </Table>
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Customer & timing" />
            <CardBody className="space-y-2 text-sm">
              <Row label="Name" value={o.customerName} />
              <Row
                label="Phone"
                value={o.customerPhone ? formatSwissNumber(o.customerPhone) : "–"}
              />
              <Row
                label={o.fulfillment === "delivery" ? "Delivery" : "Pickup"}
                value={
                  o.requestedFor
                    ? `at ${formatTime(o.requestedFor, row.timezone)}`
                    : "as soon as possible"
                }
              />
              <Row label="Estimated" value={formatTime(o.estimatedReadyAt, row.timezone)} />
              {o.deliveryAddress ? (
                <Row
                  label="Address"
                  value={[
                    o.deliveryAddress.street,
                    [o.deliveryAddress.postalCode, o.deliveryAddress.city]
                      .filter(Boolean)
                      .join(" "),
                    o.deliveryAddress.notes,
                  ]
                    .filter(Boolean)
                    .join(", ")}
                />
              ) : null}
              <Row
                label="Payment"
                value={
                  o.paymentMethod
                    ? (PAYMENT_LABELS_DE[o.paymentMethod as PaymentMethod] ?? o.paymentMethod)
                    : "–"
                }
              />
              <Row label="SMS" value={o.smsStatus ?? "–"} />
              {o.notes ? <Row label="Note" value={o.notes} /> : null}
              {o.cancelledReason ? <Row label="Cancelled" value={o.cancelledReason} /> : null}
              {o.callId ? (
                <Link
                  href={`/admin/calls/${o.callId}`}
                  className="block pt-1 text-brand-700 underline dark:text-brand-300"
                >
                  Listen to the call transcript
                </Link>
              ) : null}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Actions" />
            <CardBody>
              <OrderAdminActions
                id={o.id}
                status={o.status}
                isBillable={o.isBillable}
                isTest={o.isTest}
              />
            </CardBody>
          </Card>
        </div>
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
