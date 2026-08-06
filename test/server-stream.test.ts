import { expect, test, describe } from "bun:test";

import { startServer } from "../src/server.ts";

const HOST = "127.0.0.1";
const DEVIN_AUTH_PATH = "/exa.auth_pb.AuthService/GetUserJwt";
const CHAT_MESSAGE_PATH = "/exa.api_server_pb.ApiServerService/GetChatMessage";
const CLI_MODEL_CONFIGS_PATH = "/exa.api_server_pb.ApiServerService/GetCliModelConfigs";

// ─── protobuf encoders (mirror test/server.test.ts) ─────────────────────────

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

interface ChatResponseFields {
  text?: string;
  thinking?: string;
  toolCalls?: ToolCallFields[];
  stopReason?: number;
  usage?: { inputTokens: number; outputTokens: number; cacheWriteTokens?: number; cacheReadTokens?: number };
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
    bytes.push(
      ...encodeMessage(7, [
        ...encodeUint32(2, fields.usage.inputTokens),
        ...encodeUint32(3, fields.usage.outputTokens),
        ...(fields.usage.cacheWriteTokens ? encodeUint32(4, fields.usage.cacheWriteTokens) : []),
        ...(fields.usage.cacheReadTokens ? encodeUint32(5, fields.usage.cacheReadTokens) : []),
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
  /** Return a non-ok status for GetCliModelConfigs (model discovery). */
  modelsStatus?: number;
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
        const payload = Uint8Array.from([...encodeString(1, "jwt")]);
        return new Response(payload, { headers: { "content-type": "application/proto" } });
      }
      if (url.pathname === CHAT_MESSAGE_PATH) {
        const body = opts.chatBody ? opts.chatBody() : framesBody([dataFrame({ text: "hi" })]);
        return new Response(body, { headers: { "content-type": "application/connect+proto" } });
      }
      if (url.pathname === CLI_MODEL_CONFIGS_PATH) {
        if (opts.modelsStatus) {
          return new Response("upstream down", { status: opts.modelsStatus });
        }
        return new Response(new Uint8Array(0), { headers: { "content-type": "application/proto" } });
      }
      return new Response("not found", { status: 404 });
    },
  });
  return { url: server.url, stop: () => server.stop() };
}

// ─── Gateway harness with SIGTERM/SIGINT listener cleanup ────────────────────

async function reservePort(): Promise<number> {
  const probe = Bun.serve({ hostname: HOST, port: 0, fetch: () => new Response(null) });
  const port = probe.port;
  await probe.stop();
  return port;
}

const SIGNALS = ["SIGINT", "SIGTERM"] as const;

interface Gateway {
  url: string;
  cleanup: () => Promise<void>;
}

