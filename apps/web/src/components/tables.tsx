import { formatChf, formatSwissNumber } from "@justcall/core";
import Link from "next/link";
import { CallOutcomeBadge, InvoiceStatusBadge, OrderStatusBadge } from "@/components/status";
import { Badge } from "@/components/ui/badge";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { formatDate, formatDateTime, formatDuration, formatTime } from "@/lib/utils";

export type CallRow = {
  id: string;
  startedAt: Date;
  fromNumber: string | null;
  status: string;
  outcome: string | null;
  durationSeconds: number | null;
  isSimulation: boolean;
  summary: string | null;
  restaurantName: string | null;
};

export function CallsTable({
  rows,
  showRestaurant = true,
  basePath = "/admin/calls",
}: {
  rows: CallRow[];
  showRestaurant?: boolean;
  basePath?: string;
}) {
  return (
    <Table>
      <THead>
        <tr>
          <TH>Time</TH>
          {showRestaurant ? <TH>Restaurant</TH> : null}
          <TH>Caller</TH>
          <TH>Summary</TH>
          <TH>Outcome</TH>
          <TH className="text-right">Duration</TH>
        </tr>
      </THead>
      <TBody>
        {rows.length === 0 ? (
          <EmptyRow colSpan={showRestaurant ? 6 : 5}>No calls found.</EmptyRow>
        ) : (
          rows.map((c) => (
            <TR key={c.id}>
              <TD className="whitespace-nowrap">
                <Link href={`${basePath}/${c.id}`} className="font-medium hover:underline">
                  {formatDateTime(c.startedAt)}
                </Link>
                {c.isSimulation ? (
                  <Badge className="ml-2" tone="purple">
                    Test
                  </Badge>
                ) : null}
              </TD>
              {showRestaurant ? <TD>{c.restaurantName ?? "–"}</TD> : null}
              <TD className="whitespace-nowrap text-muted">
                {c.fromNumber ? formatSwissNumber(c.fromNumber) : "unknown"}
              </TD>
              <TD className="max-w-md truncate text-muted">{c.summary ?? "–"}</TD>
              <TD>
                <CallOutcomeBadge outcome={c.outcome} status={c.status} />
              </TD>
              <TD className="text-right tabular-nums">{formatDuration(c.durationSeconds)}</TD>
            </TR>
          ))
        )}
      </TBody>
    </Table>
  );
}

export type OrderRow = {
  id: string;
  orderNumber: number;
  orderDate: string;
  createdAt: Date;
  status: string;
  fulfillment: string;
  customerName: string;
  customerPhone: string | null;
  totalCents: number;
  paymentMethod: string | null;
  isTest: boolean;
  isBillable: boolean;
  estimatedReadyAt: Date | null;
  restaurantName?: string | null;
};

export function OrdersTable({
  rows,
  showRestaurant = true,
}: {
  rows: OrderRow[];
  showRestaurant?: boolean;
}) {
  return (
    <Table>
      <THead>
        <tr>
          <TH>No.</TH>
          <TH>Placed</TH>
          {showRestaurant ? <TH>Restaurant</TH> : null}
          <TH>Customer</TH>
          <TH>Pickup / delivery</TH>
          <TH>Status</TH>
          <TH className="text-right">Total</TH>
        </tr>
      </THead>
      <TBody>
        {rows.length === 0 ? (
          <EmptyRow colSpan={showRestaurant ? 7 : 6}>No orders found.</EmptyRow>
        ) : (
          rows.map((o) => (
            <TR key={o.id}>
              <TD>
                <Link href={`/admin/orders/${o.id}`} className="font-medium hover:underline">
                  #{o.orderNumber}
                </Link>
                {o.isTest ? (
                  <Badge className="ml-2" tone="purple">
                    Test
                  </Badge>
                ) : !o.isBillable ? (
                  <Badge className="ml-2">Not billed</Badge>
                ) : null}
              </TD>
              <TD className="whitespace-nowrap">{formatDateTime(o.createdAt)}</TD>
              {showRestaurant ? <TD>{o.restaurantName ?? "–"}</TD> : null}
              <TD>
                <div>{o.customerName}</div>
                <div className="text-xs text-muted">
                  {o.customerPhone ? formatSwissNumber(o.customerPhone) : ""}
                </div>
              </TD>
              <TD className="whitespace-nowrap">
                {o.fulfillment === "delivery" ? "Delivery" : "Pickup"}{" "}
                {o.estimatedReadyAt ? formatTime(o.estimatedReadyAt) : ""}
              </TD>
              <TD>
                <OrderStatusBadge status={o.status} />
              </TD>
              <TD className="text-right font-medium tabular-nums">{formatChf(o.totalCents)}</TD>
            </TR>
          ))
        )}
      </TBody>
    </Table>
  );
}

export type InvoiceRow = {
  id: string;
  number: string;
  periodStart: string;
  issueDate: string;
  dueDate: string;
  status: string;
  orderCount: number;
  orderVolumeCents: number;
  totalCents: number;
  restaurantName?: string | null;
};

export function InvoicesTable({
  rows,
  showRestaurant = true,
  linkBase = "/admin/invoices",
}: {
  rows: InvoiceRow[];
  showRestaurant?: boolean;
  linkBase?: string | null;
}) {
  return (
    <Table>
      <THead>
        <tr>
          <TH>Number</TH>
          {showRestaurant ? <TH>Restaurant</TH> : null}
          <TH>Period</TH>
          <TH>Issued</TH>
          <TH>Due</TH>
          <TH>Status</TH>
          <TH className="text-right">Orders</TH>
          <TH className="text-right">Amount</TH>
        </tr>
      </THead>
      <TBody>
        {rows.length === 0 ? (
          <EmptyRow colSpan={showRestaurant ? 8 : 7}>No invoices yet.</EmptyRow>
        ) : (
          rows.map((i) => (
            <TR key={i.id}>
              <TD className="font-medium">
                {linkBase ? (
                  <Link href={`${linkBase}/${i.id}`} className="hover:underline">
                    {i.number}
                  </Link>
                ) : (
                  <a
                    href={`/api/invoices/${i.id}/pdf`}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:underline"
                  >
                    {i.number}
                  </a>
                )}
              </TD>
              {showRestaurant ? <TD>{i.restaurantName ?? "–"}</TD> : null}
              <TD>{i.periodStart.slice(0, 7)}</TD>
              <TD>{formatDate(i.issueDate)}</TD>
              <TD>{formatDate(i.dueDate)}</TD>
              <TD>
                <InvoiceStatusBadge status={i.status} />
              </TD>
              <TD className="text-right tabular-nums">{i.orderCount}</TD>
              <TD className="text-right font-medium tabular-nums">{formatChf(i.totalCents)}</TD>
            </TR>
          ))
        )}
      </TBody>
    </Table>
  );
}
