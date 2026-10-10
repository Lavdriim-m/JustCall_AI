import {
  ConversationEngine,
  normalizeForSpeech,
  type EngineEvent,
  type MenuSnapshot,
  type RestaurantProfile,
  type TransferReason,
} from "@justcall/core";
import type { LlmClient } from "@justcall/core/llm";
import { updateCall, type Call, type Database } from "@justcall/db";
import type { Config } from "../config";
import type { Logger } from "../logger";
import { createSttSession, type SttSession } from "../stt";
import type { TtsProvider } from "../tts";
import type { CallPersistence } from "./persistence";

/** How the session talks to the phone line (Twilio media stream or browser simulator). */
export interface CallTransport {
  readonly kind: "twilio" | "simulator";
  sendAudio(mulaw: Buffer): void;
  sendMark(name: string): void;
  clearAudio(): void;
  /** Hands the call to a human. `fallbackSay` is spoken by the carrier if our own TTS failed. */
  transfer(target: string, reason: TransferReason, fallbackSay?: string): Promise<void>;
  hangup(): Promise<void>;
  /** Optional structured events (simulator UI). */
  emit?(event: Record<string, unknown>): void;
}

export type CallSessionOptions = {
  config: Config;
  logger: Logger;
  db: Database;
  callId: string;
  restaurant: RestaurantProfile;
  menu: MenuSnapshot;
  phrases: string[];
  callerPhone: string | null;
  transport: CallTransport;
  /** "voice" = audio in/out, "text" = simulator chat without audio. */
  mode: "voice" | "text";
  llm: LlmClient;
  tts: TtsProvider | null;
  ttsVoice?: string | null;
  sttProvider?: string | null;
  persistence: CallPersistence;
  isSimulation: boolean;
};

type CallOutcome = NonNullable<Call["outcome"]>;
type Turn = {
  controller: AbortController;
  spoke: boolean;
  muted: boolean;
  text: string[];
  done: Promise<void>;
};
type SpeechItem = { text: string; audio: Promise<Buffer | null>; turn: Turn | null };

/**
 * One live phone call: streams caller audio into speech recognition, runs the conversation engine
 * turn by turn, synthesises replies sentence by sentence and executes transfers/hang-ups.
 */
export class CallSession {
  readonly engine: ConversationEngine;
  private readonly o: CallSessionOptions;
  private stt: SttSession | null = null;
  private sttRestarts = 0;

  private utterance: string[] = [];
  private commitTimer: NodeJS.Timeout | null = null;
  private silenceTimer: NodeJS.Timeout | null = null;
  private maxDurationTimer: NodeJS.Timeout | null = null;

  private turn: Turn | null = null;
  private speech: SpeechItem[] = [];
  private playing = false;
  private marks = new Set<string>();
  private markCounter = 0;
  private playbackUntil = 0;
  private playbackWaiters: (() => void)[] = [];
  private ttsFailures = 0;

  private ending = false;
  private ended = false;
  private outcome: {
    status: "completed" | "transferred" | "failed";
    outcome: CallOutcome | null;
    transferReason?: string | null;
    error?: string | null;
  } = {
    status: "completed",
    outcome: null,
  };
  readonly startedAt = Date.now();

  constructor(options: CallSessionOptions) {
    this.o = options;
    this.engine = new ConversationEngine({
      restaurant: options.restaurant,
      menu: options.menu,
      llm: options.llm,
      caller: { phone: options.callerPhone },
      hooks: { placeOrder: (draft) => options.persistence.placeOrder(draft) },
    });
  }

  get isEnded() {
    return this.ended;
  }

  /* ------------------------------------------------------------------ */
  /*                              Lifecycle                              */
  /* ------------------------------------------------------------------ */

