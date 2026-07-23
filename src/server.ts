/**
 * Devin Gateway — HTTP server.
 *
 * Exposes Devin/Windsurf Cascade models behind standard API surfaces:
 *   POST /v1/chat/completions   — OpenAI Chat Completions
 *   POST /v1/responses          — OpenAI Responses API
 *   POST /v1/messages           — Anthropic Messages
 *   GET  /v1/models             — OpenAI-style model list
 *   GET  /login                 — start OAuth flow
 *   GET  /login/callback        — OAuth callback
 *   POST /login/paste           — paste redirect URL to complete flow
 *   GET  /health                — health check
 */

import { streamChat, discoverModels, type ChatStreamEvent } from "./devin.ts";
import { getModel, listModels, resolveModelUid, type ModelInfo } from "./models.ts";
import {
  openaiToInternal,
  openaiToolsToDevin,
  anthropicToInternal,
  anthropicToolsToDevin,
  toDevinPrompts,
  stopReasonToOpenAI,
  stopReasonToAnthropic,
  type OpenAIMessage,
  type OpenAITool,
  type AnthropicMessage,
  type AnthropicTool,
} from "./convert.ts";
import { StopReason } from "./proto.ts";
import { startLoginFlow, completeLoginWithUrl, type LoginSession } from "./login.ts";
import { readToken, writeToken, watchToken } from "./config.ts";

// ─── Config (populated by startServer) ──────────────────────────────────────

let PORT = 3000;
let HOST = "0.0.0.0";
/** If set, used as the Devin session token for all requests when the client doesn't supply one. */
let DEFAULT_DEVIN_KEY = "";
/** Base URL override for the Devin API (default: https://server.codeium.com). */
let DEVIN_BASE_URL = "";
let storedToken = "";
let stopTokenWatcher: () => void = () => {};

async function saveToken(token: string): Promise<void> {
  storedToken = token;
  await writeToken(token);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractToken(req: Request): string {
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  return bearer || storedToken;
}

function jsonResponse(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders(req) },
  });
}

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin");
  return origin ? { "access-control-allow-origin": origin, "access-control-allow-headers": "*", "access-control-allow-methods": "*" } : {};
}

function errorResponse(req: Request, status: number, message: string, type = "invalid_request_error"): Response {
  return jsonResponse(req, { error: { message, type } }, status);
}

// ─── OpenAI Chat Completions ─────────────────────────────────────────────────

interface OpenAIChatRequest {
  model: string;
  messages: OpenAIMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  max_completion_tokens?: number;
  top_p?: number;
  tools?: OpenAITool[];
  tool_choice?: string | { type: string; function?: { name: string } };
  stop?: string | string[];
  reasoning_effort?: string;
}

