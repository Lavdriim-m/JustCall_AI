import "server-only";
import { addDays, getLocalParts } from "@justcall/core";
import { and, calls, desc, eq, gte, orders, restaurants, sql } from "@justcall/db";
import { db } from "./db";

export const ZURICH = "Europe/Zurich";

export function todayLocal(): string {
  return getLocalParts(new Date(), ZURICH).date;
}

export function monthStartLocal(): string {
  return `${todayLocal().slice(0, 7)}-01`;
}

/** KPIs for the admin overview (optionally for one restaurant). */
export async function overviewStats(restaurantId?: string) {
  const today = todayLocal();
  const monthStart = monthStartLocal();
  const rFilter = restaurantId ? sql`and restaurant_id = ${restaurantId}` : sql``;
  const rFilterO = restaurantId ? sql`and o.restaurant_id = ${restaurantId}` : sql``;

  const [ordersRow] = (await db.execute(sql`
    select
      count(*) filter (where order_date = ${today})::int as today_count,
      coalesce(sum(total_cents) filter (where order_date = ${today}), 0)::int as today_volume,
      count(*) filter (where order_date >= ${monthStart})::int as month_count,
      coalesce(sum(total_cents) filter (where order_date >= ${monthStart}), 0)::int as month_volume
    from orders
    where is_test = false and status <> 'cancelled' and order_date >= ${monthStart < today ? monthStart : today} ${rFilter}
  `)) as unknown as {
    today_count: number;
    today_volume: number;
    month_count: number;
    month_volume: number;
  }[];

  const [commissionRow] = (await db.execute(sql`
    select coalesce(sum(round(o.total_cents * r.commission_bps / 10000.0)), 0)::int as commission
    from orders o join restaurants r on r.id = o.restaurant_id
    where o.is_test = false and o.is_billable = true and o.status <> 'cancelled' and o.order_date >= ${monthStart} ${rFilterO}
  `)) as unknown as { commission: number }[];

  const [callsRow] = (await db.execute(sql`
    select
      count(*) filter (where started_at >= date_trunc('day', now() at time zone ${ZURICH}) at time zone ${ZURICH})::int as today_calls,
      count(*) filter (where status in ('ringing','in_progress') and started_at > now() - interval '1 hour')::int as live_calls,
      count(*) filter (where started_at >= date_trunc('month', now() at time zone ${ZURICH}) at time zone ${ZURICH})::int as month_calls,
      count(*) filter (where outcome = 'order_placed' and started_at >= date_trunc('month', now() at time zone ${ZURICH}) at time zone ${ZURICH})::int as month_order_calls,
      count(*) filter (where outcome::text like 'transferred%' and started_at >= date_trunc('month', now() at time zone ${ZURICH}) at time zone ${ZURICH})::int as month_transfers,
      coalesce(avg(duration_seconds) filter (where started_at >= date_trunc('month', now() at time zone ${ZURICH}) at time zone ${ZURICH}), 0)::int as avg_duration
    from calls
    where is_simulation = false and started_at > now() - interval '40 days' ${rFilter}
  `)) as unknown as {
    today_calls: number;
    live_calls: number;
    month_calls: number;
    month_order_calls: number;
    month_transfers: number;
    avg_duration: number;
  }[];

  return {
    todayOrders: ordersRow?.today_count ?? 0,
    todayVolume: ordersRow?.today_volume ?? 0,
    monthOrders: ordersRow?.month_count ?? 0,
    monthVolume: ordersRow?.month_volume ?? 0,
    monthCommission: commissionRow?.commission ?? 0,
    todayCalls: callsRow?.today_calls ?? 0,
    liveCalls: callsRow?.live_calls ?? 0,
    monthCalls: callsRow?.month_calls ?? 0,
    monthConversion: callsRow?.month_calls
      ? callsRow.month_order_calls / callsRow.month_calls
      : null,
    monthTransfers: callsRow?.month_transfers ?? 0,
    avgDuration: callsRow?.avg_duration ?? 0,
  };
}

/** Orders per local day for the last `days` days (zero-filled). */
export async function ordersPerDay(days = 14, restaurantId?: string) {
  const today = todayLocal();
  const from = addDays(today, -(days - 1));
  const rows = (await db.execute(sql`
    select order_date::text as day, count(*)::int as n, coalesce(sum(total_cents),0)::int as volume
    from orders
    where is_test = false and status <> 'cancelled' and order_date >= ${from} ${restaurantId ? sql`and restaurant_id = ${restaurantId}` : sql``}
    group by order_date
  `)) as unknown as { day: string; n: number; volume: number }[];
  const map = new Map(rows.map((r) => [r.day, r]));
  return Array.from({ length: days }, (_, i) => {
    const day = addDays(from, i);
    return { day, count: map.get(day)?.n ?? 0, volume: map.get(day)?.volume ?? 0 };
  });
}

export async function recentCalls(limit = 10, restaurantId?: string) {
  return db
    .select({
      id: calls.id,
      startedAt: calls.startedAt,
      fromNumber: calls.fromNumber,
      status: calls.status,
      outcome: calls.outcome,
      durationSeconds: calls.durationSeconds,
      isSimulation: calls.isSimulation,
      summary: calls.summary,
      restaurantName: restaurants.name,
      restaurantId: calls.restaurantId,
    })
    .from(calls)
    .leftJoin(restaurants, eq(restaurants.id, calls.restaurantId))
    .where(restaurantId ? eq(calls.restaurantId, restaurantId) : undefined)
    .orderBy(desc(calls.startedAt))
    .limit(limit);
}

/** Per-restaurant month-to-date summary for the overview table. */
export async function restaurantMonthSummary() {
  const monthStart = monthStartLocal();
  return (await db.execute(sql`
    select r.id, r.name, r.slug, r.status, r.commission_bps,
      (select count(*)::int from orders o where o.restaurant_id = r.id and o.is_test = false and o.status <> 'cancelled' and o.order_date >= ${monthStart}) as orders,
      (select coalesce(sum(o.total_cents),0)::int from orders o where o.restaurant_id = r.id and o.is_test = false and o.status <> 'cancelled' and o.order_date >= ${monthStart}) as volume,
      (select count(*)::int from calls c where c.restaurant_id = r.id and c.is_simulation = false and c.started_at >= ${monthStart}::date) as calls,
      (select string_agg(p.e164, ', ') from phone_numbers p where p.restaurant_id = r.id and p.is_active) as numbers
    from restaurants r
    where r.status <> 'archived'
    order by r.name
  `)) as unknown as {
    id: string;
    name: string;
    slug: string;
    status: string;
    commission_bps: number;
    orders: number;
    volume: number;
    calls: number;
    numbers: string | null;
  }[];
}

export async function liveOrders(restaurantId: string, since: string) {
  return db
    .select()
    .from(orders)
    .where(and(eq(orders.restaurantId, restaurantId), gte(orders.orderDate, since)))
    .orderBy(desc(orders.createdAt))
    .limit(200);
}
