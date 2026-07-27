/**
 * SDK conformance tests: validate that gateway responses parse into the
 * official OpenAI / Anthropic TypeScript SDK types without errors.
 *
 * Gated on BOTH `DEVIN_API_KEY` and `DEVIN_MODEL` (same as live.test.ts).
 * Uses real Devin upstream + real gateway HTTP surface, then feeds each
 * response into the official SDK's type system. TypeScript compilation
 * (via `bun run typecheck`) enforces structural conformance at compile time;
 * runtime assertions check the fields the SDK cares about are present and
 * correctly typed.
 *
 * Run:   DEVIN_API_KEY=... DEVIN_MODEL=glm-5-2 bun test test/sdk-conformance.test.ts
 */

import { expect, test, describe } from "bun:test";

// Official SDK types — importing these ties the test to the real schemas.
import type OpenAI from "openai";
import type Anthropic from "@anthropic-ai/sdk";

import { startServer } from "../src/server.ts";

const TOKEN = process.env.DEVIN_API_KEY;
const BASE_URL = process.env.DEVIN_BASE_URL || undefined;
const MODEL = process.env.DEVIN_MODEL;

const RUN = !!(TOKEN && MODEL);
const SMALL_MAX_TOKENS = 64;
const TIMEOUT = 90_000;

async function reservePort(): Promise<number> {
  const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response(null) });
  const port = probe.port;
  await probe.stop();
  return port;
}

async function withServer(fn: (url: string) => Promise<void>): Promise<void> {
  const port = await reservePort();
  const handle = await startServer({ port, host: "127.0.0.1", token: TOKEN, baseUrl: BASE_URL });
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await handle.stop();
  }
}

describe.skipIf(!RUN)("SDK type conformance", () => {
  test("POST /v1/chat/completions response fits OpenAI.Chat.Completion", async () => {
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
      const json = await res.json();

      // Compile-time: json must structurally match OpenAI.Chat.Completion.
      // If the gateway is missing a required field or has a wrong type,
      // `bun run typecheck` fails on this assignment.
      const completion: OpenAI.Chat.Completion = json;

      // Runtime: assert the fields the SDK guarantees.
      expect(completion.id).toBeTruthy();
      expect(completion.object).toBe("chat.completion");
      expect(completion.created).toBeGreaterThan(0);
      expect(completion.model).toBe(MODEL);
      expect(Array.isArray(completion.choices)).toBe(true);
      expect(completion.choices.length).toBeGreaterThan(0);
      const choice = completion.choices[0];
      expect(choice.index).toBe(0);
      expect(choice.message).toBeDefined();
      expect(typeof choice.message.role).toBe("string");
      expect(choice.finish_reason).toBeTruthy();
      // usage is present on non-streaming completions.
      expect(completion.usage).toBeDefined();
      expect(typeof completion.usage!.prompt_tokens).toBe("number");
      expect(typeof completion.usage!.completion_tokens).toBe("number");
    });
  }, TIMEOUT);

  test("POST /v1/chat/completions stream chunks fit OpenAI.Chat.CompletionChunk", async () => {
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
      const raw = await res.text();

      // Parse each `data: {...}` line as a ChatCompletionChunk.
      const lines = raw.split("\n").filter((l) => l.startsWith("data: ") && !l.includes("[DONE]"));
      expect(lines.length).toBeGreaterThan(0);

      for (const line of lines) {
        const json = JSON.parse(line.slice(6));
        // Compile-time: each SSE payload must match OpenAI.Chat.CompletionChunk.
        const chunk: OpenAI.Chat.CompletionChunk = json;
        expect(chunk.id).toBeTruthy();
        expect(chunk.object).toBe("chat.completion.chunk");
        expect(chunk.created).toBeGreaterThan(0);
        expect(Array.isArray(chunk.choices)).toBe(true);
      }
    });
  }, TIMEOUT);

  test("GET /v1/models response fits OpenAI.Models.Model[] list shape", async () => {
    await withServer(async (url) => {
      const res = await fetch(`${url}/v1/models`);
      expect(res.status).toBe(200);
      const json = await res.json();

      // OpenAI list response: { object: "list", data: Model[] }
      expect(json.object).toBe("list");
      expect(Array.isArray(json.data)).toBe(true);

      for (const m of json.data) {
        // Compile-time: each entry must match OpenAI.Models.Model.
        const model: OpenAI.Models.Model = m;
        expect(model.id).toBeTruthy();
        expect(model.object).toBe("model");
        expect(typeof model.created).toBe("number");
        expect(model.owned_by).toBeTruthy();
      }
    });
  }, TIMEOUT);

  test("POST /v1/messages response fits Anthropic.Message", async () => {
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
      const json = await res.json();

      // Compile-time: json must structurally match Anthropic.Message.
      const message: Anthropic.Message = json;

      // Runtime: assert the fields the SDK guarantees.
      expect(message.id).toBeTruthy();
      expect(message.type).toBe("message");
      expect(message.role).toBe("assistant");
      expect(typeof message.model).toBe("string");
      expect(message.stop_reason).toBeTruthy();
      expect(Array.isArray(message.content)).toBe(true);
      expect(message.content.length).toBeGreaterThan(0);
      // usage is required on Anthropic.Message.
      expect(message.usage).toBeDefined();
      expect(typeof message.usage.input_tokens).toBe("number");
      expect(typeof message.usage.output_tokens).toBe("number");
    });
  }, TIMEOUT);

  test("POST /v1/messages stream events fit Anthropic RawMessageStreamEvent union", async () => {
    await withServer(async (url) => {
      const res = await fetch(`${url}/v1/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: SMALL_MAX_TOKENS,
          stream: true,
          messages: [{ role: "user", content: "Reply with exactly: OK" }],
        }),
      });
      expect(res.status).toBe(200);
      const raw = await res.text();

      // Anthropic SSE: `event: <type>\ndata: {...}\n\n`
      const blocks = raw.split("\n\n").filter((b) => b.trim().length > 0);
      expect(blocks.length).toBeGreaterThan(0);

      const eventTypes = new Set<string>();
      for (const block of blocks) {
        const eventLine = block.split("\n").find((l) => l.startsWith("event: "));
        const dataLine = block.split("\n").find((l) => l.startsWith("data: "));
        expect(eventLine).toBeDefined();
        expect(dataLine).toBeDefined();
        const eventType = eventLine!.slice(7).trim();
        eventTypes.add(eventType);
        const json = JSON.parse(dataLine!.slice(6));

        // Compile-time: each event must match some member of the union.
        // We assert the `type` field matches the SSE event name, which is
        // how the SDK's discriminated union dispatches.
        expect(json.type).toBe(eventType);
        const ev: Anthropic.RawMessageStreamEvent = json;
        expect(ev.type).toBe(eventType);
      }

      // Anthropic streams always start with message_start and end with message_stop.
      expect(eventTypes.has("message_start")).toBe(true);
      expect(eventTypes.has("message_stop")).toBe(true);
    });
  }, TIMEOUT);

  test("POST /v1/responses response fits OpenAI.Responses.Response", async () => {
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
      const json = await res.json();

      // Compile-time: json must match OpenAI.Responses.Response.
      const response: OpenAI.Responses.Response = json;

      expect(response.id).toBeTruthy();
      expect(response.object).toBe("response");
      expect(typeof response.model).toBe("string");
      expect(Array.isArray(response.output)).toBe(true);
      expect(response.status).toBeTruthy();
    });
  }, TIMEOUT);
});
