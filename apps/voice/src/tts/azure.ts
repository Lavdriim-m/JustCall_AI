import type { TtsOptions, TtsProvider } from "./types";

function escapeXml(s: string) {
  return s.replace(
    /[<>&"']/g,
    (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!,
  );
}

/** Azure AI Speech neural voices, e.g. de-CH-LeniNeural / de-CH-JanNeural. Returns μ-law directly. */
export class AzureTts implements TtsProvider {
  readonly name = "azure";

  constructor(
    private readonly key: string,
    private readonly region: string,
    private readonly defaultVoice: string,
  ) {}

  async synthesize(text: string, options: TtsOptions = {}): Promise<Buffer> {
    const voice = options.voice || this.defaultVoice;
    const lang = voice.split("-").slice(0, 2).join("-");
    const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${lang}"><voice name="${escapeXml(voice)}"><prosody rate="+5%">${escapeXml(text)}</prosody></voice></speak>`;
    const res = await fetch(
      `https://${this.region}.tts.speech.microsoft.com/cognitiveservices/v1`,
      {
        method: "POST",
        headers: {
          "Ocp-Apim-Subscription-Key": this.key,
          "Content-Type": "application/ssml+xml",
          "X-Microsoft-OutputFormat": "raw-8khz-8bit-mono-mulaw",
          "User-Agent": "justcall-voice",
        },
        body: ssml,
        signal: options.signal,
      },
    );
    if (!res.ok) throw new Error(`Azure TTS ${res.status}: ${await res.text().catch(() => "")}`);
    return Buffer.from(await res.arrayBuffer());
  }
}
