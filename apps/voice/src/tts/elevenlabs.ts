import type { TtsOptions, TtsProvider } from "./types";

/** ElevenLabs. Supports custom/cloned voices (e.g. a Swiss German speaker); returns μ-law 8 kHz. */
export class ElevenLabsTts implements TtsProvider {
  readonly name = "elevenlabs";

  constructor(
    private readonly apiKey: string,
    private readonly defaultVoice: string,
    private readonly model: string,
  ) {}

  async synthesize(text: string, options: TtsOptions = {}): Promise<Buffer> {
    const voice = options.voice || this.defaultVoice;
    if (!voice) throw new Error("ELEVENLABS_VOICE_ID is not set");
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=ulaw_8000`,
      {
        method: "POST",
        headers: {
          "xi-api-key": this.apiKey,
          "Content-Type": "application/json",
          Accept: "audio/basic",
        },
        body: JSON.stringify({
          text,
          model_id: this.model,
          language_code: /flash|turbo|v3/.test(this.model) ? "de" : undefined,
          voice_settings: { stability: 0.5, similarity_boost: 0.8, speed: 1.05 },
        }),
        signal: options.signal,
      },
    );
    if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${await res.text().catch(() => "")}`);
    return Buffer.from(await res.arrayBuffer());
  }
}
