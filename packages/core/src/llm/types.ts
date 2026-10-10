/** Provider-agnostic chat model interface with tool calling and streaming text. */

export type JsonSchema = {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
};

export type ToolSpec = {
  name: string;
  description: string;
  parameters: JsonSchema;
};

export type ToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type LlmMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; name: string; content: string };

export type LlmUsage = {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
};

export type LlmRequest = {
  /** Static instructions + menu (kept identical across turns for prompt caching). */
  system: string;
  /** Dynamic state appended after the conversation (current cart, time, next step …). */
  context?: string;
  messages: LlmMessage[];
  tools: ToolSpec[];
  /** Called with text as soon as it is generated so speech synthesis can start early. */
  onTextDelta?: (delta: string) => void;
  signal?: AbortSignal;
  temperature?: number;
  maxTokens?: number;
  /** Stable key for provider-side prompt caching (e.g. restaurant id). */
  cacheKey?: string;
};

export type LlmResponse = {
  text: string;
  toolCalls: ToolCall[];
  usage: LlmUsage;
};

export interface LlmClient {
  readonly provider: string;
  readonly model: string;
  complete(request: LlmRequest): Promise<LlmResponse>;
}

export class LlmError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

export function emptyUsage(): LlmUsage {
  return { inputTokens: 0, outputTokens: 0, cachedTokens: 0 };
}

/** Parses tool-call argument JSON defensively (models occasionally emit trailing junk). */
export function parseToolArguments(raw: string | undefined | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1));
      } catch {
        return {};
      }
    }
    return {};
  }
}