  async start() {
    const { config, logger } = this.o;
    await updateCall(this.o.db, this.o.callId, {
      status: "in_progress",
      answeredAt: new Date(),
      llmProvider: `${this.o.llm.provider}:${this.o.llm.model}`,
      sttProvider: this.o.mode === "voice" ? this.o.sttProvider || config.STT_PROVIDER : "text",
      ttsProvider: this.o.mode === "voice" ? (this.o.tts?.name ?? null) : "text",
    });
    if (this.o.mode === "voice") this.startStt();
    this.maxDurationTimer = setTimeout(() => {
      logger.warn("max call duration reached");
      void this.handleEvents(this.engine.handleMaxDuration(), null);
    }, config.CALL_MAX_DURATION_SECONDS * 1000);
    this.o.persistence.event("system", "Anruf gestartet", {
      caller: this.o.callerPhone,
      mode: this.o.mode,
      llm: `${this.o.llm.provider}:${this.o.llm.model}`,
    });
    await this.handleEvents(this.engine.start(), null);
    this.emitState();
  }

  private startStt() {
    try {
      this.stt = createSttSession(this.o.config, this.o.sttProvider, {
        phrases: this.o.phrases,
        logger: this.o.logger,
        events: {
          onPartial: (text) => this.onPartial(text),
          onFinal: (text) => this.onFinal(text),
          onSpeechStart: () => this.onSpeechStart(),
          onError: (err) => this.onSttError(err),
        },
      });
    } catch (err) {
      this.onSttError(err instanceof Error ? err : new Error(String(err)));
    }
  }

  private onSttError(err: Error) {
    this.o.logger.error({ err }, "speech recognition error");
    this.o.persistence.event("system", `STT-Fehler: ${err.message}`);
    if (this.ending) return;
    if (this.sttRestarts < 2) {
      this.sttRestarts += 1;
      const old = this.stt;
      this.stt = null;
      void old?.close().catch(() => undefined);
      setTimeout(() => !this.ending && this.startStt(), 300);
      return;
    }
    // Recognition keeps failing – hand over to a human (or end politely).
    this.outcome.error = `STT failure: ${err.message}`;
    void this.performTransfer("technical", "Spracherkennung ausgefallen");
  }

  /** Caller audio from the transport (20 ms μ-law frames). */
  onAudio(frame: Buffer) {
    if (this.ended) return;
    this.stt?.write(frame);
  }

  /** Text typed in the simulator (bypasses speech recognition). */
  onText(text: string) {
    if (this.ended || !text.trim()) return;
    this.utterance.push(text.trim());
    this.commitUtterance();
  }

  /** Playback position marker echoed by the transport. */
  onMark(name: string) {
    this.marks.delete(name);
    if (!this.marks.size) this.onPlaybackDrained();
  }

  /** The caller hung up or the stream closed. */
  async onStop(reason = "caller_hangup") {
    if (this.ended) return;
    this.ended = true;
    this.ending = true;
    this.clearTimers();
    this.turn?.controller.abort();
    await this.stt?.close().catch(() => undefined);
    const state = this.engine.state();
    if (!this.outcome.outcome) {
      this.outcome.outcome = state.placedOrder
        ? "order_placed"
        : state.transferReason
          ? transferOutcome(state.transferReason)
          : state.endReason === "paused"
            ? "paused"
            : "no_order";
    }
    this.o.persistence.event("system", `Anruf beendet (${reason})`, {
      state: summarizeState(state),
    });
    await this.o.persistence.flush();
    const usage = {
      llmInputTokens: state.usage.inputTokens,
      llmOutputTokens: state.usage.outputTokens,
      llmCachedTokens: state.usage.cachedTokens,
      sttSeconds: Math.round(this.stt?.audioSeconds ?? 0),
      ttsCharacters: this.ttsCharacters,
      turns: state.turns,
    };
    await updateCall(this.o.db, this.o.callId, {
      status: this.outcome.status,
      outcome: this.outcome.outcome,
      transferReason: this.outcome.transferReason ?? state.transferReason ?? null,
      endedAt: new Date(),
      durationSeconds: Math.round((Date.now() - this.startedAt) / 1000),
      usage,
      error: this.outcome.error ?? null,
      summary: buildSummary(state),
    }).catch((err) => this.o.logger.error({ err }, "failed to finalize call"));
  }

  private clearTimers() {
    for (const t of [this.commitTimer, this.silenceTimer, this.maxDurationTimer])
      if (t) clearTimeout(t);
    this.commitTimer = this.silenceTimer = this.maxDurationTimer = null;
  }

