import { normalize, tokenize } from "../text";
import { emptyUsage, type LlmClient, type LlmMessage, type LlmRequest, type LlmResponse, type ToolCall } from "./types";

type ScriptStep =
  | { text?: string; toolCalls?: { name: string; arguments: Record<string, unknown> }[] }
  | ((request: LlmRequest) => { text?: string; toolCalls?: { name: string; arguments: Record<string, unknown> }[] });

/** Replays a fixed list of responses. Used in unit tests. */
export class ScriptedLlm implements LlmClient {
  readonly provider = "scripted";
  readonly model = "scripted";
  readonly requests: LlmRequest[] = [];
  private counter = 0;

  constructor(private readonly steps: ScriptStep[]) {}

  async complete(request: LlmRequest): Promise<LlmResponse> {
    this.requests.push({ ...request, messages: [...request.messages] });
    const step = this.steps.shift();
    if (!step) return { text: "", toolCalls: [], usage: emptyUsage() };
    const resolved = typeof step === "function" ? step(request) : step;
    const text = resolved.text ?? "";
    if (text) {
      // Emit in small chunks to exercise streaming.
      for (const chunk of text.match(/.{1,12}/gs) ?? []) request.onTextDelta?.(chunk);
    }
    const toolCalls: ToolCall[] = (resolved.toolCalls ?? []).map((tc) => ({
      id: `call_${++this.counter}`,
      name: tc.name,
      arguments: tc.arguments,
    }));
    return { text, toolCalls, usage: { inputTokens: 100, outputTokens: 20, cachedTokens: 0 } };
  }
}

const YES = /\b(ja|jo|jawohl|genau|stimmt|passt|korrekt|richtig|perfekt|gut so|super|einverstanden|yes)\b/;
const NO = /\b(nein|nei|nö|no|nope|keine|kei|nichts|nuet|nut|nid|nod)\b/;
const DONE = /\b(das wars|das wärs|das ist alles|das isch alles|alles|fertig|nichts mehr|nuet meh|nut meh|susch nut|sonst nichts|nein danke|nei danke)\b/;

function contextValue(context: string | undefined, label: string): string | null {
  if (!context) return null;
  const m = new RegExp(`- ${label}: (.*)`).exec(context);
  return m ? m[1]!.trim() : null;
}

/**
 * Rule-based stand-in for a real language model so the simulator works without an API key.
 * It is intentionally simple and only meant for demos and local development.
 */
