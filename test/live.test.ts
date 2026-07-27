/**
 * Live integration tests against the real Devin/Cascade API.
 *
 * Gated on BOTH `DEVIN_API_KEY` and `DEVIN_MODEL`: absent → entire suite skips,
 * so `bun test` stays free and offline-safe by default. Set both to run these.
 * Optionally set `DEVIN_BASE_URL` to override the Devin API base URL.
 *
 * Credits-conscious: every completion uses `maxTokens: 64` and a trivial prompt.
 * Assertions check structure/non-emptiness only — never exact text — because
 * model output is non-deterministic.
 *
 * Run:   DEVIN_API_KEY=... DEVIN_MODEL=glm-5-2 bun test test/live.test.ts
 */

import { expect, test, describe } from "bun:test";

import { getUserJwt, streamChat, discoverModels } from "../src/devin.ts";
import { chat } from "../src/client.ts";
import { startServer } from "../src/server.ts";
import { openaiToInternal, toDevinPrompts } from "../src/convert.ts";

const TOKEN = process.env.DEVIN_API_KEY;
const BASE_URL = process.env.DEVIN_BASE_URL || undefined;
/** Required: the model UID to use for completion tests. */
const MODEL = process.env.DEVIN_MODEL;

const RUN = !!(TOKEN && MODEL);

const SMALL_MAX_TOKENS = 64;
const TIMEOUT = 90_000; // thinking models can be slow; real network

/**
 * Assert text is non-empty and free of UTF-8 corruption.
 * Catches: replacement chars (U+FFFD from bad decode), lone surrogates,
 * and bytes that don't round-trip through UTF-8 (garbled protobuf/gzip).
 */
function assertValidText(text: string, label = "text"): void {
  expect(text.length).toBeGreaterThan(0);
  // U+FFFD = replacement char; presence means a decoder hit invalid UTF-8.
  expect(text).not.toContain("\uFFFD");
  // Round-trip through UTF-8: if encode→decode changes the string, bytes were
  // not valid UTF-8 (lone surrogates, truncated multibyte sequences).
  const roundTrip = new TextDecoder("utf-8").decode(new TextEncoder().encode(text));
  expect(roundTrip).toBe(text);
  // Reject strings that are only whitespace/control chars (plausible garble).
  expect(text.trim().length).toBeGreaterThan(0);
}

