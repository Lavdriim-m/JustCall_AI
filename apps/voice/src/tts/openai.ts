import OpenAI from "openai";
import { pcm16ToMulaw, resamplePcm16 } from "../audio/codec";
import type { TtsOptions, TtsProvider } from "./types";

/** OpenAI speech (gpt-4o-mini-tts). Useful for testing with only an OpenAI key. */
export class OpenAiTts implements TtsProvider {
  readonly name = "openai";
  private readonly client: OpenAI;

  constructor(
    apiKey: string,
    private readonly model: string,
    private readonly defaultVoice: string,
    baseURL?: string,
  ) {
    this.client = new OpenAI({
      apiKey,
      baseURL: baseURL || undefined,
      timeout: 15_000,
      maxRetries: 1,
    });
  }

  async synthesize(text: string, options: TtsOptions = {}): Promise<Buffer> {
    const res = await this.client.audio.speech.create(
      {
        model: this.model,
        voice: (options.voice || this.defaultVoice) as "coral",
        input: text,
        response_format: "pcm",
        ...(this.model.includes("gpt-4o")
          ? {
              instructions:
                "Sprich Schweizer Hochdeutsch mit leichtem Schweizer Akzent: freundlich, klar und zügig, wie am Telefon eines Restaurants.",
            }
          : {}),
      },
      { signal: options.signal },
    );
    const pcm24k = Buffer.from(await res.arrayBuffer());
    return pcm16ToMulaw(resamplePcm16(pcm24k, 24000, 8000));
  }
}
