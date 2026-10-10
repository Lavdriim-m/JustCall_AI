import { toE164, verifyToken } from "@justcall/core";
import { createLlmClientOrDemo } from "@justcall/core/llm";
import { createCall } from "@justcall/db";
import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import { CallPersistence } from "../call/persistence";
import { CallSession, type CallTransport } from "../call/session";
import type { AppContext } from "../context";
import { getTtsProvider } from "../tts";

type SimToken = { restaurantId: string; userId: string; purpose: string };

/**
 * Browser test calls. The web app issues a short-lived signed token; the browser then talks to the
 * very same conversation pipeline as a real phone call – either by text or with the microphone
 * (μ-law 8 kHz frames, Twilio-compatible messages).
 */
export function registerSimulatorRoutes(app: FastifyInstance, ctx: AppContext) {
  const { config, db, logger } = ctx;

  app.get("/sim", { websocket: true }, (socket: WebSocket, req) => {
    const token = (req.query as Record<string, string>).token ?? "";
    // Listeners must be attached synchronously, otherwise the client's first message can be lost.
    const verified = verifyToken<SimToken>(
      token,
      config.INTERNAL_API_SECRET || "dev-secret-change-me-please",
    ).then((p) => {
      if (!p || p.purpose !== "simulator") {
        socket.send(
          JSON.stringify({ type: "error", message: "Ungültiges oder abgelaufenes Token" }),
        );
        socket.close();
        return null;
      }
      return p;
    });
    let session: CallSession | null = null;
    let callId: string | null = null;
    const send = (data: Record<string, unknown>) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(data));
    };

    const transport: CallTransport = {
      kind: "simulator",
      sendAudio(mulaw) {
        send({ type: "media", payload: mulaw.toString("base64") });
      },
      sendMark(name) {
        send({ type: "mark", name });
      },
      clearAudio() {
        send({ type: "clear" });
      },
      async transfer(target, reason) {
        send({ type: "transfer", target, reason });
        setTimeout(() => void session?.onStop("transferred").then(() => socket.close()), 500);
      },
      async hangup() {
        send({ type: "hangup" });
        setTimeout(() => void session?.onStop("hangup").then(() => socket.close()), 300);
      },
      emit(event) {
        send(event);
      },
    };

    let starting = false;
    socket.on("message", async (raw: Buffer) => {
      let msg: Record<string, any>;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      const payload = await verified;
      if (!payload) return;
      try {
        if (msg.type === "start" && !session && !starting) {
          starting = true;
          const bundle = await ctx.restaurants.get(payload.restaurantId);
          if (!bundle) {
            send({ type: "error", message: "Restaurant nicht gefunden" });
            return;
          }
          const mode = msg.mode === "voice" ? "voice" : "text";
          const callerPhone = toE164(String(msg.callerPhone ?? "")) ?? null;
          const call = await createCall(db, {
            restaurantId: bundle.row.id,
            fromNumber: callerPhone,
            toNumber: "simulator",
            status: "ringing",
            isSimulation: true,
          });
          callId = call.id;
          const llm = createLlmClientOrDemo({ model: bundle.row.llmModel });
          let tts = null;
          if (mode === "voice") {
            try {
              tts = getTtsProvider(config, msg.ttsProvider || bundle.row.ttsProvider);
            } catch (err) {
              send({
                type: "error",
                message: `Sprachausgabe nicht konfiguriert: ${(err as Error).message}`,
              });
              return;
            }
          }
          const persistence = new CallPersistence({
            db,
            logger: logger.child({ callId, sim: true }),
            callId,
            restaurant: bundle.row,
            profile: bundle.profile,
            isSimulation: true,
            appUrl: config.APP_URL,
            onSmsPreview: (text) => send({ type: "sms", text }),
          });
          session = new CallSession({
            config,
            logger: logger.child({ callId, sim: true }),
            db,
            callId,
            restaurant: bundle.profile,
            menu: bundle.menu,
            phrases: bundle.phrases,
            callerPhone,
            transport,
            mode,
            llm,
            tts,
            ttsVoice: msg.ttsVoice || bundle.row.ttsVoice,
            sttProvider: msg.sttProvider || bundle.row.sttProvider,
            persistence,
            isSimulation: true,
          });
          ctx.registry.add(callId, session);
          send({ type: "ready", callId, llm: `${llm.provider}:${llm.model}`, mode });
          await session.start();
        } else if (msg.type === "text") {
          session?.onText(String(msg.text ?? ""));
        } else if (msg.event === "media" && msg.media?.payload) {
          session?.onAudio(Buffer.from(msg.media.payload, "base64"));
        } else if (msg.event === "mark" && msg.mark?.name) {
          session?.onMark(msg.mark.name);
        } else if (msg.type === "hangup") {
          await session?.onStop("caller_hangup");
          socket.close();
        }
      } catch (err) {
        logger.error({ err }, "simulator error");
        send({ type: "error", message: err instanceof Error ? err.message : String(err) });
      }
    });

    socket.on("close", async () => {
      await session?.onStop("socket_closed");
      if (callId) ctx.registry.remove(callId);
    });
  });
}
