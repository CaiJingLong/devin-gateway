import { expect, test, describe } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { ProtoDecoder } from "../src/proto.ts";

// ─── Token-file isolation ────────────────────────────────────────────────────
// config.ts computes TOKEN_FILE from DEVIN_GATEWAY_CONFIG_DIR at module-load
// time. A static `import { chat }` would hoist above any top-level env mutation,
// binding TOKEN_FILE to the user's real ~/.devin-gateway/token — so the
// no-token test could read a real token and refuse to throw. Dynamic import is
// the only way to set the env first; this is a genuine module-loading boundary.
const TMP_CONFIG_DIR = mkdtempSync(join(tmpdir(), "devin-client-test-"));
process.env.DEVIN_GATEWAY_CONFIG_DIR = TMP_CONFIG_DIR;
delete process.env.DEVIN_API_KEY;

const { chat } = await import("../src/client.ts");

// ─── Byte-construction helpers (raw protobuf wire format) ───────────────────

function encodeVarint(value: number | bigint): number[] {
  const bytes: number[] = [];
  let n = BigInt(value);
  do {
    let byte = Number(n & 0x7fn);
    n >>= 7n;
    if (n !== 0n) byte |= 0x80;
    bytes.push(byte);
  } while (n !== 0n);
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

// ChatToolCall: field1=id, field2=name, field3=argumentsJson
function encodeChatToolCallBytes(tc: {
  id: string;
  name: string;
  argumentsJson: string;
}): number[] {
  return [
    ...encodeString(1, tc.id),
    ...encodeString(2, tc.name),
    ...encodeString(3, tc.argumentsJson),
  ];
}

// ModelUsageStats: field2=inputTokens, field3=outputTokens,
// field4=cacheWriteTokens, field5=cacheReadTokens
function encodeModelUsageStatsBytes(s: {
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
}): number[] {
  return [
    ...encodeUint32(2, s.inputTokens),
    ...encodeUint32(3, s.outputTokens),
    ...encodeUint32(4, s.cacheWriteTokens),
    ...encodeUint32(5, s.cacheReadTokens),
  ];
}

// GetChatMessageResponse: field3=deltaText, field5=stopReason,
// field6=deltaToolCalls(repeated msg), field7=usage(msg), field9=deltaThinking
function encodeGetChatMessageResponseBytes(opts: {
  deltaText?: string;
  deltaThinking?: string;
  stopReason?: number;
  toolCalls?: { id: string; name: string; argumentsJson: string }[];
  usage?: { inputTokens: number; outputTokens: number; cacheWriteTokens: number; cacheReadTokens: number };
}): number[] {
  const bytes: number[] = [];
  if (opts.deltaText) bytes.push(...encodeString(3, opts.deltaText));
  if (opts.stopReason) bytes.push(...encodeUint32(5, opts.stopReason));
  for (const tc of opts.toolCalls ?? []) {
    bytes.push(...encodeMessage(6, encodeChatToolCallBytes(tc)));
  }
  if (opts.usage) bytes.push(...encodeMessage(7, encodeModelUsageStatsBytes(opts.usage)));
  if (opts.deltaThinking) bytes.push(...encodeString(9, opts.deltaThinking));
  return bytes;
}

const FLAG_NORMAL = 0x00;
const FLAG_END_STREAM = 0x02;

function connectFrame(flag: number, payload: Uint8Array | number[]): Buffer {
  const p = payload instanceof Uint8Array ? payload : Uint8Array.from(payload);
  const header = Buffer.alloc(5);
  header[0] = flag;
  header.writeUInt32BE(p.length, 1);
  return Buffer.concat([header, Buffer.from(p)]);
}

function dataFrame(opts: Parameters<typeof encodeGetChatMessageResponseBytes>[0]): Buffer {
  return connectFrame(FLAG_NORMAL, encodeGetChatMessageResponseBytes(opts));
}

function errorTrailer(code: string, message: string): Buffer {
  return connectFrame(
    FLAG_END_STREAM,
    new TextEncoder().encode(JSON.stringify({ error: { code, message } })),
  );
}

// ─── Mock upstream ───────────────────────────────────────────────────────────

const AUTH_PATH = "/exa.auth_pb.AuthService/GetUserJwt";
const CHAT_PATH = "/exa.api_server_pb.ApiServerService/GetChatMessage";
// GetUserJwtResponse: field1=userJwt
const AUTH_RESPONSE = Uint8Array.from(encodeString(1, "client-test-jwt"));

interface UpstreamHandle {
  server: { stop: () => Promise<unknown>; url: URL };
  /** Raw GetUserJwt request body (uncompressed proto). */
  authBody: () => Uint8Array;
  /** Raw GetChatMessage request body (Connect frame: 5-byte header + gzip). */
  chatBody: () => Uint8Array;
}

/**
 * Start a mock Devin upstream. `chatFrames` is the Connect-frame stream served
 * on the chat path. The auth path always returns a valid user JWT.
 */
function mockUpstream(chatFrames: Buffer[]): UpstreamHandle {
  let authBody = new Uint8Array();
  let chatBody = new Uint8Array();
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (req) => {
      const path = new URL(req.url).pathname;
      const body = new Uint8Array(await req.arrayBuffer());
      if (path === AUTH_PATH) {
        authBody = body;
        return new Response(AUTH_RESPONSE, {
          headers: { "content-type": "application/proto" },
        });
      }
      if (path === CHAT_PATH) {
        chatBody = body;
        return new Response(Buffer.concat(chatFrames), {
          headers: { "content-type": "application/connect+proto" },
        });
      }
      return new Response("not found", { status: 404 });
    },
  });
  return { server, authBody: () => authBody, chatBody: () => chatBody };
}

