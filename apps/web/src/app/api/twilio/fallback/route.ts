import { toE164 } from "@justcall/core";
import { calls, findRestaurantByNumber } from "@justcall/db";
import { validateTwilioSignature } from "@justcall/services";
import { env } from "@/lib/env";
import { db } from "@/server/db";

export const dynamic = "force-dynamic";

function twiml(body: string) {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`, {
    headers: { "content-type": "text/xml" },
  });
}
function esc(s: string) {
  return s.replace(
    /[<>&"']/g,
    (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!,
  );
}

/**
 * Twilio "voice fallback URL": called when the voice server does not answer. Forwards the caller
 * directly to the restaurant so no call is lost, and records the incident in the call log.
 */
export async function POST(req: Request) {
  const params = Object.fromEntries(new URLSearchParams(await req.text())) as Record<
    string,
    string
  >;
  if (process.env.TWILIO_VALIDATE_SIGNATURES !== "false") {
    const ok = validateTwilioSignature(
      req.headers.get("x-twilio-signature") ?? undefined,
      `${env.appUrl}/api/twilio/fallback`,
      params,
    );
    if (!ok) return new Response("invalid signature", { status: 403 });
  }
  const to = toE164(params.To) ?? params.To ?? "";
  const match = to ? await findRestaurantByNumber(db, to).catch(() => null) : null;
  const restaurant = match?.restaurant;
  if (restaurant && params.CallSid) {
    await db
      .insert(calls)
      .values({
        restaurantId: restaurant.id,
        phoneNumberId: match?.phoneNumber.id,
        providerCallSid: params.CallSid,
        fromNumber: toE164(params.From) ?? null,
        toNumber: to,
        status: restaurant.transferPhone ? "transferred" : "failed",
        outcome: "error",
        transferTarget: restaurant.transferPhone,
        error: `Voice server unavailable – fallback (${params.ErrorCode ?? "no error code"})`,
      })
      .onConflictDoUpdate({
        target: calls.providerCallSid,
        set: {
          status: restaurant.transferPhone ? "transferred" : "failed",
          outcome: "error",
          error: "Voice server unavailable – fallback",
        },
      })
      .catch(() => undefined);
  }
  if (restaurant?.transferPhone) {
    return twiml(
      `<Say language="de-DE">Einen Moment bitte, Sie werden mit ${esc(restaurant.name)} verbunden.</Say><Dial timeout="30">${esc(restaurant.transferPhone)}</Dial>`,
    );
  }
  return twiml(
    `<Say language="de-DE">Entschuldigung, im Moment ist niemand erreichbar. Bitte versuchen Sie es später nochmals.</Say><Hangup/>`,
  );
}
