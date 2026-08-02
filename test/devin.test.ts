import { expect, test, describe } from "bun:test";
import { gzipSync } from "node:zlib";

import {
  getUserJwt,
  streamChat,
  discoverModels,
  type ChatStreamEvent,
} from "../src/devin.ts";
import {
  ProtoDecoder,
  decodeGetUserJwtResponse,
} from "../src/proto.ts";

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

// GetUserJwtResponse: field1=userJwt, field2=customApiServerUrl
function encodeGetUserJwtResponseBytes(opts: {
  userJwt: string;
  customApiServerUrl?: string;
}): number[] {
  const bytes = [...encodeString(1, opts.userJwt)];
  if (opts.customApiServerUrl !== undefined) {
    bytes.push(...encodeString(2, opts.customApiServerUrl));
  }
  return bytes;
}

// GetChatMessageResponse fields:
// 1=messageId, 3=deltaText, 5=stopReason, 6=deltaToolCalls(repeated msg),
// 7=usage(msg), 9=deltaThinking, 10=deltaSignature
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

function encodeGetChatMessageResponseBytes(opts: {
  deltaText?: string;
  deltaThinking?: string;
  deltaSignature?: string;
  stopReason?: number;
  toolCalls?: { id: string; name: string; argumentsJson: string }[];
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cacheWriteTokens: number;
    cacheReadTokens: number;
  };
}): number[] {
  const bytes: number[] = [];
  if (opts.deltaText) bytes.push(...encodeString(3, opts.deltaText));
  if (opts.stopReason) bytes.push(...encodeUint32(5, opts.stopReason));
  for (const tc of opts.toolCalls ?? []) {
    bytes.push(...encodeMessage(6, encodeChatToolCallBytes(tc)));
  }
  if (opts.usage) bytes.push(...encodeMessage(7, encodeModelUsageStatsBytes(opts.usage)));
  if (opts.deltaThinking) bytes.push(...encodeString(9, opts.deltaThinking));
  if (opts.deltaSignature) bytes.push(...encodeString(10, opts.deltaSignature));
  return bytes;
}

// ClientModelConfig: field1=label, field4=disabled, field18=configuredMaxTokens, field22=modelUid
function encodeClientModelConfigBytes(config: {
  label: string;
  modelUid: string;
  disabled: boolean;
  maxTokens: number;
}): number[] {
  return [
    ...encodeString(1, config.label),
    ...encodeUint32(4, config.disabled ? 1 : 0),
    ...encodeUint32(18, config.maxTokens),
    ...encodeString(22, config.modelUid),
  ];
}

// ─── Connect frame helpers ───────────────────────────────────────────────────
// 5-byte header: [flag:1, length:4 BE] + payload

function connectFrame(flag: number, payload: Uint8Array | number[]): Buffer {
  const p = payload instanceof Uint8Array ? payload : Uint8Array.from(payload);
  const header = Buffer.alloc(5);
  header[0] = flag;
  header.writeUInt32BE(p.length, 1);
  return Buffer.concat([header, Buffer.from(p)]);
}

const FLAG_NORMAL = 0x00;
const FLAG_COMPRESSED = 0x01;
const FLAG_END_STREAM = 0x02;

// ─── Mock upstream server builders ──────────────────────────────────────────

const AUTH_PATH = "/exa.auth_pb.AuthService/GetUserJwt";
const CHAT_PATH = "/exa.api_server_pb.ApiServerService/GetChatMessage";
const MODELS_PATH = "/exa.api_server_pb.ApiServerService/GetCliModelConfigs";

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

// ─── getUserJwt ──────────────────────────────────────────────────────────────

