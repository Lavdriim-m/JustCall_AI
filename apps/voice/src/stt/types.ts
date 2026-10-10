import type { Logger } from "../logger";

export type SttEvents = {
  /** Interim hypothesis (used for barge-in). */
  onPartial?(text: string): void;
  /** Final transcript of a speech segment. */
  onFinal(text: string): void;
  /** Caller started speaking (when the provider can tell). */
  onSpeechStart?(): void;
  onError?(error: Error): void;
};

export type SttOptions = {
  language: string;
  /** Menu words to boost recognition (item names, aliases). */
  phrases: string[];
  events: SttEvents;
  logger: Logger;
};

export interface SttSession {
  readonly provider: string;
  /**
   * "segment": each final result already marks the end of an utterance (batch STT with VAD).
   * "stream":  finals may come in pieces; the call session waits a short moment for more speech.
   */
  readonly endpointing: "segment" | "stream";
  /** Feeds one 20 ms μ-law 8 kHz frame. */
  write(mulawFrame: Buffer): void;
  close(): Promise<void>;
  /** Seconds of audio sent to the provider (for cost tracking). */
  readonly audioSeconds: number;
}

export type SttFactory = (options: SttOptions) => SttSession;
