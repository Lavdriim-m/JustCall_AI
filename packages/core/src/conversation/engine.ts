import { Cart, describeLine, lineTotal, lineUnitPrice } from "../cart";
import {
  formatLocalDateTime,
  formatLocalTime,
  getOpenState,
  resolveRequestedTime,
  roundUpMinutes,
} from "../hours";
import type { LlmClient, LlmMessage, LlmUsage, ToolCall } from "../llm/types";
import { emptyUsage } from "../llm/types";
import { formatChf } from "../money";
import { MenuIndex } from "../menu/menu-index";
import type { MenuSnapshot } from "../menu/types";
import { canReceiveSms, formatSwissNumber, toE164 } from "../phone";
import { detectAllergyMention, detectHumanRequest } from "../safety";
import { SentenceStream, normalize } from "../text";
import {
  PAYMENT_LABELS_DE,
  PHRASES,
  buildSystemPrompt,
  closedGreeting,
  defaultGreeting,
  paymentMethodsSentence,
} from "./prompts";
import { TOOL_SPECS } from "./tools";
import type {
  CallerInfo,
  ConversationHooks,
  ConversationPhase,
  DeliveryAddressInput,
  EngineEvent,
  FulfillmentType,
  OrderDraft,
  PaymentMethod,
  PlacedOrder,
  RestaurantProfile,
  TransferReason,
} from "./types";

export type EngineOptions = {
  restaurant: RestaurantProfile;
  menu: MenuSnapshot;
  llm: LlmClient;
  hooks: ConversationHooks;
  caller: CallerInfo;
  /** Maximum model/tool round trips per caller turn. */
  maxToolRounds?: number;
  temperature?: number;
};

type Fulfillment = {
  type: FulfillmentType;
  /** null = as soon as possible */
  requestedFor: Date | null;
  address: DeliveryAddressInput | null;
};

type ToolOutcome = { result: Record<string, unknown> };

/** Small async queue used to forward streamed sentences while the model is still generating. */
class EventQueue<T> {
  private items: T[] = [];
  private waiters: ((v: IteratorResult<T>) => void)[] = [];
  private closed = false;

  push(item: T) {
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value: item, done: false });
    else this.items.push(item);
  }

  close() {
    this.closed = true;
    for (const w of this.waiters.splice(0)) w({ value: undefined as never, done: true });
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<T> {
    while (true) {
      if (this.items.length) {
        yield this.items.shift()!;
        continue;
      }
      if (this.closed) return;
      const next = await new Promise<IteratorResult<T>>((resolve) => this.waiters.push(resolve));
      if (next.done) return;
      yield next.value;
    }
  }
}

/**
 * One phone conversation. Deterministic guards (allergies, explicit human requests, order
 * validation, pricing) wrap a language model that handles natural dialogue via tools.
 */
export class ConversationEngine {
  readonly restaurant: RestaurantProfile;
  readonly menu: MenuIndex;
  readonly cart: Cart;
  readonly systemPrompt: string;
  readonly llm: LlmClient;

  phase: ConversationPhase = "active";
  allergyStatus: "unknown" | "none" | "reported" = "unknown";
  fulfillment: Fulfillment | null = null;
  customerName: string | null = null;
  customerPhone: string | null;
  callerPhone: string | null;
  paymentMethod: PaymentMethod | null = null;
  orderNote: string | null = null;
  placedOrder: PlacedOrder | null = null;
  transferReason: TransferReason | null = null;
  endReason: string | null = null;
  usage: LlmUsage = emptyUsage();
  turns = 0;

  private readonly hooks: ConversationHooks;
  private readonly maxToolRounds: number;
  private readonly temperature: number;
  private messages: LlmMessage[] = [];
  private reviewedKey: string | null = null;
  private pendingTransfer: { reason: TransferReason; note?: string } | null = null;
  private pendingHangup: string | null = null;
  private silenceCount = 0;
  private consecutiveFailures = 0;

  constructor(options: EngineOptions) {
    this.restaurant = options.restaurant;
    this.menu = new MenuIndex(options.menu);
    this.cart = new Cart(this.menu, options.restaurant.maxItemQuantity || 20);
    this.llm = options.llm;
    this.hooks = options.hooks;
    this.maxToolRounds = options.maxToolRounds ?? 6;
    this.temperature = options.temperature ?? 0.3;
    this.callerPhone = options.caller.phone;
    this.customerPhone =
      options.caller.phone && canReceiveSms(options.caller.phone) ? options.caller.phone : null;
    this.systemPrompt = buildSystemPrompt(this.restaurant, this.menu);
  }

  private now(): Date {
    return this.hooks.now?.() ?? new Date();
  }

  get conversation(): readonly LlmMessage[] {
    return this.messages;
  }

  /** Opening line(s). Deterministic so they can be pre-synthesised and cached. */
  start(): EngineEvent[] {
    if (!this.restaurant.acceptingOrders) {
      this.phase = "ending";
      this.endReason = "paused";
      this.messages.push({ role: "assistant", content: PHRASES.notAccepting });
      return [
        { type: "say", text: PHRASES.notAccepting },
        { type: "hangup", reason: "paused" },
      ];
    }
    const open = getOpenState(
      this.now(),
      this.restaurant.openingHours,
      this.restaurant.hoursExceptions,
      this.restaurant.timezone,
    );
    let greeting: string;
    if (open.isOpen) {
      greeting = defaultGreeting(this.restaurant);
    } else {
      const next = open.next ? this.describeNextOpening(open.next.start) : null;
      greeting = closedGreeting(this.restaurant, next);
    }
    this.messages.push({ role: "assistant", content: greeting });
    return [{ type: "say", text: greeting }];
  }