describe("getUserJwt", () => {
  test("success returns userJwt and baseUrl with trailing slash stripped", async () => {
    const response = Uint8Array.from(
      encodeGetUserJwtResponseBytes({
        userJwt: "jwt-abc",
        customApiServerUrl: "https://custom.example.com/",
      }),
    );
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (req) => {
        expect(req.url.endsWith(AUTH_PATH)).toBe(true);
        return new Response(response, {
          headers: { "content-type": "application/proto" },
        });
      },
    });
    try {
      const result = await getUserJwt("raw-token", server.url.origin);
      expect(result.userJwt).toBe("jwt-abc");
      expect(result.baseUrl).toBe("https://custom.example.com");
    } finally {
      await server.stop();
    }
  });

  test("success without customApiServerUrl omits baseUrl key", async () => {
    const response = Uint8Array.from(
      encodeGetUserJwtResponseBytes({ userJwt: "jwt-only" }),
    );
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => new Response(response, { headers: { "content-type": "application/proto" } }),
    });
    try {
      const result = await getUserJwt("raw-token", server.url.origin);
      expect(result.userJwt).toBe("jwt-only");
      expect("baseUrl" in result).toBe(false);
    } finally {
      await server.stop();
    }
  });

  test("gzip fallback: gunzips payload when raw decode fails", async () => {
    const raw = Uint8Array.from(encodeGetUserJwtResponseBytes({ userJwt: "gz-jwt" }));
    const gz = gzipSync(raw);
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => new Response(gz, { headers: { "content-type": "application/proto" } }),
    });
    try {
      const result = await getUserJwt("raw-token", server.url.origin);
      expect(result.userJwt).toBe("gz-jwt");
    } finally {
      await server.stop();
    }
  });

  test("non-ok response throws Devin auth <status> with body text", async () => {
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => new Response("bad key", { status: 401, statusText: "Unauthorized" }),
    });
    try {
      await expect(getUserJwt("raw-token", server.url.origin)).rejects.toThrow(
        /Devin auth 401.*bad key/,
      );
    } finally {
      await server.stop();
    }
  });

  test("empty userJwt throws Devin auth: empty user JWT", async () => {
    const response = Uint8Array.from(encodeGetUserJwtResponseBytes({ userJwt: "" }));
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => new Response(response, { headers: { "content-type": "application/proto" } }),
    });
    try {
      await expect(getUserJwt("raw-token", server.url.origin)).rejects.toThrow(
        "Devin auth: empty user JWT",
      );
    } finally {
      await server.stop();
    }
  });

  test("apiKey is auto-prefixed with devin-session-token$", async () => {
    const response = Uint8Array.from(
      encodeGetUserJwtResponseBytes({ userJwt: "jwt-pfx" }),
    );
    let capturedApiKey = "";
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: async (req) => {
        const body = new Uint8Array(await req.arrayBuffer());
        capturedApiKey = extractApiKeyFromAuthRequest(body);
        return new Response(response, { headers: { "content-type": "application/proto" } });
      },
    });
    try {
      await getUserJwt("my-bare-token", server.url.origin);
      expect(capturedApiKey).toBe("devin-session-token$my-bare-token");
    } finally {
      await server.stop();
    }
  });

  test("already-prefixed apiKey is not double-prefixed", async () => {
    const response = Uint8Array.from(
      encodeGetUserJwtResponseBytes({ userJwt: "jwt-pfx2" }),
    );
    let capturedApiKey = "";
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: async (req) => {
        const body = new Uint8Array(await req.arrayBuffer());
        capturedApiKey = extractApiKeyFromAuthRequest(body);
        return new Response(response, { headers: { "content-type": "application/proto" } });
      },
    });
    try {
      await getUserJwt("devin-session-token$already", server.url.origin);
      expect(capturedApiKey).toBe("devin-session-token$already");
    } finally {
      await server.stop();
    }
  });
});

// ─── streamChat ──────────────────────────────────────────────────────────────

/**
 * Build a mock upstream that serves a valid GetUserJwt on the auth path and a
 * caller-supplied Connect-frame stream on the chat path.
 */
function mockUpstream(chatFrames: Buffer[], chatStatus: { status: number; statusText: string; body?: string } | null = null) {
  const authResponse = Uint8Array.from(
    encodeGetUserJwtResponseBytes({ userJwt: "stream-jwt" }),
  );
  return Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (req) => {
      const path = new URL(req.url).pathname;
      if (path === AUTH_PATH) {
        return new Response(authResponse, { headers: { "content-type": "application/proto" } });
      }
      if (path === CHAT_PATH) {
        if (chatStatus) {
          return new Response(chatStatus.body ?? "upstream error", {
            status: chatStatus.status,
            statusText: chatStatus.statusText,
          });
        }
        return new Response(Buffer.concat(chatFrames), {
          headers: { "content-type": "application/connect+proto" },
        });
      }
      return new Response("not found", { status: 404 });
    },
  });
}

async function collectStream(params: Parameters<typeof streamChat>[0]): Promise<ChatStreamEvent[]> {
  const events: ChatStreamEvent[] = [];
  for await (const e of streamChat(params)) events.push(e);
  return events;
}

