import { sql } from "@justcall/db";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { normalizeForSpeech } from "@justcall/core";
import type { AppContext } from "../context";
import { pcm16ToWav, mulawToPcm16 } from "../audio/codec";
import { internalApiSecret } from "../config";
import { getTtsProvider } from "../tts";

export function registerSystemRoutes(app: FastifyInstance, ctx: AppContext) {
  const { config, db } = ctx;

  app.get("/health", async (_req, reply) => {
    const body = {
      ok: !ctx.draining,
      draining: ctx.draining,
      service: "justcall-voice",
      activeCalls: ctx.registry.size,
      uptimeSeconds: Math.round(process.uptime()),
      stt: config.STT_PROVIDER,
      tts: config.TTS_PROVIDER,
      llm: process.env.LLM_PROVIDER ?? "openai",
    };
    // 503 while draining so load balancers stop sending new calls to this instance.
    return ctx.draining ? reply.code(503).send(body) : body;
  });

  app.get("/ready", async (_req, reply) => {
    try {
      await db.execute(sql`select 1`);
      return { ok: true };
    } catch (err) {
      return reply.code(503).send({ ok: false, error: String(err) });
    }
  });

  /** Requests from the web app. Without INTERNAL_API_SECRET, development accepts the dev fallback. */
  const internal = (req: FastifyRequest) => {
    const secret = internalApiSecret(config);
    const auth = req.headers.authorization ?? "";
    return secret !== "" && auth === `Bearer ${secret}`;
  };

  /** Called by the web app after menu/settings changes so live calls pick them up immediately. */
  app.post("/internal/restaurants/:id/invalidate", async (req, reply) => {
    if (!internal(req)) return reply.code(401).send({ error: "unauthorized" });
    ctx.restaurants.invalidate((req.params as { id: string }).id);
    return { ok: true };
  });

  app.get("/internal/active-calls", async (req, reply) => {
    if (!internal(req)) return reply.code(401).send({ error: "unauthorized" });
    return { count: ctx.registry.size, ids: ctx.registry.ids() };
  });

  /** Voice preview for the admin UI: returns a WAV file. */
  app.post("/internal/tts-preview", async (req, reply) => {
    if (!internal(req)) return reply.code(401).send({ error: "unauthorized" });
    const body = (req.body ?? {}) as { text?: string; provider?: string; voice?: string };
    const text = normalizeForSpeech(
      String(body.text ?? "Grüezi, was darf ich für Sie notieren?"),
    ).slice(0, 400);
    try {
      const tts = getTtsProvider(config, body.provider || null);
      const mulaw = await tts.synthesize(text, { voice: body.voice || null });
      reply.type("audio/wav");
      return pcm16ToWav(mulawToPcm16(mulaw), 8000);
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });
}
