import { expect, test, describe } from "bun:test";
import { gunzipSync } from "node:zlib";

import { startServer } from "../src/server.ts";

const HOST = "127.0.0.1";
const DEVIN_AUTH_PATH = "/exa.auth_pb.AuthService/GetUserJwt";
const CHAT_MESSAGE_PATH = "/exa.api_server_pb.ApiServerService/GetChatMessage";

// ─── protobuf encoders ───────────────────────────────────────────────────────

function encodeVarint(value: number): number[] {
  const bytes: number[] = [];
  let remaining = BigInt(value);
  do {
    let byte = Number(remaining & 0x7fn);
    remaining >>= 7n;
    if (remaining !== 0n) byte |= 0x80;
    bytes.push(byte);
  } while (remaining !== 0n);
  return bytes;
}

function encodeTag(field: number, wire: number): number[] {
  return encodeVarint((field << 3) | wire);
}

function encodeString(field: number, value: string): number[] {
  const payload = new TextEncoder().encode(value);
  return [...encodeTag(field, 2), ...encodeVarint(payload.length), ...payload];
}

function encodeUint32(field: number, value: number): number[] {
  return [...encodeTag(field, 0), ...encodeVarint(value)];
}

function encodeMessage(field: number, payload: number[]): number[] {
  return [...encodeTag(field, 2), ...encodeVarint(payload.length), ...payload];
}

// ─── Connect frame + response builders ───────────────────────────────────────

function connectFrame(flag: number, payload: Uint8Array): Uint8Array {
  const header = Buffer.alloc(5);
  header[0] = flag;
  header.writeUInt32BE(payload.length, 1);
  return Buffer.concat([header, payload]);
}

interface ToolCallFields {
  id: string;
  name: string;
  argumentsJson: string;
}

interface UsageFields {
  inputTokens?: number;
  outputTokens?: number;
  cacheWriteTokens?: number;
  cacheReadTokens?: number;
}

interface ChatResponseFields {
  text?: string;
  thinking?: string;
  toolCalls?: ToolCallFields[];
  stopReason?: number;
  usage?: UsageFields;
}

function chatResponsePayload(fields: ChatResponseFields): Uint8Array {
  const bytes: number[] = [];
  bytes.push(...encodeString(1, "msg-fixture"));
  if (fields.text) bytes.push(...encodeString(3, fields.text));
  if (fields.stopReason) bytes.push(...encodeUint32(5, fields.stopReason));
  for (const tc of fields.toolCalls ?? []) {
    bytes.push(
      ...encodeMessage(6, [
        ...encodeString(1, tc.id),
        ...encodeString(2, tc.name),
        ...encodeString(3, tc.argumentsJson),
      ]),
    );
  }
  if (fields.usage) {
    const u = fields.usage;
    bytes.push(
      ...encodeMessage(7, [
        ...(u.inputTokens ? encodeUint32(2, u.inputTokens) : []),
        ...(u.outputTokens ? encodeUint32(3, u.outputTokens) : []),
        ...(u.cacheWriteTokens ? encodeUint32(4, u.cacheWriteTokens) : []),
        ...(u.cacheReadTokens ? encodeUint32(5, u.cacheReadTokens) : []),
      ]),
    );
  }
  if (fields.thinking) bytes.push(...encodeString(9, fields.thinking));
  return Uint8Array.from(bytes);
}

function framesBody(
  dataFrames: Uint8Array[],
  trailer?: { error?: { code: string; message: string } },
): Uint8Array {
  const parts = [...dataFrames];
  if (trailer?.error) {
    const json = JSON.stringify({ error: trailer.error });
    parts.push(connectFrame(0x02, new TextEncoder().encode(json)));
  } else {
    parts.push(connectFrame(0x02, new Uint8Array(0)));
  }
  return Buffer.concat(parts);
}

function dataFrame(fields: ChatResponseFields): Uint8Array {
  return connectFrame(0x00, chatResponsePayload(fields));
}

// ─── Upstream mock ───────────────────────────────────────────────────────────

interface UpstreamOptions {
  chatBody?: () => Uint8Array;
  chatError?: { status: number; body: string };
  jwt?: string;
}

interface Upstream {
  url: string;
  stop: () => Promise<void>;
}