const baseChatParams = (baseUrl: string) => ({
  apiKey: "raw-token",
  modelUid: "model-uid",
  systemPrompt: "system",
  messages: [],
  tools: [],
  baseUrl,
});

describe("streamChat", () => {
  test("single text frame yields a text event then done", async () => {
    const frame = connectFrame(
      FLAG_NORMAL,
      encodeGetChatMessageResponseBytes({ deltaText: "hello" }),
    );
    const server = mockUpstream([frame]);
    try {
      const events = await collectStream(baseChatParams(server.url.origin));
      expect(events.map((e) => e.type)).toEqual(["text", "done"]);
      expect(events[0]).toEqual({ type: "text", deltaText: "hello" });
      expect(events[1]).toEqual({ type: "done", stopReason: 0, usage: null });
    } finally {
      await server.stop();
    }
  });

  test("multiple text frames yield separate text events", async () => {
    const f1 = connectFrame(FLAG_NORMAL, encodeGetChatMessageResponseBytes({ deltaText: "hel" }));
    const f2 = connectFrame(FLAG_NORMAL, encodeGetChatMessageResponseBytes({ deltaText: "lo" }));
    const server = mockUpstream([f1, f2]);
    try {
      const events = await collectStream(baseChatParams(server.url.origin));
      expect(events.map((e) => e.type)).toEqual(["text", "text", "done"]);
      expect(events[0].deltaText).toBe("hel");
      expect(events[1].deltaText).toBe("lo");
    } finally {
      await server.stop();
    }
  });

  test("thinking frame yields thinking event with signature", async () => {
    const frame = connectFrame(
      FLAG_NORMAL,
      encodeGetChatMessageResponseBytes({
        deltaThinking: "pondering",
        deltaSignature: "sig-123",
      }),
    );
    const server = mockUpstream([frame]);
    try {
      const events = await collectStream(baseChatParams(server.url.origin));
      expect(events.map((e) => e.type)).toEqual(["thinking", "done"]);
      expect(events[0]).toEqual({
        type: "thinking",
        deltaThinking: "pondering",
        deltaSignature: "sig-123",
      });
    } finally {
      await server.stop();
    }
  });

  test("toolcall frame yields toolcall event with decoded tool calls", async () => {
    const frame = connectFrame(
      FLAG_NORMAL,
      encodeGetChatMessageResponseBytes({
        toolCalls: [{ id: "call-1", name: "search", argumentsJson: '{"q":"x"}' }],
      }),
    );
    const server = mockUpstream([frame]);
    try {
      const events = await collectStream(baseChatParams(server.url.origin));
      expect(events.map((e) => e.type)).toEqual(["toolcall", "done"]);
      expect(events[0].toolCalls).toEqual([
        { id: "call-1", name: "search", argumentsJson: '{"q":"x"}' },
      ]);
    } finally {
      await server.stop();
    }
  });

  test("usage frame yields usage event and done carries the same usage", async () => {
    const usage = { inputTokens: 10, outputTokens: 20, cacheWriteTokens: 5, cacheReadTokens: 2 };
    const frame = connectFrame(
      FLAG_NORMAL,
      encodeGetChatMessageResponseBytes({ usage }),
    );
    const server = mockUpstream([frame]);
    try {
      const events = await collectStream(baseChatParams(server.url.origin));
      expect(events.map((e) => e.type)).toEqual(["usage", "done"]);
      expect(events[0]).toEqual({ type: "usage", usage });
      expect(events[1].usage).toEqual(usage);
    } finally {
      await server.stop();
    }
  });

  test("non-zero stopReason is forwarded on the done event", async () => {
    const frame = connectFrame(
      FLAG_NORMAL,
      encodeGetChatMessageResponseBytes({ deltaText: "done", stopReason: 10 }),
    );
    const server = mockUpstream([frame]);
    try {
      const events = await collectStream(baseChatParams(server.url.origin));
      const done = events[events.length - 1];
      expect(done.type).toBe("done");
      expect(done.stopReason).toBe(10);
    } finally {
      await server.stop();
    }
  });

  test("end-stream trailer with error yields an error event and terminates", async () => {
    const textFrame = connectFrame(
      FLAG_NORMAL,
      encodeGetChatMessageResponseBytes({ deltaText: "partial" }),
    );
    const trailer = Buffer.from(
      JSON.stringify({ error: { code: "internal", message: "boom" } }),
    );
    const endFrame = connectFrame(FLAG_END_STREAM, trailer);
    const server = mockUpstream([textFrame, endFrame]);
    try {
      const events = await collectStream(baseChatParams(server.url.origin));
      // After the error event the generator returns; no done event.
      expect(events.map((e) => e.type)).toEqual(["text", "error"]);
      expect(events[1].error).toContain("internal");
      expect(events[1].error).toContain("boom");
    } finally {
      await server.stop();
    }
  });

  test("compressed frame is gunzipped before decoding", async () => {
    const raw = Uint8Array.from(
      encodeGetChatMessageResponseBytes({ deltaText: "compressed-text" }),
    );
    const frame = connectFrame(FLAG_COMPRESSED, gzipSync(raw));
    const server = mockUpstream([frame]);
    try {
      const events = await collectStream(baseChatParams(server.url.origin));
      expect(events.map((e) => e.type)).toEqual(["text", "done"]);
      expect(events[0].deltaText).toBe("compressed-text");
    } finally {
      await server.stop();
    }
  });

  test("non-ok GetChatMessage response throws Devin API <status>", async () => {
    const server = mockUpstream([], { status: 500, statusText: "Internal Server Error", body: "oops" });
    try {
      await expect(collectStream(baseChatParams(server.url.origin))).rejects.toThrow(
        /Devin API 500.*oops/,
      );
    } finally {
      await server.stop();
    }
  });

  test("frame length exceeding MAX_FRAME_PAYLOAD throws exceeds error", async () => {
    // 5-byte header declaring a 17MB payload; the length check fires before the
    // payload-availability check, so no actual payload bytes are needed.
    const header = Buffer.alloc(5);
    header[0] = FLAG_NORMAL;
    header.writeUInt32BE(17 * 1024 * 1024, 1);
    const server = mockUpstream([header]);
    try {
      await expect(collectStream(baseChatParams(server.url.origin))).rejects.toThrow(
        /exceeds/,
      );
    } finally {
      await server.stop();
    }
  });

  test("upstream idle silence aborts the stream with a timed-out error", async () => {
    // Chat path sends one valid frame, then stays open without ending. The
    // idle guard must fire on the silence after the first chunk and surface an
    // explicit error instead of hanging forever. Real timer is intentional —
    // integration test of the actual abort timing; fake timers cannot drive
    // the network IO abort sequence.
    const authResponse = Uint8Array.from(encodeGetUserJwtResponseBytes({ userJwt: "stream-jwt" }));
    const frame = connectFrame(FLAG_NORMAL, encodeGetChatMessageResponseBytes({ deltaText: "partial" }));
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (req) => {
        const path = new URL(req.url).pathname;
        if (path === AUTH_PATH) {
          return new Response(authResponse, { headers: { "content-type": "application/proto" } });
        }
        if (path === CHAT_PATH) {
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(frame);
                // intentionally no close() — read() hangs after the first chunk
              },
            }),
            { headers: { "content-type": "application/connect+proto" } },
          );
        }
        return new Response("not found", { status: 404 });
      },
    });
    try {
      await expect(
        collectStream({ ...baseChatParams(server.url.origin), upstreamIdleTimeoutMs: 100 }),
      ).rejects.toThrow(/timed out.*no upstream data/);
    } finally {
      await server.stop();
    }
  });

  test("upstream slow to respond aborts with a timed-out error", async () => {
    // Chat path never resolves the response; the idle guard fires while
    // waiting for the fetch itself. Real timer is intentional — this is an
    // integration test of the actual abort timing; fake timers cannot drive
    // the network IO abort sequence.
    const authResponse = Uint8Array.from(encodeGetUserJwtResponseBytes({ userJwt: "stream-jwt" }));
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (req) => {
        const path = new URL(req.url).pathname;
        if (path === AUTH_PATH) {
          return new Response(authResponse, { headers: { "content-type": "application/proto" } });
        }
        if (path === CHAT_PATH) {
          return new Promise<Response>(() => {});
        }
        return new Response("not found", { status: 404 });
      },
    });
    try {
      await expect(
        collectStream({ ...baseChatParams(server.url.origin), upstreamIdleTimeoutMs: 100 }),
      ).rejects.toThrow(/timed out.*no response within/);
    } finally {
      await server.stop();
    }
  });
});

