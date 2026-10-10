import { closeDb, getDb } from "@justcall/db";
import { closeStaleCalls } from "@justcall/db";
import { loadConfig } from "./config";
import { startScheduler } from "./jobs/scheduler";
import { createLogger } from "./logger";
import { buildServer } from "./server";

async function main() {
  const config = loadConfig();
  const logger = createLogger(config.LOG_LEVEL);
  if (!config.INTERNAL_API_SECRET) {
    logger.warn("INTERNAL_API_SECRET is not set – using an insecure development secret");
  }
  const db = getDb();
  const { app, ctx } = await buildServer({ config, db, logger });

  await closeStaleCalls(db, 120).catch((err) =>
    logger.warn({ err }, "could not close stale calls"),
  );
  const stopJobs = config.JOBS_ENABLED ? startScheduler(db, config, logger) : () => undefined;

  await app.listen({ port: config.PORT, host: config.HOST });
  logger.info(
    {
      port: config.PORT,
      stt: config.STT_PROVIDER,
      tts: config.TTS_PROVIDER,
      llm: process.env.LLM_PROVIDER ?? "openai",
    },
    "JustCall voice server ready",
  );

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(
      { signal, activeCalls: ctx.registry.size },
      "shutting down – draining active calls",
    );
    stopJobs();
    const deadline = Date.now() + Number(process.env.DRAIN_TIMEOUT_SECONDS ?? 25) * 1000;
    while (ctx.registry.size > 0 && Date.now() < deadline)
      await new Promise((r) => setTimeout(r, 500));
    await ctx.registry.stopAll("server_shutdown");
    await app.close();
    await closeDb();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
