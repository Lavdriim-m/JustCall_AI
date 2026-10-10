import Anthropic from "@anthropic-ai/sdk";
import type {
  ContentBlockParam,
  MessageCreateParamsBase,
  MessageParam,
  Tool,
  ToolResultBlockParam,
} from "@anthropic-ai/sdk/resources/messages";
import {
  LlmError,
  emptyUsage,
  type LlmClient,
  type LlmRequest,
  type LlmResponse,
  type ToolCall,
} from "./types";

export type AnthropicLlmOptions = {
  apiKey: string;
  model: string;
  timeoutMs?: number;
  /** Custom fetch (tests, proxies). */
  fetch?: typeof fetch;
};

/**
 * Optional request fields that not every Claude model accepts. The adapter sends them where they
 * help phone latency and drops one for good (per model) when the API rejects it with a 400:
 * - `temperature`: Claude 4.7 and later (Haiku 5.5 included) reject any non-default value.
 * - `thinking`: `{type: "disabled"}`. Haiku 5.5 would otherwise think at effort `medium`, which adds
 *   latency and counts toward `max_tokens`; Opus 5.5, Sonnet 5.5 and Fable reject it.
 * - `effort`: `output_config: {effort: "low"}`. Haiku 4.5, Sonnet 4.5 and older reject it.
 */
type OptionalField = "temperature" | "thinking" | "effort";

/** Effort for phone turns: short, fast replies; the conversation logic lives in code. */
const PHONE_EFFORT = "low";

/** Output cap when the model may think before it speaks (thinking counts toward `max_tokens`). */
const MIN_TOKENS_WITH_THINKING = 2000;

const REJECTION_PATTERN: Record<OptionalField, RegExp> = {
  temperature: /temperature/i,
  thinking: /thinking/i,
  effort: /effort|output_config/i,
};

/**
 * Fields not to send, per model id. Module-level so every AnthropicLlm shares it: the voice server
 * creates a client per call, so a per-instance flag would cost each call's first turn a failed
 * request. Seeded from the model families documented to reject a field, then extended whenever the
 * API rejects one.
 */
const skippedFieldsByModel = new Map<string, Set<OptionalField>>();

function skippedFields(model: string): Set<OptionalField> {
  let skipped = skippedFieldsByModel.get(model);
  if (!skipped) {
    skipped = knownUnsupportedFields(model);
    skippedFieldsByModel.set(model, skipped);
  }
  return skipped;
}

/**
 * Fields the model is documented to reject (or, for `thinking` on Opus 5 and Sonnet 5, to mishandle:
 * with thinking disabled Opus 5 can write a tool call into its spoken text and Sonnet 5 reaches for
 * tools less often, so both keep adaptive thinking at low effort). Unknown ids return an empty set and are
 * learned from the API's 400s instead.
 */
function knownUnsupportedFields(model: string): Set<OptionalField> {
  const id = model.toLowerCase();
  if (/claude-(?:fable|mythos)/.test(id)) return new Set(["temperature", "thinking"]);
  const match = /claude-(opus|sonnet|haiku)-(\d+)(?:-(\d{1,2}))?(?!\d)/.exec(id);
  if (!match) return new Set();
  const family = match[1];
  const version = Number(match[2]) * 100 + Number(match[3] ?? 0);
  const skipped = new Set<OptionalField>();
  if (version >= 407) skipped.add("temperature");
  if ((family === "opus" || family === "sonnet") && version >= 500) skipped.add("thinking");
  if (version < 405 || (version === 405 && family !== "opus")) skipped.add("effort");
  return skipped;
}

/** The optional field a 400 complains about, if the request sent it. */
function rejectedField(err: unknown, sent: OptionalField[]): OptionalField | null {
  const cause = err instanceof LlmError ? err.cause : err;
  if (!(cause instanceof Anthropic.BadRequestError)) return null;
  return sent.find((field) => REJECTION_PATTERN[field].test(cause.message)) ?? null;
}

/** Anthropic Messages API adapter (Claude) with prompt caching and streaming text. */
export class AnthropicLlm implements LlmClient {
  readonly provider = "anthropic";
  readonly model: string;
  private readonly client: Anthropic;

  constructor(options: AnthropicLlmOptions) {
    this.model = options.model;
    this.client = new Anthropic({
      apiKey: options.apiKey,
      timeout: options.timeoutMs ?? 20_000,
      maxRetries: 1,
      fetch: options.fetch,
    });
  }

