import { describe, expect, it, vi } from "vitest";
import { ConversationEngine } from "../src/conversation/engine";
import type { EngineEvent, OrderDraft, RestaurantProfile } from "../src/conversation/types";
import { demoMenu, demoRestaurant } from "../src/fixtures/demo";
import { zonedTimeToUtc } from "../src/hours";
import { LlmError, type LlmClient } from "../src/llm/types";
import { ScriptedLlm } from "../src/llm/mock";

const WEDNESDAY_18H = zonedTimeToUtc("2026-10-07", "18:00", "Europe/Zurich");

function setup(steps: ConstructorParameters<typeof ScriptedLlm>[0], opts: { now?: Date; restaurant?: Partial<RestaurantProfile>; llm?: LlmClient; phone?: string | null } = {}) {
  const llm = opts.llm ?? new ScriptedLlm(steps);
  const placeOrder = vi.fn(async (_draft: OrderDraft) => ({ orderId: "order-1", orderNumber: 101, smsStatus: "sent" as const }));
  const engine = new ConversationEngine({
    restaurant: { ...demoRestaurant, ...opts.restaurant },
    menu: demoMenu,
    llm,
    hooks: { placeOrder, now: () => opts.now ?? WEDNESDAY_18H },
    caller: { phone: opts.phone === undefined ? "+41791234567" : opts.phone },
  });
  return { engine, llm, placeOrder };
}

async function turn(engine: ConversationEngine, text: string): Promise<EngineEvent[]> {
  const out: EngineEvent[] = [];
  for await (const ev of engine.handleUserTurn(text)) out.push(ev);
  return out;
}

const said = (events: EngineEvent[]) =>
  events.filter((e): e is Extract<EngineEvent, { type: "say" }> => e.type === "say").map((e) => e.text).join(" ");

describe("ConversationEngine – happy path", () => {
  it("takes a complete pickup order with read-back, allergy question, review and confirmation", async () => {
    const { engine, placeOrder } = setup([
      { toolCalls: [{ name: "add_items", arguments: { items: [{ item: "Napoli", quantity: 2 }, { item: "Cola" }] } }] },
      { text: "Gerne, zwei Pizza Napoli und ein Cola. Kurze Frage vorab: Hat jemand eine Lebensmittelallergie oder eine Unverträglichkeit?" },
      { toolCalls: [{ name: "record_allergy_answer", arguments: { has_allergy: false } }] },
      { text: "Danke. Darf es sonst noch etwas sein?" },
      { toolCalls: [{ name: "set_fulfillment", arguments: { type: "pickup", time: "asap" } }] },
      { text: "Auf welchen Namen darf ich die Bestellung aufnehmen?" },
      { toolCalls: [{ name: "set_customer", arguments: { name: "Müller" } }] },
      { text: "Danke. Möchten Sie bar oder mit TWINT bezahlen?" },
      { toolCalls: [{ name: "set_payment_method", arguments: { method: "twint" } }, { name: "review_order", arguments: {} }] },
      { text: "Ich fasse zusammen: zwei Pizza Napoli und ein Cola, Abholung um 18 Uhr 20, Name Müller. Total 41 Franken 50. Stimmt das so?" },
      { toolCalls: [{ name: "confirm_order", arguments: { customer_confirmed: true } }] },
      { text: "Vielen Dank! Ihre Bestellnummer ist 101. Auf Wiederhören!" },
    ]);

    const greeting = engine.start();
    expect(said(greeting)).toContain("Pizzeria Bella Vista");

    const t1 = await turn(engine, "Grüezi, ich hätt gern zwöi Napoli und es Cola");
    expect(said(t1)).toMatch(/allergie/i);
    expect(engine.cart.subtotalCents).toBe(2 * 1850 + 450);

    await turn(engine, "Nei, kei Allergie");
    expect(engine.allergyStatus).toBe("none");

    const t3 = await turn(engine, "Nei, das wär alles. Ich hol's so schnell wie möglich ab.");
    expect(engine.fulfillment?.type).toBe("pickup");
    expect(said(t3)).toContain("Namen");

    await turn(engine, "Müller");
    await turn(engine, "Mit TWINT bitte");
    expect(engine.paymentMethod).toBe("twint");

    const t6 = await turn(engine, "Ja, genau so");
    expect(placeOrder).toHaveBeenCalledTimes(1);
    const draft = placeOrder.mock.calls[0]![0];
    expect(draft.totalCents).toBe(4150);
    expect(draft.customerName).toBe("Müller");
    expect(draft.customerPhone).toBe("+41791234567");
    expect(draft.paymentMethod).toBe("twint");
    expect(draft.lines.map((l) => [l.name, l.quantity])).toEqual([
      ["Pizza Napoli", 2],
      ["Coca-Cola 0.5l", 1],
    ]);
    // 18:00 + 20 min prep → 18:20
    expect(draft.estimatedReadyAt.toISOString()).toBe(zonedTimeToUtc("2026-10-07", "18:20", "Europe/Zurich").toISOString());
    expect(t6.some((e) => e.type === "order_placed")).toBe(true);
    expect(t6.at(-1)).toEqual({ type: "hangup", reason: "order_placed" });
    expect(engine.phase).toBe("ending");
  });

  it("streams sentences before the model finishes", async () => {
    const { engine } = setup([{ text: "Gerne. Was darf es sein? Wir haben feine Pizzen." }]);
    engine.start();
    const events = await turn(engine, "Hallo");
    const says = events.filter((e) => e.type === "say");
    expect(says.length).toBe(3);
  });
});

