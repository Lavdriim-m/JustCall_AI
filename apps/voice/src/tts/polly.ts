import {
  PollyClient,
  SynthesizeSpeechCommand,
  type Engine,
  type VoiceId,
} from "@aws-sdk/client-polly";
import { pcm16ToMulaw } from "../audio/codec";
import type { TtsOptions, TtsProvider } from "./types";

/** Amazon Polly. Default voice "Sabrina" (Swiss German, generative engine). */
export class PollyTts implements TtsProvider {
  readonly name = "polly";
  private readonly client: PollyClient;

  constructor(
    region: string,
    private readonly defaultVoice: string,
    private readonly engine: string,
  ) {
    this.client = new PollyClient({ region });
  }

  async synthesize(text: string, options: TtsOptions = {}): Promise<Buffer> {
    const res = await this.client.send(
      new SynthesizeSpeechCommand({
        Engine: this.engine as Engine,
        VoiceId: (options.voice || this.defaultVoice) as VoiceId,
        OutputFormat: "pcm",
        SampleRate: "8000",
        Text: text,
        TextType: "text",
      }),
      { abortSignal: options.signal },
    );
    if (!res.AudioStream) throw new Error("Polly returned no audio");
    const pcm = Buffer.from(await res.AudioStream.transformToByteArray());
    return pcm16ToMulaw(pcm);
  }
}