/** Decode the apiKey (metadata field 3) from a GetUserJwtRequest body. */
function extractApiKeyFromAuthRequest(body: Uint8Array): string {
  const dec = new ProtoDecoder(body);
  const { field, wire } = dec.readTag();
  expect(field).toBe(1);
  expect(wire).toBe(2);
  return dec.readMessage((d) => {
    let apiKey = "";
    while (!d.done) {
      const t = d.readTag();
      if (t.field === 3 && t.wire === 2) apiKey = d.readString();
      else d.skip(t.wire);
    }
    return apiKey;
  });
}

/** Decompress the GetChatMessage Connect-frame request body to raw proto. */
function decodeChatRequestBody(body: Uint8Array): Uint8Array {
  // Body = [flag:1][len:4 BE][gzip(payload)]; streamChat always compresses.
  expect(body[0]).toBe(0x01);
  return gunzipSync(body.subarray(5));
}

const BASE_MESSAGES = [{ role: "user", content: "hi" }] as const;

// ─── chat() aggregation ──────────────────────────────────────────────────────

describe("chat() aggregation", () => {
  test("concatenates text deltas and reports a stop finish reason", async () => {
    const upstream = mockUpstream([
      dataFrame({ deltaText: "hel" }),
      dataFrame({ deltaText: "lo" }),
    ]);
    try {
      const result = await chat({
        token: "agg-token",
        model: "model-uid",
        messages: [...BASE_MESSAGES],
        baseUrl: upstream.server.url.origin,
      });
      expect(result.text).toBe("hello");
      expect(result.thinking).toBe("");
      expect(result.toolCalls).toEqual([]);
      expect(result.stopReason).toBe(0);
      expect(result.finishReason).toBe("stop");
      expect(result.usage).toBeUndefined();
    } finally {
      await upstream.server.stop();
    }
  });

  test("accumulates thinking deltas separately from text", async () => {
    const upstream = mockUpstream([
      dataFrame({ deltaThinking: "reasoning" }),
      dataFrame({ deltaText: "answer" }),
    ]);
    try {
      const result = await chat({
        token: "agg-token",
        model: "model-uid",
        messages: [...BASE_MESSAGES],
        baseUrl: upstream.server.url.origin,
      });
      expect(result.thinking).toBe("reasoning");
      expect(result.text).toBe("answer");
    } finally {
      await upstream.server.stop();
    }
  });

  test("collects a tool call and maps finish reason to tool_calls", async () => {
    const upstream = mockUpstream([
      dataFrame({
        toolCalls: [{ id: "call_1", name: "get_weather", argumentsJson: '{"city":"SF"}' }],
      }),
    ]);
    try {
      const result = await chat({
        token: "agg-token",
        model: "model-uid",
        messages: [...BASE_MESSAGES],
        baseUrl: upstream.server.url.origin,
      });
      expect(result.toolCalls).toEqual([
        { id: "call_1", name: "get_weather", arguments: '{"city":"SF"}' },
      ]);
      expect(result.finishReason).toBe("tool_calls");
    } finally {
      await upstream.server.stop();
    }
  });

  test("overwrites arguments when a second toolcall frame shares the same id", async () => {
    // chat() uses `existing.arguments = tc.argumentsJson` (overwrite, not
    // concatenation). A second frame with the same id replaces the arguments
    // rather than appending to them.
    const upstream = mockUpstream([
      dataFrame({
        toolCalls: [{ id: "call_1", name: "get_weather", argumentsJson: '{"a":' }],
      }),
      dataFrame({
        toolCalls: [{ id: "call_1", name: "get_weather", argumentsJson: "1}" }],
      }),
    ]);
    try {
      const result = await chat({
        token: "agg-token",
        model: "model-uid",
        messages: [...BASE_MESSAGES],
        baseUrl: upstream.server.url.origin,
      });
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].id).toBe("call_1");
      // Second frame's argumentsJson wins (overwrite semantics).
      expect(result.toolCalls[0].arguments).toBe("1}");
    } finally {
      await upstream.server.stop();
    }
  });

  test("surfaces usage stats from a usage frame", async () => {
    const upstream = mockUpstream([
      dataFrame({
        usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 2, cacheWriteTokens: 3 },
      }),
      dataFrame({ deltaText: "ok" }),
    ]);
    try {
      const result = await chat({
        token: "agg-token",
        model: "model-uid",
        messages: [...BASE_MESSAGES],
        baseUrl: upstream.server.url.origin,
      });
      expect(result.usage).toEqual({
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 2,
        cacheWriteTokens: 3,
      });
    } finally {
      await upstream.server.stop();
    }
  });

  test("maps MAX_TOKENS stop reason to length finish reason", async () => {
    const upstream = mockUpstream([
      dataFrame({ deltaText: "cut off" }),
      dataFrame({ stopReason: 3 }), // StopReason.MAX_TOKENS
    ]);
    try {
      const result = await chat({
        token: "agg-token",
        model: "model-uid",
        messages: [...BASE_MESSAGES],
        baseUrl: upstream.server.url.origin,
      });
      expect(result.stopReason).toBe(3);
      expect(result.finishReason).toBe("length");
    } finally {
      await upstream.server.stop();
    }
  });

  test("throws when the upstream stream emits a Connect error trailer", async () => {
    const upstream = mockUpstream([
      dataFrame({ deltaText: "partial" }),
      errorTrailer("internal", "upstream boom"),
    ]);
    try {
      await expect(
        chat({
          token: "agg-token",
          model: "model-uid",
          messages: [...BASE_MESSAGES],
          baseUrl: upstream.server.url.origin,
        }),
      ).rejects.toThrow(/Devin stream error internal: upstream boom/);
    } finally {
      await upstream.server.stop();
    }
  });
});

