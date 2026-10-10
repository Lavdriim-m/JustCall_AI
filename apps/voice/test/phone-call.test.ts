import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { createTestRestaurant, resetTestDatabase, TEST_DB_URL } from "./helpers";

const transferCall = vi.fn(async () => ({}));
const hangupCall = vi.fn(async () => ({}));
const sendSms = vi.fn(async () => ({ sid: "SM1" }));
vi.mock("@justcall/services", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@justcall/services")>();
  return { ...actual, transferCall, hangupCall, sendSms, isTwilioConfigured: () => true };
});

process.env.DATABASE_URL = TEST_DB_URL;
process.env.LLM_PROVIDER = "demo";

const { loadConfig } = await import("../src/config");
const { createLogger } = await import("../src/logger");
const { buildServer } = await import("../src/server");
const { encodeMockUtterance } = await import("../src/stt/mock");
const { createDb, calls, orders, orderItems, callEvents, eq, asc } = await import("@justcall/db");

const { db, client } = createDb({ url: TEST_DB_URL, max: 4 });
let baseUrl = "";
let app: Awaited<ReturnType<typeof buildServer>>["app"];
let ctx: Awaited<ReturnType<typeof buildServer>>["ctx"];

beforeAll(async () => {
  await resetTestDatabase();
  const config = loadConfig({
    STT_PROVIDER: "mock",
    TTS_PROVIDER: "mock",
    TWILIO_VALIDATE_SIGNATURES: "false",
    INTERNAL_API_SECRET: "test-secret-0123456789",
    END_OF_TURN_MS: "20",
    SILENCE_PROMPT_SECONDS: "60",
    JOBS_ENABLED: "false",
    LOG_LEVEL: "warn",
  });
  ({ app, ctx } = await buildServer({ config, db, logger: createLogger("warn") }));
  await app.listen({ port: 0, host: "127.0.0.1" });
  baseUrl = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await app?.close();
  await client.end();
});

async function waitFor<T>(fn: () => T | Promise<T>, timeoutMs = 8000): Promise<NonNullable<T>> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const v = await fn();
    if (v) return v as NonNullable<T>;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("timeout");
}

/** Simulates Twilio: places a call, opens the media stream and acknowledges played audio. */
async function placeCall(
  to: string,
  from = "+41791234567",
  opts: { ackMarks?: boolean; startOnly?: boolean } = {},
) {
  const callSid = `CA${Math.random().toString(16).slice(2, 12)}`;
  const res = await fetch(`${baseUrl}/twilio/voice`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ CallSid: callSid, From: from, To: to, CallStatus: "ringing" }),
  });
  const twiml = await res.text();
  const callId = /name="callId" value="([^"]+)"/.exec(twiml)?.[1];
  const token = /name="token" value="([^"]+)"/.exec(twiml)?.[1];
  if (!callId || !token) return { twiml, callSid };

  const ws = new WebSocket(`${baseUrl.replace("http", "ws")}/twilio/stream`);
  const received: any[] = [];
  let pendingMarks = 0;
  ws.on("message", (raw) => {
    const msg = JSON.parse(raw.toString());
    received.push(msg);
    if (msg.event === "mark" && opts.ackMarks !== false) {
      pendingMarks += 1;
      // Acknowledge playback like Twilio does.
      setTimeout(() => {
        pendingMarks -= 1;
        ws.send(JSON.stringify({ event: "mark", streamSid: "MZ1", mark: { name: msg.mark.name } }));
      }, 5);
    }
  });
  await new Promise((r) => ws.once("open", r));
  ws.send(JSON.stringify({ event: "connected", protocol: "Call", version: "1.0.0" }));
  ws.send(
    JSON.stringify({
      event: "start",
      streamSid: "MZ1",
      start: {
        streamSid: "MZ1",
        callSid,
        customParameters: { callId, token },
        mediaFormat: { encoding: "audio/x-mulaw", sampleRate: 8000, channels: 1 },
      },
    }),
  );
  if (opts.startOnly) {
    ws.send(JSON.stringify({ event: "stop", streamSid: "MZ1" }));
    return { twiml, callSid, callId, ws, received };
  }
  const marksSeen = () => received.filter((m) => m.event === "mark").length;
  const say = async (text: string) => {
    const before = marksSeen();
    ws.send(
      JSON.stringify({
        event: "media",
        streamSid: "MZ1",
        media: { track: "inbound", payload: encodeMockUtterance(text).toString("base64") },
      }),
    );
    await waitFor(() => marksSeen() > before && pendingMarks === 0);
    await new Promise((r) => setTimeout(r, 60));
  };
  const stop = async () => {
    ws.send(JSON.stringify({ event: "stop", streamSid: "MZ1" }));
    await new Promise((r) => setTimeout(r, 200));
    ws.close();
  };
  return { twiml, callSid, callId, ws, say, stop, received };
}

