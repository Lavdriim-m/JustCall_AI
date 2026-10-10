import * as sdk from "microsoft-cognitiveservices-speech-sdk";
import { mulawToPcm16 } from "../audio/codec";
import type { SttOptions, SttSession } from "./types";

/** Azure AI Speech continuous recognition (supports Swiss German "de-CH") with phrase boosting. */
export function createAzureSttSession(
  opts: SttOptions & { key: string; region: string },
): SttSession {
  const speechConfig = sdk.SpeechConfig.fromSubscription(opts.key, opts.region);
  speechConfig.speechRecognitionLanguage = opts.language;
  speechConfig.setProperty(sdk.PropertyId.Speech_SegmentationSilenceTimeoutMs, "600");
  speechConfig.setProperty(sdk.PropertyId.SpeechServiceConnection_InitialSilenceTimeoutMs, "15000");
  const push = sdk.AudioInputStream.createPushStream(
    sdk.AudioStreamFormat.getWaveFormatPCM(8000, 16, 1),
  );
  const recognizer = new sdk.SpeechRecognizer(speechConfig, sdk.AudioConfig.fromStreamInput(push));
  const phraseList = sdk.PhraseListGrammar.fromRecognizer(recognizer);
  for (const p of opts.phrases.slice(0, 500)) phraseList.addPhrase(p);

  let speaking = false;
  let bytes = 0;
  let closed = false;
  recognizer.recognizing = (_s, e) => {
    const text = e.result.text?.trim();
    if (!text) return;
    if (!speaking) {
      speaking = true;
      opts.events.onSpeechStart?.();
    }
    opts.events.onPartial?.(text);
  };
  recognizer.recognized = (_s, e) => {
    speaking = false;
    if (e.result.reason === sdk.ResultReason.RecognizedSpeech && e.result.text?.trim()) {
      opts.events.onFinal(e.result.text.trim());
    }
  };
  recognizer.canceled = (_s, e) => {
    if (!closed && e.reason === sdk.CancellationReason.Error) {
      opts.events.onError?.(new Error(`Azure STT: ${e.errorDetails}`));
    }
  };
  recognizer.startContinuousRecognitionAsync(
    () => undefined,
    (err) => opts.events.onError?.(new Error(`Azure STT start failed: ${err}`)),
  );

  return {
    provider: "azure",
    endpointing: "stream",
    get audioSeconds() {
      return bytes / 16000;
    },
    write(frame) {
      if (closed) return;
      const pcm = mulawToPcm16(frame);
      bytes += pcm.length;
      push.write(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength) as ArrayBuffer);
    },
    async close() {
      if (closed) return;
      closed = true;
      push.close();
      await new Promise<void>((resolve) =>
        recognizer.stopContinuousRecognitionAsync(
          () => resolve(),
          () => resolve(),
        ),
      );
      recognizer.close();
    },
  };
}
