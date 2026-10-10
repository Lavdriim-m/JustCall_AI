import { formatChf, formatSwissNumber, hasAnyHours } from "@justcall/core";
import { count, eq, menuItems, and, phoneNumbers } from "@justcall/db";
import { CheckCircle2, Circle, PhoneCall, ShoppingBag } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BarChart } from "@/components/charts/bar-chart";
import { CallOutcomeBadge } from "@/components/status";
import { Card, CardBody, CardHeader, Stat } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/misc";
import { formatTime, relativeTime } from "@/lib/utils";
import { db } from "@/server/db";
import { ordersPerDay, overviewStats, recentCalls } from "@/server/queries";
import { getRestaurantAccess } from "@/server/session";
import { StatusActions } from "./status-actions";

export default async function RestaurantOverview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await getRestaurantAccess(id);
  if (!access) notFound();
  const r = access.restaurant;
  const [[items], numbers, stats, perDay, calls] = await Promise.all([
    db
      .select({ n: count() })
      .from(menuItems)
      .where(and(eq(menuItems.restaurantId, r.id), eq(menuItems.isActive, true))),
    db.select().from(phoneNumbers).where(eq(phoneNumbers.restaurantId, r.id)),
    overviewStats(r.id),
    ordersPerDay(14, r.id),
    recentCalls(6, r.id),
  ]);
  const base = `/admin/restaurants/${r.id}`;
  const checklist = [
    {
      done: Number(items?.n ?? 0) > 0,
      label: `Menu (${items?.n ?? 0} items)`,
      href: `${base}/menu`,
    },
    { done: hasAnyHours(r.openingHours), label: "Opening hours", href: `${base}/hours` },
    {
      done: numbers.some((n) => n.isActive),
      label: "Phone number connected",
      href: `${base}/phone`,
    },
    {
      done: Boolean(r.transferPhone),
      label: "Transfer number for allergies & owner requests",
      href: `${base}/settings#safety`,
    },
    {
      done: r.paymentMethods.length > 0,
      label: "Payment methods",
      href: `${base}/settings#payment`,
    },
    {
      done: Boolean(r.billingEmail || r.contactEmail),
      label: "Billing email",
      href: `${base}/billing`,
    },
  ];
  const ready = checklist.every((c) => c.done);

  return (
    <div className="grid gap-6 xl:grid-cols-3">
      <div className="space-y-6 xl:col-span-2">
        <div className="grid gap-4 sm:grid-cols-3">
          <Stat
            label="Orders today"
            value={stats.todayOrders}
            hint={formatChf(stats.todayVolume)}
            icon={<ShoppingBag />}
          />
          <Stat
            label="Orders this month"
            value={stats.monthOrders}
            hint={formatChf(stats.monthVolume)}
            icon={<ShoppingBag />}
          />
          <Stat
            label="Calls this month"
            value={stats.monthCalls}
            hint={`${stats.monthTransfers} transferred`}
            icon={<PhoneCall />}
          />
        </div>
        <Card>
          <CardHeader title="Orders per day" description="Last 14 days" />
          <CardBody>
            <BarChart
              data={perDay.map((d) => ({
                key: d.day,
                label: `${d.day.slice(8)}.${d.day.slice(5, 7)}.`,
                value: d.count,
                detail: formatChf(d.volume),
              }))}
              valueLabel="Orders"
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Latest calls" />
          {calls.length === 0 ? (
            <EmptyState icon={<PhoneCall />} title="No calls yet">
              <Link href={`${base}/test`} className="text-brand-700 underline">
                Make a test call
              </Link>{" "}
              to try the assistant.
            </EmptyState>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {calls.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/admin/calls/${c.id}`}
                    className="flex items-center gap-3 px-5 py-3 hover:bg-[var(--surface-muted)]"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm">{c.summary ?? "–"}</div>
                      <div className="text-xs text-muted">
                        {formatTime(c.startedAt)} ·{" "}
                        {c.fromNumber ? formatSwissNumber(c.fromNumber) : "unknown"} ·{" "}
                        {relativeTime(c.startedAt)}
                        {c.isSimulation ? " · test" : ""}
                      </div>
                    </div>
                    <CallOutcomeBadge outcome={c.outcome} status={c.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <div className="space-y-6">
        <Card>
          <CardHeader
            title="Go-live checklist"
            description={
              ready ? "Everything is set up." : "Complete these steps before activating."
            }
          />
          <CardBody className="space-y-3">
            {checklist.map((c) => (
              <Link
                key={c.label}
                href={c.href}
                className="flex items-center gap-2.5 text-sm hover:underline"
              >
                {c.done ? (
                  <CheckCircle2 className="size-4 text-emerald-600" />
                ) : (
                  <Circle className="size-4 text-muted" />
                )}
                <span className={c.done ? "" : "text-muted"}>{c.label}</span>
              </Link>
            ))}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Status" />
          <CardBody>
            <StatusActions id={r.id} status={r.status} ready={ready} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Phone numbers" />
          <CardBody className="space-y-2 text-sm">
            {numbers.length === 0 ? (
              <p className="text-muted">
                No number connected.{" "}
                <Link href={`${base}/phone`} className="text-brand-700 underline">
                  Connect one
                </Link>
                .
              </p>
            ) : (
              numbers.map((n) => (
                <div key={n.id} className="flex items-center justify-between">
                  <span className="font-medium">{formatSwissNumber(n.e164)}</span>
                  <span className="text-xs text-muted">
                    {n.forwardedFrom ? `from ${formatSwissNumber(n.forwardedFrom)}` : n.label}
                  </span>
                </div>
              ))
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
