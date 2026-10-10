import { formatChf } from "@justcall/core";
import { and, desc, eq, gte, lte, orders, restaurants, sql, type SQL } from "@justcall/db";
import { Filters, Pagination } from "@/components/filters";
import { OrdersTable } from "@/components/tables";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { db } from "@/server/db";

export const metadata = { title: "Orders" };
const PAGE = 50;

type SP = {
  restaurant?: string;
  status?: string;
  from?: string;
  to?: string;
  tests?: string;
  page?: string;
};

export default async function OrdersPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1));
  const where: SQL[] = [];
  if (sp.restaurant) where.push(eq(orders.restaurantId, sp.restaurant));
  if (sp.status) where.push(eq(orders.status, sp.status as never));
  if (sp.from) where.push(gte(orders.orderDate, sp.from));
  if (sp.to) where.push(lte(orders.orderDate, sp.to));
  if (sp.tests !== "1") where.push(eq(orders.isTest, false));
  const filter = where.length ? and(...where) : undefined;

  const [rows, [totals], restaurantList] = await Promise.all([
    db
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        orderDate: orders.orderDate,
        createdAt: orders.createdAt,
        status: orders.status,
        fulfillment: orders.fulfillment,
        customerName: orders.customerName,
        customerPhone: orders.customerPhone,
        totalCents: orders.totalCents,
        paymentMethod: orders.paymentMethod,
        isTest: orders.isTest,
        isBillable: orders.isBillable,
        estimatedReadyAt: orders.estimatedReadyAt,
        restaurantName: restaurants.name,
      })
      .from(orders)
      .leftJoin(restaurants, eq(restaurants.id, orders.restaurantId))
      .where(filter)
      .orderBy(desc(orders.createdAt))
      .limit(PAGE + 1)
      .offset((page - 1) * PAGE),
    db
      .select({
        n: sql<number>`count(*)::int`,
        volume: sql<number>`coalesce(sum(${orders.totalCents}),0)::int`,
      })
      .from(orders)
      .where(filter),
    db
      .select({ id: restaurants.id, name: restaurants.name })
      .from(restaurants)
      .orderBy(restaurants.name),
  ]);

  return (
    <>
      <PageHeader
        title="Orders"
        description={`${totals?.n ?? 0} orders · ${formatChf(totals?.volume ?? 0)} for the current filter`}
      />
      <Card>
        <Filters
          action="/admin/orders"
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
              name: "status",
              label: "Status",
              options: ["new", "accepted", "ready", "completed", "cancelled"].map((s) => ({
                value: s,
                label: s,
              })),
            },
            { type: "date", name: "from", label: "From" },
            { type: "date", name: "to", label: "To" },
            { type: "checkbox", name: "tests", label: "Include tests" },
          ]}
        />
        <OrdersTable rows={rows.slice(0, PAGE)} />
        <Pagination page={page} hasMore={rows.length > PAGE} base="/admin/orders" params={sp} />
      </Card>
    </>
  );
}