function startUpstream(opts: UpstreamOptions = {}): Upstream {
  const server = Bun.serve({
    hostname: HOST,
    port: 0,
    async fetch(req: Request): Promise<Response> {
      const url = new URL(req.url);
      if (url.pathname === DEVIN_AUTH_PATH) {
        const payload = Uint8Array.from([...encodeString(1, opts.jwt ?? "jwt")]);
        return new Response(payload, { headers: { "content-type": "application/proto" } });
      }
      if (url.pathname === CHAT_MESSAGE_PATH) {
        if (opts.chatError) {
          return new Response(opts.chatError.body, { status: opts.chatError.status });
        }
        const body = opts.chatBody ? opts.chatBody() : framesBody([
          dataFrame({ text: "hi", usage: { inputTokens: 10, outputTokens: 5 } }),
        ]);
        return new Response(body, { headers: { "content-type": "application/connect+proto" } });
      }
      return new Response("not found", { status: 404 });
    },
  });
  return { url: server.url, stop: () => server.stop() };
}

// ─── Gateway harness ─────────────────────────────────────────────────────────

async function reservePort(): Promise<number> {
  const probe = Bun.serve({ hostname: HOST, port: 0, fetch: () => new Response(null) });
  const port = probe.port;
  await probe.stop();
  return port;
}

const SIGNALS = ["SIGINT", "SIGTERM"] as const;

async function startGateway(upstreamUrl: string, token = "k"): Promise<{ url: string; cleanup: () => Promise<void> }> {
  const port = await reservePort();
  const before = new Map(SIGNALS.map((s) => [s, new Set(process.listeners(s))]));
  const handle = await startServer({ host: HOST, port, token, baseUrl: upstreamUrl });
  const url = `http://${HOST}:${port}`;
  const cleanup = async () => {
    try {
      await handle.stop();
    } finally {
      for (const s of SIGNALS) {
        const prev = before.get(s)!;
        for (const l of process.listeners(s)) {
          if (!prev.has(l)) process.removeListener(s, l);
        }
      }
    }
  };
  return { url, cleanup };
}

// ─── SSE parsing ─────────────────────────────────────────────────────────────

interface SseEvent {
  event: string | null;
  data: string;
}

function parseSse(text: string): SseEvent[] {
  const events: SseEvent[] = [];
  for (const block of text.split("\n\n")) {
    if (!block.trim()) continue;
    let event: string | null = null;
    let data = "";
    for (const line of block.split("\n")) {
      if (line.startsWith("event: ")) event = line.slice(7);
      else if (line.startsWith("data: ")) data += line.slice(6);
    }
    events.push({ event, data });
  }
  return events;
}

// Reuse the same JSON body + headers across surfaces.
function chatBody(messages: unknown[], extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ model: "m", messages, ...extra });
}

// ═════════════════════════════════════════════════════════════════════════════
// OpenAI Chat Completions — non-streaming output format
// ═════════════════════════════════════════════════════════════════════════════

