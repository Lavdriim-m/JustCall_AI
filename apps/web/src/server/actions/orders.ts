"use server";

import { and, eq, orders } from "@justcall/db";
import { revalidatePath } from "next/cache";
import { audit } from "../audit";
import { db } from "../db";
import { requireAdmin, requireRestaurantAccess } from "../session";
import { fail, ok, type ActionResult } from "./helpers";

type Status = "new" | "accepted" | "ready" | "completed" | "cancelled";

/** Moves an order through the kitchen workflow (restaurant staff or admins). */
export async function setOrderStatus(
  orderId: string,
  status: Status,
  reason?: string,
): Promise<ActionResult> {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order) return fail("Order not found");
  const access = await requireRestaurantAccess(order.restaurantId, "staff");
  const now = new Date();
  await db
    .update(orders)
    .set({
      status,
      acceptedAt: status === "accepted" ? now : order.acceptedAt,
      readyAt: status === "ready" ? now : order.readyAt,
      completedAt: status === "completed" ? now : order.completedAt,
      cancelledAt: status === "cancelled" ? now : null,
      cancelledReason: status === "cancelled" ? reason?.trim() || "Storniert" : null,
    })
    .where(and(eq(orders.id, orderId), eq(orders.restaurantId, order.restaurantId)));
  await audit(access.user.id, `order.${status}`, {
    restaurantId: order.restaurantId,
    entity: "order",
    entityId: orderId,
    data: { reason },
  });
  revalidatePath(`/r/${access.restaurant.slug}/orders`);
  revalidatePath(`/admin/orders/${orderId}`);
  return ok();
}

/** Admin only: exclude/include an order from the commission (e.g. disputed or fraudulent orders). */
export async function setOrderBillable(
  orderId: string,
  isBillable: boolean,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order) return fail("Order not found");
  await db.update(orders).set({ isBillable }).where(eq(orders.id, orderId));
  await audit(admin.id, "order.billable", {
    restaurantId: order.restaurantId,
    entityId: orderId,
    data: { isBillable },
  });
  revalidatePath(`/admin/orders/${orderId}`);
  return ok(isBillable ? "Order counts towards the commission" : "Order excluded from billing");
}
