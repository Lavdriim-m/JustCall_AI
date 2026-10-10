import {
  defaultGreeting,
  getOpenState,
  isAnonymousCaller,
  normalizeForSpeech,
  signToken,
  toE164,
  verifyToken,
  type TransferReason,
} from "@justcall/core";
import { createLlmClient } from "@justcall/core/llm";
import {
  appendCallEvent,
  calls,
  createCall,
  eq,
  findRestaurantByNumber,
  updateCall,
} from "@justcall/db";
import {
  hangupCall,
  requireTwilio,
  transferCall,
  validateTwilioSignature,
} from "@justcall/services";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { WebSocket } from "ws";
import { wsUrl } from "../config";
import { CallPersistence } from "../call/persistence";
import { CallSession, type CallTransport } from "../call/session";
import type { AppContext } from "../context";
import { getTtsProvider } from "../tts";

function xml(body: string) {
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`;
}
function esc(s: string) {
  return s.replace(
    /[<>&"']/g,
    (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!,
  );
}
/** Fallback speech by the carrier (used only when our own pipeline cannot run). */
function say(text: string) {
  return `<Say language="de-DE" voice="Polly.Vicki-Neural">${esc(text)}</Say>`;
}

export function registerTwilioRoutes(app: FastifyInstance, ctx: AppContext) {
  const { config, db, logger } = ctx;
  const publicBase = config.VOICE_PUBLIC_URL.replace(/\/$/, "");

  const verify = (req: FastifyRequest, reply: FastifyReply): boolean => {
    if (!config.TWILIO_VALIDATE_SIGNATURES) return true;
    const signature = req.headers["x-twilio-signature"] as string | undefined;
    const url = `${publicBase}${req.url}`;
    const ok = validateTwilioSignature(signature, url, (req.body ?? {}) as Record<string, string>);
    if (!ok) {
      logger.warn({ url }, "invalid Twilio signature");
      void reply.code(403).send("invalid signature");
    }
    return ok;
  };

  /** Incoming call: find the restaurant behind the dialled number and connect the media stream. */
  app.post("/twilio/voice", async (req, reply) => {
    if (!verify(req, reply)) return;
    const body = req.body as Record<string, string>;
    const to = toE164(body.To) ?? String(body.To ?? "");
    const from = isAnonymousCaller(body.From) ? null : (toE164(body.From) ?? body.From);
    reply.type("text/xml");

    const match = await findRestaurantByNumber(db, to);
    const restaurant = match?.restaurant ?? null;
    if (
      !match ||
      !restaurant ||
      restaurant.status === "archived" ||
      restaurant.status === "draft"
    ) {
      logger.warn({ to }, "call to unassigned or inactive number");
      return xml(`${say("Diese Nummer ist zurzeit nicht in Betrieb. Auf Wiederhören.")}<Hangup/>`);
    }

    const call = await createCall(db, {
      restaurantId: restaurant.id,
      phoneNumberId: match.phoneNumber.id,
      providerCallSid: body.CallSid,
      fromNumber: from,
      toNumber: to,
      status: "ringing",
    }).catch(async () => {
      // Twilio retries webhooks – reuse an existing row for the same CallSid.
      const [existing] = await db
        .select()
        .from(calls)
        .where(eq(calls.providerCallSid, body.CallSid!))
        .limit(1);
      return existing!;
    });

    // Bot switched off by the restaurant (busy/paused): forward straight to staff when possible.
    if (
      (restaurant.status === "paused" || !restaurant.acceptingOrders) &&
      restaurant.transferPhone
    ) {
      await updateCall(db, call.id, {
        status: "transferred",
        outcome: "paused",
        transferTarget: restaurant.transferPhone,
      });
      return xml(`<Dial timeout="25">${esc(restaurant.transferPhone)}</Dial>`);
    }

    // Synthesise the greeting while Twilio opens the media stream (cached for the session).
    void prewarmGreeting(ctx, restaurant.id);

    const token = await signToken(
      { callId: call.id, sid: body.CallSid },
      config.INTERNAL_API_SECRET || "dev-secret-change-me-please",
      3600,
    );
    const streamUrl = wsUrl(publicBase, "/twilio/stream");
    return xml(
      `<Connect><Stream url="${esc(streamUrl)}"><Parameter name="callId" value="${esc(call.id)}"/><Parameter name="token" value="${esc(token)}"/></Stream></Connect>`,
    );
  });

  /** Call status callback (completed, busy, failed …) for duration and cleanup. */
  app.post("/twilio/status", async (req, reply) => {
    if (!verify(req, reply)) return;
    const body = req.body as Record<string, string>;
    if (!body.CallSid) return reply.code(204).send();
    const [call] = await db
      .select()
      .from(calls)
      .where(eq(calls.providerCallSid, body.CallSid))
      .limit(1);
    if (call) {
      const finalStatuses = ["completed", "busy", "failed", "no-answer", "canceled"];
      if (finalStatuses.includes(body.CallStatus ?? "")) {
        await updateCall(db, call.id, {
          durationSeconds: body.CallDuration ? Number(body.CallDuration) : call.durationSeconds,
          endedAt: call.endedAt ?? new Date(),
          status:
            call.status === "ringing" || call.status === "in_progress"
              ? body.CallStatus === "completed"
                ? "completed"
                : "failed"
              : call.status,
        });
      }
    }
    return reply.code(204).send();
  });

  /** Result of the <Dial> to the restaurant after a transfer. */
  app.post("/twilio/transfer-status", async (req, reply) => {
    if (!verify(req, reply)) return;
    const body = req.body as Record<string, string>;
    const callId = (req.query as Record<string, string>).callId;
    reply.type("text/xml");
    const status = body.DialCallStatus;
    if (callId) {
      await appendCallEvent(db, callId, {
        kind: "event",
        content: `Weiterleitung: ${status}`,
      }).catch(() => undefined);
    }
    if (status === "completed" || status === "answered") return xml("<Hangup/>");
    if (callId)
      await updateCall(db, callId, { error: `Transfer not answered (${status})` }).catch(
        () => undefined,
      );
    return xml(
      `${say("Leider ist im Moment niemand erreichbar. Bitte versuchen Sie es in ein paar Minuten nochmals. Auf Wiederhören.")}<Hangup/>`,
    );
  });

  /** Twilio Media Stream (bidirectional audio). */
  app.get("/twilio/stream", { websocket: true }, (socket: WebSocket) => {
    let session: CallSession | null = null;
    let stopped = false;
    let streamSid: string | null = null;
    let callSid: string | null = null;
    let callId: string | null = null;

    const transport: CallTransport = {
      kind: "twilio",
      sendAudio(mulaw) {
        if (socket.readyState !== socket.OPEN || !streamSid) return;
        socket.send(
          JSON.stringify({
            event: "media",
            streamSid,
            media: { payload: mulaw.toString("base64") },
          }),
        );
      },
      sendMark(name) {
        if (socket.readyState !== socket.OPEN || !streamSid) return;
        socket.send(JSON.stringify({ event: "mark", streamSid, mark: { name } }));
      },
      clearAudio() {
        if (socket.readyState !== socket.OPEN || !streamSid) return;
        socket.send(JSON.stringify({ event: "clear", streamSid }));
      },
      async transfer(target: string, _reason: TransferReason, fallbackSay?: string) {
        if (!callSid) throw new Error("No CallSid");
        const actionUrl = `${publicBase}/twilio/transfer-status?callId=${encodeURIComponent(callId ?? "")}`;
        if (fallbackSay) {
          // Our TTS failed – let the carrier speak and dial.
          await requireTwilio()
            .calls(callSid)
            .update({
              twiml: xml(
                `${say(fallbackSay)}<Dial timeout="25" action="${esc(actionUrl)}" method="POST">${esc(target)}</Dial>`,
              ),
            });
          return;
        }
        await transferCall(callSid, target, { actionUrl, timeoutSeconds: 25 });
      },
      async hangup() {
        if (callSid) await hangupCall(callSid);
      },
    };

    socket.on("message", async (raw: Buffer) => {
      let msg: Record<string, any>;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      switch (msg.event) {
        case "start": {
          streamSid = msg.start?.streamSid ?? msg.streamSid;
          callSid = msg.start?.callSid ?? null;
          const params = (msg.start?.customParameters ?? {}) as Record<string, string>;
          const payload = await verifyToken<{ callId: string; sid: string }>(
            params.token ?? "",
            config.INTERNAL_API_SECRET || "dev-secret-change-me-please",
          );
          if (!payload || payload.callId !== params.callId) {
            logger.warn("media stream with invalid token");
            socket.close();
            return;
          }
          callId = payload.callId;
          try {
            session = await createPhoneSession(ctx, callId, transport);
            ctx.registry.add(callId, session);
            // The caller may have hung up while the session was starting.
            if (stopped) {
              await session.onStop("caller_hangup_during_start");
              ctx.registry.remove(callId);
            }
          } catch (err) {
            logger.error({ err, callId }, "could not start call session");
            if (callId)
              await updateCall(db, callId, {
                status: "failed",
                outcome: "error",
                error: String(err),
              }).catch(() => undefined);
            // Last resort: forward the caller to the restaurant if possible.
            await fallbackForward(ctx, callId, callSid).catch(() => undefined);
            socket.close();
          }
          break;
        }
        case "media": {
          if (session && msg.media?.payload && (msg.media.track ?? "inbound") === "inbound") {
            session.onAudio(Buffer.from(msg.media.payload, "base64"));
          }
          break;
        }
        case "mark":
          if (msg.mark?.name) session?.onMark(msg.mark.name);
          break;
        case "stop":
          stopped = true;
          await session?.onStop("stream_stopped");
          if (callId) ctx.registry.remove(callId);
          break;
      }
    });

    socket.on("close", async () => {
      stopped = true;
      await session?.onStop("socket_closed");
      if (callId) ctx.registry.remove(callId);
    });
    socket.on("error", (err) => logger.warn({ err }, "media stream socket error"));
  });
}

async function createPhoneSession(
  ctx: AppContext,
  callId: string,
  transport: CallTransport,
): Promise<CallSession> {
  const { db, config, logger } = ctx;
  const [call] = await db.select().from(calls).where(eq(calls.id, callId)).limit(1);
  if (!call || !call.restaurantId) throw new Error("Call not found");
  const bundle = await ctx.restaurants.get(call.restaurantId);
  if (!bundle) throw new Error("Restaurant not found");
  const llm = createLlmClient({ model: bundle.row.llmModel });
  const tts = getTtsProvider(config, bundle.row.ttsProvider);
  const persistence = new CallPersistence({
    db,
    logger: logger.child({ callId }),
    callId,
    restaurant: bundle.row,
    profile: bundle.profile,
    isSimulation: false,
    appUrl: config.APP_URL,
  });
  const session = new CallSession({
    config,
    logger: logger.child({ callId, restaurant: bundle.row.slug }),
    db,
    callId,
    restaurant: bundle.profile,
    menu: bundle.menu,
    phrases: bundle.phrases,
    callerPhone: call.fromNumber,
    transport,
    mode: "voice",
    llm,
    tts,
    ttsVoice: bundle.row.ttsVoice,
    sttProvider: bundle.row.sttProvider,
    persistence,
    isSimulation: false,
  });
  await session.start();
  return session;
}

/** If the AI pipeline cannot start, forward the caller to the restaurant instead of dropping the call. */
async function fallbackForward(ctx: AppContext, callId: string | null, callSid: string | null) {
  if (!callId || !callSid) return;
  const [call] = await ctx.db.select().from(calls).where(eq(calls.id, callId)).limit(1);
  if (!call?.restaurantId) return;
  const bundle = await ctx.restaurants.get(call.restaurantId).catch(() => null);
  const target = bundle?.row.transferPhone;
  const twiml = target
    ? xml(
        `${say("Einen Moment bitte, ich verbinde Sie mit dem Restaurant.")}<Dial timeout="25">${esc(target)}</Dial>`,
      )
    : xml(
        `${say("Entschuldigung, ein technisches Problem ist aufgetreten. Bitte rufen Sie später nochmals an.")}<Hangup/>`,
      );
  await requireTwilio().calls(callSid).update({ twiml });
}

async function prewarmGreeting(ctx: AppContext, restaurantId: string) {
  try {
    const bundle = await ctx.restaurants.get(restaurantId);
    if (!bundle) return;
    const p = bundle.profile;
    if (!getOpenState(new Date(), p.openingHours, p.hoursExceptions, p.timezone).isOpen) return;
    const tts = getTtsProvider(ctx.config, bundle.row.ttsProvider);
    await tts.synthesize(normalizeForSpeech(defaultGreeting(p)), { voice: bundle.row.ttsVoice });
  } catch {
    // Best effort – the session synthesises it again if needed.
  }
}