  private toMessages(request: LlmRequest): MessageParam[] {
    const out: MessageParam[] = [];
    const push = (role: "user" | "assistant", blocks: ContentBlockParam[]) => {
      if (!blocks.length) return;
      const last = out[out.length - 1];
      if (last && last.role === role) {
        const existing = Array.isArray(last.content)
          ? last.content
          : [{ type: "text" as const, text: last.content }];
        last.content = [...existing, ...blocks];
      } else {
        out.push({ role, content: blocks });
      }
    };
    for (const m of request.messages) {
      if (m.role === "user") push("user", [{ type: "text", text: m.content }]);
      else if (m.role === "assistant") {
        const blocks: ContentBlockParam[] = [];
        if (m.content) blocks.push({ type: "text", text: m.content });
        for (const tc of m.toolCalls ?? [])
          blocks.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.arguments });
        push("assistant", blocks);
      } else {
        const block: ToolResultBlockParam = {
          type: "tool_result",
          tool_use_id: m.toolCallId,
          content: m.content,
        };
        push("user", [block]);
      }
    }
    // The conversation starts with our greeting; the API expects a user turn first.
    if (out[0]?.role !== "user")
      out.unshift({ role: "user", content: [{ type: "text", text: "(Anruf verbunden)" }] });
    if (request.context) {
      const contextBlock = {
        type: "text" as const,
        text: `<systemkontext>\n${request.context}\n</systemkontext>`,
      };
      const last = out[out.length - 1]!;
      if (last.role === "user") {
        const blocks = Array.isArray(last.content)
          ? last.content
          : [{ type: "text" as const, text: last.content }];
        last.content = [...blocks, contextBlock];
      } else {
        out.push({ role: "user", content: [contextBlock] });
      }
    }
    return out;
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const skipped = skippedFields(this.model);
    // Each rejection removes one more field, so this retries at most once per optional field.
    for (;;) {
      const { body, sent } = this.buildBody(request, skipped);
      try {
        return await this.run(request, body);
      } catch (err) {
        const field = rejectedField(err, sent);
        if (!field) throw err;
        skipped.add(field);
      }
    }
  }

  private buildBody(
    request: LlmRequest,
    skipped: ReadonlySet<OptionalField>,
  ): { body: MessageCreateParamsBase; sent: OptionalField[] } {
    const sent: OptionalField[] = [];
    const thinkingOff = !skipped.has("thinking");
    const maxTokens = request.maxTokens ?? 400;
    const body: MessageCreateParamsBase = {
      model: this.model,
      max_tokens: thinkingOff ? maxTokens : Math.max(maxTokens * 4, MIN_TOKENS_WITH_THINKING),
      system: [{ type: "text", text: request.system, cache_control: { type: "ephemeral" } }],
      tools: request.tools.map((t): Tool => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters as Tool["input_schema"],
      })),
      messages: this.toMessages(request),
    };
    if (request.temperature !== undefined && !skipped.has("temperature")) {
      body.temperature = request.temperature;
      sent.push("temperature");
    }
    if (thinkingOff) {
      body.thinking = { type: "disabled" };
      sent.push("thinking");
    }
    if (!skipped.has("effort")) {
      body.output_config = { effort: PHONE_EFFORT };
      sent.push("effort");
    }
    return { body, sent };
  }

  private async run(request: LlmRequest, body: MessageCreateParamsBase): Promise<LlmResponse> {
    try {
      const stream = this.client.messages.stream(body, { signal: request.signal });
      stream.on("text", (delta) => request.onTextDelta?.(delta));
      const final = await stream.finalMessage();
      let text = "";
      const toolCalls: ToolCall[] = [];
      for (const block of final.content) {
        if (block.type === "text") text += block.text;
        else if (block.type === "tool_use") {
          toolCalls.push({
            id: block.id,
            name: block.name,
            arguments: (block.input ?? {}) as Record<string, unknown>,
          });
        }
      }
      const usage = emptyUsage();
      usage.inputTokens =
        (final.usage.input_tokens ?? 0) +
        (final.usage.cache_read_input_tokens ?? 0) +
        (final.usage.cache_creation_input_tokens ?? 0);
      usage.outputTokens = final.usage.output_tokens ?? 0;
      usage.cachedTokens = final.usage.cache_read_input_tokens ?? 0;
      return { text: text.trim(), toolCalls, usage };
    } catch (err) {
      if (err instanceof Anthropic.APIError) {
        const retryable = err.status === undefined || err.status === 429 || err.status >= 500;
        throw new LlmError(`Anthropic ${err.status ?? ""}: ${err.message}`, retryable, err);
      }
      throw new LlmError(err instanceof Error ? err.message : String(err), true, err);
    }
  }
}
