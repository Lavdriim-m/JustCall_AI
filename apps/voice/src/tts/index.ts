import { createHash } from "node:crypto";
import type { Config } from "../config";
import { AzureTts } from "./azure";
import { ElevenLabsTts } from "./elevenlabs";
import { MockTts } from "./mock";
import { OpenAiTts } from "./openai";
import { PollyTts } from "./polly";
import type { TtsOptions, TtsProvider } from "./types";

export * from "./types";

/** In-memory LRU cache for synthesised phrases (greetings and fixed prompts repeat constantly). */
export class CachedTts implements TtsProvider {
  readonly name: string;
  private readonly cache = new Map<string, Buffer>();
  private bytes = 0;
  private readonly inflight = new Map<string, Promise<Buffer>>();

  constructor(
    private readonly inner: TtsProvider,
    private readonly maxBytes: number,
  ) {
    this.name = inner.name;
  }

  async synthesize(text: string, options: TtsOptions = {}): Promise<Buffer> {
    const key = createHash("sha1")
      .update(`${this.inner.name}|${options.voice ?? ""}|${text}`)
      .digest("hex");
    const hit = this.cache.get(key);
    if (hit) {
      this.cache.delete(key);
      this.cache.set(key, hit);
      return hit;
    }
    const running = this.inflight.get(key);
    if (running) return running;
    const p = this.inner
      .synthesize(text, { voice: options.voice })
      .then((audio) => {
        if (text.length <= 400) {
          this.cache.set(key, audio);
          this.bytes += audio.length;
          while (this.bytes > this.maxBytes && this.cache.size) {
            const [oldestKey, oldest] = this.cache.entries().next().value as [string, Buffer];
            this.cache.delete(oldestKey);
            this.bytes -= oldest.length;
          }
        }
        return audio;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }
}

const providers = new Map<string, TtsProvider>();

export function getTtsProvider(config: Config, override?: string | null): TtsProvider {
  const name = (override || config.TTS_PROVIDER) as Config["TTS_PROVIDER"];
  const existing = providers.get(name);
  if (existing) return existing;
  let inner: TtsProvider;
  switch (name) {
    case "mock":
      inner = new MockTts();
      break;
    case "azure":
      if (!config.AZURE_SPEECH_KEY) throw new Error("AZURE_SPEECH_KEY is not set");
      inner = new AzureTts(
        config.AZURE_SPEECH_KEY,
        config.AZURE_SPEECH_REGION,
        config.AZURE_TTS_VOICE,
      );
      break;
    case "elevenlabs":
      if (!config.ELEVENLABS_API_KEY) throw new Error("ELEVENLABS_API_KEY is not set");
      inner = new ElevenLabsTts(
        config.ELEVENLABS_API_KEY,
        config.ELEVENLABS_VOICE_ID ?? "",
        config.ELEVENLABS_MODEL,
      );
      break;
    case "openai":
      if (!config.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set");
      inner = new OpenAiTts(
        config.OPENAI_API_KEY,
        config.OPENAI_TTS_MODEL,
        config.OPENAI_TTS_VOICE,
        config.OPENAI_BASE_URL,
      );
      break;
    case "polly":
    default:
      inner = new PollyTts(config.AWS_REGION, config.POLLY_VOICE, config.POLLY_ENGINE);
  }
  const cached = new CachedTts(inner, config.TTS_CACHE_MB * 1024 * 1024);
  providers.set(name, cached);
  return cached;
}
