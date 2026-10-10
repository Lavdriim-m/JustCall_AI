import { and, calls, desc, eq, gte, lt, restaurants, sql, type SQL } from "@justcall/db";
import { Filters, Pagination } from "@/components/filters";
import { CallsTable } from "@/components/tables";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { db } from "@/server/db";

export const metadata = { title: "Calls" };
const PAGE = 50;

type SP = {
  restaurant?: string;
  outcome?: string;
  from?: string;
  to?: string;
  tests?: string;
  page?: string;
};

export default async function CallsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1));
  const where: SQL[] = [];
  if (sp.restaurant) where.push(eq(calls.restaurantId, sp.restaurant));
  if (sp.outcome === "transferred") where.push(sql`${calls.outcome}::text like 'transferred%'`);
  else if (sp.outcome === "live") where.push(sql`${calls.status} in ('ringing','in_progress')`);
  else if (sp.outcome) where.push(eq(calls.outcome, sp.outcome as never));
  if (sp.from) where.push(gte(calls.startedAt, new Date(`${sp.from}T00:00:00`)));
  if (sp.to)
    where.push(lt(calls.startedAt, new Date(new Date(`${sp.to}T00:00:00`).getTime() + 86400_000)));
  if (sp.tests !== "1") where.push(eq(calls.isSimulation, false));

  const [rows, restaurantList] = await Promise.all([
    db
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
      })
      .from(calls)
      .leftJoin(restaurants, eq(restaurants.id, calls.restaurantId))
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(calls.startedAt))
      .limit(PAGE + 1)
      .offset((page - 1) * PAGE),
    db
      .select({ id: restaurants.id, name: restaurants.name })
      .from(restaurants)
      .orderBy(restaurants.name),
  ]);

  return (
    <>
      <PageHeader title="Calls" description="Every call with transcript, outcome and cost data." />
      <Card>
        <Filters
          action="/admin/calls"
          values={sp}
          fields={[
            {
              type: "select",
              name: "restaurant",
              label: "Restaurant",
              options: restaurantList.map((r) => ({ value: r.id, label: r.name })),
            },
            {
              type: "select",
              name: "outcome",
              label: "Outcome",
              options: [
                { value: "order_placed", label: "Order placed" },
                { value: "transferred", label: "Transferred (all)" },
                { value: "transferred_allergy", label: "Transferred · allergy" },
                { value: "transferred_owner", label: "Transferred · owner" },
                { value: "no_order", label: "No order" },
                { value: "error", label: "Error" },
                { value: "live", label: "Live now" },
              ],
            },
            { type: "date", name: "from", label: "From" },
            { type: "date", name: "to", label: "To" },
            { type: "checkbox", name: "tests", label: "Include tests" },
          ]}
        />
        <CallsTable rows={rows.slice(0, PAGE)} />
        <Pagination page={page} hasMore={rows.length > PAGE} base="/admin/calls" params={sp} />
      </Card>
    </>
  );
}
