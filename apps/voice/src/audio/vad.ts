import { mulawToPcm16, rms } from "./codec";

export type VadOptions = {
  /** RMS level considered speech (μ-law decoded 16-bit). */
  threshold?: number;
  /** Speech must last this long to start an utterance. */
  minSpeechMs?: number;
  /** Silence after speech that ends the utterance. */
  endSilenceMs?: number;
  /** Hard limit for one utterance. */
  maxUtteranceMs?: number;
  frameMs?: number;
};

export type VadEvent =
  { type: "speech_start" } | { type: "speech_end"; audio: Buffer; durationMs: number };

/**
 * Energy based voice activity detector with an adaptive noise floor. Used to segment caller audio
 * for batch transcription providers (OpenAI) and for barge-in detection.
 */
export class EnergyVad {
  private readonly threshold: number;
  private readonly minSpeechFrames: number;
  private readonly endSilenceFrames: number;
  private readonly maxFrames: number;
  private noiseFloor = 200;
  private speaking = false;
  private speechFrames = 0;
  private silenceFrames = 0;
  private buffer: Buffer[] = [];
  private preRoll: Buffer[] = [];

  constructor(options: VadOptions = {}) {
    const frameMs = options.frameMs ?? 20;
    this.threshold = options.threshold ?? 900;
    this.minSpeechFrames = Math.ceil((options.minSpeechMs ?? 160) / frameMs);
    this.endSilenceFrames = Math.ceil((options.endSilenceMs ?? 700) / frameMs);
    this.maxFrames = Math.ceil((options.maxUtteranceMs ?? 20_000) / frameMs);
  }

  /** Feeds one μ-law frame; returns events produced by it. */
  push(frame: Buffer): VadEvent[] {
    const level = rms(mulawToPcm16(frame));
    const dynamicThreshold = Math.max(this.threshold, this.noiseFloor * 3);
    const isSpeech = level > dynamicThreshold;
    const events: VadEvent[] = [];
    if (!this.speaking) {
      // Track background noise while nobody speaks.
      if (!isSpeech) this.noiseFloor = this.noiseFloor * 0.95 + level * 0.05;
      this.preRoll.push(frame);
      if (this.preRoll.length > 15) this.preRoll.shift();
      this.speechFrames = isSpeech ? this.speechFrames + 1 : 0;
      if (this.speechFrames >= this.minSpeechFrames) {
        this.speaking = true;
        this.silenceFrames = 0;
        this.buffer = [...this.preRoll];
        this.preRoll = [];
        events.push({ type: "speech_start" });
      }
      return events;
    }
    this.buffer.push(frame);
    this.silenceFrames = isSpeech ? 0 : this.silenceFrames + 1;
    if (this.silenceFrames >= this.endSilenceFrames || this.buffer.length >= this.maxFrames) {
      const audio = Buffer.concat(this.buffer);
      events.push({ type: "speech_end", audio, durationMs: this.buffer.length * 20 });
      this.reset();
    }
    return events;
  }

  get isSpeaking() {
    return this.speaking;
  }

  reset() {
    this.speaking = false;
    this.speechFrames = 0;
    this.silenceFrames = 0;
    this.buffer = [];
  }
}
