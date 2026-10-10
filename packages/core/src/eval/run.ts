/**
 * Conversation evaluation: runs scripted Swiss German calls against the configured language model.
 *   pnpm eval                 # all scenarios
 *   pnpm eval -- allergy      # scenarios whose name matches "allergy"
 * Uses LLM_PROVIDER / OPENAI_MODEL etc. from the environment (or the root .env).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ConversationEngine } from "../conversation/engine";
import type { EngineEvent } from "../conversation/types";
import { demoMenu, demoRestaurant } from "../fixtures/demo";
import { zonedTimeToUtc } from "../hours";
import { createLlmClient } from "../llm";
import { SCENARIOS } from "./scenarios";

async function loadEnv() {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    process.loadEnvFile(path.resolve(here, "../../../../.env"));
  } catch {
    // no .env – rely on the environment
  }
}

async function main() {
  await loadEnv();
  const filter = process.argv
    .slice(2)
    .find((a) => !a.startsWith("-"))
    ?.toLowerCase();
  const verbose = process.argv.includes("--verbose");
  const llm = createLlmClient();
  console.log(`\nJustCall conversation eval · ${llm.provider}:${llm.model}\n`);
  const now = zonedTimeToUtc("2026-10-07", "18:00", "Europe/Zurich");
  let passed = 0;
  let total = 0;
  const latencies: number[] = [];
  for (const scenario of SCENARIOS.filter(
    (s) => !filter || s.name.toLowerCase().includes(filter),
  )) {
    total += 1;
    const events: EngineEvent[] = [];
    const transcript: string[] = [];
    const engine = new ConversationEngine({
      restaurant: demoRestaurant,
      menu: demoMenu,
      llm,
      caller: { phone: scenario.callerPhone === undefined ? "+41791234567" : scenario.callerPhone },
      hooks: {
        now: () => now,
        placeOrder: async () => ({ orderId: "eval", orderNumber: 101, smsStatus: "sent" }),
      },
    });
    for (const ev of engine.start()) if (ev.type === "say") transcript.push(`🤖 ${ev.text}`);
    for (const line of scenario.caller) {
      if (engine.phase !== "active") break;
      transcript.push(`🧑 ${line}`);
      const t0 = Date.now();
      let first = 0;
      let said = "";
      for await (const ev of engine.handleUserTurn(line)) {
        events.push(ev);
        if (ev.type === "say") {
          if (!first) first = Date.now() - t0;
          said += `${ev.text} `;
        } else if (ev.type === "tool" && verbose)
          transcript.push(`   🔧 ${ev.name} ${JSON.stringify(ev.arguments)}`);
        else if (ev.type === "transfer") transcript.push(`   ☎️  transfer (${ev.reason})`);
        else if (ev.type === "hangup") transcript.push(`   📴 hangup (${ev.reason})`);
      }
      if (first) latencies.push(first);
      if (said) transcript.push(`🤖 ${said.trim()}`);
    }
    const failures = scenario.expect({ engine, events, transcript });
    if (!failures.length) passed += 1;
    console.log(`${failures.length ? "❌" : "✅"} ${scenario.name}`);
    if (failures.length || verbose) {
      for (const f of failures) console.log(`     – ${f}`);
      console.log(transcript.map((t) => `     ${t}`).join("\n"));
      console.log("");
    }
  }
  const sorted = [...latencies].sort((a, b) => a - b);
  const p = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
  console.log(
    `\n${passed}/${total} scenarios passed · time to first sentence: median ${p(0.5)} ms, p90 ${p(0.9)} ms\n`,
  );
  process.exit(passed === total ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
