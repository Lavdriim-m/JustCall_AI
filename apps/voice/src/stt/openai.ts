import OpenAI, { toFile } from "openai";
import { EnergyVad } from "../audio/vad";
import { mulawToPcm16, pcm16ToWav } from "../audio/codec";
import type { SttOptions, SttSession } from "./types";

/**
 * OpenAI transcription (gpt-4o-transcribe / whisper-1). Caller audio is segmented with a local
 * voice activity detector and each utterance is transcribed as a whole. Menu words are passed as a
 * prompt to improve recognition of dish names.
 */
export function createOpenAiSttSession(
  opts: SttOptions & { apiKey: string; model: string; baseURL?: string; endSilenceMs?: number },
): SttSession {
  const client = new OpenAI({
    apiKey: opts.apiKey,
    baseURL: opts.baseURL || undefined,
    timeout: 15_000,
    maxRetries: 1,
  });
  const vad = new EnergyVad({ endSilenceMs: opts.endSilenceMs ?? 650 });
  const language = opts.language.split("-")[0] ?? "de";
  const prompt =
    `Telefonische Bestellung in einem Schweizer Restaurant, Schweizerdeutsch. ${opts.phrases.slice(0, 80).join(", ")}`.slice(
      0,
      900,
    );
  let bytes = 0;
  let closed = false;
  let chain = Promise.resolve();

  const transcribe = async (audio: Buffer) => {
    const wav = pcm16ToWav(mulawToPcm16(audio), 8000);
    try {
      const res = await client.audio.transcriptions.create({
        file: await toFile(wav, "utterance.wav", { type: "audio/wav" }),
        model: opts.model,
        language,
        prompt,
      });
      const text = (res as { text?: string }).text?.trim();
      if (text && !closed) opts.events.onFinal(text);
    } catch (err) {
      if (!closed) opts.events.onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  };

  return {
    provider: "openai",
    endpointing: "segment",
    get audioSeconds() {
      return bytes / 8000;
    },
    write(frame) {
      if (closed) return;
      bytes += frame.length;
      for (const ev of vad.push(frame)) {
        if (ev.type === "speech_start") {
          opts.events.onSpeechStart?.();
          opts.events.onPartial?.("…");
        } else if (ev.durationMs >= 300) {
          // Keep order of transcripts even if requests overlap.
          chain = chain.then(() => transcribe(ev.audio));
        }
      }
    },
    async close() {
      closed = true;
      await chain.catch(() => undefined);
    },
  };
}