  /** Called by the host when the caller stayed silent for a while. */
  handleSilence(): EngineEvent[] {
    if (this.phase !== "active") return [];
    this.silenceCount += 1;
    if (this.silenceCount >= 3) {
      this.phase = "ending";
      this.endReason = "silence";
      this.messages.push({ role: "assistant", content: PHRASES.silenceGoodbye });
      return [
        { type: "say", text: PHRASES.silenceGoodbye },
        { type: "hangup", reason: "silence" },
      ];
    }
    this.messages.push({ role: "assistant", content: PHRASES.stillThere });
    return [{ type: "say", text: PHRASES.stillThere }];
  }

  /** Ends the conversation because it took too long. */
  handleMaxDuration(): EngineEvent[] {
    if (this.phase !== "active") return [];
    return this.beginTransfer("other", "Maximale Gesprächsdauer erreicht", PHRASES.maxDuration);
  }

  /**
   * Processes one caller utterance and yields what to say/do. Sentences are yielded as soon as they
   * are generated, so the host can start speech synthesis immediately.
   */
  async *handleUserTurn(rawText: string, signal?: AbortSignal): AsyncGenerator<EngineEvent> {
    const text = rawText.trim();
    if (this.phase !== "active" || !text) return;
    this.silenceCount = 0;
    this.turns += 1;
    this.messages.push({ role: "user", content: text });

    // 1) Deterministic safety guards (never depend on the language model for these).
    const allergy = detectAllergyMention(text);
    if (allergy.mentioned) {
      this.allergyStatus = "reported";
      yield { type: "tool", name: "guard.allergy", arguments: { text }, result: allergy };
      for (const ev of this.handleAllergy(`Erwähnt: "${allergy.matched}"`)) yield ev;
      return;
    }
    if (
      this.restaurant.transferOnOwnerRequest &&
      this.restaurant.transferPhone &&
      detectHumanRequest(text)
    ) {
      yield { type: "tool", name: "guard.human_request", arguments: { text }, result: true };
      for (const ev of this.beginTransfer(
        "owner_request",
        "Kunde möchte mit einer Person sprechen",
        PHRASES.ownerTransfer,
      )) {
        yield ev;
      }
      return;
    }

    // 2) Language model with tools.
    let spokeSomething = false;
    for (let round = 0; round < this.maxToolRounds; round++) {
      if (signal?.aborted) return;
      const stream = new SentenceStream();
      const queue = new EventQueue<EngineEvent>();
      const request = this.llm
        .complete({
          system: this.systemPrompt,
          context: this.buildContext(),
          messages: this.messages,
          tools: TOOL_SPECS,
          signal,
          temperature: this.temperature,
          maxTokens: 400,
          cacheKey: `restaurant:${this.restaurant.id}`,
          onTextDelta: (delta) => {
            for (const sentence of stream.push(delta)) queue.push({ type: "say", text: sentence });
          },
        })
        .finally(() => queue.close());

      for await (const ev of queue) {
        spokeSomething = true;
        yield ev;
      }

      let response;
      try {
        response = await request;
        this.consecutiveFailures = 0;
      } catch (err) {
        if (signal?.aborted) return;
        this.consecutiveFailures += 1;
        yield { type: "error", message: err instanceof Error ? err.message : String(err) };
        if (this.consecutiveFailures < 2) {
          // One silent retry for transient provider errors.
          continue;
        }
        for (const ev of this.handleTechnicalFailure()) yield ev;
        return;
      }
      const rest = stream.flush();
      if (rest) {
        spokeSomething = true;
        yield { type: "say", text: rest };
      }
      this.addUsage(response.usage);

      this.messages.push({
        role: "assistant",
        content: response.text,
        toolCalls: response.toolCalls.length ? response.toolCalls : undefined,
      });

      if (!response.toolCalls.length) break;

      for (const call of response.toolCalls) {
        const outcome = await this.executeTool(call);
        yield { type: "tool", name: call.name, arguments: call.arguments, result: outcome.result };
        if (outcome.result.__events) {
          for (const ev of outcome.result.__events as EngineEvent[]) yield ev;
          delete outcome.result.__events;
        }
        this.messages.push({
          role: "tool",
          toolCallId: call.id,
          name: call.name,
          content: JSON.stringify(outcome.result),
        });
      }
      if (round === this.maxToolRounds - 1) {
        // Safety net: the model kept calling tools without answering.
        if (!spokeSomething && !this.pendingTransfer && !this.pendingHangup) {
          yield { type: "say", text: PHRASES.repeat };
        }
      }
    }

    if (!spokeSomething && !this.pendingTransfer && !this.pendingHangup) {
      this.messages.push({ role: "assistant", content: PHRASES.repeat });
      yield { type: "say", text: PHRASES.repeat };
    }

    if (this.pendingTransfer) {
      const { reason, note } = this.pendingTransfer;
      this.pendingTransfer = null;
      this.phase = "transferring";
      if (!spokeSomething) {
        const phrase = reason === "owner_request" ? PHRASES.ownerTransfer : PHRASES.genericTransfer;
        this.messages.push({ role: "assistant", content: phrase });
        yield { type: "say", text: phrase };
      }
      yield { type: "transfer", reason, target: this.restaurant.transferPhone ?? null, note };
      return;
    }
    if (this.pendingHangup) {
      const reason = this.pendingHangup;
      this.pendingHangup = null;
      this.phase = "ending";
      this.endReason = reason;
      yield { type: "hangup", reason };
    }
  }