async function handleChatCompletions(req: Request): Promise<Response> {
  const body = (await req.json()) as OpenAIChatRequest;
  const token = extractToken(req);
  if (!token) return errorResponse(req, 401, "No Devin API key. Set DEVIN_API_KEY or pass Authorization: Bearer <token>.", "authentication_error");

  const modelUid = resolveModelUid(body.model, body.reasoning_effort);
  const internal = openaiToInternal(body.messages);
  const cascadeId = crypto.randomUUID();
  const prompts = toDevinPrompts(internal, cascadeId);
  const systemPrompt = extractSystemPrompt(body.messages);
  const tools = openaiToolsToDevin(body.tools);
  const stop = Array.isArray(body.stop) ? body.stop : body.stop ? [body.stop] : undefined;
  const maxTokens = body.max_completion_tokens ?? body.max_tokens;

  const completionId = `chatcmpl-${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
  const created = Math.floor(Date.now() / 1000);

  if (body.stream) {
    return streamOpenAIChat(req, {
      token, modelUid, systemPrompt, prompts, tools, maxTokens,
      temperature: body.temperature, topP: body.top_p, stopSequences: stop,
      cascadeId, modelId: body.model, completionId, created,
    });
  }

  // Non-streaming: collect all events
  try {
    let text = "";
    let thinking = "";
    const toolCalls: { id: string; name: string; arguments: string }[] = [];
    let stopReason = 0;
    let usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number } | null | undefined;

    for await (const ev of streamChat({
      apiKey: token, modelUid, systemPrompt, messages: prompts, tools,
      maxTokens, temperature: body.temperature, topP: body.top_p, stopSequences: stop, cascadeId,
      baseUrl: DEVIN_BASE_URL || undefined,
    })) {
      if (ev.type === "text") text += ev.deltaText;
      else if (ev.type === "thinking") thinking += ev.deltaThinking;
      else if (ev.type === "toolcall" && ev.toolCalls) {
        for (const tc of ev.toolCalls) {
          const existing = toolCalls.find((t) => t.id === tc.id);
          if (existing) {
            existing.arguments = tc.argumentsJson;
          } else {
            toolCalls.push({ id: tc.id, name: tc.name, arguments: tc.argumentsJson });
          }
        }
      } else if (ev.type === "usage") usage = ev.usage;
      else if (ev.type === "done") stopReason = ev.stopReason ?? 0;
      else if (ev.type === "error") throw new Error(ev.error);
    }

    const hasToolCalls = toolCalls.length > 0;
    const message: Record<string, unknown> = {
      role: "assistant",
      content: text || null,
    };
    if (hasToolCalls) {
      message.content = null;
      message.tool_calls = toolCalls.map((tc, i) => ({
        id: tc.id || `call_${i}`,
        type: "function",
        function: { name: tc.name, arguments: tc.arguments || "{}" },
      }));
    }

    return jsonResponse(req, {
      id: completionId,
      object: "chat.completion",
      created,
      model: body.model,
      choices: [{
        index: 0,
        message,
        finish_reason: stopReasonToOpenAI(stopReason, hasToolCalls),
      }],
      usage: usage ? {
        prompt_tokens: usage.inputTokens,
        completion_tokens: usage.outputTokens,
        total_tokens: usage.inputTokens + usage.outputTokens,
      } : undefined,
    });
  } catch (err) {
    return errorResponse(req, 502, String((err as Error).message ?? err));
  }
}

function streamOpenAIChat(
  req: Request,
  params: {
    token: string; modelUid: string; systemPrompt: string;
    prompts: ReturnType<typeof toDevinPrompts>; tools: ReturnType<typeof openaiToolsToDevin>;
    maxTokens?: number; temperature?: number; topP?: number; stopSequences?: string[];
    cascadeId: string; modelId: string; completionId: string; created: number;
  },
): Response {
  const { token, modelUid, systemPrompt, prompts, tools, maxTokens, temperature, topP, stopSequences, cascadeId, modelId, completionId, created } = params;

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (obj: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));

      try {
        // Initial role chunk
        send({
          id: completionId, object: "chat.completion.chunk", created, model: modelId,
          choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
        });

        let hasToolCalls = false;
        let stopReason = 0;

        for await (const ev of streamChat({
          apiKey: token, modelUid, systemPrompt, messages: prompts, tools,
          maxTokens, temperature, topP, stopSequences, cascadeId,
          baseUrl: DEVIN_BASE_URL || undefined,
        })) {
          if (ev.type === "text" && ev.deltaText) {
            send({
              id: completionId, object: "chat.completion.chunk", created, model: modelId,
              choices: [{ index: 0, delta: { content: ev.deltaText }, finish_reason: null }],
            });
          } else if (ev.type === "toolcall" && ev.toolCalls) {
            hasToolCalls = true;
            for (const tc of ev.toolCalls) {
              send({
                id: completionId, object: "chat.completion.chunk", created, model: modelId,
                choices: [{
                  index: 0,
                  delta: {
                    tool_calls: [{
                      id: tc.id, type: "function",
                      function: { name: tc.name, arguments: tc.argumentsJson },
                    }],
                  },
                  finish_reason: null,
                }],
              });
            }
          } else if (ev.type === "done") {
            stopReason = ev.stopReason ?? 0;
          } else if (ev.type === "error") {
            send({ error: { message: ev.error, type: "api_error" } });
          }
        }

        send({
          id: completionId, object: "chat.completion.chunk", created, model: modelId,
          choices: [{ index: 0, delta: {}, finish_reason: stopReasonToOpenAI(stopReason, hasToolCalls) }],
        });
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } catch (err) {
        send({ error: { message: String((err as Error).message ?? err), type: "api_error" } });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      "connection": "keep-alive",
      ...corsHeaders(req),
    },
  });
}

function extractSystemPrompt(messages: OpenAIMessage[]): string {
  return messages
    .filter((m) => m.role === "system" || m.role === "developer")
    .map((m) => (typeof m.content === "string" ? m.content : ""))
    .filter(Boolean)
    .join("\n\n");
}

// ─── OpenAI Responses API ────────────────────────────────────────────────────

interface OpenAIResponsesRequest {
  model: string;
  input: string | { role: string; content?: string | unknown[] }[];
  stream?: boolean;
  temperature?: number;
  max_output_tokens?: number;
  top_p?: number;
  tools?: OpenAITool[];
  reasoning?: { effort?: string };
  instructions?: string;
}

async function handleResponses(req: Request): Promise<Response> {
  const body = (await req.json()) as OpenAIResponsesRequest;
  const token = extractToken(req);
  if (!token) return errorResponse(req, 401, "No Devin API key.", "authentication_error");

  // Convert `input` to OpenAI messages format
  let messages: OpenAIMessage[];
  if (typeof body.input === "string") {
    messages = [{ role: "user", content: body.input }];
  } else if (Array.isArray(body.input)) {
    messages = body.input.map((m) => ({
      role: m.role,
      content: typeof m.content === "string" ? m.content : Array.isArray(m.content)
        ? (m.content as { type: string; text?: string }[]).map((p) => ({ type: p.type, text: p.text }))
        : undefined,
    }));
  } else {
    messages = [];
  }

  if (body.instructions) {
    messages = [{ role: "developer", content: body.instructions }, ...messages];
  }

  const modelUid = resolveModelUid(body.model, body.reasoning?.effort);
  const internal = openaiToInternal(messages);
  const cascadeId = crypto.randomUUID();
  const prompts = toDevinPrompts(internal, cascadeId);
  const systemPrompt = extractSystemPrompt(messages);
  const tools = openaiToolsToDevin(body.tools);
  const responseId = `resp_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
  const created = Math.floor(Date.now() / 1000);

  if (body.stream) {
    return streamOpenAIResponses(req, {
      token, modelUid, systemPrompt, prompts, tools,
      maxTokens: body.max_output_tokens, temperature: body.temperature, topP: body.top_p,
      cascadeId, modelId: body.model, responseId, created,
    });
  }

  try {
    let text = "";
    let stopReason = 0;
    let usage: { inputTokens: number; outputTokens: number } | null = null;

    for await (const ev of streamChat({
      apiKey: token, modelUid, systemPrompt, messages: prompts, tools,
      maxTokens: body.max_output_tokens, temperature: body.temperature, topP: body.top_p,
      cascadeId, baseUrl: DEVIN_BASE_URL || undefined,
    })) {
      if (ev.type === "text") text += ev.deltaText;
      else if (ev.type === "done") stopReason = ev.stopReason ?? 0;
      else if (ev.type === "usage" && ev.usage) usage = { inputTokens: ev.usage.inputTokens, outputTokens: ev.usage.outputTokens };
      else if (ev.type === "error") throw new Error(ev.error);
    }

    return jsonResponse(req, {
      id: responseId,
      object: "response",
      created_at: created,
      model: body.model,
      status: "completed",
      output: [{
        type: "message",
        id: `msg_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`,
        status: "completed",
        role: "assistant",
        content: [{ type: "output_text", text }],
      }],
      usage: usage ? {
        input_tokens: usage.inputTokens,
        output_tokens: usage.outputTokens,
        total_tokens: usage.inputTokens + usage.outputTokens,
      } : undefined,
    });
  } catch (err) {
    return errorResponse(req, 502, String((err as Error).message ?? err));
  }
}

