import { addDays } from "@justcall/core";
import { and, asc, desc, eq, gte, inArray, orderItems, orders } from "@justcall/db";
import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { todayLocal } from "@/server/queries";
import { getRestaurantAccess } from "@/server/session";

export const dynamic = "force-dynamic";

/** Live orders for the orders board (polled every few seconds). */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const access = await getRestaurantAccess(slug);
  if (!access) return NextResponse.json({ error: "not found" }, { status: 404 });
  const r = access.restaurant;
  const since = addDays(todayLocal(), -1);
  const rows = await db
    .select()
    .from(orders)
    .where(and(eq(orders.restaurantId, r.id), gte(orders.orderDate, since)))
    .orderBy(desc(orders.createdAt))
    .limit(300);
  const items = rows.length
    ? await db
        .select()
        .from(orderItems)
        .where(
          inArray(
            orderItems.orderId,
            rows.map((o) => o.id),
          ),
        )
        .orderBy(asc(orderItems.sortOrder))
    : [];
  return NextResponse.json(
    {
      restaurant: {
        acceptingOrders: r.acceptingOrders,
        extraWaitMinutes: r.extraWaitMinutes,
        status: r.status,
        timezone: r.timezone,
      },
      orders: rows.map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        orderDate: o.orderDate,
        status: o.status,
        fulfillment: o.fulfillment,
        requestedFor: o.requestedFor,
        estimatedReadyAt: o.estimatedReadyAt,
        customerName: o.customerName,
        customerPhone: o.customerPhone,
        deliveryAddress: o.deliveryAddress,
        paymentMethod: o.paymentMethod,
        notes: o.notes,
        totalCents: o.totalCents,
        isTest: o.isTest,
        createdAt: o.createdAt,
        items: items
          .filter((i) => i.orderId === o.id)
          .map((i) => ({
            id: i.id,
            name: i.name,
            quantity: i.quantity,
            options: i.options.map((x) => x.optionName),
            notes: i.notes,
          })),
      })),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