// ─── discoverModels (supplements devin-model-discovery.test.ts) ──────────────

describe("discoverModels", () => {
  function mockModelsServer(response: Uint8Array, status: { status: number; statusText: string; body?: string } | null = null) {
    return Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (req) => {
        expect(new URL(req.url).pathname).toBe(MODELS_PATH);
        if (status) {
          return new Response(status.body ?? "err", { status: status.status, statusText: status.statusText });
        }
        return new Response(response, { headers: { "content-type": "application/proto" } });
      },
    });
  }

  function modelsResponse(configs: {
    label: string;
    modelUid: string;
    disabled: boolean;
    maxTokens: number;
  }[]): Uint8Array {
    const bytes: number[] = [];
    for (const c of configs) bytes.push(...encodeMessage(1, encodeClientModelConfigBytes(c)));
    return Uint8Array.from(bytes);
  }

  test("disabled models are filtered out", async () => {
    const response = modelsResponse([
      { label: "Enabled", modelUid: "enabled-uid", disabled: false, maxTokens: 128_000 },
      { label: "Disabled", modelUid: "disabled-uid", disabled: true, maxTokens: 32_000 },
    ]);
    const server = mockModelsServer(response);
    try {
      const models = await discoverModels("raw-token", server.url.origin);
      expect(models.map((m) => m.id)).toEqual(["enabled-uid"]);
    } finally {
      await server.stop();
    }
  });

  test("empty/whitespace modelUid is filtered out", async () => {
    const response = modelsResponse([
      { label: "Has Id", modelUid: "real-uid", disabled: false, maxTokens: 64_000 },
      { label: "No Id", modelUid: "   ", disabled: false, maxTokens: 64_000 },
    ]);
    const server = mockModelsServer(response);
    try {
      const models = await discoverModels("raw-token", server.url.origin);
      expect(models.map((m) => m.id)).toEqual(["real-uid"]);
    } finally {
      await server.stop();
    }
  });

  test("empty label falls back to id as name", async () => {
    const response = modelsResponse([
      { label: "", modelUid: "fallback-uid", disabled: false, maxTokens: 64_000 },
    ]);
    const server = mockModelsServer(response);
    try {
      const models = await discoverModels("raw-token", server.url.origin);
      expect(models).toHaveLength(1);
      expect(models[0].name).toBe("fallback-uid");
      expect(models[0].id).toBe("fallback-uid");
    } finally {
      await server.stop();
    }
  });

  test("configuredMaxTokens=0 yields contextWindow=200000 and maxTokens=64000", async () => {
    const response = modelsResponse([
      { label: "Zero", modelUid: "zero-uid", disabled: false, maxTokens: 0 },
    ]);
    const server = mockModelsServer(response);
    try {
      const models = await discoverModels("raw-token", server.url.origin);
      expect(models[0].contextWindow).toBe(200_000);
      expect(models[0].maxTokens).toBe(64_000);
    } finally {
      await server.stop();
    }
  });

  test("configuredMaxTokens>64000 is capped to maxTokens=64000, contextWindow=configured", async () => {
    const response = modelsResponse([
      { label: "Big", modelUid: "big-uid", disabled: false, maxTokens: 200_000 },
    ]);
    const server = mockModelsServer(response);
    try {
      const models = await discoverModels("raw-token", server.url.origin);
      expect(models[0].contextWindow).toBe(200_000);
      expect(models[0].maxTokens).toBe(64_000);
    } finally {
      await server.stop();
    }
  });

  test("non-ok response throws Devin model discovery <status>", async () => {
    const server = mockModelsServer(new Uint8Array(0), {
      status: 503,
      statusText: "Service Unavailable",
      body: "down",
    });
    try {
      await expect(discoverModels("raw-token", server.url.origin)).rejects.toThrow(
        /Devin model discovery 503.*down/,
      );
    } finally {
      await server.stop();
    }
  });

  test("malformed payload fails closed and returns [] without throwing", async () => {
    // Byte 0x0f => tag field=1, wire=7 (unknown) => skip(7) throws internally,
    // which the catch in discoverModels swallows, returning [].
    const malformed = new Uint8Array([0x0f]);
    const server = mockModelsServer(malformed);
    try {
      const models = await discoverModels("raw-token", server.url.origin);
      expect(models).toEqual([]);
    } finally {
      await server.stop();
    }
  });
});
