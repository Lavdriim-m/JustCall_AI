import type { Config } from "../config";
import { createAwsTranscribeSession } from "./aws";
import { createAzureSttSession } from "./azure";
import { createMockSttSession } from "./mock";
import { createOpenAiSttSession } from "./openai";
import type { SttOptions, SttSession } from "./types";

export * from "./types";

export function createSttSession(
  config: Config,
  provider: string | null | undefined,
  options: Omit<SttOptions, "language">,
): SttSession {
  const p = (provider || config.STT_PROVIDER) as Config["STT_PROVIDER"];
  switch (p) {
    case "mock":
      return createMockSttSession({ ...options, language: "de-CH" });
    case "azure":
      if (!config.AZURE_SPEECH_KEY) throw new Error("AZURE_SPEECH_KEY is not set");
      return createAzureSttSession({
        ...options,
        language: config.AZURE_STT_LANGUAGE,
        key: config.AZURE_SPEECH_KEY,
        region: config.AZURE_SPEECH_REGION,
      });
    case "openai":
      if (!config.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set");
      return createOpenAiSttSession({
        ...options,
        language: "de",
        apiKey: config.OPENAI_API_KEY,
        model: config.OPENAI_STT_MODEL,
        baseURL: config.OPENAI_BASE_URL,
      });
    case "aws":
    default:
      return createAwsTranscribeSession({
        ...options,
        language: config.TRANSCRIBE_LANGUAGE,
        region: config.AWS_REGION,
        vocabularyName: config.TRANSCRIBE_VOCABULARY_NAME,
        stabilization: config.TRANSCRIBE_PARTIAL_STABILIZATION,
      });
  }
}
