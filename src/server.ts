/**
 * Devin Gateway — HTTP server.
 *
 * Exposes Devin/Windsurf Cascade models behind standard API surfaces:
 *   POST /v1/chat/completions   — OpenAI Chat Completions
 *   POST /v1/responses          — OpenAI Responses API
 *   POST /v1/messages           — Anthropic Messages
 *   GET  /v1/models             — OpenAI-style model list
 *   GET  /health                — health check
 *
 * The server holds no token state. Each request must carry its own
 * credentials via `Authorization: Bearer <token>` or `x-api-key: <token>`.
 * `DEVIN_API_KEY` (or `ServerOptions.token`) is an optional fallback used
 * only when a request omits both headers.
 */

import { streamChat, discoverModels, type ChatStreamEvent } from "./devin.js";
import { listModels, type ModelInfo } from "./models.js";
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
} from "./convert.js";
import { StopReason, type ChatToolChoice } from "./proto.js";
import { log, truncate } from "./log.js";

// ─── Config (populated by startServer) ──────────────────────────────────────

let PORT = 3000;
let HOST = "0.0.0.0";
/** Optional fallback token (from DEVIN_API_KEY or ServerOptions.token) when a request carries no credentials. */
let DEFAULT_DEVIN_KEY = "";
/** Base URL override for the Devin API (default: https://server.codeium.com). */
let DEVIN_BASE_URL = "";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractToken(req: Request): string {
  // Authorization: Bearer <token> (OpenAI) or bare <token>
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : auth;
  // x-api-key: <token> (Anthropic SDK convention)
  const apiKey = req.headers.get("x-api-key") ?? "";
  // Per-request credentials override the optional DEVIN_API_KEY fallback.
  return bearer || apiKey || DEFAULT_DEVIN_KEY;
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

// ─── tool_choice mapping ────────────────────────────────────────────────────

/** Map an OpenAI `tool_choice` value onto a Devin `ChatToolChoice`. */
function mapOpenAIToolChoice(choice: OpenAIChatRequest["tool_choice"]): ChatToolChoice | undefined {
  if (!choice) return undefined;
  if (typeof choice === "string") {
    // "auto" | "none" | "required" → optionName; Devin recognises "auto".
    return { optionName: choice === "required" ? "any" : choice };
  }
  if (choice.type === "function" && choice.function?.name) {
    return { toolName: choice.function.name };
  }
  return undefined;
}

/** Map an Anthropic `tool_choice` value onto a Devin `ChatToolChoice`. */
function mapAnthropicToolChoice(choice: AnthropicRequest["tool_choice"]): ChatToolChoice | undefined {
  if (!choice) return undefined;
  if (choice.type === "auto" || choice.type === "any") return { optionName: choice.type };
  if (choice.type === "tool" && choice.name) return { toolName: choice.name };
  return undefined;
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
  if (!token) return errorResponse(req, 401, "No Devin API key. Set DEVIN_API_KEY or pass Authorization: Bearer <token> / x-api-key: <token>.", "authentication_error");

  const modelUid = body.model;
  const internal = openaiToInternal(body.messages);
  const cascadeId = crypto.randomUUID();
  const prompts = toDevinPrompts(internal, cascadeId);
  const systemPrompt = extractSystemPrompt(body.messages);
  const tools = openaiToolsToDevin(body.tools);
  const toolChoice = mapOpenAIToolChoice(body.tool_choice);
  const stop = Array.isArray(body.stop) ? body.stop : body.stop ? [body.stop] : undefined;
  const maxTokens = body.max_completion_tokens ?? body.max_tokens;

  const completionId = `chatcmpl-${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
  const created = Math.floor(Date.now() / 1000);

  if (body.stream) {
    return streamOpenAIChat(req, {
      token, modelUid, systemPrompt, prompts, tools, maxTokens,
      temperature: body.temperature, topP: body.top_p, stopSequences: stop,
      cascadeId, modelId: body.model, completionId, created, toolChoice,
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
      maxTokens, temperature: body.temperature, topP: body.top_p, stopSequences: stop, cascadeId, toolChoice,
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
    if (thinking) message.reasoning_content = thinking;
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
    toolChoice?: ChatToolChoice;
  },
): Response {
  const { token, modelUid, systemPrompt, prompts, tools, maxTokens, temperature, topP, stopSequences, cascadeId, modelId, completionId, created, toolChoice } = params;

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (obj: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));

      let upstreamChunks = 0;
      let sentChunks = 0;
      const slog = (msg: string) => log.debug(`[stream/chat ${completionId}] ${msg}`);

      try {
        // Initial role chunk
        send({
          id: completionId, object: "chat.completion.chunk", created, model: modelId,
          choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
        });
        sentChunks++;

        let hasToolCalls = false;
        let stopReason = 0;

        for await (const ev of streamChat({
          apiKey: token, modelUid, systemPrompt, messages: prompts, tools,
          maxTokens, temperature, topP, stopSequences, cascadeId, toolChoice,
          baseUrl: DEVIN_BASE_URL || undefined,
        })) {
          upstreamChunks++;
          if (ev.type === "text" && ev.deltaText) {
            send({
              id: completionId, object: "chat.completion.chunk", created, model: modelId,
              choices: [{ index: 0, delta: { content: ev.deltaText }, finish_reason: null }],
            });
            sentChunks++;
          } else if (ev.type === "thinking" && ev.deltaThinking) {
            // Forward reasoning tokens as reasoning_content so thinking models
            // keep the SSE stream alive while reasoning (Bun closes idle
            // streaming connections after idleTimeout seconds of silence).
            send({
              id: completionId, object: "chat.completion.chunk", created, model: modelId,
              choices: [{ index: 0, delta: { reasoning_content: ev.deltaThinking }, finish_reason: null }],
            });
            sentChunks++;
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
              sentChunks++;
            }
          } else if (ev.type === "done") {
            stopReason = ev.stopReason ?? 0;
          } else if (ev.type === "error") {
            send({ error: { message: ev.error, type: "api_error" } });
            sentChunks++;
            slog(`upstream error: ${ev.error}`);
          }
        }

        send({
          id: completionId, object: "chat.completion.chunk", created, model: modelId,
          choices: [{ index: 0, delta: {}, finish_reason: stopReasonToOpenAI(stopReason, hasToolCalls) }],
        });
        sentChunks++;
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        slog(`done — upstream chunks: ${upstreamChunks}, client chunks: ${sentChunks}`);
      } catch (err) {
        send({ error: { message: String((err as Error).message ?? err), type: "api_error" } });
        sentChunks++;
        slog(`exception after upstream=${upstreamChunks} client=${sentChunks}: ${(err as Error).message ?? err}`);
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
  if (!token) return errorResponse(req, 401, "No Devin API key. Set DEVIN_API_KEY or pass Authorization: Bearer <token> / x-api-key: <token>.", "authentication_error");

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

  const modelUid = body.model;
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
        const reasoningId = `rs_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
        let reasoningStarted = false;
        let messageStarted = false;
        let fullText = "";
        let outputIndex = 0;
        const outputItems: unknown[] = [];

        const startMessage = () => {
          messageStarted = true;
          send("response.output_item.added", {
            type: "response.output_item.added",
            output_index: outputIndex,
            item: { type: "message", id: messageId, status: "in_progress", role: "assistant", content: [] },
          });
          send("response.content_part.added", {
            type: "response.content_part.added",
            item_id: messageId, output_index: outputIndex, content_index: 0,
            part: { type: "output_text", text: "" },
          });
        };

        for await (const ev of streamChat({
          apiKey: token, modelUid, systemPrompt, messages: prompts, tools,
          maxTokens, temperature, topP, cascadeId, baseUrl: DEVIN_BASE_URL || undefined,
        })) {
          if (ev.type === "thinking" && ev.deltaThinking) {
            // Forward reasoning as a summary_text part so thinking models keep
            // the SSE stream alive (Bun closes idle streams after idleTimeout).
            if (!reasoningStarted) {
              reasoningStarted = true;
              send("response.output_item.added", {
                type: "response.output_item.added",
                output_index: outputIndex,
                item: { type: "reasoning", id: reasoningId, status: "in_progress", summary: [] },
              });
            }
            send("response.reasoning_summary_text.delta", {
              type: "response.reasoning_summary_text.delta",
              item_id: reasoningId, output_index: outputIndex, delta: ev.deltaThinking,
            });
          } else if (ev.type === "text" && ev.deltaText) {
            if (reasoningStarted) {
              send("response.reasoning_summary_text.done", {
                type: "response.reasoning_summary_text.done",
                item_id: reasoningId, output_index: outputIndex,
              });
              send("response.output_item.done", {
                type: "response.output_item.done",
                output_index: outputIndex,
                item: { type: "reasoning", id: reasoningId, status: "completed", summary: [] },
              });
              outputItems.push({ type: "reasoning", id: reasoningId, status: "completed", summary: [] });
              reasoningStarted = false;
              outputIndex++;
            }
            if (!messageStarted) startMessage();
            fullText += ev.deltaText;
            send("response.output_text.delta", {
              type: "response.output_text.delta",
              item_id: messageId, output_index: outputIndex, content_index: 0, delta: ev.deltaText,
            });
          } else if (ev.type === "error") {
            send("response.failed", { type: "response.failed", error: { message: ev.error } });
          }
        }

        if (reasoningStarted) {
          send("response.output_item.done", {
            type: "response.output_item.done",
            output_index: outputIndex,
            item: { type: "reasoning", id: reasoningId, status: "completed", summary: [] },
          });
          outputItems.push({ type: "reasoning", id: reasoningId, status: "completed", summary: [] });
          outputIndex++;
        }

        if (messageStarted) {
          send("response.content_part.done", {
            type: "response.content_part.done",
            item_id: messageId, output_index: outputIndex, content_index: 0,
            part: { type: "output_text", text: fullText },
          });
          send("response.output_item.done", {
            type: "response.output_item.done",
            output_index: outputIndex,
            item: { type: "message", id: messageId, status: "completed", role: "assistant", content: [{ type: "output_text", text: fullText }] },
          });
          outputItems.push({ type: "message", id: messageId, status: "completed", role: "assistant", content: [{ type: "output_text", text: fullText }] });
        }

        send("response.completed", {
          type: "response.completed",
          response: { id: responseId, object: "response", created_at: created, model: modelId, status: "completed", output: outputItems },
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
  if (!token) return errorResponse(req, 401, "No Devin API key. Set DEVIN_API_KEY or pass Authorization: Bearer <token> / x-api-key: <token>.", "authentication_error");

  const modelUid = body.model;
  const internal = anthropicToInternal(body.messages);
  const cascadeId = crypto.randomUUID();
  const prompts = toDevinPrompts(internal, cascadeId);
  const systemPrompt = typeof body.system === "string"
    ? body.system
    : Array.isArray(body.system)
      ? body.system.map((s) => s.text).join("\n\n")
      : "";
  const tools = anthropicToolsToDevin(body.tools);
  const toolChoice = mapAnthropicToolChoice(body.tool_choice);
  const messageId = `msg_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;

  if (body.stream) {
    return streamAnthropic(req, {
      token, modelUid, systemPrompt, prompts, tools,
      maxTokens: body.max_tokens, temperature: body.temperature, topP: body.top_p,
      stopSequences: body.stop_sequences, cascadeId, modelId: body.model, messageId, toolChoice,
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
      stopSequences: body.stop_sequences, cascadeId, toolChoice, baseUrl: DEVIN_BASE_URL || undefined,
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
    toolChoice?: ChatToolChoice;
  },
): Response {
  const { token, modelUid, systemPrompt, prompts, tools, maxTokens, temperature, topP, stopSequences, cascadeId, modelId, messageId, toolChoice } = params;

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
          maxTokens, temperature, topP, stopSequences, cascadeId, toolChoice, baseUrl: DEVIN_BASE_URL || undefined,
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

  // Remote discovery by default; ?source=local explicitly selects the built-in catalog.
  if (source === "local") {
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
        supports_images: m.supportsImages,
      })),
    });
  } catch (err) {
    return errorResponse(req, 502, `Model discovery failed: ${String((err as Error).message ?? err)}`);
  }
}

// ─── Server lifecycle ───────────────────────────────────────────────────────

export interface ServerOptions {
  /** Listening port (default: `PORT` env or `3000`). */
  port?: number;
  /** Listening address (default: `HOST` env or `0.0.0.0`). */
  host?: string;
  /** Optional fallback token when a request carries no credentials (default: `DEVIN_API_KEY` env). */
  token?: string;
  /** Override for the Devin API base URL (default: `DEVIN_BASE_URL` env). */
  baseUrl?: string;
}

export interface ServerHandle {
  port: number;
  host: string;
  /** Gracefully stop the server. */
  stop: () => Promise<void>;
}

/**
 * Start the HTTP gateway. Reads `PORT`/`HOST`/`DEVIN_API_KEY`/`DEVIN_BASE_URL`
 * from the environment when the equivalent option is omitted. The server holds
 * no token state; `DEVIN_API_KEY` is only a fallback for requests that omit
 * `Authorization`/`x-api-key` headers.
 */
export async function startServer(options: ServerOptions = {}): Promise<ServerHandle> {
  PORT = options.port ?? Number(process.env.PORT ?? 3000);
  HOST = options.host ?? process.env.HOST ?? "0.0.0.0";
  DEFAULT_DEVIN_KEY = options.token ?? process.env.DEVIN_API_KEY ?? "";
  DEVIN_BASE_URL = options.baseUrl ?? process.env.DEVIN_BASE_URL ?? "";

  const server = Bun.serve({
    port: PORT,
    hostname: HOST,
    // Bun closes idle streaming connections after 10s by default. Thinking
    // models can reason for tens of seconds before emitting text, so raise the
    // ceiling (255 is Bun's max) to keep SSE streams alive through quiet gaps.
    idleTimeout: 255,
    async fetch(req: Request): Promise<Response> {
      const url = new URL(req.url);
      const method = req.method;
      const path = url.pathname;
      const startedAt = Date.now();
      const id = crypto.randomUUID().slice(0, 8);

      // CORS preflight
      if (method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders(req) });
      }

      log.info(`→ ${method} ${path} [${id}]`);
      if (log.enabled("debug") && method === "POST") {
        try {
          const bodyText = await req.clone().text();
          log.debug(`body [${id}]: ${truncate(bodyText)}`);
        } catch { /* body not cloneable/empty */ }
      }

      let res: Response;
      try {
        // Health
        if (path === "/health" && method === "GET") {
          res = jsonResponse(req, { status: "ok", fallback_token: DEFAULT_DEVIN_KEY ? "configured" : "not_set" });
        } else if (path === "/v1/models" && method === "GET") {
          res = await handleModels(req);
        } else if (path === "/v1/chat/completions" && method === "POST") {
          res = await handleChatCompletions(req);
        } else if (path === "/v1/responses" && method === "POST") {
          res = await handleResponses(req);
        } else if (path === "/v1/messages" && method === "POST") {
          res = await handleAnthropicMessages(req);
        } else {
          res = errorResponse(req, 404, `Not found: ${method} ${path}`);
        }
      } catch (err) {
        log.error(`handler error [${id}] ${method} ${path}:`, err);
        res = errorResponse(req, 500, String((err as Error).message ?? err));
      }

      const ms = Date.now() - startedAt;
      const status = res.status;
      if (status >= 500) log.error(`← ${status} ${method} ${path} ${ms}ms [${id}]`);
      else if (status >= 400) log.warn(`← ${status} ${method} ${path} ${ms}ms [${id}]`);
      else log.info(`← ${status} ${method} ${path} ${ms}ms [${id}]`);
      return res;
    },
  });

  let shutdownStarted = false;
  const stop = async (): Promise<void> => {
    if (shutdownStarted) return;
    shutdownStarted = true;
    await server.stop();
  };

  const handleShutdown = (): void => {
    void stop().catch((error) => {
      log.error("[shutdown] Failed to stop cleanly:", error);
      process.exit(1);
    });
  };
  process.once("SIGTERM", handleShutdown);
  process.once("SIGINT", handleShutdown);
  console.log(`Devin Gateway running at http://${HOST}:${PORT}`);
  console.log(`  OpenAI:    POST /v1/chat/completions, POST /v1/responses, GET /v1/models`);
  console.log(`  Anthropic: POST /v1/messages`);
  console.log(`  Health:    GET  /health`);
  console.log(DEFAULT_DEVIN_KEY
    ? "  Fallback:  DEVIN_API_KEY configured (used when a request sends no credentials)"
    : "  Fallback:  none — each request must send Authorization / x-api-key");
  return { port: PORT, host: HOST, stop };
}
