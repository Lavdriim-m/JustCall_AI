import OpenAI from "openai";
import type {
  ChatCompletionCreateParamsStreaming,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions";
import {
  LlmError,
  emptyUsage,
  parseToolArguments,
  type LlmClient,
  type LlmRequest,
  type LlmResponse,
  type ToolCall,
} from "./types";

export type OpenAiLlmOptions = {
  apiKey: string;
  model: string;
  baseURL?: string;
  /** Reasoning models (gpt-5.x, gpt-6, o-series): "none" (recommended) | "low" | "medium"; "minimal" only on gpt-5 / gpt-5-mini / gpt-5-nano. */
  reasoningEffort?: string;
  timeoutMs?: number;
  /** Custom fetch (tests, proxies). */
  fetch?: typeof fetch;
};

const REASONING_MODEL = /^(o\d|gpt-5|gpt-6)/;

/** OpenAI Chat Completions adapter with streaming text and tool calls. */
export class OpenAiLlm implements LlmClient {
  readonly provider = "openai";
  readonly model: string;
  private readonly client: OpenAI;
  private readonly reasoningEffort?: string;
  /** Parameters the model rejected once; they are not sent again. */
  private readonly unsupported = new Set<string>();

  constructor(options: OpenAiLlmOptions) {
    this.model = options.model;
    this.reasoningEffort = options.reasoningEffort;
    this.client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.baseURL,
      timeout: options.timeoutMs ?? 20_000,
      maxRetries: 1,
      fetch: options.fetch,
    });
  }

  private toMessages(request: LlmRequest): ChatCompletionMessageParam[] {
    const out: ChatCompletionMessageParam[] = [{ role: "system", content: request.system }];
    for (const m of request.messages) {
      if (m.role === "user") out.push({ role: "user", content: m.content });
      else if (m.role === "assistant") {
        out.push({
          role: "assistant",
          content: m.content || null,
          ...(m.toolCalls?.length
            ? {
                tool_calls: m.toolCalls.map((tc) => ({
                  id: tc.id,
                  type: "function" as const,
                  function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
                })),
              }
            : {}),
        });
      } else {
        out.push({ role: "tool", tool_call_id: m.toolCallId, content: m.content });
      }
    }
    if (request.context) out.push({ role: "system", content: request.context });
    return out;
  }

  private buildParams(request: LlmRequest): ChatCompletionCreateParamsStreaming {
    const isReasoning = REASONING_MODEL.test(this.model);
    const params: ChatCompletionCreateParamsStreaming = {
      model: this.model,
      messages: this.toMessages(request),
      tools: request.tools.map((t) => ({
        type: "function" as const,
        function: { name: t.name, description: t.description, parameters: t.parameters },
      })),
      stream: true,
      stream_options: { include_usage: true },
    };
    if (!this.unsupported.has("parallel_tool_calls")) params.parallel_tool_calls = true;
    if (request.maxTokens && !this.unsupported.has("max_completion_tokens")) {
      // Reasoning models need head-room for hidden reasoning tokens.
      params.max_completion_tokens = isReasoning
        ? Math.max(request.maxTokens * 4, 2000)
        : request.maxTokens;
    }
    if (!isReasoning && request.temperature !== undefined && !this.unsupported.has("temperature")) {
      params.temperature = request.temperature;
    }
    if (isReasoning && this.reasoningEffort && !this.unsupported.has("reasoning_effort")) {
      params.reasoning_effort = this
        .reasoningEffort as ChatCompletionCreateParamsStreaming["reasoning_effort"];
    }
    if (request.cacheKey && !this.unsupported.has("prompt_cache_key"))
      params.prompt_cache_key = request.cacheKey;
    return params;
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.run(request);
      } catch (err) {
        const param = unsupportedParam(err);
        if (param && !this.unsupported.has(param)) {
          this.unsupported.add(param);
          continue;
        }
        throw toLlmError(err);
      }
    }
    throw new LlmError("OpenAI request failed after removing unsupported parameters", false);
  }

  private async run(request: LlmRequest): Promise<LlmResponse> {
    const stream = await this.client.chat.completions.create(this.buildParams(request), {
      signal: request.signal,
    });
    let text = "";
    const calls = new Map<number, { id: string; name: string; args: string }>();
    const usage = emptyUsage();
    for await (const chunk of stream) {
      const choice = chunk.choices[0];
      const delta = choice?.delta;
      if (delta?.content) {
        text += delta.content;
        request.onTextDelta?.(delta.content);
      }
      for (const tc of delta?.tool_calls ?? []) {
        const entry = calls.get(tc.index) ?? { id: "", name: "", args: "" };
        if (tc.id) entry.id = tc.id;
        if (tc.function?.name) entry.name += tc.function.name;
        if (tc.function?.arguments) entry.args += tc.function.arguments;
        calls.set(tc.index, entry);
      }
      if (chunk.usage) {
        usage.inputTokens = chunk.usage.prompt_tokens ?? 0;
        usage.outputTokens = chunk.usage.completion_tokens ?? 0;
        usage.cachedTokens = chunk.usage.prompt_tokens_details?.cached_tokens ?? 0;
      }
    }
    const toolCalls: ToolCall[] = [...calls.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([i, c]) => ({
        id: c.id || `call_${i}`,
        name: c.name,
        arguments: parseToolArguments(c.args),
      }))
      .filter((c) => c.name);
    return { text: text.trim(), toolCalls, usage };
  }
}

function unsupportedParam(err: unknown): string | null {
  if (!(err instanceof OpenAI.APIError) || err.status !== 400) return null;
  const known = [
    "reasoning_effort",
    "temperature",
    "parallel_tool_calls",
    "prompt_cache_key",
    "max_completion_tokens",
  ];
  if (err.param && known.includes(err.param)) return err.param;
  const msg = `${err.message} ${JSON.stringify((err as { error?: unknown }).error ?? "")}`;
  for (const p of [
    "reasoning_effort",
    "temperature",
    "parallel_tool_calls",
    "prompt_cache_key",
    "max_completion_tokens",
  ]) {
    if (msg.includes(p)) return p;
  }
  return null;
}

function toLlmError(err: unknown): LlmError {
  if (err instanceof LlmError) return err;
  if (err instanceof OpenAI.APIError) {
    const retryable = err.status === undefined || err.status === 429 || err.status >= 500;
    return new LlmError(`OpenAI ${err.status ?? ""}: ${err.message}`, retryable, err);
  }
  if (err instanceof Error && err.name === "AbortError") return new LlmError("aborted", false, err);
  return new LlmError(err instanceof Error ? err.message : String(err), true, err);
}
