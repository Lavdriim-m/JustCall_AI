import { AnthropicLlm } from "./anthropic";
import { DemoLlm, ScriptedLlm } from "./mock";
import { OpenAiLlm } from "./openai";
import type { LlmClient } from "./types";

export * from "./types";
export { AnthropicLlm, DemoLlm, OpenAiLlm, ScriptedLlm };

export type LlmProvider = "openai" | "anthropic" | "demo";

export const DEFAULT_MODELS: Record<LlmProvider, string> = {
  openai: "gpt-5.4-mini",
  anthropic: "claude-haiku-5-5",
  demo: "rule-based",
};

export type LlmConfig = {
  provider?: string;
  model?: string | null;
  env?: Record<string, string | undefined>;
};

/**
 * Creates the language model client from environment variables:
 * LLM_PROVIDER (openai | anthropic | demo), OPENAI_API_KEY, OPENAI_MODEL, OPENAI_REASONING_EFFORT,
 * OPENAI_BASE_URL, ANTHROPIC_API_KEY, ANTHROPIC_MODEL. A per-restaurant model override wins.
 */
export function createLlmClient(config: LlmConfig = {}): LlmClient {
  const env = config.env ?? process.env;
  const provider = (config.provider ?? env.LLM_PROVIDER ?? "openai").toLowerCase() as LlmProvider;
  switch (provider) {
    case "anthropic": {
      const apiKey = env.ANTHROPIC_API_KEY;
      if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
      return new AnthropicLlm({ apiKey, model: config.model || env.ANTHROPIC_MODEL || DEFAULT_MODELS.anthropic });
    }
    case "demo":
      return new DemoLlm();
    case "openai":
    default: {
      const apiKey = env.OPENAI_API_KEY;
      if (!apiKey || apiKey.length < 20) throw new Error("OPENAI_API_KEY is not set (or is a placeholder)");
      return new OpenAiLlm({
        apiKey,
        model: config.model || env.OPENAI_MODEL || DEFAULT_MODELS.openai,
        baseURL: env.OPENAI_BASE_URL || undefined,
        reasoningEffort: env.OPENAI_REASONING_EFFORT || "none",
      });
    }
  }
}

/** Like createLlmClient but falls back to the rule-based demo model when no key is configured. */
export function createLlmClientOrDemo(config: LlmConfig = {}): LlmClient {
  try {
    return createLlmClient(config);
  } catch {
    return new DemoLlm();
  }
}
