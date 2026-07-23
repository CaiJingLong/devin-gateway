/**
 * High-level programmatic client for external consumers (e.g. GitHub Actions).
 *
 * `chat()` resolves a Devin token, performs the GetUserJwt handshake, streams a
 * single completion to completion, and returns the accumulated text, tool calls,
 * thinking, and usage. Pass `token` explicitly to avoid touching the token file
 * — this keeps the call Node-compatible when run outside Bun.
 */

import { streamChat } from "./devin.ts";
import { readToken } from "./config.ts";
import { resolveModelUid } from "./models.ts";
import {
  openaiToInternal,
  openaiToolsToDevin,
  toDevinPrompts,
  stopReasonToOpenAI,
  type OpenAIMessage,
  type OpenAITool,
} from "./convert.ts";

export interface ChatOptions {
  /** Devin session token; falls back to `DEVIN_API_KEY` env or the token file. */
  token?: string;
  /** Model id from the catalog (e.g. `claude-opus-4-8`) or a raw Cascade UID. */
  model: string;
  messages: OpenAIMessage[];
  tools?: OpenAITool[];
  /** Reasoning effort, routed via the model's `effortRouting` map. */
  effort?: string;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  stop?: string[] | string;
  /** Reuse a cascade id to continue a conversation; a fresh one is generated otherwise. */
  cascadeId?: string;
  /** Override for the Devin API base URL. */
  baseUrl?: string;
  signal?: AbortSignal;
}

export interface ChatToolResult {
  id: string;
  name: string;
  arguments: string;
}

export interface ChatUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface ChatResult {
  /** Concatenated assistant text. */
  text: string;
  /** Concatenated reasoning/thinking text (empty for non-reasoning models). */
  thinking: string;
  toolCalls: ChatToolResult[];
  /** Raw Devin stop reason code. */
  stopReason: number;
  /** OpenAI-style finish reason (`stop`, `tool_calls`, ...). */
  finishReason: string;
  usage?: ChatUsage;
}

/**
 * Run a single non-streaming chat completion against the Devin/Cascade API.
 *
 * @example
 * ```ts
 * import { chat } from "devin-gateway";
 * const { text } = await chat({
 *   token: process.env.DEVIN_TOKEN,
 *   model: "claude-opus-4-8",
 *   messages: [{ role: "user", content: "Summarize this PR" }],
 * });
 * ```
 */
export async function chat(options: ChatOptions): Promise<ChatResult> {
  const token = options.token ?? process.env.DEVIN_API_KEY ?? (await readToken());
  if (!token) {
    throw new Error(
      "No Devin token: pass `token`, set DEVIN_API_KEY, or run `bun run login`.",
    );
  }

  const modelUid = resolveModelUid(options.model, options.effort);
  const internal = openaiToInternal(options.messages);
  const cascadeId = options.cascadeId ?? crypto.randomUUID();
  const prompts = toDevinPrompts(internal, cascadeId);
  const systemPrompt = extractSystemPrompt(options.messages);
  const tools = openaiToolsToDevin(options.tools);
  const stopSequences = Array.isArray(options.stop)
    ? options.stop
    : options.stop
      ? [options.stop]
      : undefined;

  let text = "";
  let thinking = "";
  const toolCalls: ChatToolResult[] = [];
  let stopReason = 0;
  let usage: ChatUsage | undefined;

  for await (const ev of streamChat({
    apiKey: token,
    modelUid,
    systemPrompt,
    messages: prompts,
    tools,
    maxTokens: options.maxTokens,
    temperature: options.temperature,
    topP: options.topP,
    stopSequences,
    cascadeId,
    baseUrl: options.baseUrl,
    signal: options.signal,
  })) {
    if (ev.type === "text" && ev.deltaText) {
      text += ev.deltaText;
    } else if (ev.type === "thinking" && ev.deltaThinking) {
      thinking += ev.deltaThinking;
    } else if (ev.type === "toolcall" && ev.toolCalls) {
      for (const tc of ev.toolCalls) {
        const existing = toolCalls.find((t) => t.id === tc.id);
        if (existing) {
          existing.arguments = tc.argumentsJson;
        } else {
          toolCalls.push({ id: tc.id, name: tc.name, arguments: tc.argumentsJson });
        }
      }
    } else if (ev.type === "usage") {
      usage = ev.usage ?? undefined;
    } else if (ev.type === "done") {
      stopReason = ev.stopReason ?? 0;
    } else if (ev.type === "error") {
      throw new Error(ev.error);
    }
  }

  return {
    text,
    thinking,
    toolCalls,
    stopReason,
    finishReason: stopReasonToOpenAI(stopReason, toolCalls.length > 0),
    usage,
  };
}

function extractSystemPrompt(messages: OpenAIMessage[]): string {
  return messages
    .filter((m) => m.role === "system" || m.role === "developer")
    .map((m) => (typeof m.content === "string" ? m.content : ""))
    .filter(Boolean)
    .join("\n\n");
}