function streamOpenAIResponses(
  req: Request,
  params: {
    token: string; modelUid: string; systemPrompt: string;
    prompts: ReturnType<typeof toDevinPrompts>; tools: ReturnType<typeof openaiToolsToDevin>;
    maxTokens?: number; temperature?: number; topP?: number;
    cascadeId: string; modelId: string; responseId: string; created: number;
  },
): Response {
  const { token, modelUid, systemPrompt, prompts, tools, maxTokens, temperature, topP, cascadeId, modelId, responseId, created } = params;

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: string, obj: unknown) =>
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(obj)}\n\n`));

      try {
        send("response.created", {
          type: "response.created",
          response: { id: responseId, object: "response", created_at: created, model: modelId, status: "in_progress" },
        });

        const messageId = `msg_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
        send("response.output_item.added", {
          type: "response.output_item.added",
          output_index: 0,
          item: { type: "message", id: messageId, status: "in_progress", role: "assistant", content: [] },
        });
        send("response.content_part.added", {
          type: "response.content_part.added",
          item_id: messageId, output_index: 0, content_index: 0,
          part: { type: "output_text", text: "" },
        });

        let fullText = "";
        for await (const ev of streamChat({
          apiKey: token, modelUid, systemPrompt, messages: prompts, tools,
          maxTokens, temperature, topP, cascadeId, baseUrl: DEVIN_BASE_URL || undefined,
        })) {
          if (ev.type === "text" && ev.deltaText) {
            fullText += ev.deltaText;
            send("response.output_text.delta", {
              type: "response.output_text.delta",
              item_id: messageId, output_index: 0, content_index: 0, delta: ev.deltaText,
            });
          } else if (ev.type === "error") {
            send("response.failed", { type: "response.failed", error: { message: ev.error } });
          }
        }

        send("response.content_part.done", {
          type: "response.content_part.done",
          item_id: messageId, output_index: 0, content_index: 0,
          part: { type: "output_text", text: fullText },
        });
        send("response.output_item.done", {
          type: "response.output_item.done",
          output_index: 0,
          item: { type: "message", id: messageId, status: "completed", role: "assistant", content: [{ type: "output_text", text: fullText }] },
        });
        send("response.completed", {
          type: "response.completed",
          response: { id: responseId, object: "response", created_at: created, model: modelId, status: "completed", output: [{ type: "message", id: messageId, status: "completed", role: "assistant", content: [{ type: "output_text", text: fullText }] }] },
        });
      } catch (err) {
        send("response.failed", { type: "response.failed", error: { message: String((err as Error).message ?? err) } });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache", ...corsHeaders(req) },
  });
}