describe.skipIf(!RUN)("live Devin API integration", () => {
  test("getUserJwt handshake returns a non-empty JWT", async () => {
    const auth = await getUserJwt(TOKEN!, BASE_URL);
    expect(typeof auth.userJwt).toBe("string");
    expect(auth.userJwt.length).toBeGreaterThan(0);
  }, TIMEOUT);

  test("discoverModels returns a non-empty list with id + name", async () => {
    const models = await discoverModels(TOKEN!, BASE_URL);
    expect(models.length).toBeGreaterThan(0);
    for (const m of models) {
      expect(m.id).toBeTruthy();
      expect(m.name).toBeTruthy();
      expect(typeof m.contextWindow).toBe("number");
      expect(typeof m.supportsImages).toBe("boolean");
    }
  }, TIMEOUT);

  test("streamChat emits text + done events for a trivial prompt", async () => {
    const internal = openaiToInternal([{ role: "user", content: "Reply with exactly: OK" }]);
    const cascadeId = crypto.randomUUID();
    const prompts = toDevinPrompts(internal, cascadeId);

    const events: string[] = [];
    let text = "";
    let stopReason: number | undefined;
    for await (const ev of streamChat({
      apiKey: TOKEN!,
      modelUid: MODEL!,
      systemPrompt: "",
      messages: prompts,
      tools: [],
      maxTokens: SMALL_MAX_TOKENS,
      cascadeId,
      baseUrl: BASE_URL,
    })) {
      events.push(ev.type);
      if (ev.type === "text" && ev.deltaText) text += ev.deltaText;
      else if (ev.type === "done") stopReason = ev.stopReason;
      else if (ev.type === "error") throw new Error(ev.error);
    }
    expect(events).toContain("text");
    expect(events).toContain("done");
    assertValidText(text, "streamChat text");
    expect(stopReason).toBeDefined();
  }, TIMEOUT);

  test("chat() high-level client returns non-empty text", async () => {
    const result = await chat({
      token: TOKEN!,
      model: MODEL!,
      messages: [{ role: "user", content: "Reply with exactly: OK" }],
      maxTokens: SMALL_MAX_TOKENS,
      baseUrl: BASE_URL,
    });
    assertValidText(result.text, "chat() text");
    expect(typeof result.finishReason).toBe("string");
  }, TIMEOUT);

  // ─── HTTP surface (real server + real upstream) ────────────────────────────

  async function reservePort(): Promise<number> {
    const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response(null) });
    const port = probe.port;
    await probe.stop();
    return port;
  }

  async function withServer(fn: (url: string) => Promise<void>): Promise<void> {
    const port = await reservePort();
    const handle = await startServer({
      port,
      host: "127.0.0.1",
      token: TOKEN,
      baseUrl: BASE_URL,
    });
    try {
      await fn(`http://127.0.0.1:${port}`);
    } finally {
      await handle.stop();
    }
  }

  test("GET /health returns ok", async () => {
    await withServer(async (url) => {
      const res = await fetch(`${url}/health`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe("ok");
    });
  }, TIMEOUT);

  test("GET /v1/models returns real discovered models", async () => {
    await withServer(async (url) => {
      const res = await fetch(`${url}/v1/models`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.object).toBe("list");
      expect(body.source).toBe("remote");
      expect(body.data.length).toBeGreaterThan(0);
      expect(typeof body.data[0].id).toBe("string");
      expect(typeof body.data[0].supports_images).toBe("boolean");
    });
  }, TIMEOUT);

  test("POST /v1/chat/completions returns 200 with non-empty content", async () => {
    await withServer(async (url) => {
      const res = await fetch(`${url}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: MODEL,
          messages: [{ role: "user", content: "Reply with exactly: OK" }],
          max_tokens: SMALL_MAX_TOKENS,
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.object).toBe("chat.completion");
      expect(body.choices).toHaveLength(1);
      assertValidText(body.choices[0].message.content, "chat.completions content");
    });
  }, TIMEOUT);

  test("POST /v1/chat/completions stream returns SSE chunks", async () => {
    await withServer(async (url) => {
      const res = await fetch(`${url}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: MODEL,
          stream: true,
          messages: [{ role: "user", content: "Reply with exactly: OK" }],
          max_tokens: SMALL_MAX_TOKENS,
        }),
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/event-stream");
      const raw = await res.text();
      expect(raw).toContain("data: ");
      expect(raw).toContain("[DONE]");
      // Extract assistant text from SSE chunks and validate UTF-8 integrity.
      const chunks = [...raw.matchAll(/data: (\{.*\})/g)].map((m) => m[1]);
      const streamed = chunks
        .map((c) => JSON.parse(c).choices?.[0]?.delta?.content ?? "")
        .join("");
      assertValidText(streamed, "streamed content");
    });
  }, TIMEOUT);

  test("POST /v1/messages returns 200 with non-empty content", async () => {
    await withServer(async (url) => {
      const res = await fetch(`${url}/v1/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: SMALL_MAX_TOKENS,
          messages: [{ role: "user", content: "Reply with exactly: OK" }],
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.type).toBe("message");
      expect(body.role).toBe("assistant");
      expect(Array.isArray(body.content)).toBe(true);
      const textBlock = body.content.find((b: { type: string }) => b.type === "text");
      expect(textBlock).toBeDefined();
      assertValidText(textBlock.text, "messages text block");
    });
  }, TIMEOUT);

  test("POST /v1/responses returns 200 with output", async () => {
    await withServer(async (url) => {
      const res = await fetch(`${url}/v1/responses`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: MODEL,
          input: "Reply with exactly: OK",
          max_output_tokens: SMALL_MAX_TOKENS,
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.object).toBe("response");
      expect(Array.isArray(body.output)).toBe(true);
    });
  }, TIMEOUT);
  test("streamChat preserves multibyte UTF-8 (CJK prompt)", async () => {
    const internal = openaiToInternal([{ role: "user", content: "用中文回复「你好」两个字" }]);
    const cascadeId = crypto.randomUUID();
    const prompts = toDevinPrompts(internal, cascadeId);
    let text = "";
    for await (const ev of streamChat({
      apiKey: TOKEN!,
      modelUid: MODEL!,
      systemPrompt: "",
      messages: prompts,
      tools: [],
      maxTokens: SMALL_MAX_TOKENS,
      cascadeId,
      baseUrl: BASE_URL,
    })) {
      if (ev.type === "text" && ev.deltaText) text += ev.deltaText;
      else if (ev.type === "error") throw new Error(ev.error);
    }
    assertValidText(text, "CJK response");
    // Round-trip already validated; also confirm at least one non-ASCII char
    // survived (catches accidental ASCII-only fallback / mojibake).
    expect(/[^\x00-\x7f]/.test(text)).toBe(true);
  }, TIMEOUT);

});