describe("ConversationEngine – guards", () => {
  it("transfers immediately on allergy mentions without asking the model", async () => {
    const { engine, llm } = setup([]);
    engine.start();
    const events = await turn(engine, "Mini Tochter hät e Nussallergie, isch das es Problem?");
    expect(said(events)).toContain("Allergien");
    expect(events.at(-1)).toMatchObject({ type: "transfer", reason: "allergy", target: "+41791112233" });
    expect((llm as ScriptedLlm).requests).toHaveLength(0);
    expect(engine.phase).toBe("transferring");
  });

  it("transfers when the model records an allergy", async () => {
    const { engine } = setup([
      { toolCalls: [{ name: "record_allergy_answer", arguments: { has_allergy: true, details: "Sellerie" } }] },
      { text: "Ich verbinde Sie aus Sicherheitsgründen mit unserem Team." },
    ]);
    engine.start();
    const events = await turn(engine, "Ja, eine Person verträgt Sellerie schlecht");
    expect(events.at(-1)).toMatchObject({ type: "transfer", reason: "allergy" });
  });

  it("ends politely when allergy transfer is impossible", async () => {
    const { engine } = setup([], { restaurant: { transferPhone: null } });
    engine.start();
    const events = await turn(engine, "Ich han e Laktoseintoleranz");
    expect(events.at(-1)).toMatchObject({ type: "hangup", reason: "allergy_no_transfer" });
  });

  it("transfers explicit requests to talk to the owner", async () => {
    const { engine } = setup([]);
    engine.start();
    const events = await turn(engine, "Chan ich bitte mit em Chef rede?");
    expect(events.at(-1)).toMatchObject({ type: "transfer", reason: "owner_request" });
  });

  it("refuses to confirm without a review", async () => {
    const { engine, placeOrder } = setup([
      { toolCalls: [{ name: "add_items", arguments: { items: [{ item: "Margherita" }] } }] },
      { toolCalls: [{ name: "record_allergy_answer", arguments: { has_allergy: false } }] },
      { toolCalls: [{ name: "set_fulfillment", arguments: { type: "pickup", time: "asap" } }] },
      { toolCalls: [{ name: "set_customer", arguments: { name: "Meier" } }] },
      { toolCalls: [{ name: "set_payment_method", arguments: { method: "cash" } }] },
      { toolCalls: [{ name: "confirm_order", arguments: { customer_confirmed: true } }] },
      { text: "Ich lese Ihnen die Bestellung zuerst vor." },
    ]);
    engine.start();
    const events = await turn(engine, "Eine Margherita, keine Allergien, Abholung sofort, Meier, bar");
    const confirm = events.find((e) => e.type === "tool" && e.name === "confirm_order");
    expect(confirm && confirm.type === "tool" && (confirm.result as { ok: boolean }).ok).toBe(false);
    expect(placeOrder).not.toHaveBeenCalled();
  });

  it("requires a new review after the cart changed", async () => {
    const { engine, placeOrder } = setup([
      { toolCalls: [{ name: "add_items", arguments: { items: [{ item: "Margherita" }] } }, { name: "record_allergy_answer", arguments: { has_allergy: false } }, { name: "set_fulfillment", arguments: { type: "pickup", time: "asap" } }, { name: "set_customer", arguments: { name: "Meier" } }, { name: "set_payment_method", arguments: { method: "cash" } }, { name: "review_order", arguments: {} }] },
      { text: "Stimmt das so?" },
      { toolCalls: [{ name: "add_items", arguments: { items: [{ item: "Tiramisu" }] } }, { name: "confirm_order", arguments: { customer_confirmed: true } }] },
      { text: "Ich fasse nochmals zusammen." },
    ]);
    engine.start();
    await turn(engine, "Eine Margherita bitte, keine Allergien, sofort abholen, Meier, bar");
    const events = await turn(engine, "Ja, und no es Tiramisu");
    const confirm = events.find((e) => e.type === "tool" && e.name === "confirm_order");
    expect((confirm as Extract<EngineEvent, { type: "tool" }>).result).toMatchObject({ ok: false });
    expect(placeOrder).not.toHaveBeenCalled();
  });

  it("validates delivery postal codes and minimum order", async () => {
    const { engine } = setup([
      { toolCalls: [{ name: "add_items", arguments: { items: [{ item: "Cola" }] } }, { name: "set_fulfillment", arguments: { type: "delivery", time: "asap", address: { street: "Bahnhofstrasse 1", postal_code: "8001", city: "Zürich" } } }] },
      { text: "Leider liefern wir nicht nach 8001." },
      { toolCalls: [{ name: "set_fulfillment", arguments: { type: "delivery", time: "asap", address: { street: "Langstrasse 1", postal_code: "8004", city: "Zürich" } } }] },
      { text: "Der Mindestbestellwert ist 30 Franken." },
    ]);
    engine.start();
    const t1 = await turn(engine, "Es Cola, liefere a d Bahnhofstrass 1, 8001");
    const f1 = t1.find((e) => e.type === "tool" && e.name === "set_fulfillment") as Extract<EngineEvent, { type: "tool" }>;
    expect(f1.result).toMatchObject({ ok: false });
    const t2 = await turn(engine, "Dann Langstrass 1, 8004");
    const f2 = t2.find((e) => e.type === "tool" && e.name === "set_fulfillment") as Extract<EngineEvent, { type: "tool" }>;
    expect(f2.result).toMatchObject({ ok: true });
    expect(String((f2.result as { warnung?: string }).warnung)).toContain("Mindestbestellwert");
  });

  it("rejects pickup times before the earliest possible time or outside opening hours", async () => {
    const { engine } = setup([
      { toolCalls: [{ name: "add_items", arguments: { items: [{ item: "Margherita" }] } }, { name: "set_fulfillment", arguments: { type: "pickup", time: "18:05" } }, { name: "set_fulfillment", arguments: { type: "pickup", time: "23:30" } }, { name: "set_fulfillment", arguments: { type: "pickup", time: "19:00" } }] },
      { text: "Um 19 Uhr ist notiert." },
    ]);
    engine.start();
    const events = await turn(engine, "E Margherita uf 18:05");
    const results = events.filter((e) => e.type === "tool" && e.name === "set_fulfillment").map((e) => (e as Extract<EngineEvent, { type: "tool" }>).result as { ok: boolean });
    expect(results.map((r) => r.ok)).toEqual([false, false, true]);
    expect(engine.fulfillment?.requestedFor?.toISOString()).toBe(zonedTimeToUtc("2026-10-07", "19:00", "Europe/Zurich").toISOString());
  });
});

