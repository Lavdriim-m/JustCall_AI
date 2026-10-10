import Anthropic from "@anthropic-ai/sdk";
import type {
  MessageParam,
  Tool,
  ToolResultBlockParam,
  ContentBlockParam,
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

  /** Set when the model rejected `temperature` (some newer models fix sampling parameters). */
  private omitTemperature = false;

  async complete(request: LlmRequest): Promise<LlmResponse> {
    try {
      return await this.run(request);
    } catch (err) {
      if (
        !this.omitTemperature &&
        err instanceof LlmError &&
        err.cause instanceof Anthropic.APIError &&
        err.cause.status === 400 &&
        /temperature/i.test(err.message)
      ) {
        this.omitTemperature = true;
        return this.run(request);
      }
      throw err;
    }
  }

  private async run(request: LlmRequest): Promise<LlmResponse> {
    const tools: Tool[] = request.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters as Tool["input_schema"],
    }));
    try {
      const stream = this.client.messages.stream(
        {
          model: this.model,
          max_tokens: request.maxTokens ?? 400,
          temperature: this.omitTemperature ? undefined : request.temperature,
          system: [{ type: "text", text: request.system, cache_control: { type: "ephemeral" } }],
          tools,
          messages: this.toMessages(request),
        },
        { signal: request.signal },
      );
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
