/**
 * Convert between OpenAI / Anthropic request formats and Devin's internal
 * ChatMessagePrompt representation, and convert Devin stream events back to
 * the appropriate response shapes.
 */

import {
  type ChatMessagePrompt,
  type ChatToolCall,
  type ChatToolDefinition,
  type ImageData,
  ChatMessageSource,
  StopReason,
} from "./proto.js";

// ─── Common internal message shape ───────────────────────────────────────────

export interface InternalMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  images?: ImageData[];
  toolCalls?: { id: string; name: string; arguments: Record<string, unknown> }[];
  toolCallId?: string;
  isError?: boolean;
  thinking?: string;
}

// ─── OpenAI → Internal ───────────────────────────────────────────────────────

export interface OpenAIMessage {
  role: string;
  content?: string | OpenAIContentPart[];
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface OpenAIContentPart {
  type: string;
  text?: string;
  image_url?: { url: string };
}

export interface OpenAIToolCall {
  id: string;
  type: string;
  function: { name: string; arguments: string };
}

export interface OpenAITool {
  type: string;
  function: { name: string; description?: string; parameters?: Record<string, unknown> };
}

export function openaiToInternal(messages: OpenAIMessage[]): InternalMessage[] {
  return messages.map((msg) => {
    if (msg.role === "tool") {
      return {
        role: "tool",
        content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content),
        toolCallId: msg.tool_call_id,
      };
    }

    if (msg.role === "assistant") {
      const text = typeof msg.content === "string" ? msg.content : "";
      const images = extractOpenAIImages(msg.content);
      return {
        role: "assistant",
        content: text,
        images,
        toolCalls: msg.tool_calls?.map((tc) => ({
          id: tc.id,
          name: tc.function.name,
          arguments: JSON.parse(tc.function.arguments || "{}"),
        })),
      };
    }

    // user / system / developer
    const text = typeof msg.content === "string" ? msg.content : extractOpenAIText(msg.content);
    const images = extractOpenAIImages(msg.content);
    return { role: "user", content: text, images };
  });
}

function extractOpenAIText(content?: string | OpenAIContentPart[]): string {
  if (!content || typeof content === "string") return content ?? "";
  return content.filter((p) => p.type === "text").map((p) => p.text ?? "").join("");
}

function extractOpenAIImages(content?: string | OpenAIContentPart[]): ImageData[] {
  if (!content || typeof content === "string") return [];
  return content
    .filter((p) => p.type === "image_url" && p.image_url?.url)
    .map((p) => parseDataUrl(p.image_url!.url))
    .filter((img): img is ImageData => img !== null);
}

function parseDataUrl(url: string): ImageData | null {
  const match = url.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return { mimeType: match[1], base64Data: match[2] };
}

export function openaiToolsToDevin(tools?: OpenAITool[]): ChatToolDefinition[] {
  if (!tools) return [];
  return tools.map((t) => ({
    name: t.function.name,
    description: t.function.description ?? "",
    jsonSchemaString: JSON.stringify(t.function.parameters ?? { type: "object" }),
    strict: false,
  }));
}

// ─── Anthropic → Internal ────────────────────────────────────────────────────

export interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
}

export interface AnthropicContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string | AnthropicContentBlock[];
  source?: { type: string; media_type: string; data: string };
  is_error?: boolean;
}

export interface AnthropicTool {
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
}

export function anthropicToInternal(messages: AnthropicMessage[]): InternalMessage[] {
  const result: InternalMessage[] = [];
  for (const msg of messages) {
    if (typeof msg.content === "string") {
      result.push({ role: msg.role === "assistant" ? "assistant" : "user", content: msg.content });
      continue;
    }

    // Group tool_result blocks into tool messages
    const blocks = msg.content;
    let textBuf = "";
    let thinkingBuf = "";
    const toolCalls: NonNullable<InternalMessage["toolCalls"]> = [];
    const images: ImageData[] = [];

    for (const block of blocks) {
      switch (block.type) {
        case "text":
          textBuf += block.text ?? "";
          break;
        case "thinking":
          thinkingBuf += block.thinking ?? "";
          break;
        case "tool_use":
          toolCalls.push({
            id: block.id ?? "",
            name: block.name ?? "",
            arguments: block.input ?? {},
          });
          break;
        case "tool_result": {
          const resultText = typeof block.content === "string"
            ? block.content
            : Array.isArray(block.content)
              ? block.content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("")
              : "";
          result.push({
            role: "tool",
            content: resultText,
            toolCallId: block.tool_use_id,
            isError: block.is_error,
          });
          break;
        }
        case "image":
          if (block.source?.type === "base64") {
            images.push({ mimeType: block.source.media_type, base64Data: block.source.data });
          }
          break;
      }
    }

    if (textBuf || thinkingBuf || toolCalls.length > 0 || images.length > 0) {
      result.push({
        role: msg.role === "assistant" ? "assistant" : "user",
        content: textBuf,
        thinking: thinkingBuf || undefined,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        images: images.length > 0 ? images : undefined,
      });
    }
  }
  return result;
}

export function anthropicToolsToDevin(tools?: AnthropicTool[]): ChatToolDefinition[] {
  if (!tools) return [];
  return tools.map((t) => ({
    name: t.name,
    description: t.description ?? "",
    jsonSchemaString: JSON.stringify(t.input_schema ?? { type: "object" }),
    strict: false,
  }));
}

// ─── Internal → Devin ChatMessagePrompt ──────────────────────────────────────

export function toDevinPrompts(messages: InternalMessage[], cascadeId: string): ChatMessagePrompt[] {
  const prompts: ChatMessagePrompt[] = [];
  for (const [index, msg] of messages.entries()) {
    const messageId = deterministicUuid(`${cascadeId}\0${index}\0${msg.role}`);
    if (msg.role === "user") {
      prompts.push({
        messageId,
        source: ChatMessageSource.USER,
        prompt: msg.content,
        images: msg.images,
      });
    } else if (msg.role === "assistant") {
      prompts.push({
        messageId: `bot-${messageId}`,
        source: ChatMessageSource.SYSTEM,
        prompt: msg.content,
        thinking: msg.thinking,
        toolCalls: msg.toolCalls?.map((tc) => ({
          id: tc.id,
          name: tc.name,
          argumentsJson: JSON.stringify(tc.arguments),
        })),
      });
    } else {
      prompts.push({
        messageId: deterministicUuid(`${cascadeId}\0${index}\0tool\0${msg.toolCallId ?? ""}`),
        source: ChatMessageSource.TOOL,
        toolCallId: msg.toolCallId,
        toolResultIsError: msg.isError,
        prompt: msg.content,
        images: msg.images,
      });
    }
  }
  return prompts;
}

function deterministicUuid(seed: string): string {
  // Simple deterministic ID from seed (not a real UUID, but stable)
  let h1 = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h1 ^= seed.charCodeAt(i);
    h1 = Math.imul(h1, 0x01000193);
  }
  const hex = (h1 >>> 0).toString(16).padStart(8, "0");
  return `${hex}-0000-0000-0000-000000000000`;
}

// ─── Stop reason mapping ─────────────────────────────────────────────────────

export function stopReasonToOpenAI(reason: number, hasToolCalls: boolean): string {
  if (hasToolCalls) return "tool_calls";
  if (reason === StopReason.MAX_TOKENS) return "length";
  return "stop";
}

export function stopReasonToAnthropic(reason: number, hasToolCalls: boolean): string {
  if (hasToolCalls) return "tool_use";
  if (reason === StopReason.MAX_TOKENS) return "max_tokens";
  return "end_turn";
}