  /** Snapshot of the collected order state (for logs, dashboards and tests). */
  state() {
    return {
      phase: this.phase,
      allergyStatus: this.allergyStatus,
      cart: this.cart.toJSON(),
      fulfillment: this.fulfillment,
      customerName: this.customerName,
      customerPhone: this.customerPhone,
      paymentMethod: this.paymentMethod,
      orderNote: this.orderNote,
      placedOrder: this.placedOrder,
      transferReason: this.transferReason,
      endReason: this.endReason,
      usage: this.usage,
      turns: this.turns,
    };
  }

  /* ------------------------------------------------------------------------ */
  /*                              Guards & helpers                             */
  /* ------------------------------------------------------------------------ */

  private handleAllergy(note: string): EngineEvent[] {
    if (this.restaurant.transferOnAllergy && this.restaurant.transferPhone) {
      return this.beginTransfer("allergy", note, PHRASES.allergyTransfer);
    }
    this.phase = "ending";
    this.endReason = "allergy_no_transfer";
    this.transferReason = "allergy";
    this.messages.push({ role: "assistant", content: PHRASES.allergyNoTransfer });
    return [
      { type: "say", text: PHRASES.allergyNoTransfer },
      { type: "hangup", reason: "allergy_no_transfer" },
    ];
  }

  private beginTransfer(reason: TransferReason, note: string, phrase: string): EngineEvent[] {
    if (!this.restaurant.transferPhone) {
      this.phase = "ending";
      this.endReason = "transfer_unavailable";
      this.transferReason = reason;
      const text = `${phrase.split(".")[0]}. Leider kann ich Sie im Moment nicht verbinden. Bitte versuchen Sie es später nochmals. Auf Wiederhören.`;
      this.messages.push({ role: "assistant", content: text });
      return [
        { type: "say", text },
        { type: "hangup", reason: "transfer_unavailable" },
      ];
    }
    this.phase = "transferring";
    this.transferReason = reason;
    this.messages.push({ role: "assistant", content: phrase });
    return [
      { type: "say", text: phrase },
      { type: "transfer", reason, target: this.restaurant.transferPhone, note },
    ];
  }

  private handleTechnicalFailure(): EngineEvent[] {
    if (this.restaurant.transferPhone) {
      return this.beginTransfer(
        "technical",
        "Technisches Problem mit dem Sprachmodell",
        PHRASES.technicalTransfer,
      );
    }
    this.phase = "ending";
    this.endReason = "technical_error";
    this.messages.push({ role: "assistant", content: PHRASES.technicalGoodbye });
    return [
      { type: "say", text: PHRASES.technicalGoodbye },
      { type: "hangup", reason: "technical_error" },
    ];
  }

  private addUsage(u: LlmUsage) {
    this.usage.inputTokens += u.inputTokens;
    this.usage.outputTokens += u.outputTokens;
    this.usage.cachedTokens += u.cachedTokens;
  }

  private describeNextOpening(at: Date): string {
    const tz = this.restaurant.timezone;
    const now = this.now();
    const sameDay =
      formatLocalDateTime(at, tz).split(",")[1] === formatLocalDateTime(now, tz).split(",")[1];
    const day = formatLocalDateTime(at, tz).split(",")[0];
    return sameDay ? `${formatLocalTime(at, tz)} Uhr` : `${day}, ${formatLocalTime(at, tz)} Uhr`;
  }

  private leadMinutes(type: FulfillmentType): number {
    const r = this.restaurant;
    return (
      (type === "delivery" ? r.deliveryTimeMinutes : r.prepTimeMinutes) +
      Math.max(0, r.extraWaitMinutes)
    );
  }

  /** Earliest possible ready/delivery time, or null when ordering is impossible right now. */
  earliestTime(type: FulfillmentType): Date | null {
    const r = this.restaurant;
    const now = this.now();
    const state = getOpenState(now, r.openingHours, r.hoursExceptions, r.timezone);
    let base = now;
    if (!state.isOpen) {
      if (!r.allowPreorders || !state.next) return null;
      if (state.next.start.getTime() - now.getTime() > 24 * 3600_000) return null;
      base = state.next.start;
    }
    return roundUpMinutes(new Date(base.getTime() + this.leadMinutes(type) * 60_000), 5);
  }

  private isOpenAt(at: Date): boolean {
    const r = this.restaurant;
    // Must still be open one minute before the requested time.
    return getOpenState(
      new Date(at.getTime() - 60_000),
      r.openingHours,
      r.hoursExceptions,
      r.timezone,
    ).isOpen;
  }

