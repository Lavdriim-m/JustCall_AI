import { describe, expect, it } from "vitest";
import { AnthropicLlm } from "../src/llm/anthropic";
import { OpenAiLlm } from "../src/llm/openai";
import type { LlmRequest } from "../src/llm/types";

function sse(lines: string[]): Response {
  return new Response(lines.join("\n\n") + "\n\n", {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

const tools: LlmRequest["tools"] = [
  {
    name: "add_items",
    description: "add",
    parameters: { type: "object", properties: { items: { type: "array" } } },
  },
];

describe("OpenAiLlm", () => {
  it("streams text, assembles tool calls and drops parameters the model rejects", async () => {
    const bodies: Record<string, unknown>[] = [];
    const fakeFetch = (async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      if (bodies.length === 1) {
        return new Response(
          JSON.stringify({
            error: {
              message:
                "Unsupported value: 'reasoning_effort' does not support 'none' with this model.",
              type: "invalid_request_error",
              param: "reasoning_effort",
              code: "unsupported_value",
            },
          }),
          { status: 400, headers: { "content-type": "application/json" } },
        );
      }
      const chunk = (delta: unknown, extra: Record<string, unknown> = {}) =>
        `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", created: 1, model: "gpt-x", choices: [{ index: 0, delta, finish_reason: null }], ...extra })}`;
      return sse([
        chunk({ role: "assistant", content: "Gerne. " }),
        chunk({ content: "Ich notiere das." }),
        chunk({
          tool_calls: [
            {
              index: 0,
              id: "call_1",
              type: "function",
              function: { name: "add_items", arguments: '{"items":[{"it' },
            },
          ],
        }),
        chunk({ tool_calls: [{ index: 0, function: { arguments: 'em":"I3","quantity":2}]}' } }] }),
        `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", created: 1, model: "gpt-x", choices: [], usage: { prompt_tokens: 1200, completion_tokens: 30, prompt_tokens_details: { cached_tokens: 1024 } } })}`,
        "data: [DONE]",
      ]);
    }) as typeof fetch;

    const llm = new OpenAiLlm({
      apiKey: "sk-test-0123456789abcdefghij",
      model: "gpt-5.4-mini",
      reasoningEffort: "none",
      fetch: fakeFetch,
    });
    const deltas: string[] = [];
    const res = await llm.complete({
      system: "SYS",
      context: "CTX",
      messages: [
        { role: "assistant", content: "Grüezi" },
        { role: "user", content: "Zwei Napoli" },
      ],
      tools,
      maxTokens: 300,
      onTextDelta: (d) => deltas.push(d),
    });
    expect(res.text).toBe("Gerne. Ich notiere das.");
    expect(deltas.join("")).toBe("Gerne. Ich notiere das.");
    expect(res.toolCalls).toEqual([
      { id: "call_1", name: "add_items", arguments: { items: [{ item: "I3", quantity: 2 }] } },
    ]);
    expect(res.usage).toEqual({ inputTokens: 1200, outputTokens: 30, cachedTokens: 1024 });
    expect(bodies[0]!.reasoning_effort).toBe("none");
    expect(bodies[1]!.reasoning_effort).toBeUndefined();
    const messages = bodies[1]!.messages as { role: string; content: string }[];
    expect(messages[0]).toEqual({ role: "system", content: "SYS" });
    expect(messages.at(-1)).toEqual({ role: "system", content: "CTX" });
  });
});

describe("AnthropicLlm", () => {
  it("converts the conversation, caches the system prompt and parses streamed tool use", async () => {
    let body: Record<string, any> = {};
    const fakeFetch = (async (_url: string, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      const ev = (type: string, data: unknown) => `event: ${type}\ndata: ${JSON.stringify(data)}`;
      return sse([
        ev("message_start", {
          type: "message_start",
          message: {
            id: "msg_1",
            type: "message",
            role: "assistant",
            content: [],
            model: "claude-haiku-5-5",
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 50, output_tokens: 1, cache_read_input_tokens: 900 },
          },
        }),
        ev("content_block_start", {
          type: "content_block_start",
          index: 0,
          content_block: { type: "text", text: "" },
        }),
        ev("content_block_delta", {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "Gerne." },
        }),
        ev("content_block_stop", { type: "content_block_stop", index: 0 }),
        ev("content_block_start", {
          type: "content_block_start",
          index: 1,
          content_block: { type: "tool_use", id: "toolu_1", name: "add_items", input: {} },
        }),
        ev("content_block_delta", {
          type: "content_block_delta",
          index: 1,
          delta: { type: "input_json_delta", partial_json: '{"items":[{"item":"I1"}]}' },
        }),
        ev("content_block_stop", { type: "content_block_stop", index: 1 }),
        ev("message_delta", {
          type: "message_delta",
          delta: { stop_reason: "tool_use", stop_sequence: null },
          usage: { output_tokens: 20 },
        }),
        ev("message_stop", { type: "message_stop" }),
      ]);
    }) as typeof fetch;

    const llm = new AnthropicLlm({
      apiKey: "sk-ant-test",
      model: "claude-haiku-5-5",
      fetch: fakeFetch,
    });
    const res = await llm.complete({
      system: "SYS",
      context: "CTX",
      messages: [
        { role: "assistant", content: "Grüezi" },
        { role: "user", content: "Eine Margherita" },
        {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "toolu_0", name: "add_items", arguments: { items: [] } }],
        },
        { role: "tool", toolCallId: "toolu_0", name: "add_items", content: '{"ok":false}' },
      ],
      tools,
      temperature: 0.3,
      maxTokens: 300,
    });
    expect(res.text).toBe("Gerne.");
    expect(res.toolCalls).toEqual([
      { id: "toolu_1", name: "add_items", arguments: { items: [{ item: "I1" }] } },
    ]);
    expect(res.usage.cachedTokens).toBe(900);
    // Haiku 5.5: no temperature up front (non-default values 400), thinking off at low effort.
    expect(body).not.toHaveProperty("temperature");
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body.output_config).toEqual({ effort: "low" });
    expect(body.max_tokens).toBe(300);
    expect(body.system[0].cache_control).toEqual({ type: "ephemeral" });
    const roles = (body.messages as { role: string }[]).map((m) => m.role);
    expect(roles).toEqual(["user", "assistant", "user", "assistant", "user"]);
    const last = body.messages.at(-1).content as { type: string; text?: string }[];
    expect(last[0]!.type).toBe("tool_result");
    expect(last.at(-1)!.text).toContain("CTX");
  });
});

