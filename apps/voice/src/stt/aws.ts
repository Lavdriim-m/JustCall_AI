import {
  StartStreamTranscriptionCommand,
  TranscribeStreamingClient,
  type AudioStream,
  type LanguageCode,
} from "@aws-sdk/client-transcribe-streaming";
import { mulawToPcm16 } from "../audio/codec";
import type { SttOptions, SttSession } from "./types";

let client: TranscribeStreamingClient | null = null;

/** Amazon Transcribe streaming (supports Swiss German "de-CH"). */
export function createAwsTranscribeSession(
  opts: SttOptions & { region: string; vocabularyName?: string; stabilization?: boolean },
): SttSession {
  client ??= new TranscribeStreamingClient({ region: opts.region });
  const queue: Buffer[] = [];
  let waiting: (() => void) | null = null;
  let closed = false;
  let pending: Buffer[] = [];
  let bytes = 0;

  const flushPending = () => {
    if (!pending.length) return;
    queue.push(Buffer.concat(pending));
    pending = [];
    waiting?.();
    waiting = null;
  };

  async function* audio(): AsyncGenerator<AudioStream> {
    while (true) {
      if (queue.length) {
        yield { AudioEvent: { AudioChunk: queue.shift()! } };
        continue;
      }
      if (closed) return;
      await new Promise<void>((resolve) => (waiting = resolve));
    }
  }

  const run = async () => {
    try {
      const response = await client!.send(
        new StartStreamTranscriptionCommand({
          LanguageCode: opts.language as LanguageCode,
          MediaEncoding: "pcm",
          MediaSampleRateHertz: 8000,
          AudioStream: audio(),
          VocabularyName: opts.vocabularyName || undefined,
          ...(opts.stabilization
            ? {
                EnablePartialResultsStabilization: true,
                PartialResultsStability: "medium" as const,
              }
            : {}),
        }),
      );
      let speaking = false;
      for await (const event of response.TranscriptResultStream ?? []) {
        if (
          event.BadRequestException ||
          event.InternalFailureException ||
          event.LimitExceededException
        ) {
          const e =
            event.BadRequestException ??
            event.InternalFailureException ??
            event.LimitExceededException;
          opts.events.onError?.(new Error(`Transcribe: ${e?.Message ?? "stream error"}`));
          continue;
        }
        for (const result of event.TranscriptEvent?.Transcript?.Results ?? []) {
          const text = result.Alternatives?.[0]?.Transcript?.trim() ?? "";
          if (!text) continue;
          if (!speaking) {
            speaking = true;
            opts.events.onSpeechStart?.();
          }
          if (result.IsPartial) opts.events.onPartial?.(text);
          else {
            speaking = false;
            opts.events.onFinal(text);
          }
        }
      }
    } catch (err) {
      if (!closed) opts.events.onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  };
  void run();

  return {
    provider: "aws",
    endpointing: "stream",
    get audioSeconds() {
      return bytes / 16000;
    },
    write(frame) {
      if (closed) return;
      const pcm = mulawToPcm16(frame);
      bytes += pcm.length;
      pending.push(pcm);
      // ~100 ms chunks are recommended for streaming transcription.
      if (pending.length >= 5) flushPending();
    },
    async close() {
      flushPending();
      closed = true;
      waiting?.();
    },
  };
}