describe("ConversationEngine – edge cases", () => {
  it("offers pre-orders when closed", () => {
    const { engine } = setup([], { now: zonedTimeToUtc("2026-10-07", "15:30", "Europe/Zurich") });
    const events = engine.start();
    expect(said(events)).toContain("geschlossen");
    expect(said(events)).toContain("17:00 Uhr");
    expect(said(events)).toContain("Vorbestellung");
  });

  it("plays a message and hangs up when orders are paused", () => {
    const { engine } = setup([], { restaurant: { acceptingOrders: false } });
    const events = engine.start();
    expect(events.at(-1)).toMatchObject({ type: "hangup", reason: "paused" });
  });

  it("transfers on repeated model failures", async () => {
    const failing: LlmClient = {
      provider: "test",
      model: "test",
      complete: async () => {
        throw new LlmError("boom", true);
      },
    };
    const { engine } = setup([], { llm: failing });
    engine.start();
    const events = await turn(engine, "Hallo");
    expect(events.at(-1)).toMatchObject({ type: "transfer", reason: "technical" });
  });

  it("asks if the caller is still there and hangs up after repeated silence", () => {
    const { engine } = setup([]);
    engine.start();
    expect(said(engine.handleSilence())).toContain("noch da");
    engine.handleSilence();
    expect(engine.handleSilence().at(-1)).toMatchObject({ type: "hangup", reason: "silence" });
  });

  it("does not let the model hang up while an order is in progress", async () => {
    const { engine } = setup([
      { toolCalls: [{ name: "add_items", arguments: { items: [{ item: "Margherita" }] } }, { name: "end_call", arguments: { reason: "no_order" } }] },
      { text: "Möchten Sie die Bestellung abbrechen?" },
    ]);
    engine.start();
    const events = await turn(engine, "Eine Margherita");
    expect(events.some((e) => e.type === "hangup")).toBe(false);
  });

  it("puts the dynamic state into the context, not the system prompt", async () => {
    const llm = new ScriptedLlm([{ text: "Gerne." }]);
    const { engine } = setup([], { llm });
    engine.start();
    await turn(engine, "Hallo");
    const req = llm.requests[0]!;
    expect(req.system).toContain("Pizza Napoli");
    expect(req.system).not.toContain("Jetzt:");
    expect(req.context).toContain("Jetzt: Mittwoch, 07.10.2026, 18:00");
    expect(req.context).toContain("Frühestmögliche Abholung: 18:20 Uhr");
    expect(req.context).toContain("NÄCHSTER SCHRITT");
  });

  it("asks for an SMS number when the caller ID is withheld", async () => {
    const llm = new ScriptedLlm([{ text: "Gerne." }]);
    const { engine } = setup([], { llm, phone: null });
    engine.start();
    await turn(engine, "Hallo");
    expect(llm.requests[0]!.context).toContain("Nummer unterdrückt");
  });
});