describe("AnthropicLlm optional request fields", () => {
  const ev = (type: string, data: unknown) => `event: ${type}\ndata: ${JSON.stringify(data)}`;
  const textStream = (text: string) =>
    sse([
      ev("message_start", {
        type: "message_start",
        message: {
          id: "msg_1",
          type: "message",
          role: "assistant",
          content: [],
          model: "claude-x",
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 1 },
        },
      }),
      ev("content_block_start", {
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" },
      }),
      ev("content_block_delta", {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text },
      }),
      ev("content_block_stop", { type: "content_block_stop", index: 0 }),
      ev("message_delta", {
        type: "message_delta",
        delta: { stop_reason: "end_turn", stop_sequence: null },
        usage: { output_tokens: 5 },
      }),
      ev("message_stop", { type: "message_stop" }),
    ]);
  const badRequest = (message: string) =>
    new Response(
      JSON.stringify({ type: "error", error: { type: "invalid_request_error", message } }),
      { status: 400, headers: { "content-type": "application/json" } },
    );

  /** Fake fetch that records request bodies and answers each with the next scripted response. */
  function scripted(responses: (() => Response)[]) {
    const bodies: Record<string, any>[] = [];
    const fakeFetch = (async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      const next = responses.shift();
      return next ? next() : textStream("Gerne.");
    }) as typeof fetch;
    return { bodies, fakeFetch };
  }

  const request = (): LlmRequest => ({
    system: "SYS",
    messages: [{ role: "user", content: "Eine Margherita" }],
    tools,
    temperature: 0.3,
    maxTokens: 400,
  });

  it("remembers a rejected temperature for the model across instances", async () => {
    const model = "claude-test-temperature";
    const { bodies, fakeFetch } = scripted([
      () => badRequest("temperature: only the default value 1 is supported for this model."),
    ]);
    const first = new AnthropicLlm({ apiKey: "sk-ant-test", model, fetch: fakeFetch });
    expect((await first.complete(request())).text).toBe("Gerne.");
    expect(bodies).toHaveLength(2);
    expect(bodies[0]!.temperature).toBe(0.3);
    expect(bodies[1]).not.toHaveProperty("temperature");
    expect(bodies[1]!.thinking).toEqual({ type: "disabled" });
    expect(bodies[1]!.output_config).toEqual({ effort: "low" });

    // A new client (the voice server creates one per call) does not repeat the failed request.
    const second = new AnthropicLlm({ apiKey: "sk-ant-test", model, fetch: fakeFetch });
    expect((await second.complete(request())).text).toBe("Gerne.");
    expect(bodies).toHaveLength(3);
    expect(bodies[2]).not.toHaveProperty("temperature");
  });

  it("drops disabled thinking, then effort, when the model rejects them", async () => {
    const model = "claude-test-legacy";
    const { bodies, fakeFetch } = scripted([
      () =>
        badRequest(
          "thinking.type: 'disabled' is not supported for this model; lower output_config.effort instead.",
        ),
      () => badRequest("output_config.effort: Extra inputs are not permitted"),
    ]);
    const llm = new AnthropicLlm({ apiKey: "sk-ant-test", model, fetch: fakeFetch });
    expect((await llm.complete(request())).text).toBe("Gerne.");
    expect(bodies).toHaveLength(3);
    expect(bodies[0]!.thinking).toEqual({ type: "disabled" });
    expect(bodies[0]!.max_tokens).toBe(400);
    // The model may think now, so the cap leaves room for thinking before the spoken text.
    expect(bodies[1]).not.toHaveProperty("thinking");
    expect(bodies[1]!.output_config).toEqual({ effort: "low" });
    expect(bodies[1]!.max_tokens).toBe(2000);
    expect(bodies[2]).not.toHaveProperty("thinking");
    expect(bodies[2]).not.toHaveProperty("output_config");
    expect(bodies[2]!.temperature).toBe(0.3);

    const again = new AnthropicLlm({ apiKey: "sk-ant-test", model, fetch: fakeFetch });
    await again.complete(request());
    expect(bodies).toHaveLength(4);
    expect(bodies[3]).not.toHaveProperty("thinking");
    expect(bodies[3]).not.toHaveProperty("output_config");
  });

  it("throws other 400s without retrying", async () => {
    const { bodies, fakeFetch } = scripted([
      () => badRequest("messages: roles must alternate between user and assistant"),
    ]);
    const llm = new AnthropicLlm({
      apiKey: "sk-ant-test",
      model: "claude-test-other",
      fetch: fakeFetch,
    });
    await expect(llm.complete(request())).rejects.toMatchObject({
      name: "LlmError",
      retryable: false,
    });
    expect(bodies).toHaveLength(1);
  });

  it("skips fields up front for model families documented to reject them", async () => {
    const cases: [string, { temperature: boolean; thinking: boolean; effort: boolean }][] = [
      ["claude-opus-5-5", { temperature: false, thinking: false, effort: true }],
      ["claude-sonnet-5-5", { temperature: false, thinking: false, effort: true }],
      ["claude-sonnet-5", { temperature: false, thinking: false, effort: true }],
      ["claude-fable-5-1", { temperature: false, thinking: false, effort: true }],
      ["claude-opus-4-8", { temperature: false, thinking: true, effort: true }],
      ["claude-sonnet-4-6", { temperature: true, thinking: true, effort: true }],
      ["claude-haiku-4-5-20251001", { temperature: true, thinking: true, effort: false }],
      ["anthropic.claude-haiku-5-5", { temperature: false, thinking: true, effort: true }],
    ];
    for (const [model, expected] of cases) {
      const { bodies, fakeFetch } = scripted([]);
      await new AnthropicLlm({ apiKey: "sk-ant-test", model, fetch: fakeFetch }).complete(
        request(),
      );
      expect(bodies, model).toHaveLength(1);
      const body = bodies[0]!;
      expect("temperature" in body, `${model} temperature`).toBe(expected.temperature);
      expect("thinking" in body, `${model} thinking`).toBe(expected.thinking);
      expect("output_config" in body, `${model} effort`).toBe(expected.effort);
      expect(body.max_tokens, `${model} max_tokens`).toBe(expected.thinking ? 400 : 2000);
    }
  });
});
