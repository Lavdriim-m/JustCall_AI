import { MULAW_SILENCE } from "../audio/codec";
import type { TtsProvider } from "./types";

/** Test double: returns silence whose length matches the text (≈ 60 ms per character). */
export class MockTts implements TtsProvider {
  readonly name = "mock";
  async synthesize(text: string): Promise<Buffer> {
    return Buffer.alloc(Math.min(8000 * 10, Math.max(800, text.length * 480)), MULAW_SILENCE);
  }
}