  private detailsKey(): string {
    const f = this.fulfillment;
    return [
      this.cart.version,
      f?.type ?? "",
      f?.requestedFor?.toISOString() ?? "asap",
      f?.address ? JSON.stringify(f.address) : "",
      this.customerName ?? "",
      this.paymentMethod ?? "",
    ].join("|");
  }

  private deliveryFee(): number {
    return this.fulfillment?.type === "delivery" ? this.restaurant.deliveryFeeCents : 0;
  }

  private estimatedReadyAt(): Date | null {
    if (!this.fulfillment) return null;
    if (this.fulfillment.requestedFor) return this.fulfillment.requestedFor;
    return this.earliestTime(this.fulfillment.type);
  }

  private missingDetails(): string[] {
    const missing: string[] = [];
    const r = this.restaurant;
    if (this.cart.isEmpty) missing.push("Artikel");
    if (r.allergyQuestionEnabled && this.allergyStatus === "unknown")
      missing.push("Antwort auf die Allergiefrage");
    if (!this.fulfillment)
      missing.push(
        r.pickupEnabled && r.deliveryEnabled
          ? "Abholung oder Lieferung und Zeit"
          : "gewünschte Zeit",
      );
    if (!this.customerName) missing.push("Name");
    if (this.fulfillment?.type === "delivery" && !this.customerPhone)
      missing.push("Telefonnummer für die Lieferung");
    if (r.paymentMethods.length > 1 && !this.paymentMethod) missing.push("Zahlungsart");
    return missing;
  }

  private fulfillmentText(): string {
    if (!this.fulfillment) return "offen";
    const tz = this.restaurant.timezone;
    const when = this.fulfillment.requestedFor
      ? `um ${formatLocalTime(this.fulfillment.requestedFor, tz)}`
      : (() => {
          const eta = this.earliestTime(this.fulfillment!.type);
          return eta
            ? `so schnell wie möglich (ca. ${formatLocalTime(eta, tz)})`
            : "so schnell wie möglich";
        })();
    if (this.fulfillment.type === "delivery") {
      const a = this.fulfillment.address;
      const addr = a
        ? [a.street, [a.postalCode, a.city].filter(Boolean).join(" ")].filter(Boolean).join(", ")
        : "";
      return `Lieferung ${when}${addr ? ` an ${addr}` : ""}`;
    }
    return `Abholung ${when}`;
  }

  /** Dynamic per-turn context for the model. */
  buildContext(): string {
    const r = this.restaurant;
    const now = this.now();
    const tz = r.timezone;
    const open = getOpenState(now, r.openingHours, r.hoursExceptions, tz);
    const lines: string[] = ["STAND DES GESPRÄCHS (Systeminformation, nicht vom Kunden gesagt)"];
    lines.push(`- Jetzt: ${formatLocalDateTime(now, tz)}`);
    if (open.isOpen) {
      lines.push(
        `- Restaurant: geöffnet${open.current ? ` bis ${formatLocalTime(open.current.end, tz)} Uhr` : ""}`,
      );
    } else {
      lines.push(
        `- Restaurant: GESCHLOSSEN${open.next ? `, nächste Öffnung ${this.describeNextOpening(open.next.start)}` : ""}. ${
          r.allowPreorders
            ? "Vorbestellungen für nach der Öffnung sind möglich."
            : "Keine Bestellungen möglich."
        }`,
      );
    }
    if (r.pickupEnabled) {
      const t = this.earliestTime("pickup");
      lines.push(
        `- Frühestmögliche Abholung: ${t ? `${formatLocalTime(t, tz)} Uhr` : "heute nicht möglich"}`,
      );
    }
    if (r.deliveryEnabled) {
      const t = this.earliestTime("delivery");
      lines.push(
        `- Frühestmögliche Lieferung: ${t ? `${formatLocalTime(t, tz)} Uhr` : "heute nicht möglich"}`,
      );
    }
    if (r.allergyQuestionEnabled) {
      lines.push(
        `- Allergiefrage: ${
          this.allergyStatus === "unknown"
            ? "noch nicht beantwortet"
            : this.allergyStatus === "none"
              ? "beantwortet – keine Allergien"
              : "Allergie gemeldet"
        }`,
      );
    }
    lines.push(`- Warenkorb:\n${this.cart.summary().replace(/^/gm, "    ")}`);
    if (!this.cart.isEmpty) lines.push(`- Zwischensumme: ${formatChf(this.cart.subtotalCents)}`);
    lines.push(`- Abholung/Lieferung: ${this.fulfillmentText()}`);
    lines.push(`- Name: ${this.customerName ?? "offen"}`);
    lines.push(
      `- Telefon für SMS: ${
        this.customerPhone
          ? `${formatSwissNumber(this.customerPhone)}${this.customerPhone === this.callerPhone ? " (Anrufernummer, nicht erneut fragen)" : ""}`
          : this.callerPhone
            ? "Anrufernummer ist kein Handy – keine SMS möglich, nicht nach Nummer fragen"
            : "Nummer unterdrückt – frage beim Namen optional nach einer Handynummer für die SMS"
      }`,
    );
    if (r.paymentMethods.length > 1) {
      lines.push(
        `- Zahlungsart: ${this.paymentMethod ? PAYMENT_LABELS_DE[this.paymentMethod] : `offen (Möglichkeiten: ${paymentMethodsSentence(r.paymentMethods)})`}`,
      );
    }
    if (this.orderNote) lines.push(`- Bemerkung: ${this.orderNote}`);
    lines.push(
      `- Zusammenfassung vorgelesen: ${this.reviewedKey === this.detailsKey() ? "ja (aktuell)" : "nein"}`,
    );
    lines.push(`- NÄCHSTER SCHRITT: ${this.nextStep()}`);
    return lines.join("\n");
  }

