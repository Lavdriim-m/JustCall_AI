import type { SttOptions, SttSession } from "./types";

/** Frames starting with these bytes carry UTF-8 text instead of audio (tests and local demos only). */
export const MOCK_TEXT_MAGIC = Buffer.from("JCTX");

export function encodeMockUtterance(text: string): Buffer {
  return Buffer.concat([MOCK_TEXT_MAGIC, Buffer.from(text, "utf8")]);
}

/** Test double: turns specially marked frames into final transcripts, ignores real audio. */
export function createMockSttSession(opts: SttOptions): SttSession {
  let frames = 0;
  return {
    provider: "mock",
    endpointing: "segment",
    get audioSeconds() {
      return frames * 0.02;
    },
    write(frame) {
      frames += 1;
      if (frame.subarray(0, 4).equals(MOCK_TEXT_MAGIC)) {
        const text = frame.subarray(4).toString("utf8").trim();
        if (text) {
          opts.events.onSpeechStart?.();
          opts.events.onFinal(text);
        }
      }
    },
    async close() {},
  };
}