describe("phone call over Twilio media streams", () => {
  it("takes an order end to end: greeting, items, allergy question, details, review, confirmation, SMS, hang-up", async () => {
    const restaurant = await createTestRestaurant("+41445550001");
    const call = await placeCall("+41445550001");
    expect(call.twiml).toContain("<Connect><Stream");
    await waitFor(() => call.received!.some((m) => m.event === "mark"));

    await call.say!("Grüezi, ich hätt gern zwei Margherita und ein Cola");
    await call.say!("Nein");
    await call.say!("Das wars, ich hole es so schnell wie möglich ab");
    await call.say!("Müller");
    await call.say!("Mit TWINT");
    await call.say!("Ja genau");

    const order = await waitFor(
      async () => (await db.select().from(orders).where(eq(orders.restaurantId, restaurant.id)))[0],
    );
    expect(order.orderNumber).toBe(101);
    expect(order.customerName).toBe("Müller");
    expect(order.totalCents).toBe(2 * 1600 + 450);
    expect(order.paymentMethod).toBe("twint");
    expect(order.isTest).toBe(false);
    const items = await db
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, order.id))
      .orderBy(asc(orderItems.sortOrder));
    expect(items.map((i) => `${i.quantity}x ${i.name}`)).toEqual([
      "2x Margherita",
      "1x Coca-Cola 0.5l",
    ]);

    await waitFor(() => hangupCall.mock.calls.length > 0);
    expect(sendSms).toHaveBeenCalledTimes(1);
    expect(String((sendSms.mock.calls[0] as unknown[])[1])).toContain("Bestellung Nr. 101");

    await call.stop!();
    const [row] = await waitFor(async () => {
      const rows = await db.select().from(calls).where(eq(calls.id, call.callId!));
      return rows[0]?.endedAt ? rows : null;
    });
    expect(row!.outcome).toBe("order_placed");
    expect(row!.usage.turns).toBe(6);
    const events = await db
      .select()
      .from(callEvents)
      .where(eq(callEvents.callId, call.callId!))
      .orderBy(asc(callEvents.seq));
    expect(events.filter((e) => e.kind === "user").map((e) => e.content)).toContain("Müller");
    expect(
      events.some((e) => e.kind === "assistant" && /Allergie|allergie/.test(e.content ?? "")),
    ).toBe(true);
  });

  it("transfers to the restaurant as soon as an allergy is mentioned", async () => {
    await createTestRestaurant("+41445550002");
    const call = await placeCall("+41445550002");
    await waitFor(() => call.received!.some((m) => m.event === "mark"));
    await call.say!("Mini Tochter hät e Nussallergie");
    await waitFor(() => transferCall.mock.calls.length > 0);
    const args = transferCall.mock.calls[0] as unknown as [string, string];
    expect(args[1]).toBe("+41791112233");
    await call.stop!();
    const [row] = await waitFor(async () => {
      const rows = await db.select().from(calls).where(eq(calls.id, call.callId!));
      return rows[0]?.endedAt ? rows : null;
    });
    expect(row!.status).toBe("transferred");
    expect(row!.outcome).toBe("transferred_allergy");
  });

  it("forwards directly to staff when the bot is paused", async () => {
    await createTestRestaurant("+41445550003", { acceptingOrders: false });
    const call = await placeCall("+41445550003");
    expect(call.twiml).toContain("<Dial");
    expect(call.twiml).toContain("+41791112233");
  });

  it("forwards new calls while the server drains for a deploy", async () => {
    await createTestRestaurant("+41445550004");
    await createTestRestaurant("+41445550005", { transferPhone: null });
    ctx.draining = true;
    try {
      const call = await placeCall("+41445550004");
      expect(call.twiml).toContain("<Dial");
      expect(call.twiml).toContain("+41791112233");
      const noTarget = await fetch(`${baseUrl}/twilio/voice`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          CallSid: "CAdrain0001",
          From: "+41791234567",
          To: "+41445550005",
        }),
      });
      expect(noTarget.status).toBe(503);
      expect((await fetch(`${baseUrl}/health`)).status).toBe(503);
    } finally {
      ctx.draining = false;
    }
    expect((await fetch(`${baseUrl}/health`)).status).toBe(200);
  });

  it("rejects calls to unknown numbers", async () => {
    const call = await placeCall("+41445559999");
    expect(call.twiml).toContain("nicht in Betrieb");
  });

  it("handles 20 simultaneous calls to the same restaurant", async () => {
    const restaurant = await createTestRestaurant("+41445550010");
    const callers = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        placeCall("+41445550010", `+4179${String(1000000 + i)}`),
      ),
    );
    await Promise.all(
      callers.map((c) => waitFor(() => c.received!.some((m) => m.event === "mark"))),
    );
    const script = [
      "Eine Napoli und eine Cola",
      "Nein",
      "Das wars, ich hole es so schnell wie möglich ab",
      "Meier",
      "bar",
      "Ja",
    ];
    for (const line of script) await Promise.all(callers.map((c) => c.say!(line)));
    const rows = await waitFor(async () => {
      const r = await db.select().from(orders).where(eq(orders.restaurantId, restaurant.id));
      return r.length === 20 ? r : null;
    }, 15_000);
    // Unique, gap-free order numbers even under concurrency.
    expect(rows.map((r) => r.orderNumber).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 20 }, (_, i) => 101 + i),
    );
    await Promise.all(callers.map((c) => c.stop!()));
  });

  it("barge-in: caller speech stops the assistant's playback", async () => {
    await createTestRestaurant("+41445550020");
    const call = await placeCall("+41445550020", "+41791234567", { ackMarks: false });
    await waitFor(() => call.received!.some((m) => m.event === "mark"));
    // Greeting is still "playing" (no mark acknowledged) – caller talks over it.
    call.ws!.send(
      JSON.stringify({
        event: "media",
        streamSid: "MZ1",
        media: {
          track: "inbound",
          payload: encodeMockUtterance("Zwei Margherita bitte").toString("base64"),
        },
      }),
    );
    await waitFor(() => call.received!.some((m) => m.event === "clear"));
    await waitFor(async () => {
      const events = await db.select().from(callEvents).where(eq(callEvents.callId, call.callId!));
      return events.some((e) => e.kind === "user" && e.content === "Zwei Margherita bitte");
    });
    call.ws!.send(JSON.stringify({ event: "stop", streamSid: "MZ1" }));
    call.ws!.close();
  });

  it("finalises the call when the caller hangs up while the session is starting", async () => {
    await createTestRestaurant("+41445550021");
    const call = await placeCall("+41445550021", "+41791234567", { startOnly: true });
    const [row] = await waitFor(async () => {
      const rows = await db.select().from(calls).where(eq(calls.id, call.callId!));
      return rows[0]?.endedAt ? rows : null;
    });
    expect(row!.outcome).toBe("no_order");
    call.ws!.close();
  });
});
