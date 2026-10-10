import { calls, desc, eq, orders, restaurants } from "@justcall/db";
import { notFound } from "next/navigation";
import { CallsTable, OrdersTable } from "@/components/tables";
import { Card, CardHeader } from "@/components/ui/card";
import { db } from "@/server/db";
import { getRestaurantAccess } from "@/server/session";

export default async function ActivityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await getRestaurantAccess(id);
  if (!access) notFound();
  const r = access.restaurant;
  const [callRows, orderRows] = await Promise.all([
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
      .where(eq(calls.restaurantId, r.id))
      .orderBy(desc(calls.startedAt))
      .limit(50),
    db
      .select()
      .from(orders)
      .where(eq(orders.restaurantId, r.id))
      .orderBy(desc(orders.createdAt))
      .limit(50),
  ]);
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Latest orders" />
        <OrdersTable rows={orderRows} showRestaurant={false} />
      </Card>
      <Card>
        <CardHeader title="Latest calls" />
        <CallsTable rows={callRows} showRestaurant={false} />
      </Card>
    </div>
  );
}