// ─── Anthropic Messages ──────────────────────────────────────────────────────

interface AnthropicRequest {
  model: string;
  messages: AnthropicMessage[];
  system?: string | { type: string; text: string }[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  tools?: AnthropicTool[];
  tool_choice?: { type: string; name?: string };
  stop_sequences?: string[];
  thinking?: { type: string; budget_tokens?: number };
}

async function handleAnthropicMessages(req: Request): Promise<Response> {
  const body = (await req.json()) as AnthropicRequest;
  const token = extractToken(req);
  if (!token) return errorResponse(req, 401, "No Devin API key.", "authentication_error");

  const modelUid = resolveModelUid(body.model);
  const internal = anthropicToInternal(body.messages);
  const cascadeId = crypto.randomUUID();
  const prompts = toDevinPrompts(internal, cascadeId);
  const systemPrompt = typeof body.system === "string"
    ? body.system
    : Array.isArray(body.system)
      ? body.system.map((s) => s.text).join("\n\n")
      : "";
  const tools = anthropicToolsToDevin(body.tools);
  const messageId = `msg_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;

  if (body.stream) {
    return streamAnthropic(req, {
      token, modelUid, systemPrompt, prompts, tools,
      maxTokens: body.max_tokens, temperature: body.temperature, topP: body.top_p,
      stopSequences: body.stop_sequences, cascadeId, modelId: body.model, messageId,
    });
  }

  try {
    let text = "";
    let thinking = "";
    const toolCalls: { id: string; name: string; arguments: string }[] = [];
    let stopReason = 0;
    let usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number } | null | undefined;

    for await (const ev of streamChat({
      apiKey: token, modelUid, systemPrompt, messages: prompts, tools,
      maxTokens: body.max_tokens, temperature: body.temperature, topP: body.top_p,
      stopSequences: body.stop_sequences, cascadeId, baseUrl: DEVIN_BASE_URL || undefined,
    })) {
      if (ev.type === "text") text += ev.deltaText;
      else if (ev.type === "thinking") thinking += ev.deltaThinking;
      else if (ev.type === "toolcall" && ev.toolCalls) {
        for (const tc of ev.toolCalls) {
          const existing = toolCalls.find((t) => t.id === tc.id);
          if (existing) existing.arguments = tc.argumentsJson;
          else toolCalls.push({ id: tc.id, name: tc.name, arguments: tc.argumentsJson });
        }
      } else if (ev.type === "usage") usage = ev.usage;
      else if (ev.type === "done") stopReason = ev.stopReason ?? 0;
      else if (ev.type === "error") throw new Error(ev.error);
    }

    const hasToolCalls = toolCalls.length > 0;
    const content: unknown[] = [];
    if (thinking) content.push({ type: "thinking", thinking });
    if (text) content.push({ type: "text", text });
    if (hasToolCalls) {
      for (const tc of toolCalls) {
        content.push({
          type: "tool_use", id: tc.id || `toolu_${crypto.randomUUID().slice(0, 12)}`,
          name: tc.name, input: JSON.parse(tc.arguments || "{}"),
        });
      }
    }
    if (content.length === 0) content.push({ type: "text", text: "" });

    return jsonResponse(req, {
      id: messageId,
      type: "message",
      role: "assistant",
      model: body.model,
      content,
      stop_reason: stopReasonToAnthropic(stopReason, hasToolCalls),
      stop_sequence: null,
      usage: usage ? {
        input_tokens: usage.inputTokens,
        output_tokens: usage.outputTokens,
        cache_read_input_tokens: usage.cacheReadTokens || undefined,
        cache_creation_input_tokens: usage.cacheWriteTokens || undefined,
      } : { input_tokens: 0, output_tokens: 0 },
    });
  } catch (err) {
    return errorResponse(req, 502, String((err as Error).message ?? err));
  }
}

function streamAnthropic(
  req: Request,
  params: {
    token: string; modelUid: string; systemPrompt: string;
    prompts: ReturnType<typeof toDevinPrompts>; tools: ReturnType<typeof anthropicToolsToDevin>;
    maxTokens?: number; temperature?: number; topP?: number; stopSequences?: string[];
    cascadeId: string; modelId: string; messageId: string;
  },
): Response {
  const { token, modelUid, systemPrompt, prompts, tools, maxTokens, temperature, topP, stopSequences, cascadeId, modelId, messageId } = params;

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: string, obj: unknown) =>
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(obj)}\n\n`));

      try {
        send("message_start", {
          type: "message_start",
          message: {
            id: messageId, type: "message", role: "assistant", model: modelId,
            content: [], stop_reason: null, stop_sequence: null,
            usage: { input_tokens: 0, output_tokens: 0 },
          },
        });

        let contentIndex = 0;
        let currentBlockType: "text" | "thinking" | null = null;
        let hasToolCalls = false;
        let stopReason = 0;
        let inputTokens = 0, outputTokens = 0;

        const startBlock = (type: "text" | "thinking") => {
          currentBlockType = type;
          send("content_block_start", {
            type: "content_block_start",
            index: contentIndex,
            content_block: type === "thinking" ? { type: "thinking", thinking: "" } : { type: "text", text: "" },
          });
        };

        const stopBlock = () => {
          if (currentBlockType) {
            send("content_block_stop", { type: "content_block_stop", index: contentIndex });
            contentIndex++;
            currentBlockType = null;
          }
        };

        for await (const ev of streamChat({
          apiKey: token, modelUid, systemPrompt, messages: prompts, tools,
          maxTokens, temperature, topP, stopSequences, cascadeId, baseUrl: DEVIN_BASE_URL || undefined,
        })) {
          if (ev.type === "thinking" && ev.deltaThinking) {
            if (currentBlockType !== "thinking") {
              stopBlock();
              startBlock("thinking");
            }
            send("content_block_delta", {
              type: "content_block_delta", index: contentIndex,
              delta: { type: "thinking_delta", thinking: ev.deltaThinking },
            });
          } else if (ev.type === "text" && ev.deltaText) {
            if (currentBlockType !== "text") {
              stopBlock();
              startBlock("text");
            }
            send("content_block_delta", {
              type: "content_block_delta", index: contentIndex,
              delta: { type: "text_delta", text: ev.deltaText },
            });
          } else if (ev.type === "toolcall" && ev.toolCalls) {
            stopBlock();
            hasToolCalls = true;
            for (const tc of ev.toolCalls) {
              const toolId = tc.id || `toolu_${crypto.randomUUID().slice(0, 12)}`;
              send("content_block_start", {
                type: "content_block_start", index: contentIndex,
                content_block: { type: "tool_use", id: toolId, name: tc.name, input: {} },
              });
              send("content_block_delta", {
                type: "content_block_delta", index: contentIndex,
                delta: { type: "input_json_delta", partial_json: tc.argumentsJson },
              });
              send("content_block_stop", { type: "content_block_stop", index: contentIndex });
              contentIndex++;
            }
          } else if (ev.type === "usage" && ev.usage) {
            inputTokens = ev.usage.inputTokens;
            outputTokens = ev.usage.outputTokens;
          } else if (ev.type === "done") {
            stopReason = ev.stopReason ?? 0;
          } else if (ev.type === "error") {
            send("error", { type: "error", error: { type: "api_error", message: ev.error } });
          }
        }

        stopBlock();

        send("message_delta", {
          type: "message_delta",
          delta: { stop_reason: stopReasonToAnthropic(stopReason, hasToolCalls), stop_sequence: null },
          usage: { output_tokens: outputTokens },
        });
        send("message_stop", { type: "message_stop" });
      } catch (err) {
        send("error", { type: "error", error: { type: "api_error", message: String((err as Error).message ?? err) } });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache", ...corsHeaders(req) },
  });
}