// ─── Token resolution ────────────────────────────────────────────────────────

describe("chat() token resolution", () => {
  test("uses options.token and forwards it (normalized) to the auth upstream", async () => {
    const upstream = mockUpstream([dataFrame({ deltaText: "ok" })]);
    try {
      const result = await chat({
        token: "my-explicit-token",
        model: "model-uid",
        messages: [...BASE_MESSAGES],
        baseUrl: upstream.server.url.origin,
      });
      expect(result.text).toBe("ok");
      // The auth request body carries the normalized apiKey (with prefix).
      expect(extractApiKeyFromAuthRequest(upstream.authBody())).toBe(
        "devin-session-token$my-explicit-token",
      );
    } finally {
      await upstream.server.stop();
    }
  });

  test("falls back to DEVIN_API_KEY env when no options.token is given", async () => {
    const previous = process.env.DEVIN_API_KEY;
    process.env.DEVIN_API_KEY = "env-token-xyz";
    const upstream = mockUpstream([dataFrame({ deltaText: "ok" })]);
    try {
      const result = await chat({
        model: "model-uid",
        messages: [...BASE_MESSAGES],
        baseUrl: upstream.server.url.origin,
      });
      expect(result.text).toBe("ok");
      expect(extractApiKeyFromAuthRequest(upstream.authBody())).toBe(
        "devin-session-token$env-token-xyz",
      );
    } finally {
      await upstream.server.stop();
      if (previous === undefined) delete process.env.DEVIN_API_KEY;
      else process.env.DEVIN_API_KEY = previous;
    }
  });

  test("throws No Devin token when no token, no env, and an empty token file", async () => {
    const previous = process.env.DEVIN_API_KEY;
    delete process.env.DEVIN_API_KEY;
    try {
      // TMP_CONFIG_DIR has no `token` file, so readToken() resolves to "".
      await expect(
        chat({
          model: "model-uid",
          messages: [...BASE_MESSAGES],
          baseUrl: "http://127.0.0.1:1", // never reached
        }),
      ).rejects.toThrow(/No Devin token: pass `token`, set DEVIN_API_KEY, or run `bun run login`/);
    } finally {
      if (previous === undefined) delete process.env.DEVIN_API_KEY;
      else process.env.DEVIN_API_KEY = previous;
    }
  });
});

