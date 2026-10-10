"use server";

import { signToken } from "@justcall/core";
import { env } from "@/lib/env";
import { requireRestaurantAccess } from "../session";

/** Short-lived token that lets the browser open a simulated call on the voice server. */
export async function createSimulatorSession(restaurantId: string) {
  const access = await requireRestaurantAccess(restaurantId, "owner");
  const token = await signToken(
    { restaurantId: access.restaurant.id, userId: access.user.id, purpose: "simulator" },
    env.internalSecret,
    600,
  );
  const wsUrl = `${env.voiceUrl.replace(/^http/, "ws")}/sim?token=${encodeURIComponent(token)}`;
  return { wsUrl };
}