// ─── Models list ─────────────────────────────────────────────────────────────

async function handleModels(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const source = url.searchParams.get("source");

  // Static catalog by default; ?source=remote queries the live Devin API.
  if (source !== "remote") {
    const models = listModels();
    return jsonResponse(req, {
      object: "list",
      data: models.map((m: ModelInfo) => ({
        id: m.id,
        object: "model",
        created: 1700000000,
        owned_by: "devin",
      })),
    });
  }

  // Remote discovery — requires a valid token.
  const token = extractToken(req);
  if (!token) return errorResponse(req, 401, "No Devin API key for model discovery.", "authentication_error");

  try {
    const remote = await discoverModels(token, DEVIN_BASE_URL || undefined);
    return jsonResponse(req, {
      object: "list",
      source: "remote",
      data: remote.map((m) => ({
        id: m.id,
        object: "model",
        created: 1700000000,
        owned_by: "devin",
        context_window: m.contextWindow,
        max_tokens: m.maxTokens,
        reasoning: m.reasoning,
      })),
    });
  } catch (err) {
    return errorResponse(req, 502, `Model discovery failed: ${String((err as Error).message ?? err)}`);
  }
}

// ─── Login flow ──────────────────────────────────────────────────────────────

const loginSessions = new Map<string, LoginSession>();