  /* ------------------------------------------------------------------ */
  /*                         Speech recognition                          */
  /* ------------------------------------------------------------------ */

  private onSpeechStart() {
    this.stopSilenceTimer();
  }

  private onPartial(text: string) {
    this.stopSilenceTimer();
    // The caller is still talking – postpone committing the utterance.
    if (this.commitTimer && this.utterance.length) {
      clearTimeout(this.commitTimer);
      this.commitTimer = null;
    }
    const words = text.split(/\s+/).filter((w) => w.length > 1).length;
    if (this.isSpeaking() && (words >= this.o.config.BARGE_IN_MIN_WORDS || text === "…")) {
      this.bargeIn();
    }
  }

  private onFinal(text: string) {
    if (this.ending) return;
    this.stopSilenceTimer();
    this.utterance.push(text);
    const words = text.split(/\s+/).filter((w) => w.length > 1).length;
    if (this.isSpeaking() && words >= this.o.config.BARGE_IN_MIN_WORDS) this.bargeIn();
    if (this.stt?.endpointing === "segment") {
      this.commitUtterance();
      return;
    }
    if (this.commitTimer) clearTimeout(this.commitTimer);
    this.commitTimer = setTimeout(() => this.commitUtterance(), this.o.config.END_OF_TURN_MS);
  }

  private commitUtterance() {
    if (this.commitTimer) {
      clearTimeout(this.commitTimer);
      this.commitTimer = null;
    }
    const text = this.utterance.join(" ").replace(/\s+/g, " ").trim();
    this.utterance = [];
    if (!text || this.ending) return;
    void this.runTurn(text);
  }

  /* ------------------------------------------------------------------ */
  /*                               Turns                                 */
  /* ------------------------------------------------------------------ */

