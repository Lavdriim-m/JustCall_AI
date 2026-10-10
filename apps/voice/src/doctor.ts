/**
 * Integration check: verifies every configured external service with a minimal real request.
 *   pnpm doctor
 */
import { createLlmClient } from "@justcall/core/llm";
import { closeDb, getDb, sql } from "@justcall/db";
import {
  isMailConfigured,
  isTwilioConfigured,
  listIncomingNumbers,
  verifyMailTransport,
  verifyTwilioCredentials,
} from "@justcall/services";
import { MULAW_SILENCE } from "./audio/codec";
import { loadConfig } from "./config";
import { createLogger } from "./logger";
import { createSttSession } from "./stt";
import { getTtsProvider } from "./tts";

type Result = { name: string; ok: boolean | null; detail: string };
const results: Result[] = [];
const check = async (name: string, fn: () => Promise<string>, skip?: string) => {
  if (skip) {
    results.push({ name, ok: null, detail: skip });
    return;
  }
  const started = Date.now();
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail: `${detail} (${Date.now() - started} ms)` });
  } catch (err) {
    results.push({ name, ok: false, detail: err instanceof Error ? err.message : String(err) });
  }
};

async function main() {
  const config = loadConfig();
  const logger = createLogger("error");
  const env = process.env;

  await check(
    "Database",
    async () => {
      const db = getDb();
      const [row] = (await db.execute(
        sql`select count(*)::int as n from restaurants`,
      )) as unknown as { n: number }[];
      return `connected, ${row?.n ?? 0} restaurant(s)`;
    },
    env.DATABASE_URL ? undefined : "DATABASE_URL not set",
  );

  await check(`LLM (${env.LLM_PROVIDER ?? "openai"})`, async () => {
    const llm = createLlmClient();
    const res = await llm.complete({
      system: "Antworte nur mit dem Wort OK.",
      messages: [{ role: "user", content: "Test" }],
      tools: [],
      maxTokens: 20,
    });
    return `${llm.model} answered "${res.text.slice(0, 30)}"`;
  });

  await check(`Text-to-speech (${config.TTS_PROVIDER})`, async () => {
    const tts = getTtsProvider(config);
    const audio = await tts.synthesize("Grüezi, was darf ich für Sie notieren?");
    return `${(audio.length / 8000).toFixed(1)} s of audio`;
  });

  await check(`Speech-to-text (${config.STT_PROVIDER})`, async () => {
    let error: Error | null = null;
    const session = createSttSession(config, null, {
      phrases: ["Margherita"],
      logger,
      events: { onFinal: () => undefined, onError: (e) => (error = e) },
    });
    const frame = Buffer.alloc(160, MULAW_SILENCE);
    for (let i = 0; i < 100; i++) {
      session.write(frame);
      await new Promise((r) => setTimeout(r, 20));
    }
    await session.close();
    await new Promise((r) => setTimeout(r, 500));
    if (error) throw error;
    return "stream accepted 2 s of audio";
  });

  await check(
    "Twilio",
    async () => {
      const account = await verifyTwilioCredentials();
      const numbers = await listIncomingNumbers();
      const expected = `${config.VOICE_PUBLIC_URL.replace(/\/$/, "")}/twilio/voice`;
      const connected = numbers.filter((n) => n.voiceUrl === expected).length;
      return `account "${account.friendlyName}" (${account.status}), ${numbers.length} number(s), ${connected} pointing to ${expected}`;
    },
    isTwilioConfigured() ? undefined : "TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN not set",
  );

  await check(
    "Email (SMTP)",
    async () => {
      await verifyMailTransport();
      return `${env.SMTP_HOST} accepted the login`;
    },
    isMailConfigured() ? undefined : "SMTP not configured – emails are only logged",
  );

  await check("Public voice URL", async () => {
    const res = await fetch(`${config.VOICE_PUBLIC_URL.replace(/\/$/, "")}/health`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (!config.VOICE_PUBLIC_URL.startsWith("https://"))
      return "reachable, but Twilio requires https:// in production";
    return "reachable";
  });

  await check("Secrets", async () => {
    // The voice server only reads INTERNAL_API_SECRET; the others belong to the web app.
    const secret = env.INTERNAL_API_SECRET;
    if (!secret || secret.length < 16) throw new Error("INTERNAL_API_SECRET missing or too short");
    return "INTERNAL_API_SECRET set (must match the web app)";
  });

  console.log("\nJustCall integration check\n");
  for (const r of results) {
    const icon = r.ok === null ? "⚪" : r.ok ? "✅" : "❌";
    console.log(`${icon}  ${r.name.padEnd(28)} ${r.detail}`);
  }
  console.log("");
  await closeDb().catch(() => undefined);
  process.exit(results.some((r) => r.ok === false) ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