async function handleLogin(req: Request): Promise<Response> {
  const callbackUrl = new URL("/login/callback", `http://${req.headers.get("host") ?? `localhost:${PORT}`}`).href;
  const session = await startLoginFlow(callbackUrl);
  loginSessions.set(session.state, session);

  const html = `<!doctype html><html><body style="font-family:system-ui;max-width:600px;margin:40px auto;padding:20px">
<h1>Devin Login</h1>
<p>Click the link below to sign in to Devin:</p>
<p><a href="${session.authUrl}" style="font-size:1.2em;padding:10px 20px;background:#4f46e5;color:#fff;border-radius:8px;text-decoration:none">Sign in to Devin →</a></p>
<p style="color:#666;font-size:0.9em">After signing in, you'll be redirected back here with your token.</p>
<p style="color:#666;font-size:0.9em">Or if the callback can't reach this server, paste the redirect URL here:</p>
<form method="POST" action="/login/paste"><input name="url" placeholder="http://127.0.0.1:${PORT}/login/callback?code=...&state=..." style="width:100%;padding:8px;margin:8px 0"><button type="submit">Submit</button></form>
</body></html>`;

  return new Response(html, { headers: { "content-type": "text/html", ...corsHeaders(req) } });
}

async function handleLoginCallback(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return errorResponse(req, 400, "Missing code or state");
  const session = loginSessions.get(state);
  if (!session) return errorResponse(req, 400, "Invalid or expired login session");

  try {
    const token = await completeLoginWithUrl(session, `${url.pathname}?${url.searchParams.toString()}`);
    loginSessions.delete(state);
    await saveToken(token);
    const html = `<!doctype html><html><body style="font-family:system-ui;max-width:600px;margin:40px auto;padding:20px">
<h1>✅ Login successful</h1><p>Your Devin token has been saved and is ready to use.</p>
<p style="word-break:break-all;background:#f3f4f6;padding:12px;border-radius:8px;font-family:monospace;font-size:0.85em">${token}</p>
<p style="color:#666">You can now use this gateway with any OpenAI/Anthropic compatible client.</p></body></html>`;
    return new Response(html, { headers: { "content-type": "text/html" } });
  } catch (err) {
    return errorResponse(req, 502, `Login failed: ${String((err as Error).message ?? err)}`);
  }
}