  private nextStep(): string {
    if (this.placedOrder) return "Die Bestellung ist abgeschlossen. Verabschiede dich kurz.";
    const r = this.restaurant;
    if (this.cart.isEmpty) {
      return "Finde heraus, was der Kunde bestellen möchte, und erfasse es mit add_items.";
    }
    if (r.allergyQuestionEnabled && this.allergyStatus === "unknown") {
      return "Lies kurz vor, was notiert ist (falls noch nicht geschehen), und stelle JETZT die Allergiefrage, bevor du weitermachst.";
    }
    const missing = this.missingDetails().filter(
      (m) => m !== "Artikel" && !m.startsWith("Antwort"),
    );
    if (missing.length) {
      return `Nimm weitere Wünsche auf. Sobald der Kunde nichts mehr möchte, kläre der Reihe nach: ${missing.join(", ")}.`;
    }
    if (this.reviewedKey !== this.detailsKey()) {
      return "Falls der Kunde nichts mehr möchte: review_order aufrufen, die Zusammenfassung vorlesen und fragen, ob alles stimmt.";
    }
    return "Warte auf die ausdrückliche Bestätigung. Bei Zustimmung confirm_order aufrufen, bei Änderungen den Warenkorb anpassen.";
  }

  /* ------------------------------------------------------------------------ */
  /*                                   Tools                                   */
  /* ------------------------------------------------------------------------ */

  private async executeTool(call: ToolCall): Promise<ToolOutcome> {
    const args = call.arguments ?? {};
    try {
      switch (call.name) {
        case "add_items":
          return this.toolAddItems(args);
        case "update_line":
          return this.toolUpdateLine(args);
        case "remove_line":
          return this.toolRemoveLine(args);
        case "search_menu":
          return this.toolSearchMenu(args);
        case "record_allergy_answer":
          return this.toolAllergy(args);
        case "set_fulfillment":
          return this.toolSetFulfillment(args);
        case "set_customer":
          return this.toolSetCustomer(args);
        case "set_payment_method":
          return this.toolSetPayment(args);
        case "set_order_note":
          this.orderNote = String(args.note ?? "").trim() || null;
          return { result: { ok: true, note: this.orderNote } };
        case "review_order":
          return this.toolReview();
        case "confirm_order":
          return await this.toolConfirm(args);
        case "transfer_to_staff":
          return this.toolTransfer(args);
        case "end_call":
          return this.toolEndCall(args);
        default:
          return { result: { ok: false, error: `Unbekanntes Tool ${call.name}` } };
      }
    } catch (err) {
      return { result: { ok: false, error: err instanceof Error ? err.message : String(err) } };
    }
  }

  private cartState() {
    return {
      cart: this.cart.isEmpty ? "(leer)" : this.cart.summary(),
      subtotal: formatChf(this.cart.subtotalCents),
    };
  }

  private toolAddItems(args: Record<string, unknown>): ToolOutcome {
    const items = Array.isArray(args.items) ? (args.items as Record<string, unknown>[]) : [];
    if (!items.length) return { result: { ok: false, error: "Keine Artikel angegeben." } };
    const results = items.map((raw) => {
      const res = this.cart.add({
        item: String(raw.item ?? ""),
        quantity: raw.quantity === undefined ? 1 : Number(raw.quantity),
        options: Array.isArray(raw.options) ? raw.options.map(String) : [],
        notes: raw.notes ? String(raw.notes) : null,
      });
      return res.status === "added"
        ? { status: "added", line: res.lineId, notiert: res.text }
        : { status: res.status, message: res.message };
    });
    const anyAdded = results.some((r) => r.status === "added");
    const needsAllergy = this.restaurant.allergyQuestionEnabled && this.allergyStatus === "unknown";
    const hint = !anyAdded
      ? "Kläre die Rückfragen mit dem Kunden."
      : needsAllergy
        ? "Lies kurz vor, was notiert wurde (ohne Preise). Stelle danach die Allergiefrage."
        : results.some((r) => r.status !== "added")
          ? "Lies kurz vor, was notiert wurde, und kläre die offenen Rückfragen."
          : "Lies kurz vor, was notiert wurde (ohne Preise), und frage, ob es noch etwas sein darf.";
    return { result: { results, ...this.cartState(), hinweis: hint } };
  }

  private toolUpdateLine(args: Record<string, unknown>): ToolOutcome {
    const res = this.cart.update(String(args.line ?? ""), {
      quantity: args.quantity === undefined ? undefined : Number(args.quantity),
      options: Array.isArray(args.options) ? args.options.map(String) : undefined,
      notes: args.notes === undefined ? undefined : String(args.notes),
    });
    if (!res.ok) return { result: { ok: false, error: res.message, ...this.cartState() } };
    return { result: { ok: true, geaendert: res.text, ...this.cartState() } };
  }