async function startGateway(upstreamUrl: string, token?: string): Promise<Gateway> {
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

// ─── SSE parsing helpers ─────────────────────────────────────────────────────

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

// ─── tests ───────────────────────────────────────────────────────────────────

describe("streamOpenAIChat tool_calls branch", () => {
  test("emits tool_calls delta chunk and finish_reason=tool_calls", async () => {
    const upstream = startUpstream({
      chatBody: () =>
        framesBody([
          dataFrame({
            toolCalls: [{ id: "call_1", name: "get_weather", argumentsJson: '{"city":"SF"}' }],
            stopReason: 10,
          }),
        ]),
    });
    const { url, cleanup } = await startGateway(upstream.url.origin, "x");
    try {
      const res = await fetch(`${url}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "m",
          stream: true,
          messages: [{ role: "user", content: "weather?" }],
        }),
      });
      expect(res.status).toBe(200);
      const events = parseSse(await res.text());
      const datas = events.map((e) => e.data);

      expect(datas[datas.length - 1]).toBe("[DONE]");

      const toolChunk = events
        .map((e) => {
          try {
            return JSON.parse(e.data);
          } catch {
            return null;
          }
        })
        .find((o) => o?.choices?.[0]?.delta?.tool_calls);
      expect(toolChunk).toBeDefined();
      const tc = toolChunk.choices[0].delta.tool_calls[0];
      expect(tc.id).toBe("call_1");
      expect(tc.type).toBe("function");
      expect(tc.function.name).toBe("get_weather");
      expect(tc.function.arguments).toBe('{"city":"SF"}');

      const penultimate = JSON.parse(datas[datas.length - 2]);
      expect(penultimate.choices[0].finish_reason).toBe("tool_calls");
    } finally {
      await cleanup();
      await upstream.stop();
    }
  });
});

describe("streamOpenAIChat thinking/reasoning forwarding", () => {
  test("forwards thinking chunks as reasoning_content and still emits [DONE]", async () => {
    const upstream = startUpstream({
      chatBody: () =>
        framesBody([
          dataFrame({ thinking: "reasoning part 1" }),
          dataFrame({ thinking: "reasoning part 2" }),
          dataFrame({ text: "answer" }),
          dataFrame({ stopReason: 1 }),
        ]),
    });
    const { url, cleanup } = await startGateway(upstream.url.origin, "x");
    try {
      const res = await fetch(`${url}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "m",
          stream: true,
          messages: [{ role: "user", content: "hi" }],
        }),
      });
      expect(res.status).toBe(200);
      const events = parseSse(await res.text());
      const datas = events.map((e) => e.data);

      // Final marker present
      expect(datas[datas.length - 1]).toBe("[DONE]");

      const parsed = datas
        .filter((d) => d !== "[DONE]")
        .map((d) => JSON.parse(d));

      // Reasoning chunks forwarded as reasoning_content deltas
      const reasoning = parsed
        .filter((o) => o?.choices?.[0]?.delta?.reasoning_content)
        .map((o) => o.choices[0].delta.reasoning_content);
      expect(reasoning).toEqual(["reasoning part 1", "reasoning part 2"]);

      // Text content forwarded
      const content = parsed
        .filter((o) => o?.choices?.[0]?.delta?.content)
        .map((o) => o.choices[0].delta.content);
      expect(content).toEqual(["answer"]);

      // No chunk carries both reasoning_content and content (kept separate)
      for (const o of parsed) {
        const delta = o?.choices?.[0]?.delta ?? {};
        expect(!(delta.reasoning_content && delta.content)).toBe(true);
      }
    } finally {
      await cleanup();
      await upstream.stop();
    }
  });
});

describe("streamOpenAIChat include_usage", () => {
  test("emits a final chunk with usage + prompt_tokens_details.cached_tokens", async () => {
    const upstream = startUpstream({
      chatBody: () =>
        framesBody([
          dataFrame({ text: "hi", usage: { inputTokens: 10, outputTokens: 5, cacheWriteTokens: 2, cacheReadTokens: 4 } }),
        ]),
    });
    const { url, cleanup } = await startGateway(upstream.url.origin, "x");
    try {
      const res = await fetch(`${url}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "m",
          stream: true,
          stream_options: { include_usage: true },
          messages: [{ role: "user", content: "hi" }],
        }),
      });
      expect(res.status).toBe(200);
      const events = parseSse(await res.text());
      const datas = events.map((e) => e.data);
      expect(datas[datas.length - 1]).toBe("[DONE]");

      const parsed = datas
        .filter((d) => d !== "[DONE]")
        .map((d) => JSON.parse(d));

      // The usage chunk has empty choices and carries usage
      const usageChunk = parsed.find((o) => o.usage && o.choices.length === 0);
      expect(usageChunk).toBeDefined();
      expect(usageChunk!.usage.prompt_tokens).toBe(10);
      expect(usageChunk!.usage.completion_tokens).toBe(5);
      expect(usageChunk!.usage.prompt_tokens_details.cached_tokens).toBe(4);
    } finally {
      await cleanup();
      await upstream.stop();
    }
  });

  test("omits usage chunk when stream_options.include_usage is not set", async () => {
    const upstream = startUpstream();
    const { url, cleanup } = await startGateway(upstream.url.origin, "x");
    try {
      const res = await fetch(`${url}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "m",
          stream: true,
          messages: [{ role: "user", content: "hi" }],
        }),
      });
      expect(res.status).toBe(200);
      const events = parseSse(await res.text());
      const datas = events.map((e) => e.data);
      const parsed = datas
        .filter((d) => d !== "[DONE]")
        .map((d) => JSON.parse(d));
      const usageChunk = parsed.find((o) => o.usage);
      expect(usageChunk).toBeUndefined();
    } finally {
      await cleanup();
      await upstream.stop();
    }
  });
});

