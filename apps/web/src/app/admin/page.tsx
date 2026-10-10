import { formatChf, formatPercentFromBps, formatSwissNumber } from "@justcall/core";
import {
  Building2,
  CircleDollarSign,
  PhoneCall,
  PhoneForwarded,
  ShoppingBag,
  Timer,
} from "lucide-react";
import Link from "next/link";
import { BarChart } from "@/components/charts/bar-chart";
import { CallOutcomeBadge, RestaurantStatusBadge } from "@/components/status";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, Stat } from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { formatDuration, formatTime, relativeTime } from "@/lib/utils";
import { ordersPerDay, overviewStats, recentCalls, restaurantMonthSummary } from "@/server/queries";

export const metadata = { title: "Overview" };

export default async function OverviewPage() {
  const [stats, perDay, latest, restaurants] = await Promise.all([
    overviewStats(),
    ordersPerDay(14),
    recentCalls(8),
    restaurantMonthSummary(),
  ]);
  const chartData = perDay.map((d) => {
    const [, m, day] = d.day.split("-");
    return { key: d.day, label: `${day}.${m}.`, value: d.count, detail: formatChf(d.volume) };
  });

  return (
    <>
      <PageHeader
        title="Overview"
        description="Live activity across all restaurants."
        actions={
          <Button asChild>
            <Link href="/admin/restaurants/new">
              <Building2 /> New restaurant
            </Link>
          </Button>
        }
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Live calls"
          value={
            <span className="inline-flex items-center gap-2">
              {stats.liveCalls}
              {stats.liveCalls > 0 ? (
                <span className="size-2 rounded-full bg-brand-500 pulse-ring" />
              ) : null}
            </span>
          }
          hint={`${stats.todayCalls} calls today`}
          icon={<PhoneCall />}
        />
        <Stat
          label="Orders today"
          value={stats.todayOrders}
          hint={formatChf(stats.todayVolume)}
          icon={<ShoppingBag />}
        />
        <Stat
          label="Order volume this month"
          value={formatChf(stats.monthVolume)}
          hint={`${stats.monthOrders} orders`}
          icon={<CircleDollarSign />}
        />
        <Stat
          label="Your commission this month"
          value={formatChf(stats.monthCommission)}
          hint="Estimated, before fees and VAT"
          icon={<CircleDollarSign />}
        />
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <Stat
          label="Calls → orders (month)"
          value={
            stats.monthConversion === null ? "–" : `${Math.round(stats.monthConversion * 100)}%`
          }
          hint={`${stats.monthCalls} calls`}
          icon={<ShoppingBag />}
        />
        <Stat
          label="Transfers to staff (month)"
          value={stats.monthTransfers}
          hint="Allergies, owner requests, other"
          icon={<PhoneForwarded />}
        />
        <Stat
          label="Average call duration"
          value={formatDuration(stats.avgDuration)}
          icon={<Timer />}
        />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader title="Orders per day" description="Last 14 days, all restaurants" />
          <CardBody>
            <BarChart data={chartData} valueLabel="Orders" />
          </CardBody>
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader
            title="Latest calls"
            actions={
              <Button variant="ghost" size="sm" asChild>
                <Link href="/admin/calls">View all</Link>
              </Button>
            }
          />
          {latest.length === 0 ? (
            <EmptyState icon={<PhoneCall />} title="No calls yet">
              Use the test call on a restaurant page to try the assistant.
            </EmptyState>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {latest.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/admin/calls/${c.id}`}
                    className="flex items-center gap-3 px-5 py-3 hover:bg-[var(--surface-muted)]"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">
                        {c.restaurantName ?? "Unknown"}{" "}
                        {c.isSimulation ? <span className="text-xs text-muted">(test)</span> : null}
                      </div>
                      <div className="truncate text-xs text-muted">
                        {formatTime(c.startedAt)} ·{" "}
                        {c.fromNumber ? formatSwissNumber(c.fromNumber) : "unknown caller"} ·{" "}
                        {relativeTime(c.startedAt)}
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

      <Card className="mt-6">
        <CardHeader title="Restaurants this month" />
        <Table>
          <THead>
            <tr>
              <TH>Restaurant</TH>
              <TH>Status</TH>
              <TH>Number</TH>
              <TH className="text-right">Calls</TH>
              <TH className="text-right">Orders</TH>
              <TH className="text-right">Volume</TH>
              <TH className="text-right">Commission</TH>
            </tr>
          </THead>
          <TBody>
            {restaurants.length === 0 ? (
              <EmptyRow colSpan={7}>
                No restaurants yet.{" "}
                <Link href="/admin/restaurants/new" className="text-brand-700 underline">
                  Create the first one
                </Link>
                .
              </EmptyRow>
            ) : (
              restaurants.map((r) => (
                <TR key={r.id}>
                  <TD>
                    <Link
                      href={`/admin/restaurants/${r.id}`}
                      className="font-medium hover:underline"
                    >
                      {r.name}
                    </Link>
                  </TD>
                  <TD>
                    <RestaurantStatusBadge status={r.status} />
                  </TD>
                  <TD className="text-muted">
                    {r.numbers ? r.numbers.split(", ").map(formatSwissNumber).join(", ") : "–"}
                  </TD>
                  <TD className="text-right tabular-nums">{r.calls}</TD>
                  <TD className="text-right tabular-nums">{r.orders}</TD>
                  <TD className="text-right tabular-nums">{formatChf(r.volume)}</TD>
                  <TD className="text-right tabular-nums">
                    {formatChf(Math.round((r.volume * r.commission_bps) / 10000))}{" "}
                    <span className="text-xs text-muted">
                      ({formatPercentFromBps(r.commission_bps)})
                    </span>
                  </TD>
                </TR>
              ))
            )}
          </TBody>
        </Table>
      </Card>
    </>
  );
}