  private toolRemoveLine(args: Record<string, unknown>): ToolOutcome {
    const line = this.cart.getLine(String(args.line ?? ""));
    if (!line)
      return {
        result: {
          ok: false,
          error: `Position ${String(args.line)} existiert nicht.`,
          ...this.cartState(),
        },
      };
    this.cart.remove(line.lineId);
    return { result: { ok: true, entfernt: describeLine(line), ...this.cartState() } };
  }

  private toolSearchMenu(args: Record<string, unknown>): ToolOutcome {
    const query = String(args.query ?? "");
    const items = this.menu.search(query);
    return {
      result: {
        treffer: items.map((i) => ({
          id: this.menu.refForItem(i.id),
          name: i.name,
          preis: formatChf(i.priceCents),
          beschreibung: i.description ?? undefined,
          verfuegbar: i.isAvailable,
        })),
      },
    };
  }

  private toolAllergy(args: Record<string, unknown>): ToolOutcome {
    const has = args.has_allergy === true || String(args.has_allergy).toLowerCase() === "true";
    if (!has) {
      this.allergyStatus = "none";
      return {
        result: {
          ok: true,
          hinweis: "Keine Allergien. Bedanke dich kurz und fahre mit der Bestellung fort.",
        },
      };
    }
    this.allergyStatus = "reported";
    if (this.restaurant.transferOnAllergy && this.restaurant.transferPhone) {
      this.pendingTransfer = {
        reason: "allergy",
        note: String(args.details ?? "Allergie gemeldet"),
      };
      return {
        result: {
          ok: true,
          weiterleitung: true,
          hinweis:
            "Sage in einem Satz, dass du bei Allergien aus Sicherheitsgründen direkt mit dem Team verbindest. Keine weiteren Fragen.",
        },
      };
    }
    this.pendingHangup = "allergy_no_transfer";
    return {
      result: {
        ok: true,
        weiterleitung: false,
        hinweis:
          "Erkläre, dass du bei Allergien keine Bestellung aufnehmen kannst und der Kunde sich direkt an das Personal im Restaurant wenden soll. Verabschiede dich.",
      },
    };
  }

  private toolSetFulfillment(args: Record<string, unknown>): ToolOutcome {
    const r = this.restaurant;
    const type = args.type === "delivery" ? "delivery" : "pickup";
    if (type === "pickup" && !r.pickupEnabled)
      return { result: { ok: false, error: "Abholung ist nicht möglich, nur Lieferung." } };
    if (type === "delivery" && !r.deliveryEnabled)
      return { result: { ok: false, error: "Lieferung ist nicht möglich, nur Abholung." } };

    let address: DeliveryAddressInput | null = null;
    if (type === "delivery") {
      const a = (args.address ?? {}) as Record<string, unknown>;
      const street = String(a.street ?? "").trim();
      if (!street)
        return {
          result: { ok: false, error: "Für die Lieferung brauche ich Strasse und Hausnummer." },
        };
      address = {
        street,
        postalCode: a.postal_code ? String(a.postal_code).trim() : undefined,
        city: a.city ? String(a.city).trim() : undefined,
        notes: a.notes ? String(a.notes).trim() : undefined,
      };
      if (r.deliveryPostalCodes.length) {
        if (!address.postalCode)
          return { result: { ok: false, error: "Bitte nach der Postleitzahl fragen." } };
        if (!r.deliveryPostalCodes.includes(address.postalCode)) {
          return {
            result: {
              ok: false,
              error: `Die Postleitzahl ${address.postalCode} liegt ausserhalb des Liefergebiets (${r.deliveryPostalCodes.join(", ")}).${r.pickupEnabled ? " Biete Abholung an." : ""}`,
            },
          };
        }
      }
    }

    const earliest = this.earliestTime(type);
    if (!earliest) {
      return {
        result: {
          ok: false,
          error:
            "Das Restaurant ist geschlossen und nimmt jetzt keine Bestellungen an. Informiere über die Öffnungszeiten.",
        },
      };
    }
    const tz = r.timezone;
    const timeArg = String(args.time ?? "asap")
      .trim()
      .toLowerCase();
    let requestedFor: Date | null = null;
    if (timeArg && timeArg !== "asap" && timeArg !== "sofort") {
      const t = resolveRequestedTime(timeArg, this.now(), tz);
      if (!t)
        return { result: { ok: false, error: "Zeit bitte im Format HH:MM angeben oder 'asap'." } };
      if (t.getTime() < earliest.getTime() - 2 * 60_000) {
        return {
          result: {
            ok: false,
            error: `Das ist zu früh. Frühestens um ${formatLocalTime(earliest, tz)} Uhr möglich. Frage, ob das passt.`,
          },
        };
      }
      if (t.getTime() - this.now().getTime() > 24 * 3600_000) {
        return {
          result: {
            ok: false,
            error: "Vorbestellungen sind nur für die nächsten 24 Stunden möglich.",
          },
        };
      }
      if (!this.isOpenAt(t)) {
        return {
          result: {
            ok: false,
            error: `Um ${formatLocalTime(t, tz)} Uhr ist das Restaurant geschlossen. Nenne eine Zeit innerhalb der Öffnungszeiten.`,
          },
        };
      }
      // Times after closing are rejected above; requests at least `earliest` are accepted as-is.
      requestedFor = t;
    } else if (!this.isOpenAt(earliest)) {
      return {
        result: {
          ok: false,
          error: "Heute ist keine Bestellung mehr möglich, die Küche schliesst vorher.",
        },
      };
    }

    this.fulfillment = { type, requestedFor, address };
    if (type === "delivery" && this.cart.subtotalCents < r.deliveryMinOrderCents) {
      return {
        result: {
          ok: true,
          warnung: `Der Mindestbestellwert für Lieferungen ist ${formatChf(r.deliveryMinOrderCents)}. Aktuell ${formatChf(this.cart.subtotalCents)}. Weise freundlich darauf hin.`,
          erfasst: this.fulfillmentText(),
        },
      };
    }
    return {
      result: {
        ok: true,
        erfasst: this.fulfillmentText(),
        liefergebuehr: type === "delivery" ? formatChf(r.deliveryFeeCents) : undefined,
      },
    };
  }