async function handleLoginPaste(req: Request): Promise<Response> {
  const formData = await req.formData();
  const redirectUrl = formData.get("url") as string;
  if (!redirectUrl) return errorResponse(req, 400, "Missing url field");

  const url = new URL(redirectUrl, "http://localhost");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return errorResponse(req, 400, "URL missing code or state");
  const session = loginSessions.get(state);
  if (!session) return errorResponse(req, 400, "Invalid or expired login session");

  try {
    const token = await completeLoginWithUrl(session, `${url.pathname}?${url.searchParams.toString()}`);
    loginSessions.delete(state);
    await saveToken(token);
    return jsonResponse(req, { success: true, token, message: "Token saved. You can now use the gateway." });
  } catch (err) {
    return errorResponse(req, 502, `Login failed: ${String((err as Error).message ?? err)}`);
  }
}

// ─── Server lifecycle ───────────────────────────────────────────────────────

export interface ServerOptions {
  /** Listening port (default: `PORT` env or `3000`). */
  port?: number;
  /** Listening address (default: `HOST` env or `0.0.0.0`). */
  host?: string;
  /** Devin session token; falls back to `DEVIN_API_KEY` env or the token file. */
  token?: string;
  /** Override for the Devin API base URL (default: `DEVIN_BASE_URL` env). */
  baseUrl?: string;
  /** Reload the token from disk when the file changes (default: `true`). */
  watchTokenFile?: boolean;
}