export class DemoLlm implements LlmClient {
  readonly provider = "demo";
  readonly model = "rule-based";
  private counter = 0;

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const res = this.decide(request);
    if (res.text) request.onTextDelta?.(res.text);
    return {
      text: res.text ?? "",
      toolCalls: (res.toolCalls ?? []).map((tc) => ({ id: `demo_${++this.counter}`, ...tc })),
      usage: emptyUsage(),
    };
  }

  private decide(request: LlmRequest): { text?: string; toolCalls?: Omit<ToolCall, "id">[] } {
    const last = request.messages[request.messages.length - 1] as LlmMessage | undefined;
    const ctx = request.context;
    if (!last) return { text: "Was darf ich für Sie notieren?" };

    if (last.role === "tool") return this.afterTool(last, ctx);
    if (last.role !== "user") return { text: "" };

    const said = normalize(last.content);
    const allergyOpen = contextValue(ctx, "Allergiefrage")?.startsWith("noch nicht");
    const cartEmpty = /- Warenkorb:\n\s+\(leer\)/.test(ctx ?? "");
    const fulfillmentOpen = contextValue(ctx, "Abholung/Lieferung") === "offen";
    const nameOpen = contextValue(ctx, "Name") === "offen";
    const paymentOpen = contextValue(ctx, "Zahlungsart")?.startsWith("offen") ?? false;
    const reviewed = contextValue(ctx, "Zusammenfassung vorgelesen")?.startsWith("ja") ?? false;

    if (reviewed && YES.test(said)) return { toolCalls: [{ name: "confirm_order", arguments: { customer_confirmed: true } }] };
    if (!cartEmpty && allergyOpen && (NO.test(said) || /niemer|niemand/.test(said))) {
      return { toolCalls: [{ name: "record_allergy_answer", arguments: { has_allergy: false } }] };
    }
    if (!cartEmpty && fulfillmentOpen && (DONE.test(said) || /abhol|hole|liefer|schnell|uhr|\d{1,2}[: ]\d{2}/.test(said))) {
      if (DONE.test(said) && !/abhol|hole|liefer|schnell|uhr/.test(said)) {
        return { text: "Gerne. Möchten Sie so schnell wie möglich abholen oder zu einer bestimmten Zeit?" };
      }
      const time = /(\d{1,2})[: ](\d{2})/.exec(said);
      const uhr = /(\d{1,2}) uhr/.exec(said);
      const value = time ? `${time[1]!.padStart(2, "0")}:${time[2]}` : uhr ? `${uhr[1]!.padStart(2, "0")}:00` : "asap";
      return {
        toolCalls: [{ name: "set_fulfillment", arguments: { type: /liefer/.test(said) ? "delivery" : "pickup", time: value } }],
      };
    }
    if (!fulfillmentOpen && nameOpen) {
      const name = last.content
        .replace(/^(ich heisse|ich bin|min name isch|mein name ist|uf|auf|de|der|die|name)\s+/i, "")
        .replace(/[.!?]/g, "")
        .trim();
      return { toolCalls: [{ name: "set_customer", arguments: { name: name.split(" ").slice(-2).join(" ") } }] };
    }
    if (!fulfillmentOpen && !nameOpen && paymentOpen) {
      const method = /twint/.test(said) ? "twint" : /karte|kart/.test(said) ? "card" : /bar|cash/.test(said) ? "cash" : null;
      if (method) return { toolCalls: [{ name: "set_payment_method", arguments: { method } }] };
      return { text: "Möchten Sie bar oder mit TWINT bezahlen?" };
    }
    if (!fulfillmentOpen && !nameOpen && !paymentOpen && !reviewed) {
      return { toolCalls: [{ name: "review_order", arguments: {} }] };
    }
    if (DONE.test(said) && cartEmpty) {
      return { text: "Alles klar. Auf Wiederhören!", toolCalls: [{ name: "end_call", arguments: { reason: "no_order" } }] };
    }

    // Try to read items: "zwei Margherita und es Cola"
    const chunks = last.content
      .split(/,|\bund\b|\bplus\b|\bdazu\b/i)
      .map((c) => c.trim())
      .filter(Boolean);
    const items = chunks
      .map((chunk) => {
        const tokens = tokenize(chunk);
        let quantity = 1;
        const qty = tokens.find((t) => /^\d+$/.test(t));
        if (qty && Number(qty) <= 20) quantity = Number(qty);
        const item = tokens.filter((t) => t !== qty).join(" ");
        return { item, quantity };
      })
      .filter((i) => i.item.length > 2);
    if (items.length) return { toolCalls: [{ name: "add_items", arguments: { items } }] };
    return { text: "Entschuldigung, was darf ich für Sie notieren?" };
  }

  private afterTool(last: Extract<LlmMessage, { role: "tool" }>, ctx: string | undefined): { text?: string; toolCalls?: Omit<ToolCall, "id">[] } {
    const result = JSON.parse(last.content) as Record<string, unknown>;
    const allergyOpen = contextValue(ctx, "Allergiefrage")?.startsWith("noch nicht");
    switch (last.name) {
      case "add_items": {
        const results = (result.results as { status: string; notiert?: string; message?: string }[]) ?? [];
        const added = results.filter((r) => r.status === "added").map((r) => r.notiert!.replace(/^(\d+)x /, "$1 "));
        const issues = results.filter((r) => r.status !== "added").map((r) => r.message);
        const parts: string[] = [];
        if (added.length) parts.push(`Gerne, ich habe ${added.join(" und ")} notiert.`);
        if (issues.length) parts.push(issues.join(" "));
        else if (allergyOpen) parts.push("Kurze Frage vorab: Hat jemand eine Lebensmittelallergie oder eine Unverträglichkeit?");
        else parts.push("Darf es sonst noch etwas sein?");
        return { text: parts.join(" ") };
      }
      case "record_allergy_answer":
        return { text: result.weiterleitung ? "Ich verbinde Sie mit unserem Team." : "Danke. Darf es sonst noch etwas sein?" };
      case "set_fulfillment":
        return { text: result.ok ? `${result.erfasst}. Auf welchen Namen darf ich die Bestellung aufnehmen?` : String(result.error) };
      case "set_customer":
        if (!result.ok) return { text: String(result.error) };
        if (contextValue(ctx, "Zahlungsart")?.startsWith("offen")) return { text: "Danke. Möchten Sie bar oder mit TWINT bezahlen?" };
        return { toolCalls: [{ name: "review_order", arguments: {} }] };
      case "set_payment_method":
        return result.ok ? { toolCalls: [{ name: "review_order", arguments: {} }] } : { text: String(result.error) };
      case "review_order": {
        if (!result.ok) return { text: String(result.error) };
        const items = (result.artikel as string[]).map((a) => a.replace(/ – CHF.*$/, "").replace(/^(\d+)x /, "$1 "));
        return {
          text: `Ich fasse zusammen: ${items.join(", ")}. ${result.zeit}, auf den Namen ${result.name}. Das macht total ${result.total}. Stimmt das so?`,
        };
      }
      case "confirm_order":
        if (!result.ok) return { text: String(result.error) };
        return {
          text: `Vielen Dank! Ihre Bestellnummer ist ${result.bestellnummer}. ${result.zeit}. ${result.sms === "SMS-Bestätigung wurde gesendet" ? "Sie erhalten gleich eine SMS. " : ""}Auf Wiederhören und en Guete!`,
        };
      case "transfer_to_staff":
        return { text: "Einen Moment bitte, ich verbinde Sie." };
      case "end_call":
        return { text: result.ok ? "Auf Wiederhören!" : String(result.error) };
      default:
        return { text: "Darf es sonst noch etwas sein?" };
    }
  }
}
