import formbody from "@fastify/formbody";
import websocket from "@fastify/websocket";
import type { Database } from "@justcall/db";
import Fastify, { type FastifyBaseLogger } from "fastify";
import { RestaurantCache } from "./call/restaurant-cache";
import type { Config } from "./config";
import { CallRegistry, type AppContext } from "./context";
import type { Logger } from "./logger";
import { registerSimulatorRoutes } from "./routes/simulator";
import { registerSystemRoutes } from "./routes/system";
import { registerTwilioRoutes } from "./routes/twilio";

export async function buildServer(opts: { config: Config; db: Database; logger: Logger }) {
  const ctx: AppContext = {
    ...opts,
    restaurants: new RestaurantCache(opts.db),
    registry: new CallRegistry(),
    draining: false,
  };
  const app = Fastify({
    loggerInstance: opts.logger as FastifyBaseLogger,
    trustProxy: true,
    bodyLimit: 1024 * 1024,
  });
  await app.register(formbody);
  await app.register(websocket, { options: { maxPayload: 1024 * 1024 } });

  // CORS for the admin UI voice preview / health checks from the browser.
  app.addHook("onRequest", async (req, reply) => {
    const origin = req.headers.origin;
    if (origin && origin === opts.config.APP_URL.replace(/\/$/, "")) {
      reply.header("Access-Control-Allow-Origin", origin);
      reply.header("Vary", "Origin");
    }
  });

  registerSystemRoutes(app, ctx);
  registerTwilioRoutes(app, ctx);
  registerSimulatorRoutes(app, ctx);
  return { app, ctx };
}