// ─── Parameter mapping (request body observables) ───────────────────────────

describe("chat() parameter mapping", () => {
  test("forwards cascadeId verbatim into the chat request body", async () => {
    const cascadeId = "11111111-2222-3333-4444-555555555555";
    const upstream = mockUpstream([dataFrame({ deltaText: "ok" })]);
    try {
      await chat({
        token: "agg-token",
        model: "model-uid",
        messages: [...BASE_MESSAGES],
        cascadeId,
        baseUrl: upstream.server.url.origin,
      });
      const reqProto = decodeChatRequestBody(upstream.chatBody());
      expect(Buffer.from(reqProto).includes(Buffer.from(cascadeId, "utf8"))).toBe(true);
    } finally {
      await upstream.server.stop();
    }
  });

  test("wraps a string stop into stopSequences in the chat request body", async () => {
    const upstream = mockUpstream([dataFrame({ deltaText: "ok" })]);
    try {
      await chat({
        token: "agg-token",
        model: "model-uid",
        messages: [...BASE_MESSAGES],
        stop: "STOP_HERE",
        baseUrl: upstream.server.url.origin,
      });
      const reqProto = decodeChatRequestBody(upstream.chatBody());
      expect(Buffer.from(reqProto).includes(Buffer.from("STOP_HERE", "utf8"))).toBe(true);
    } finally {
      await upstream.server.stop();
    }
  });

  test("forwards tool function names into the chat request body", async () => {
    const upstream = mockUpstream([dataFrame({ deltaText: "ok" })]);
    try {
      await chat({
        token: "agg-token",
        model: "model-uid",
        messages: [...BASE_MESSAGES],
        tools: [
          {
            type: "function",
            function: {
              name: "get_weather",
              description: "Get the weather",
              parameters: { type: "object", properties: { city: { type: "string" } } },
            },
          },
        ],
        baseUrl: upstream.server.url.origin,
      });
      const reqProto = decodeChatRequestBody(upstream.chatBody());
      expect(Buffer.from(reqProto).includes(Buffer.from("get_weather", "utf8"))).toBe(true);
    } finally {
      await upstream.server.stop();
    }
  });
});
