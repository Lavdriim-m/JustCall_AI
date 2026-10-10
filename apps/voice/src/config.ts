import { z } from "zod";

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) =>
      v === undefined || v === "" ? def : ["1", "true", "yes", "on"].includes(v.toLowerCase()),
    );
const int = (def: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? def : Number.parseInt(v, 10)))
    .pipe(z.number().int().nonnegative());

const schema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: int(8080),
  HOST: z.string().default("0.0.0.0"),
  LOG_LEVEL: z.string().default("info"),
  VOICE_PUBLIC_URL: z.string().default("http://localhost:8080"),
  APP_URL: z.string().default("http://localhost:3000"),
  INTERNAL_API_SECRET: z.string().default(""),

  STT_PROVIDER: z.enum(["aws", "azure", "openai", "mock"]).default("aws"),
  TTS_PROVIDER: z.enum(["polly", "azure", "elevenlabs", "openai", "mock"]).default("polly"),
  TRANSCRIBE_LANGUAGE: z.string().default("de-CH"),
  TRANSCRIBE_VOCABULARY_NAME: z.string().optional(),
  TRANSCRIBE_PARTIAL_STABILIZATION: bool(false),
  AWS_REGION: z.string().default("eu-central-1"),
  POLLY_VOICE: z.string().default("Sabrina"),
  POLLY_ENGINE: z.string().default("generative"),
  AZURE_SPEECH_KEY: z.string().optional(),
  AZURE_SPEECH_REGION: z.string().default("switzerlandnorth"),
  AZURE_STT_LANGUAGE: z.string().default("de-CH"),
  AZURE_TTS_VOICE: z.string().default("de-CH-LeniNeural"),
  ELEVENLABS_API_KEY: z.string().optional(),
  ELEVENLABS_VOICE_ID: z.string().optional(),
  ELEVENLABS_MODEL: z.string().default("eleven_flash_v2_5"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.string().optional(),
  OPENAI_STT_MODEL: z.string().default("gpt-4o-transcribe"),
  OPENAI_TTS_MODEL: z.string().default("gpt-4o-mini-tts"),
  OPENAI_TTS_VOICE: z.string().default("coral"),

  TWILIO_VALIDATE_SIGNATURES: bool(true),

  CALL_MAX_DURATION_SECONDS: int(900),
  END_OF_TURN_MS: int(700),
  SILENCE_PROMPT_SECONDS: int(10),
  BARGE_IN_MIN_WORDS: int(2),
  TTS_CACHE_MB: int(64),

  JOBS_ENABLED: bool(true),
  INVOICE_AUTO_SEND: bool(false),
  TRANSCRIPT_RETENTION_DAYS: int(180),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const cleaned = Object.fromEntries(
    Object.entries(env).filter(([, v]) => v !== undefined && v !== ""),
  );
  return schema.parse(cleaned);
}

/** Insecure secret used when INTERNAL_API_SECRET is unset outside production (same as the web app). */
export const DEV_INTERNAL_API_SECRET = "dev-secret-change-me-please";

/**
 * The secret shared with the web app: bearer token for /internal/* calls and key for signed
 * media-stream/simulator tokens. Outside production an unset INTERNAL_API_SECRET falls back to
 * DEV_INTERNAL_API_SECRET, which is what apps/web/src/lib/env.ts sends in that case. In production
 * it returns "" so that nothing is accepted (index.ts refuses to start without the secret anyway).
 */
export function internalApiSecret(
  config: Pick<Config, "INTERNAL_API_SECRET" | "NODE_ENV">,
): string {
  if (config.INTERNAL_API_SECRET) return config.INTERNAL_API_SECRET;
  return config.NODE_ENV === "production" ? "" : DEV_INTERNAL_API_SECRET;
}

export function wsUrl(httpUrl: string, path: string): string {
  const base = httpUrl.replace(/\/$/, "").replace(/^http/, "ws");
  return `${base}${path}`;
}