export interface ServerHandle {
  port: number;
  host: string;
  /** Gracefully stop the server and token watcher. */
  stop: () => Promise<void>;
}

/**
 * Start the HTTP gateway. Reads `PORT`/`HOST`/`DEVIN_API_KEY`/`DEVIN_BASE_URL`
 * from the environment when the equivalent option is omitted.
 */
export async function startServer(options: ServerOptions = {}): Promise<ServerHandle> {
  PORT = options.port ?? Number(process.env.PORT ?? 3000);
  HOST = options.host ?? process.env.HOST ?? "0.0.0.0";
  DEFAULT_DEVIN_KEY = options.token ?? process.env.DEVIN_API_KEY ?? "";
  DEVIN_BASE_URL = options.baseUrl ?? process.env.DEVIN_BASE_URL ?? "";
  storedToken = DEFAULT_DEVIN_KEY || (await readToken());

  if (options.watchTokenFile !== false) {
    stopTokenWatcher = watchToken((token) => {
      if (token && token !== storedToken) {
        storedToken = token;
        console.log(`[token] Reloaded from config file (${token.slice(0, 12)}...)`);
      } else if (!token && storedToken && !DEFAULT_DEVIN_KEY) {
        storedToken = "";
        console.log("[token] Config file cleared — token removed");
      }
    });
  }

  const server = Bun.serve({
    port: PORT,
    hostname: HOST,
    async fetch(req: Request): Promise<Response> {
      const url = new URL(req.url);
      const method = req.method;
      const path = url.pathname;

      // CORS preflight
      if (method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders(req) });
      }

      try {
        // Health
        if (path === "/health" && method === "GET") {
          return jsonResponse(req, { status: "ok", token: storedToken ? "configured" : "not_set" });
        }

        if (path === "/v1/models" && method === "GET") return await handleModels(req);
        if (path === "/login" && method === "GET") return await handleLogin(req);
        if (path === "/login/callback" && method === "GET") return await handleLoginCallback(req);
        if (path === "/login/paste" && method === "POST") return await handleLoginPaste(req);

        // OpenAI
        if (path === "/v1/chat/completions" && method === "POST") return await handleChatCompletions(req);
        if (path === "/v1/responses" && method === "POST") return await handleResponses(req);
        if (path === "/v1/models" && method === "GET") return handleModels(req);

        // Anthropic
        if (path === "/v1/messages" && method === "POST") return await handleAnthropicMessages(req);

        // 404
        return errorResponse(req, 404, `Not found: ${method} ${path}`);
      } catch (err) {
        return errorResponse(req, 500, String((err as Error).message ?? err));
      }
    },
  });

  let shutdownStarted = false;
  const stop = async (): Promise<void> => {
    if (shutdownStarted) return;
    shutdownStarted = true;
    stopTokenWatcher();
    await server.stop();
  };

  const handleShutdown = (): void => {
    void stop().catch((error) => {
      console.error("[shutdown] Failed to stop cleanly:", error);
      process.exit(1);
    });
  };
  process.once("SIGTERM", handleShutdown);
  process.once("SIGINT", handleShutdown);

  console.log(`Devin Gateway running at http://${HOST}:${PORT}`);
  console.log(`  OpenAI:    POST /v1/chat/completions, POST /v1/responses, GET /v1/models`);
  console.log(`  Anthropic: POST /v1/messages`);
  console.log(`  Login:     GET  /login`);
  console.log(`  Health:    GET  /health`);
  console.log(storedToken ? "  Token:     configured" : "  Token:     not set — visit /login or set DEVIN_API_KEY");

  return { port: PORT, host: HOST, stop };
}