describe("OpenAI chat.completion (non-streaming) — output format", () => {
  test("thinking is surfaced as message.reasoning_content alongside text", async () => {
    const upstream = startUpstream({
      chatBody: () => framesBody([dataFrame({ thinking: "reasoning", text: "answer" })]),
    });
    const { url, cleanup } = await startGateway(upstream.url.origin);
    try {
      const res = await fetch(`${url}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: chatBody([{ role: "user", content: "hi" }]),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.choices[0].message.content).toBe("answer");
      expect(body.choices[0].message.reasoning_content).toBe("reasoning");
      expect(body.choices[0].finish_reason).toBe("stop");
    } finally {
      await cleanup();
      await upstream.stop();
    }
  });

  test("MAX_TOKENS stop reason maps to finish_reason 'length'", async () => {
    const upstream = startUpstream({
      chatBody: () => framesBody([dataFrame({ text: "cut", stopReason: 3 })]),
    });
    const { url, cleanup } = await startGateway(upstream.url.origin);
    try {
      const res = await fetch(`${url}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: chatBody([{ role: "user", content: "hi" }]),
      });
      const body = await res.json();
      expect(body.choices[0].finish_reason).toBe("length");
    } finally {
      await cleanup();
      await upstream.stop();
    }
  });

  test("upstream sends no usage event -> response.usage is undefined", async () => {
    const upstream = startUpstream({
      chatBody: () => framesBody([dataFrame({ text: "hi", stopReason: 1 })]),
    });
    const { url, cleanup } = await startGateway(upstream.url.origin);
    try {
      const res = await fetch(`${url}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: chatBody([{ role: "user", content: "hi" }]),
      });
      const body = await res.json();
      expect(body.usage).toBeUndefined();
    } finally {
      await cleanup();
      await upstream.stop();
    }
  });

  test("empty text and no tool calls -> message.content is null", async () => {
    const upstream = startUpstream({
      chatBody: () => framesBody([dataFrame({ stopReason: 1 })]),
    });
    const { url, cleanup } = await startGateway(upstream.url.origin);
    try {
      const res = await fetch(`${url}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: chatBody([{ role: "user", content: "hi" }]),
      });
      const body = await res.json();
      expect(body.choices[0].message.content).toBeNull();
      expect(body.choices[0].message.tool_calls).toBeUndefined();
    } finally {
      await cleanup();
      await upstream.stop();
    }
  });

  test("tool call with empty id falls back to call_<index> and empty arguments to '{}'", async () => {
    const upstream = startUpstream({
      chatBody: () =>
        framesBody([
          dataFrame({
            toolCalls: [{ id: "", name: "noop", argumentsJson: "" }],
          }),
        ]),
    });
    const { url, cleanup } = await startGateway(upstream.url.origin);
    try {
      const res = await fetch(`${url}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: chatBody([{ role: "user", content: "go" }]),
      });
      const body = await res.json();
      expect(body.choices[0].message.tool_calls).toEqual([
        { id: "call_0", type: "function", function: { name: "noop", arguments: "{}" } },
      ]);
      expect(body.choices[0].finish_reason).toBe("tool_calls");
    } finally {
      await cleanup();
      await upstream.stop();
    }
  });

  test("thinking + text + tool_calls together: reasoning_content present, content null, tool_calls emitted", async () => {
    const upstream = startUpstream({
      chatBody: () =>
        framesBody([
          dataFrame({
            thinking: "th",
            text: "ctx",
            toolCalls: [{ id: "c1", name: "do", argumentsJson: '{"x":1}' }],
          }),
        ]),
    });
    const { url, cleanup } = await startGateway(upstream.url.origin);
    try {
      const res = await fetch(`${url}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: chatBody([{ role: "user", content: "go" }]),
      });
      const body = await res.json();
      const msg = body.choices[0].message;
      expect(msg.reasoning_content).toBe("th");
      expect(msg.content).toBeNull();
      expect(msg.tool_calls).toEqual([
        { id: "c1", type: "function", function: { name: "do", arguments: '{"x":1}' } },
      ]);
    } finally {
      await cleanup();
      await upstream.stop();
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// OpenAI Chat Completions — streaming output format
// ═════════════════════════════════════════════════════════════════════════════

describe("OpenAI chat.completion.chunk (streaming) — output format", () => {
  test("thinking deltas are forwarded as delta.reasoning_content", async () => {
    const upstream = startUpstream({
      chatBody: () => framesBody([dataFrame({ thinking: "re" }), dataFrame({ thinking: "ason" })]),
    });
    const { url, cleanup } = await startGateway(upstream.url.origin);
    try {
      const res = await fetch(`${url}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: chatBody([{ role: "user", content: "hi" }], { stream: true }),
      });
      const events = parseSse(await res.text()).filter((e) => e.data !== "[DONE]");
      const reasoning = events
        .map((e) => JSON.parse(e.data))
        .filter((c) => c.choices?.[0]?.delta?.reasoning_content)
        .map((c) => c.choices[0].delta.reasoning_content);
      expect(reasoning).toEqual(["re", "ason"]);
    } finally {
      await cleanup();
      await upstream.stop();
    }
  });

  test("tool_call deltas carry id/type/function.name/arguments", async () => {
    const upstream = startUpstream({
      chatBody: () =>
        framesBody([
          dataFrame({
            toolCalls: [{ id: "tc1", name: "get_weather", argumentsJson: '{"city":"SF"}' }],
          }),
        ]),
    });
    const { url, cleanup } = await startGateway(upstream.url.origin);
    try {
      const res = await fetch(`${url}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: chatBody([{ role: "user", content: "weather?" }], { stream: true }),
      });
      const events = parseSse(await res.text()).filter((e) => e.data !== "[DONE]");
      const toolChunk = events
        .map((e) => JSON.parse(e.data))
        .find((c) => c.choices?.[0]?.delta?.tool_calls);
      expect(toolChunk.choices[0].delta.tool_calls).toEqual([
        { id: "tc1", type: "function", function: { name: "get_weather", arguments: '{"city":"SF"}' } },
      ]);
      // final chunk carries tool_calls finish_reason
      const finalChunk = JSON.parse(events[events.length - 1].data);
      expect(finalChunk.choices[0].finish_reason).toBe("tool_calls");
    } finally {
      await cleanup();
      await upstream.stop();
    }
  });

  test("MAX_TOKENS stop reason -> finish_reason 'length' on the closing chunk", async () => {
    const upstream = startUpstream({
      chatBody: () => framesBody([dataFrame({ text: "cut", stopReason: 3 })]),
    });
    const { url, cleanup } = await startGateway(upstream.url.origin);
    try {
      const res = await fetch(`${url}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: chatBody([{ role: "user", content: "hi" }], { stream: true }),
      });
      const events = parseSse(await res.text()).filter((e) => e.data !== "[DONE]");
      const finalChunk = JSON.parse(events[events.length - 1].data);
      expect(finalChunk.choices[0].finish_reason).toBe("length");
    } finally {
      await cleanup();
      await upstream.stop();
    }
  });

  test("streamChat error event -> error chunk with api_error type", async () => {
    const upstream = startUpstream({
      chatBody: () =>
        framesBody([dataFrame({ text: "hi" })], { error: { code: "internal", message: "boom" } }),
    });
    const { url, cleanup } = await startGateway(upstream.url.origin);
    try {
      const res = await fetch(`${url}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: chatBody([{ role: "user", content: "hi" }], { stream: true }),
      });
      const events = parseSse(await res.text()).filter((e) => e.data !== "[DONE]");
      const errChunk = events.map((e) => JSON.parse(e.data)).find((c) => c.error);
      expect(errChunk.error.type).toBe("api_error");
      expect(errChunk.error.message).toContain("boom");
    } finally {
      await cleanup();
      await upstream.stop();
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// OpenAI Responses API — non-streaming output format
// ═════════════════════════════════════════════════════════════════════════════

describe("OpenAI /v1/responses (non-streaming) — output format", () => {
  test("upstream sends no usage -> response.usage is undefined", async () => {
    const upstream = startUpstream({
      chatBody: () => framesBody([dataFrame({ text: "hi", stopReason: 1 })]),
    });
    const { url, cleanup } = await startGateway(upstream.url.origin);
    try {
      const res = await fetch(`${url}/v1/responses`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "m", input: "hi" }),
      });
      const body = await res.json();
      expect(body.status).toBe("completed");
      expect(body.output[0].content[0].text).toBe("hi");
      expect(body.usage).toBeUndefined();
    } finally {
      await cleanup();
      await upstream.stop();
    }
  });

  test("usage event -> input_tokens/output_tokens/total_tokens", async () => {
    const upstream = startUpstream({
      chatBody: () =>
        framesBody([dataFrame({ text: "hi", usage: { inputTokens: 7, outputTokens: 3 } })]),
    });
    const { url, cleanup } = await startGateway(upstream.url.origin);
    try {
      const res = await fetch(`${url}/v1/responses`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "m", input: "hi" }),
      });
      const body = await res.json();
      expect(body.usage).toEqual({ input_tokens: 7, output_tokens: 3, total_tokens: 10 });
    } finally {
      await cleanup();
      await upstream.stop();
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// OpenAI Responses API — streaming output format
// ═════════════════════════════════════════════════════════════════════════════

describe("OpenAI /v1/responses stream=true — output format", () => {
  test("text-only: emits created -> output_item.added -> content_part.added -> output_text.delta -> content_part.done -> output_item.done -> completed", async () => {
    const upstream = startUpstream({
      chatBody: () => framesBody([dataFrame({ text: "he" }), dataFrame({ text: "llo" })]),
    });
    const { url, cleanup } = await startGateway(upstream.url.origin);
    try {
      const res = await fetch(`${url}/v1/responses`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "m", stream: true, input: "hi" }),
      });
      expect(res.headers.get("content-type")).toBe("text/event-stream");
      const events = parseSse(await res.text());
      const seq = events.map((e) => e.event);
      expect(seq).toEqual([
        "response.created",
        "response.output_item.added",
        "response.content_part.added",
        "response.output_text.delta",
        "response.output_text.delta",
        "response.content_part.done",
        "response.output_item.done",
        "response.completed",
      ]);

      // deltas concatenate to the full text
      const deltas = events
        .filter((e) => e.event === "response.output_text.delta")
        .map((e) => JSON.parse(e.data).delta);
      expect(deltas.join("")).toBe("hello");

      // completed carries the assembled message item
      const completed = JSON.parse(events.at(-1)!.data);
      expect(completed.response.status).toBe("completed");
      expect(completed.response.output).toEqual([
        {
          type: "message",
          id: expect.any(String),
          status: "completed",
          role: "assistant",
          content: [{ type: "output_text", text: "hello" }],
        },
      ]);
    } finally {
      await cleanup();
      await upstream.stop();
    }
  });

  test("thinking then text: reasoning item opened/closed before the message item", async () => {
    const upstream = startUpstream({
      chatBody: () => framesBody([dataFrame({ thinking: "hmm" }), dataFrame({ text: "ans" })]),
    });
    const { url, cleanup } = await startGateway(upstream.url.origin);
    try {
      const res = await fetch(`${url}/v1/responses`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "m", stream: true, input: "hi" }),
      });
      const events = parseSse(await res.text());
      const seq = events.map((e) => e.event);
      expect(seq).toEqual([
        "response.created",
        "response.output_item.added",            // reasoning item
        "response.reasoning_summary_text.delta", // hmm
        "response.reasoning_summary_text.done",
        "response.output_item.done",             // reasoning item closed
        "response.output_item.added",            // message item
        "response.content_part.added",
        "response.output_text.delta",            // ans
        "response.content_part.done",
        "response.output_item.done",             // message item closed
        "response.completed",
      ]);

      const reasoningDelta = events.find((e) => e.event === "response.reasoning_summary_text.delta");
      expect(JSON.parse(reasoningDelta!.data).delta).toBe("hmm");

      // completed output has reasoning first, then message
      const completed = JSON.parse(events.at(-1)!.data);
      expect(completed.response.output.map((o: { type: string }) => o.type)).toEqual(["reasoning", "message"]);
    } finally {
      await cleanup();
      await upstream.stop();
    }
  });

  test("thinking-only (no text): reasoning item closed, no message item emitted", async () => {
    const upstream = startUpstream({
      chatBody: () => framesBody([dataFrame({ thinking: "only" })]),
    });
    const { url, cleanup } = await startGateway(upstream.url.origin);
    try {
      const res = await fetch(`${url}/v1/responses`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "m", stream: true, input: "hi" }),
      });
      const events = parseSse(await res.text());
      const seq = events.map((e) => e.event);
      expect(seq).toEqual([
        "response.created",
        "response.output_item.added",
        "response.reasoning_summary_text.delta",
        "response.output_item.done",
        "response.completed",
      ]);
      const completed = JSON.parse(events.at(-1)!.data);
      expect(completed.response.output.map((o: { type: string }) => o.type)).toEqual(["reasoning"]);
    } finally {
      await cleanup();
      await upstream.stop();
    }
  });

  test("streamChat error event -> response.failed", async () => {
    const upstream = startUpstream({
      chatBody: () =>
        framesBody([dataFrame({ text: "hi" })], { error: { code: "internal", message: "boom" } }),
    });
    const { url, cleanup } = await startGateway(upstream.url.origin);
    try {
      const res = await fetch(`${url}/v1/responses`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "m", stream: true, input: "hi" }),
      });
      const events = parseSse(await res.text());
      const failed = events.find((e) => e.event === "response.failed");
      expect(failed).toBeDefined();
      expect(JSON.parse(failed!.data).error.message).toContain("boom");
    } finally {
      await cleanup();
      await upstream.stop();
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Anthropic Messages — non-streaming output format
// ═════════════════════════════════════════════════════════════════════════════

describe("Anthropic /v1/messages (non-streaming) — output format", () => {
  test("MAX_TOKENS stop reason -> stop_reason 'max_tokens'", async () => {
    const upstream = startUpstream({
      chatBody: () => framesBody([dataFrame({ text: "cut", stopReason: 3 })]),
    });
    const { url, cleanup } = await startGateway(upstream.url.origin);
    try {
      const res = await fetch(`${url}/v1/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "m", max_tokens: 100, messages: [{ role: "user", content: "hi" }] }),
      });
      const body = await res.json();
      expect(body.stop_reason).toBe("max_tokens");
    } finally {
      await cleanup();
      await upstream.stop();
    }
  });

  test("cache tokens propagate to cache_read_input_tokens / cache_creation_input_tokens", async () => {
    const upstream = startUpstream({
      chatBody: () =>
        framesBody([
          dataFrame({
            text: "hi",
            usage: { inputTokens: 10, outputTokens: 5, cacheWriteTokens: 2, cacheReadTokens: 4 },
          }),
        ]),
    });
    const { url, cleanup } = await startGateway(upstream.url.origin);
    try {
      const res = await fetch(`${url}/v1/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "m", max_tokens: 100, messages: [{ role: "user", content: "hi" }] }),
      });
      const body = await res.json();
      expect(body.usage).toEqual({
        input_tokens: 10,
        output_tokens: 5,
        cache_read_input_tokens: 4,
        cache_creation_input_tokens: 2,
      });
    } finally {
      await cleanup();
      await upstream.stop();
    }
  });

  test("zero cache tokens -> cache_*_input_tokens fields omitted (undefined)", async () => {
    const upstream = startUpstream({
      chatBody: () =>
        framesBody([dataFrame({ text: "hi", usage: { inputTokens: 10, outputTokens: 5 } })]),
    });
    const { url, cleanup } = await startGateway(upstream.url.origin);
    try {
      const res = await fetch(`${url}/v1/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "m", max_tokens: 100, messages: [{ role: "user", content: "hi" }] }),
      });
      const body = await res.json();
      expect(body.usage.cache_read_input_tokens).toBeUndefined();
      expect(body.usage.cache_creation_input_tokens).toBeUndefined();
    } finally {
      await cleanup();
      await upstream.stop();
    }
  });

  test("empty content (no text/thinking/tool) -> fallback [{type:text, text:''}]", async () => {
    const upstream = startUpstream({
      chatBody: () => framesBody([dataFrame({ stopReason: 1 })]),
    });
    const { url, cleanup } = await startGateway(upstream.url.origin);
    try {
      const res = await fetch(`${url}/v1/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "m", max_tokens: 100, messages: [{ role: "user", content: "hi" }] }),
      });
      const body = await res.json();
      expect(body.content).toEqual([{ type: "text", text: "" }]);
    } finally {
      await cleanup();
      await upstream.stop();
    }
  });

  test("tool_use with empty id falls back to toolu_<12> and empty arguments to {}", async () => {
    const upstream = startUpstream({
      chatBody: () =>
        framesBody([
          dataFrame({ toolCalls: [{ id: "", name: "do", argumentsJson: "" }] }),
        ]),
    });
    const { url, cleanup } = await startGateway(upstream.url.origin);
    try {
      const res = await fetch(`${url}/v1/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "m", max_tokens: 100, messages: [{ role: "user", content: "go" }] }),
      });
      const body = await res.json();
      const tu = body.content[0];
      expect(tu.type).toBe("tool_use");
      expect(tu.id).toMatch(/^toolu_[0-9a-f-]{12}$/);
      expect(tu.name).toBe("do");
      expect(tu.input).toEqual({});
      expect(body.stop_reason).toBe("tool_use");
    } finally {
      await cleanup();
      await upstream.stop();
    }
  });

  test("thinking + text + tool_use: content block order is thinking, text, tool_use", async () => {
    const upstream = startUpstream({
      chatBody: () =>
        framesBody([
          dataFrame({
            thinking: "th",
            text: "tx",
            toolCalls: [{ id: "t1", name: "do", argumentsJson: '{"a":1}' }],
          }),
        ]),
    });
    const { url, cleanup } = await startGateway(upstream.url.origin);
    try {
      const res = await fetch(`${url}/v1/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "m", max_tokens: 100, messages: [{ role: "user", content: "go" }] }),
      });
      const body = await res.json();
      expect(body.content.map((b: { type: string }) => b.type)).toEqual(["thinking", "text", "tool_use"]);
      expect(body.content[2].input).toEqual({ a: 1 });
    } finally {
      await cleanup();
      await upstream.stop();
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Anthropic Messages — streaming output format
// ═════════════════════════════════════════════════════════════════════════════

describe("Anthropic /v1/messages stream=true — output format", () => {
  test("tool_use: content_block_start tool_use -> input_json_delta -> content_block_stop, then tool_use stop_reason", async () => {
    const upstream = startUpstream({
      chatBody: () =>
        framesBody([
          dataFrame({
            toolCalls: [{ id: "toolu_1", name: "get_weather", argumentsJson: '{"city":"SF"}' }],
          }),
        ]),
    });
    const { url, cleanup } = await startGateway(upstream.url.origin);
    try {
      const res = await fetch(`${url}/v1/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "m",
          max_tokens: 100,
          stream: true,
          messages: [{ role: "user", content: "weather?" }],
        }),
      });
      const events = parseSse(await res.text());
      const seq = events.map((e) => e.event);
      expect(seq).toEqual([
        "message_start",
        "content_block_start",
        "content_block_delta",
        "content_block_stop",
        "message_delta",
        "message_stop",
      ]);

      const blockStart = JSON.parse(events[1].data);
      expect(blockStart.content_block).toEqual({
        type: "tool_use",
        id: "toolu_1",
        name: "get_weather",
        input: {},
      });

      const delta = JSON.parse(events[2].data);
      expect(delta.delta).toEqual({ type: "input_json_delta", partial_json: '{"city":"SF"}' });

      const messageDelta = JSON.parse(events[4].data);
      expect(messageDelta.delta.stop_reason).toBe("tool_use");
    } finally {
      await cleanup();
      await upstream.stop();
    }
  });

  test("usage event -> output_tokens surfaced in message_delta.usage", async () => {
    const upstream = startUpstream({
      chatBody: () =>
        framesBody([dataFrame({ text: "hi", usage: { inputTokens: 12, outputTokens: 8 } })]),
    });
    const { url, cleanup } = await startGateway(upstream.url.origin);
    try {
      const res = await fetch(`${url}/v1/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "m",
          max_tokens: 100,
          stream: true,
          messages: [{ role: "user", content: "hi" }],
        }),
      });
      const events = parseSse(await res.text());
      const messageDelta = events.find((e) => e.event === "message_delta");
      expect(JSON.parse(messageDelta!.data).usage).toEqual({ output_tokens: 8 });
    } finally {
      await cleanup();
      await upstream.stop();
    }
  });

  test("MAX_TOKENS stop reason -> stop_reason 'max_tokens' in message_delta", async () => {
    const upstream = startUpstream({
      chatBody: () => framesBody([dataFrame({ text: "cut", stopReason: 3 })]),
    });
    const { url, cleanup } = await startGateway(upstream.url.origin);
    try {
      const res = await fetch(`${url}/v1/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "m",
          max_tokens: 100,
          stream: true,
          messages: [{ role: "user", content: "hi" }],
        }),
      });
      const events = parseSse(await res.text());
      const messageDelta = events.find((e) => e.event === "message_delta");
      expect(JSON.parse(messageDelta!.data).delta.stop_reason).toBe("max_tokens");
    } finally {
      await cleanup();
      await upstream.stop();
    }
  });

  test("text then tool_use: text block closed before tool_use block starts", async () => {
    const upstream = startUpstream({
      chatBody: () =>
        framesBody([
          dataFrame({ text: "calling" }),
          dataFrame({ toolCalls: [{ id: "t1", name: "do", argumentsJson: "{}" }] }),
        ]),
    });
    const { url, cleanup } = await startGateway(upstream.url.origin);
    try {
      const res = await fetch(`${url}/v1/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "m",
          max_tokens: 100,
          stream: true,
          messages: [{ role: "user", content: "go" }],
        }),
      });
      const events = parseSse(await res.text());
      const blockStarts = events
        .filter((e) => e.event === "content_block_start")
        .map((e) => JSON.parse(e.data).content_block.type);
      expect(blockStarts).toEqual(["text", "tool_use"]);
      // one content_block_stop per block (text + tool_use)
      expect(events.filter((e) => e.event === "content_block_stop").length).toBe(2);
    } finally {
      await cleanup();
      await upstream.stop();
    }
  });

  test("streamChat error event -> 'error' SSE event with api_error type", async () => {
    const upstream = startUpstream({
      chatBody: () =>
        framesBody([dataFrame({ text: "hi" })], { error: { code: "internal", message: "boom" } }),
    });
    const { url, cleanup } = await startGateway(upstream.url.origin);
    try {
      const res = await fetch(`${url}/v1/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "m",
          max_tokens: 100,
          stream: true,
          messages: [{ role: "user", content: "hi" }],
        }),
      });
      const events = parseSse(await res.text());
      const errEvent = events.find((e) => e.event === "error");
      expect(errEvent).toBeDefined();
      expect(JSON.parse(errEvent!.data).error.type).toBe("api_error");
      expect(JSON.parse(errEvent!.data).error.message).toContain("boom");
    } finally {
      await cleanup();
      await upstream.stop();
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Edge cases: tool_call argument accumulation & multi-frame tool calls
// ═════════════════════════════════════════════════════════════════════════════

describe("tool_call argument accumulation across events", () => {
  test("OpenAI non-streaming: same id across two toolcall events -> arguments replaced by the last", async () => {
    const upstream = startUpstream({
      chatBody: () =>
        framesBody([
          dataFrame({ toolCalls: [{ id: "c1", name: "do", argumentsJson: '{"x":1}' }] }),
          dataFrame({ toolCalls: [{ id: "c1", name: "do", argumentsJson: '{"x":2}' }] }),
        ]),
    });
    const { url, cleanup } = await startGateway(upstream.url.origin);
    try {
      const res = await fetch(`${url}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: chatBody([{ role: "user", content: "go" }]),
      });
      const body = await res.json();
      // one tool_call entry, arguments replaced (not duplicated)
      expect(body.choices[0].message.tool_calls).toEqual([
        { id: "c1", type: "function", function: { name: "do", arguments: '{"x":2}' } },
      ]);
    } finally {
      await cleanup();
      await upstream.stop();
    }
  });

  test("OpenAI non-streaming: multiple distinct tool_calls in one frame", async () => {
    const upstream = startUpstream({
      chatBody: () =>
        framesBody([
          dataFrame({
            toolCalls: [
              { id: "c1", name: "a", argumentsJson: '{"i":1}' },
              { id: "c2", name: "b", argumentsJson: '{"i":2}' },
            ],
          }),
        ]),
    });
    const { url, cleanup } = await startGateway(upstream.url.origin);
    try {
      const res = await fetch(`${url}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: chatBody([{ role: "user", content: "go" }]),
      });
      const body = await res.json();
      expect(body.choices[0].message.tool_calls).toEqual([
        { id: "c1", type: "function", function: { name: "a", arguments: '{"i":1}' } },
        { id: "c2", type: "function", function: { name: "b", arguments: '{"i":2}' } },
      ]);
    } finally {
      await cleanup();
      await upstream.stop();
    }
  });

  test("Anthropic non-streaming: same id across two toolcall events -> input replaced by the last", async () => {
    const upstream = startUpstream({
      chatBody: () =>
        framesBody([
          dataFrame({ toolCalls: [{ id: "tu1", name: "do", argumentsJson: '{"x":1}' }] }),
          dataFrame({ toolCalls: [{ id: "tu1", name: "do", argumentsJson: '{"x":2}' }] }),
        ]),
    });
    const { url, cleanup } = await startGateway(upstream.url.origin);
    try {
      const res = await fetch(`${url}/v1/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "m", max_tokens: 100, messages: [{ role: "user", content: "go" }] }),
      });
      const body = await res.json();
      expect(body.content).toEqual([
        { type: "tool_use", id: "tu1", name: "do", input: { x: 2 } },
      ]);
    } finally {
      await cleanup();
      await upstream.stop();
    }
  });

  test("Anthropic streaming: multiple tool_use blocks across frames increment contentIndex", async () => {
    const upstream = startUpstream({
      chatBody: () =>
        framesBody([
          dataFrame({ toolCalls: [{ id: "tu1", name: "a", argumentsJson: '{"i":1}' }] }),
          dataFrame({ toolCalls: [{ id: "tu2", name: "b", argumentsJson: '{"i":2}' }] }),
        ]),
    });
    const { url, cleanup } = await startGateway(upstream.url.origin);
    try {
      const res = await fetch(`${url}/v1/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "m",
          max_tokens: 100,
          stream: true,
          messages: [{ role: "user", content: "go" }],
        }),
      });
      const events = parseSse(await res.text());
      const blockStarts = events
        .filter((e) => e.event === "content_block_start")
        .map((e) => ({ index: JSON.parse(e.data).index, type: JSON.parse(e.data).content_block.type, id: JSON.parse(e.data).content_block.id }));
      expect(blockStarts).toEqual([
        { index: 0, type: "tool_use", id: "tu1" },
        { index: 1, type: "tool_use", id: "tu2" },
      ]);
      // two stops, one per block
      expect(events.filter((e) => e.event === "content_block_stop").length).toBe(2);
    } finally {
      await cleanup();
      await upstream.stop();
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Payload structure assertions for the streaming "start" events
// ═════════════════════════════════════════════════════════════════════════════

describe("streaming start-event payload structure", () => {
  test("Anthropic message_start carries id/type/role/model/empty content/null stop_reason/zero usage", async () => {
    const upstream = startUpstream({
      chatBody: () => framesBody([dataFrame({ text: "hi" })]),
    });
    const { url, cleanup } = await startGateway(upstream.url.origin);
    try {
      const res = await fetch(`${url}/v1/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "m",
          max_tokens: 100,
          stream: true,
          messages: [{ role: "user", content: "hi" }],
        }),
      });
      const events = parseSse(await res.text());
      const start = JSON.parse(events[0].data);
      expect(start.type).toBe("message_start");
      expect(start.message).toEqual({
        id: expect.any(String),
        type: "message",
        role: "assistant",
        model: "m",
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      });
    } finally {
      await cleanup();
      await upstream.stop();
    }
  });

  test("OpenAI Responses response.created carries id/object/created_at/model/status=in_progress", async () => {
    const upstream = startUpstream({
      chatBody: () => framesBody([dataFrame({ text: "hi" })]),
    });
    const { url, cleanup } = await startGateway(upstream.url.origin);
    try {
      const res = await fetch(`${url}/v1/responses`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "m", stream: true, input: "hi" }),
      });
      const events = parseSse(await res.text());
      const created = JSON.parse(events[0].data);
      expect(created.type).toBe("response.created");
      expect(created.response).toEqual({
        id: expect.any(String),
        object: "response",
        created_at: expect.any(Number),
        model: "m",
        status: "in_progress",
      });
    } finally {
      await cleanup();
      await upstream.stop();
    }
  });

  test("OpenAI Responses non-streaming output[0] is a completed assistant message item with output_text content", async () => {
    const upstream = startUpstream({
      chatBody: () => framesBody([dataFrame({ text: "hi", usage: { inputTokens: 1, outputTokens: 1 } })]),
    });
    const { url, cleanup } = await startGateway(upstream.url.origin);
    try {
      const res = await fetch(`${url}/v1/responses`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "m", input: "hi" }),
      });
      const body = await res.json();
      expect(body.object).toBe("response");
      expect(body.output[0]).toEqual({
        type: "message",
        id: expect.stringMatching(/^msg_[0-9a-f]{24}$/),
        status: "completed",
        role: "assistant",
        content: [{ type: "output_text", text: "hi" }],
      });
    } finally {
      await cleanup();
      await upstream.stop();
    }
  });
});
