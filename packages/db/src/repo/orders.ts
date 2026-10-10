import { getLocalParts, type OrderDraft } from "@justcall/core";
import { sql } from "drizzle-orm";
import type { Database } from "../client";
import { orderCounters, orderItems, orders, type Order } from "../schema";

export type CreateOrderInput = {
  draft: OrderDraft;
  timezone: string;
  callId?: string | null;
  isTest?: boolean;
  now?: Date;
};

/**
 * Persists a confirmed order and allocates the next order number for the restaurant's local
 * business day (101, 102, …). Safe under concurrency: the counter row is updated atomically.
 */
export async function createOrder(db: Database, input: CreateOrderInput): Promise<Order> {
  const { draft, timezone } = input;
  const orderDate = getLocalParts(input.now ?? new Date(), timezone).date;
  return db.transaction(async (tx) => {
    const [counter] = await tx
      .insert(orderCounters)
      .values({ restaurantId: draft.restaurantId, orderDate, lastNumber: 101 })
      .onConflictDoUpdate({
        target: [orderCounters.restaurantId, orderCounters.orderDate],
        set: { lastNumber: sql`${orderCounters.lastNumber} + 1` },
      })
      .returning();
    const [order] = await tx
      .insert(orders)
      .values({
        restaurantId: draft.restaurantId,
        callId: input.callId ?? null,
        orderDate,
        orderNumber: counter!.lastNumber,
        status: "new",
        fulfillment: draft.fulfillment,
        requestedFor: draft.requestedFor,
        estimatedReadyAt: draft.estimatedReadyAt,
        customerName: draft.customerName,
        customerPhone: draft.customerPhone,
        deliveryAddress: draft.deliveryAddress
          ? {
              street: draft.deliveryAddress.street,
              postalCode: draft.deliveryAddress.postalCode,
              city: draft.deliveryAddress.city,
              notes: draft.deliveryAddress.notes,
            }
          : null,
        paymentMethod: draft.paymentMethod,
        notes: draft.notes,
        subtotalCents: draft.subtotalCents,
        deliveryFeeCents: draft.deliveryFeeCents,
        totalCents: draft.totalCents,
        isTest: input.isTest ?? false,
        isBillable: !(input.isTest ?? false),
      })
      .returning();
    if (draft.lines.length) {
      await tx.insert(orderItems).values(
        draft.lines.map((l, i) => ({
          orderId: order!.id,
          menuItemId: isUuid(l.itemId) ? l.itemId : null,
          name: l.name,
          quantity: l.quantity,
          unitPriceCents: l.unitPriceCents,
          options: l.options.map((o) => ({
            groupName: o.groupName,
            optionName: o.optionName,
            optionId: isUuid(o.optionId) ? o.optionId : undefined,
            priceDeltaCents: o.priceDeltaCents,
          })),
          notes: l.notes,
          lineTotalCents: l.lineTotalCents,
          sortOrder: i,
        })),
      );
    }
    return order!;
  });
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