  private async runTurn(text: string) {
    // Only one turn at a time: a newer utterance supersedes the one still being answered.
    const previous = this.turn;
    if (previous) {
      previous.muted = true;
      previous.controller.abort();
      await previous.done.catch(() => undefined);
    }
    if (this.ending) return;

    let resolveDone!: () => void;
    const turn: Turn = {
      controller: new AbortController(),
      spoke: false,
      muted: false,
      text: [],
      done: new Promise<void>((r) => (resolveDone = r)),
    };
    this.turn = turn;
    this.o.persistence.event("user", text);
    this.o.transport.emit?.({ type: "transcript", role: "user", text });
    const started = Date.now();
    try {
      for await (const ev of this.engine.handleUserTurn(text, turn.controller.signal)) {
        if (ev.type === "say" && turn === this.turn && !turn.spoke) {
          this.o.logger.debug({ latencyMs: Date.now() - started }, "first sentence ready");
        }
        await this.handleEvents([ev], turn);
      }
    } catch (err) {
      this.o.logger.error({ err }, "turn failed");
      this.o.persistence.event(
        "system",
        `Fehler: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      if (turn.text.length) this.o.persistence.event("assistant", turn.text.join(" "));
      if (this.turn === turn) this.turn = null;
      resolveDone();
      this.emitState();
      if (!this.isSpeaking()) this.startSilenceTimer();
    }
  }

  private async handleEvents(events: EngineEvent[], turn: Turn | null) {
    for (const ev of events) {
      switch (ev.type) {
        case "say":
          if (turn?.muted) break;
          if (turn) {
            turn.spoke = true;
            turn.text.push(ev.text);
          } else {
            this.o.persistence.event("assistant", ev.text);
          }
          this.say(ev.text, turn);
          break;
        case "tool":
          this.o.persistence.event("tool", ev.name, { arguments: ev.arguments, result: ev.result });
          this.o.transport.emit?.({
            type: "tool",
            name: ev.name,
            arguments: ev.arguments,
            result: ev.result,
          });
          break;
        case "order_placed":
          this.outcome.outcome = "order_placed";
          this.o.transport.emit?.({
            type: "order",
            orderNumber: ev.order.orderNumber,
            orderId: ev.order.orderId,
          });
          break;
        case "transfer":
          void this.performTransfer(ev.reason, ev.note ?? null);
          break;
        case "hangup":
          void this.performHangup(ev.reason);
          break;
        case "error":
          this.o.logger.warn({ message: ev.message }, "engine error");
          this.o.persistence.event("system", `Modellfehler: ${ev.message}`);
          break;
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /*                            Speech output                            */
  /* ------------------------------------------------------------------ */

  private ttsCharacters = 0;

  private say(rawText: string, turn: Turn | null) {
    const text = normalizeForSpeech(rawText);
    if (!text) return;
    this.o.transport.emit?.({ type: "transcript", role: "assistant", text: rawText });
    if (this.o.mode === "text" || !this.o.tts) return;
    this.ttsCharacters += text.length;
    const audio = this.o.tts.synthesize(text, { voice: this.o.ttsVoice }).then(
      (buf) => {
        this.ttsFailures = 0;
        return buf;
      },
      (err) => {
        this.ttsFailures += 1;
        this.o.logger.error({ err, text }, "speech synthesis failed");
        this.o.persistence.event(
          "system",
          `TTS-Fehler: ${err instanceof Error ? err.message : String(err)}`,
        );
        if (this.ttsFailures >= 2 && !this.ending) {
          this.outcome.error = "TTS failure";
          void this.performTransfer("technical", "Sprachausgabe ausgefallen");
        }
        return null;
      },
    );
    this.speech.push({ text, audio, turn });
    void this.playLoop();
  }

  private async playLoop() {
    if (this.playing) return;
    this.playing = true;
    try {
      while (this.speech.length) {
        const item = this.speech.shift()!;
        const audio = await item.audio;
        if (!audio || item.turn?.muted || this.ended) continue;
        this.stopSilenceTimer();
        // Send in 100 ms chunks.
        for (let i = 0; i < audio.length; i += 800)
          this.o.transport.sendAudio(audio.subarray(i, i + 800));
        const mark = `m${++this.markCounter}`;
        this.marks.add(mark);
        this.o.transport.sendMark(mark);
        const durationMs = (audio.length / 8000) * 1000;
        this.playbackUntil = Math.max(this.playbackUntil, Date.now()) + durationMs;
      }
    } finally {
      this.playing = false;
    }
    this.armPlaybackWatchdog();
  }

  /** Twilio may not echo marks in edge cases – fall back to the estimated playback end. */
  private watchdog: NodeJS.Timeout | null = null;
  private armPlaybackWatchdog() {
    if (this.watchdog) clearTimeout(this.watchdog);
    const delay = Math.max(0, this.playbackUntil - Date.now()) + 2500;
    this.watchdog = setTimeout(() => {
      if (this.marks.size && Date.now() > this.playbackUntil + 2000) {
        this.marks.clear();
        this.onPlaybackDrained();
      }
    }, delay);
  }

  isSpeaking(): boolean {
    if (this.o.mode === "text") return false;
    return this.playing || this.speech.length > 0 || this.marks.size > 0;
  }

  private bargeIn() {
    if (!this.isSpeaking()) return;
    this.o.logger.debug("barge-in");
    this.o.transport.clearAudio();
    for (const item of this.speech) if (item.turn) item.turn.muted = true;
    this.speech = [];
    this.marks.clear();
    this.playbackUntil = Date.now();
    if (this.turn) {
      this.turn.muted = true;
    }
    this.o.persistence.event("event", "Unterbrochen (Barge-in)");
    this.o.transport.emit?.({ type: "clear" });
    this.onPlaybackDrained();
  }

  private onPlaybackDrained() {
    if (this.isSpeaking()) return;
    for (const w of this.playbackWaiters.splice(0)) w();
    if (!this.turn) this.startSilenceTimer();
  }

  private waitForPlayback(timeoutMs = 20_000): Promise<void> {
    if (!this.isSpeaking()) return Promise.resolve();
    return new Promise((resolve) => {
      const t = setTimeout(resolve, timeoutMs);
      this.playbackWaiters.push(() => {
        clearTimeout(t);
        resolve();
      });
    });
  }

  /* ------------------------------------------------------------------ */
  /*                           Silence handling                          */
  /* ------------------------------------------------------------------ */

  private startSilenceTimer() {
    if (this.ending || this.o.mode === "text") return;
    this.stopSilenceTimer();
    this.silenceTimer = setTimeout(() => {
      this.silenceTimer = null;
      if (this.ending || this.turn || this.isSpeaking() || this.utterance.length) return;
      void this.handleEvents(this.engine.handleSilence(), null);
    }, this.o.config.SILENCE_PROMPT_SECONDS * 1000);
  }

  private stopSilenceTimer() {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
  }

  /* ------------------------------------------------------------------ */
  /*                        Transfers and hang-ups                       */
  /* ------------------------------------------------------------------ */

  private async performTransfer(reason: TransferReason, note: string | null) {
    if (this.ending) return;
    this.ending = true;
    this.stopSilenceTimer();
    const target = this.o.restaurant.transferPhone;
    this.outcome = {
      status: "transferred",
      outcome: transferOutcome(reason),
      transferReason: note ? `${reason}: ${note}` : reason,
    };
    this.o.persistence.event("event", `Weiterleitung (${reason})${target ? ` an ${target}` : ""}`, {
      reason,
      note,
    });
    await this.waitForPlayback();
    await updateCall(this.o.db, this.o.callId, {
      transferReason: this.outcome.transferReason ?? null,
      transferTarget: target ?? null,
      outcome: this.outcome.outcome,
    });
    await this.o.persistence.flush();
    if (!target) {
      await this.performHangup("transfer_unavailable", true);
      return;
    }
    try {
      await this.o.transport.transfer(
        target,
        reason,
        this.ttsFailures >= 2
          ? "Einen Moment bitte, ich verbinde Sie mit dem Restaurant."
          : undefined,
      );
    } catch (err) {
      this.o.logger.error({ err }, "transfer failed");
      this.outcome = {
        status: "failed",
        outcome: "error",
        error: `Transfer failed: ${err instanceof Error ? err.message : String(err)}`,
      };
      await this.o.transport.hangup().catch(() => undefined);
    }
  }

  private async performHangup(reason: string, force = false) {
    if (this.ending && !force) return;
    this.ending = true;
    this.stopSilenceTimer();
    await this.waitForPlayback();
    // A short pause so the goodbye is not cut off.
    await new Promise((r) => setTimeout(r, this.o.mode === "text" ? 0 : 600));
    this.o.persistence.event("event", `Aufgelegt (${reason})`);
    if (!this.outcome.outcome) {
      this.outcome.outcome =
        reason === "order_placed" ? "order_placed" : reason === "paused" ? "paused" : "no_order";
    }
    await this.o.transport.hangup().catch((err) => this.o.logger.warn({ err }, "hangup failed"));
  }

  private emitState() {
    if (!this.o.transport.emit) return;
    const s = this.engine.state();
    this.o.transport.emit({ type: "state", state: summarizeState(s) });
  }
}

function transferOutcome(reason: string): CallOutcome {
  if (reason === "allergy") return "transferred_allergy";
  if (reason === "owner_request") return "transferred_owner";
  return "transferred_other";
}

function summarizeState(s: ReturnType<ConversationEngine["state"]>) {
  return {
    phase: s.phase,
    allergyStatus: s.allergyStatus,
    cart: s.cart,
    fulfillment: s.fulfillment,
    customerName: s.customerName,
    customerPhone: s.customerPhone,
    paymentMethod: s.paymentMethod,
    placedOrder: s.placedOrder,
    transferReason: s.transferReason,
    endReason: s.endReason,
    usage: s.usage,
    turns: s.turns,
  };
}

function buildSummary(s: ReturnType<ConversationEngine["state"]>): string {
  if (s.placedOrder) {
    return `Bestellung Nr. ${s.placedOrder.orderNumber}: ${s.cart.lines.map((l) => `${l.quantity}x ${l.name}`).join(", ")} (${s.customerName ?? "?"})`;
  }
  if (s.transferReason) return `Weitergeleitet: ${s.transferReason}`;
  if (s.cart.lines.length)
    return `Abgebrochen mit ${s.cart.lines.length} Position(en) im Warenkorb`;
  return s.endReason ? `Beendet: ${s.endReason}` : "Keine Bestellung";
}
