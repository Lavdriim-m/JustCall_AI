/**
 * Talk to a restaurant's ordering assistant in the terminal (same engine as phone calls, no audio).
 * Great for testing prompts and menus with a real model:
 *
 *   pnpm --filter @justcall/voice chat                 # first active restaurant
 *   pnpm --filter @justcall/voice chat -- pizzeria-bella-vista
 *
 * Orders created here are stored as test orders (not billed).
 */
import readline from "node:readline/promises";
import { ConversationEngine, canReceiveSms } from "@justcall/core";
import { createLlmClientOrDemo } from "@justcall/core/llm";
import {
  closeDb,
  createOrder,
  getDb,
  getRestaurantBySlug,
  loadMenuSnapshot,
  restaurants,
  toRestaurantProfile,
  eq,
} from "@justcall/db";
import { composeOrderSms } from "@justcall/services";

async function main() {
  const db = getDb();
  const slug = process.argv.slice(2).find((a) => !a.startsWith("-"));
  const row = slug
    ? await getRestaurantBySlug(db, slug)
    : (await db.select().from(restaurants).where(eq(restaurants.status, "active")).limit(1))[0];
  if (!row) throw new Error("No restaurant found. Run `pnpm db:seed` first.");
  const profile = toRestaurantProfile(row);
  const menu = await loadMenuSnapshot(db, row.id);
  const llm = createLlmClientOrDemo({ model: row.llmModel });
  console.log(
    `\n📞 ${row.name} – model ${llm.provider}:${llm.model}. Type your lines, empty line to quit.\n`,
  );

  const engine = new ConversationEngine({
    restaurant: profile,
    menu,
    llm,
    caller: { phone: "+41791234567" },
    hooks: {
      placeOrder: async (draft) => {
        const order = await createOrder(db, { draft, timezone: profile.timezone, isTest: true });
        console.log(`\n   📝 Test order #${order.orderNumber} saved.`);
        if (draft.customerPhone && canReceiveSms(draft.customerPhone)) {
          console.log(
            `   📱 SMS preview:\n${composeOrderSms({
              restaurantName: row.name,
              restaurantAddress: [row.street, row.city].filter(Boolean).join(", "),
              orderNumber: order.orderNumber,
              customerName: draft.customerName,
              fulfillment: draft.fulfillment,
              estimatedReadyAt: draft.estimatedReadyAt,
              timezone: profile.timezone,
              totalCents: draft.totalCents,
              lines: draft.lines,
              paymentMethod: draft.paymentMethod,
              paymentMethods: profile.paymentMethods,
              twintPaymentUrl: row.twintPaymentUrl,
            }).replace(/^/gm, "      ")}\n`,
          );
        }
        return { orderId: order.id, orderNumber: order.orderNumber, smsStatus: "skipped" };
      },
    },
  });

  const print = (events: { type: string; text?: string; name?: string; reason?: string }[]) => {
    for (const ev of events) {
      if (ev.type === "say") console.log(`🤖 ${ev.text}`);
      else if (ev.type === "tool" && process.argv.includes("--tools"))
        console.log(`   🔧 ${ev.name}`);
      else if (ev.type === "transfer") console.log(`   ☎️  → transfer to staff (${ev.reason})`);
      else if (ev.type === "hangup") console.log(`   📴 hang-up (${ev.reason})`);
    }
  };
  print(engine.start());
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  while (engine.phase === "active") {
    const line = await rl.question("🧑 ");
    if (!line.trim()) break;
    const events = [];
    for await (const ev of engine.handleUserTurn(line)) {
      events.push(ev);
      print([ev]);
    }
  }
  rl.close();
  const u = engine.usage;
  console.log(`\nTokens: ${u.inputTokens} in (${u.cachedTokens} cached), ${u.outputTokens} out\n`);
  await closeDb();
}

main().catch(async (err) => {
  console.error(err);
  await closeDb();
  process.exit(1);
});