describe("streamOpenAIChat error event", () => {
  test("surfaces a Connect trailer error as an SSE error data chunk", async () => {
    const upstream = startUpstream({
      chatBody: () =>
        framesBody([dataFrame({ text: "hi" })], {
          error: { code: "internal", message: "boom" },
        }),
    });
    const { url, cleanup } = await startGateway(upstream.url.origin, "x");
    try {
      const res = await fetch(`${url}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "m",
          stream: true,
          messages: [{ role: "user", content: "hi" }],
        }),
      });
      expect(res.status).toBe(200);
      const events = parseSse(await res.text());
      const errChunk = events
        .map((e) => {
          try {
            return JSON.parse(e.data);
          } catch {
            return null;
          }
        })
        .find((o) => o?.error);
      expect(errChunk).toBeDefined();
      expect(errChunk.error.type).toBe("api_error");
      expect(errChunk.error.message).toContain("boom");
    } finally {
      await cleanup();
      await upstream.stop();
    }
  });
});

describe("streamOpenAIResponses full event sequence", () => {
  test("emits created → output_item.added → content_part.added → text deltas → done → completed", async () => {
    const upstream = startUpstream({
      chatBody: () => framesBody([dataFrame({ text: "hel" }), dataFrame({ text: "lo" })]),
    });
    const { url, cleanup } = await startGateway(upstream.url.origin, "x");
    try {
      const res = await fetch(`${url}/v1/responses`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "m", stream: true, input: "hi" }),
      });
      expect(res.status).toBe(200);
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

      // each delta carries the right text
      const deltas = events
        .filter((e) => e.event === "response.output_text.delta")
        .map((e) => JSON.parse(e.data).delta);
      expect(deltas).toEqual(["hel", "lo"]);

      // content_part.done carries the full accumulated text
      const done = JSON.parse(
        events.find((e) => e.event === "response.content_part.done")!.data,
      );
      expect(done.part.text).toBe("hello");

      // completed event has status completed
      const completed = JSON.parse(
        events.find((e) => e.event === "response.completed")!.data,
      );
      expect(completed.response.status).toBe("completed");
    } finally {
      await cleanup();
      await upstream.stop();
    }
  });
});

describe("streamOpenAIResponses error event", () => {
  test("emits response.failed when the upstream sends a Connect error trailer", async () => {
    const upstream = startUpstream({
      chatBody: () =>
        framesBody([dataFrame({ text: "hi" })], {
          error: { code: "internal", message: "boom" },
        }),
    });
    const { url, cleanup } = await startGateway(upstream.url.origin, "x");
    try {
      const res = await fetch(`${url}/v1/responses`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "m", stream: true, input: "hi" }),
      });
      expect(res.status).toBe(200);
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

describe("streamAnthropic tool_use branch", () => {
  test("emits content_block_start(tool_use) + input_json_delta + content_block_stop, tool_use stop_reason", async () => {
    const upstream = startUpstream({
      chatBody: () =>
        framesBody([
          dataFrame({
            toolCalls: [{ id: "toolu_1", name: "get_weather", argumentsJson: '{"city":"SF"}' }],
            stopReason: 10,
          }),
        ]),
    });
    const { url, cleanup } = await startGateway(upstream.url.origin, "x");
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
      expect(res.status).toBe(200);
      const events = parseSse(await res.text());

      const blockStart = events.find((e) => e.event === "content_block_start");
      expect(blockStart).toBeDefined();
      const startBlock = JSON.parse(blockStart!.data).content_block;
      expect(startBlock.type).toBe("tool_use");
      expect(startBlock.id).toBe("toolu_1");
      expect(startBlock.name).toBe("get_weather");
      expect(startBlock.input).toEqual({});

      const jsonDelta = events
        .filter((e) => e.event === "content_block_delta")
        .map((e) => JSON.parse(e.data).delta)
        .find((d) => d.type === "input_json_delta");
      expect(jsonDelta).toBeDefined();
      expect(jsonDelta.partial_json).toBe('{"city":"SF"}');

      expect(events.some((e) => e.event === "content_block_stop")).toBe(true);

      const messageDelta = events.find((e) => e.event === "message_delta");
      expect(messageDelta).toBeDefined();
      expect(JSON.parse(messageDelta!.data).delta.stop_reason).toBe("tool_use");
    } finally {
      await cleanup();
      await upstream.stop();
    }
  });
});

describe("handleModels remote 502", () => {
  test("maps an upstream model-discovery failure to 502 with Model discovery failed", async () => {
    const upstream = startUpstream({ modelsStatus: 500 });
    const { url, cleanup } = await startGateway(upstream.url.origin, "x");
    try {
      const res = await fetch(`${url}/v1/models`, {
        headers: { authorization: "Bearer x" },
      });
      expect(res.status).toBe(502);
      const body = await res.json();
      expect(body.error.message).toContain("Model discovery failed");
    } finally {
      await cleanup();
      await upstream.stop();
    }
  });
});

describe("handleResponses input array with array content", () => {
  test("accepts content as an array of typed parts", async () => {
    const upstream = startUpstream();
    const { url, cleanup } = await startGateway(upstream.url.origin, "x");
    try {
      const res = await fetch(`${url}/v1/responses`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "m",
          input: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.output[0].content[0].text).toBe("hi");
    } finally {
      await cleanup();
      await upstream.stop();
    }
  });
});

describe("handleChatCompletions non-streaming same-id toolcall merge", () => {
  test("two frames with the same tool-call id keep a single entry whose arguments are the last frame's", async () => {
    const upstream = startUpstream({
      chatBody: () =>
        framesBody([
          dataFrame({
            toolCalls: [{ id: "call_1", name: "get_weather", argumentsJson: '{"a":' }],
          }),
          dataFrame({
            toolCalls: [{ id: "call_1", name: "get_weather", argumentsJson: "1}" }],
          }),
        ]),
    });
    const { url, cleanup } = await startGateway(upstream.url.origin, "x");
    try {
      const res = await fetch(`${url}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "m",
          messages: [{ role: "user", content: "weather?" }],
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      const toolCalls = body.choices[0].message.tool_calls;
      expect(toolCalls.length).toBe(1);
      expect(toolCalls[0].id).toBe("call_1");
      expect(toolCalls[0].function.arguments).toBe("1}");
      expect(body.choices[0].finish_reason).toBe("tool_calls");
    } finally {
      await cleanup();
      await upstream.stop();
    }
  });
});

describe("handleAnthropicMessages empty content defaults to a text block", () => {
  test("an upstream frame with no text/thinking/tool yields content=[{type:text,text:''}]", async () => {
    const upstream = startUpstream({
      chatBody: () => framesBody([dataFrame({})]),
    });
    const { url, cleanup } = await startGateway(upstream.url.origin, "x");
    try {
      const res = await fetch(`${url}/v1/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "m",
          max_tokens: 100,
          messages: [{ role: "user", content: "hi" }],
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.content).toEqual([{ type: "text", text: "" }]);
    } finally {
      await cleanup();
      await upstream.stop();
    }
  });
});