  private toolSetCustomer(args: Record<string, unknown>): ToolOutcome {
    const name = String(args.name ?? "")
      .trim()
      .replace(/\s+/g, " ");
    if (!name || name.length > 60)
      return { result: { ok: false, error: "Bitte einen gültigen Namen erfassen." } };
    this.customerName = name;
    if (args.phone) {
      const e164 = toE164(String(args.phone));
      if (!e164)
        return {
          result: {
            ok: false,
            error: "Die Telefonnummer ist ungültig. Bitte nochmals erfragen.",
            name,
          },
        };
      this.customerPhone = e164;
    }
    return {
      result: {
        ok: true,
        name,
        telefon: this.customerPhone ? formatSwissNumber(this.customerPhone) : null,
      },
    };
  }

  private toolSetPayment(args: Record<string, unknown>): ToolOutcome {
    const method = String(args.method ?? "") as PaymentMethod;
    if (!this.restaurant.paymentMethods.includes(method)) {
      return {
        result: {
          ok: false,
          error: `Diese Zahlungsart wird nicht angeboten. Möglich: ${paymentMethodsSentence(this.restaurant.paymentMethods)}.`,
        },
      };
    }
    this.paymentMethod = method;
    return { result: { ok: true, zahlung: PAYMENT_LABELS_DE[method] } };
  }

  private toolReview(): ToolOutcome {
    const missing = this.missingDetails();
    if (missing.includes("Artikel"))
      return { result: { ok: false, error: "Der Warenkorb ist leer." } };
    const r = this.restaurant;
    if (
      this.fulfillment?.type === "delivery" &&
      this.cart.subtotalCents < r.deliveryMinOrderCents
    ) {
      return {
        result: {
          ok: false,
          error: `Mindestbestellwert für Lieferung ${formatChf(r.deliveryMinOrderCents)} nicht erreicht (aktuell ${formatChf(this.cart.subtotalCents)}).`,
        },
      };
    }
    if (missing.length) {
      return {
        result: { ok: false, error: `Vor der Zusammenfassung fehlt noch: ${missing.join(", ")}.` },
      };
    }
    this.reviewedKey = this.detailsKey();
    const fee = this.deliveryFee();
    return {
      result: {
        ok: true,
        artikel: this.cart.items.map((l) => `${describeLine(l)} – ${formatChf(lineTotal(l))}`),
        liefergebuehr: fee ? formatChf(fee) : undefined,
        total: formatChf(this.cart.subtotalCents + fee),
        zeit: this.fulfillmentText(),
        name: this.customerName,
        zahlung: this.paymentMethod
          ? PAYMENT_LABELS_DE[this.paymentMethod]
          : paymentMethodsSentence(r.paymentMethods),
        bemerkung: this.orderNote ?? undefined,
        hinweis:
          "Lies alle Artikel, das Total, die Zeit und den Namen in natürlichen Sätzen vor (ohne Einzelpreise, ausser der Kunde fragt) und frage: Stimmt das so?",
      },
    };
  }

