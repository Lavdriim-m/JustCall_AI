"use server";

import { toE164 } from "@justcall/core";
import { eq, phoneNumbers } from "@justcall/db";
import {
  configureNumberWebhooks,
  isTwilioConfigured,
  listIncomingNumbers,
  purchaseNumber,
  searchAvailableNumbers,
} from "@justcall/services";
import { revalidatePath } from "next/cache";
import { env } from "@/lib/env";
import { audit } from "../audit";
import { db } from "../db";
import { requireAdmin } from "../session";
import { fail, ok, type ActionResult } from "./helpers";

/** Twilio calls this web app URL when the voice server is unreachable (forwards to the restaurant). */
function fallbackUrl() {
  return env.appUrl.startsWith("https://") ? `${env.appUrl}/api/twilio/fallback` : null;
}

function refresh(restaurantId?: string | null) {
  revalidatePath("/admin/numbers");
  if (restaurantId) revalidatePath(`/admin/restaurants/${restaurantId}`, "layout");
}

/** Connects a number to a restaurant. Twilio numbers get their webhooks configured automatically. */
export async function connectNumber(
  restaurantId: string,
  input: {
    e164: string;
    providerSid?: string | null;
    label?: string | null;
    forwardedFrom?: string | null;
  },
): Promise<ActionResult> {
  const admin = await requireAdmin();
  const e164 = toE164(input.e164);
  if (!e164) return fail("Invalid phone number (use international format, e.g. +41 44 123 45 67).");
  const forwardedFrom = input.forwardedFrom ? toE164(input.forwardedFrom) : null;
  if (input.forwardedFrom && !forwardedFrom) return fail("Invalid forwarded-from number.");

  let providerSid = input.providerSid ?? null;
  if (!providerSid && isTwilioConfigured()) {
    const numbers = await listIncomingNumbers().catch(() => []);
    providerSid = numbers.find((n) => n.phoneNumber === e164)?.sid ?? null;
  }

  const [existing] = await db
    .select()
    .from(phoneNumbers)
    .where(eq(phoneNumbers.e164, e164))
    .limit(1);
  if (existing?.restaurantId && existing.restaurantId !== restaurantId) {
    return fail(
      "This number is already connected to another restaurant. Disconnect it there first.",
    );
  }
  let webhookConfiguredAt: Date | null = existing?.webhookConfiguredAt ?? null;
  let warning: string | null = null;
  if (providerSid && isTwilioConfigured()) {
    try {
      await configureNumberWebhooks(providerSid, env.voiceUrl, process.env, fallbackUrl());
      webhookConfiguredAt = new Date();
    } catch (err) {
      warning = `Saved, but configuring Twilio failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  } else {
    warning =
      "Saved. Twilio is not configured or the number is not in your Twilio account – set the voice webhook manually (see instructions).";
  }

  if (existing) {
    await db
      .update(phoneNumbers)
      .set({
        restaurantId,
        providerSid,
        label: input.label ?? existing.label,
        forwardedFrom,
        isActive: true,
        webhookConfiguredAt,
      })
      .where(eq(phoneNumbers.id, existing.id));
  } else {
    await db.insert(phoneNumbers).values({
      e164,
      restaurantId,
      providerSid,
      label: input.label ?? null,
      forwardedFrom,
      webhookConfiguredAt,
    });
  }
  await audit(admin.id, "phone.connect", { restaurantId, data: { e164 } });
  refresh(restaurantId);
  return warning
    ? { ok: true, message: warning }
    : ok("Number connected – calls are now answered by the assistant");
}

export async function disconnectNumber(numberId: string): Promise<ActionResult> {
  const admin = await requireAdmin();
  const [n] = await db.select().from(phoneNumbers).where(eq(phoneNumbers.id, numberId)).limit(1);
  if (!n) return fail("Number not found");
  await db.update(phoneNumbers).set({ restaurantId: null }).where(eq(phoneNumbers.id, numberId));
  await audit(admin.id, "phone.disconnect", {
    restaurantId: n.restaurantId,
    data: { e164: n.e164 },
  });
  refresh(n.restaurantId);
  return ok("Number disconnected");
}

export async function reconfigureWebhooks(numberId: string): Promise<ActionResult> {
  await requireAdmin();
  const [n] = await db.select().from(phoneNumbers).where(eq(phoneNumbers.id, numberId)).limit(1);
  if (!n?.providerSid) return fail("This number has no Twilio SID.");
  try {
    await configureNumberWebhooks(n.providerSid, env.voiceUrl, process.env, fallbackUrl());
    await db
      .update(phoneNumbers)
      .set({ webhookConfiguredAt: new Date() })
      .where(eq(phoneNumbers.id, numberId));
    refresh(n.restaurantId);
    return ok(`Webhooks point to ${env.voiceUrl}/twilio/voice`);
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

export async function searchNumbersAction(input: {
  type: "local" | "mobile" | "national";
  contains?: string;
}): Promise<ActionResult> {
  await requireAdmin();
  if (!isTwilioConfigured()) return fail("Twilio is not configured.");
  try {
    const numbers = await searchAvailableNumbers({
      country: "CH",
      type: input.type,
      contains: input.contains,
      limit: 20,
    });
    return { ok: true, data: numbers };
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

export async function buyNumberAction(
  phoneNumber: string,
  restaurantId: string | null,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!isTwilioConfigured()) return fail("Twilio is not configured.");
  try {
    const bought = await purchaseNumber(phoneNumber, env.voiceUrl, process.env, fallbackUrl());
    await db
      .insert(phoneNumbers)
      .values({
        e164: bought.phoneNumber,
        providerSid: bought.sid,
        restaurantId,
        label: bought.friendlyName,
        webhookConfiguredAt: new Date(),
      })
      .onConflictDoUpdate({
        target: phoneNumbers.e164,
        set: { providerSid: bought.sid, restaurantId, webhookConfiguredAt: new Date() },
      });
    await audit(admin.id, "phone.purchase", { restaurantId, data: { phoneNumber } });
    refresh(restaurantId);
    return ok(`Purchased ${bought.phoneNumber}`);
  } catch (err) {
    return fail(
      `Purchase failed: ${err instanceof Error ? err.message : String(err)}. Swiss numbers require an approved regulatory bundle (TWILIO_CH_BUNDLE_SID).`,
    );
  }
}