  private async toolConfirm(args: Record<string, unknown>): Promise<ToolOutcome> {
    if (this.placedOrder) {
      return {
        result: { ok: true, bereits_bestaetigt: true, bestellnummer: this.placedOrder.orderNumber },
      };
    }
    if (args.customer_confirmed !== true) {
      return {
        result: {
          ok: false,
          error: "Der Kunde muss die Zusammenfassung zuerst ausdrücklich bestätigen.",
        },
      };
    }
    const missing = this.missingDetails();
    if (missing.length)
      return { result: { ok: false, error: `Es fehlt noch: ${missing.join(", ")}.` } };
    if (this.reviewedKey !== this.detailsKey()) {
      return {
        result: {
          ok: false,
          error:
            "Die Bestellung wurde seit der letzten Zusammenfassung geändert oder noch nicht zusammengefasst. Rufe review_order auf und lies sie vor.",
        },
      };
    }
    const r = this.restaurant;
    const f = this.fulfillment!;
    if (f.type === "delivery" && this.cart.subtotalCents < r.deliveryMinOrderCents) {
      return {
        result: {
          ok: false,
          error: `Mindestbestellwert für Lieferung ${formatChf(r.deliveryMinOrderCents)} nicht erreicht.`,
        },
      };
    }
    const eta = this.estimatedReadyAt();
    if (!eta) {
      return {
        result: {
          ok: false,
          error: "Das Restaurant nimmt gerade keine Bestellungen an (geschlossen).",
        },
      };
    }
    const fee = this.deliveryFee();
    const draft: OrderDraft = {
      restaurantId: r.id,
      lines: this.cart.items.map((l) => ({
        ...l,
        unitPriceCents: lineUnitPrice(l),
        lineTotalCents: lineTotal(l),
      })),
      subtotalCents: this.cart.subtotalCents,
      deliveryFeeCents: fee,
      totalCents: this.cart.subtotalCents + fee,
      fulfillment: f.type,
      requestedFor: f.requestedFor,
      estimatedReadyAt: eta,
      customerName: this.customerName!,
      customerPhone: this.customerPhone,
      deliveryAddress: f.address,
      paymentMethod:
        this.paymentMethod ?? (r.paymentMethods.length === 1 ? r.paymentMethods[0]! : null),
      notes: this.orderNote,
    };
    let placed: PlacedOrder;
    try {
      placed = await this.hooks.placeOrder(draft);
    } catch (err) {
      return {
        result: {
          ok: false,
          error:
            "Die Bestellung konnte technisch nicht übermittelt werden. Entschuldige dich und verbinde mit dem Personal (transfer_to_staff, reason other).",
          detail: err instanceof Error ? err.message : String(err),
        },
      };
    }
    this.placedOrder = placed;
    this.pendingHangup = "order_placed";
    const tz = r.timezone;
    const payment = draft.paymentMethod;
    let paymentHint = payment
      ? PAYMENT_LABELS_DE[payment]
      : paymentMethodsSentence(r.paymentMethods);
    if (payment === "twint" && r.twintPaymentUrl && placed.smsStatus === "sent") {
      paymentHint += " – der TWINT-Link ist in der SMS";
    }
    return {
      result: {
        ok: true,
        bestellnummer: placed.orderNumber,
        zeit: `${f.type === "delivery" ? "Lieferung" : "Abholung"} ca. ${formatLocalTime(eta, tz)} Uhr`,
        total: formatChf(draft.totalCents),
        zahlung: paymentHint,
        sms: placed.smsStatus === "sent" ? "SMS-Bestätigung wurde gesendet" : "keine SMS",
        hinweis:
          "Nenne die Bestellnummer deutlich, die Zeit und die Zahlung, erwähne die SMS (falls gesendet), bedanke dich und verabschiede dich. Stelle KEINE weitere Frage – das Gespräch endet danach automatisch.",
        __events: [{ type: "order_placed", order: placed, draft }] satisfies EngineEvent[],
      },
    };
  }

  private toolTransfer(args: Record<string, unknown>): ToolOutcome {
    const allowed: TransferReason[] = [
      "allergy",
      "owner_request",
      "complaint",
      "large_order",
      "other",
    ];
    const reason = (
      allowed.includes(args.reason as TransferReason) ? args.reason : "other"
    ) as TransferReason;
    const note = args.note ? String(args.note) : undefined;
    if (reason === "allergy") this.allergyStatus = "reported";
    const r = this.restaurant;
    if (!r.transferPhone) {
      this.pendingHangup = "transfer_unavailable";
      this.transferReason = reason;
      return {
        result: {
          ok: false,
          weiterleitung: false,
          hinweis:
            reason === "allergy"
              ? "Eine Verbindung ist nicht möglich. Erkläre, dass du bei Allergien keine Bestellung aufnehmen kannst und der Kunde sich direkt an das Personal wenden soll. Verabschiede dich."
              : "Eine Verbindung ist gerade nicht möglich. Entschuldige dich, biete an, die Bestellung trotzdem aufzunehmen, oder bitte, es später nochmals zu versuchen.",
        },
      };
    }
    if (reason === "owner_request" && !r.transferOnOwnerRequest) {
      return {
        result: {
          ok: false,
          weiterleitung: false,
          hinweis:
            "Eine Verbindung zum Inhaber ist nicht vorgesehen. Biete freundlich an, die Bestellung aufzunehmen.",
        },
      };
    }
    this.pendingTransfer = { reason, note };
    this.transferReason = reason;
    return {
      result: {
        ok: true,
        weiterleitung: true,
        hinweis: "Sage in einem kurzen Satz, dass du jetzt verbindest.",
      },
    };
  }

  private toolEndCall(args: Record<string, unknown>): ToolOutcome {
    if (!this.placedOrder && !this.cart.isEmpty) {
      const said = normalize(
        String(this.messages.filter((m) => m.role === "user").at(-1)?.content ?? ""),
      );
      // Prevent accidental hang-ups while an order is in progress, unless the caller cancelled.
      if (
        !/\b(tschuss|tschau|ciao|adieu|uf widerluege|auf wiederh\w*|abbrechen|nicht mehr|doch nicht|vergessen sie|stornier\w*|egal)\b/.test(
          said,
        )
      ) {
        return {
          result: {
            ok: false,
            error:
              "Es ist eine Bestellung in Arbeit. Frage zuerst, ob der Kunde die Bestellung abbrechen möchte.",
          },
        };
      }
    }
    this.pendingHangup = String(args.reason ?? "no_order");
    return { result: { ok: true, hinweis: "Verabschiede dich in einem kurzen Satz." } };
  }
}
