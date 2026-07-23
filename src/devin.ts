/**
 * Devin / Codeium Cascade API client.
 *
 * Two RPCs are used:
 *  1. GetUserJwt  — exchange the session token (apiKey) for a per-user JWT.
 *  2. GetChatMessage — streaming chat via the Connect protocol over HTTP/1.1.
 *
 * The session token is the value returned by the Devin OAuth CLI flow,
 * prefixed with `devin-session-token$` if not already.
 */

import { gzipSync, gunzipSync } from "node:zlib";
import {
  type ChatMessagePrompt,
  type ChatToolCall,
  type ChatToolDefinition,
  type CompletionConfiguration,
  type GetChatMessageRequest,
  type GetChatMessageResponse,
  type Metadata,
  ChatMessageRequestType,
  ConversationalPlannerMode,
  CacheControlType,
  StopReason,
  encodeGetUserJwtRequest,
  decodeGetUserJwtResponse,
  encodeGetChatMessageRequest,
  decodeGetChatMessageResponse,
  ProtoDecoder,
  ProtoEncoder,
} from "./proto.ts";

const DEVIN_API_URL = "https://server.codeium.com";
const DEVIN_AUTH_PATH = "/exa.auth_pb.AuthService/GetUserJwt";
const CHAT_MESSAGE_PATH = "/exa.api_server_pb.ApiServerService/GetChatMessage";
const DEVIN_IDE_VERSION = "3.2.23";
const DEVIN_EXTENSION_VERSION = "1.48.2";
const SESSION_TOKEN_PREFIX = "devin-session-token$";
const CONNECT_COMPRESSED_FLAG = 0x01;
const CONNECT_END_STREAM_FLAG = 0x02;
const MAX_FRAME_PAYLOAD = 16 * 1024 * 1024;
const DEFAULT_STOP_PATTERNS = ["\n\nUSER:", "\n\nASSISTANT:", "<|context_request|>", "<|end_of_turn|>"];

function normalizeToken(token: string): string {
  return token.startsWith(SESSION_TOKEN_PREFIX) ? token : `${SESSION_TOKEN_PREFIX}${token}`;
}

function buildMetadata(apiKey: string, userJwt?: string): Metadata {
  return {
    ideName: "windsurf",
    ideVersion: DEVIN_IDE_VERSION,
    extensionName: "windsurf",
    extensionVersion: DEVIN_EXTENSION_VERSION,
    apiKey,
    locale: "en",
    userJwt,
  };
}

// ─── GetUserJwt ──────────────────────────────────────────────────────────────

export async function getUserJwt(
  apiKey: string,
  baseUrl: string = DEVIN_API_URL,
  signal?: AbortSignal,
): Promise<{ userJwt: string; baseUrl?: string }> {
  const token = normalizeToken(apiKey);
  const body = encodeGetUserJwtRequest(buildMetadata(token));
  const url = `${baseUrl.replace(/\/+$/, "")}${DEVIN_AUTH_PATH}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/proto",
      "connect-protocol-version": "1",
      accept: "*/*",
    },
    body,
    signal,
  });
  const payload = new Uint8Array(await res.arrayBuffer());
  if (!res.ok) {
    throw new Error(`Devin auth ${res.status} ${res.statusText}: ${new TextDecoder().decode(payload)}`);
  }
  let decoded;
  try {
    decoded = decodeGetUserJwtResponse(payload);
  } catch {
    decoded = decodeGetUserJwtResponse(gunzipSync(payload));
  }
  if (!decoded.userJwt) throw new Error("Devin auth: empty user JWT");
  const customUrl = decoded.customApiServerUrl.trim();
  return {
    userJwt: decoded.userJwt,
    ...(customUrl ? { baseUrl: customUrl.replace(/\/+$/, "") } : undefined),
  };
}

// ─── GetChatMessage (streaming) ──────────────────────────────────────────────

export interface ChatParams {
  apiKey: string;
  modelUid: string;
  systemPrompt: string;
  messages: ChatMessagePrompt[];
  tools: ChatToolDefinition[];
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  stopSequences?: string[];
  cascadeId?: string;
  baseUrl?: string;
  signal?: AbortSignal;
}

export interface ChatStreamEvent {
  type: "text" | "thinking" | "toolcall" | "usage" | "done" | "error";
  deltaText?: string;
  deltaThinking?: string;
  deltaSignature?: string;
  toolCalls?: ChatToolCall[];
  stopReason?: number;
  usage?: GetChatMessageResponse["usage"];
  error?: string;
}

export async function* streamChat(params: ChatParams): AsyncGenerator<ChatStreamEvent> {
  const token = normalizeToken(params.apiKey);
  const baseUrl = (params.baseUrl ?? DEVIN_API_URL).replace(/\/+$/, "");

  // Resolve user JWT first
  const auth = await getUserJwt(token, baseUrl, params.signal);
  const chatBaseUrl = auth.baseUrl ?? baseUrl;

  const cascadeId = params.cascadeId ?? crypto.randomUUID();
  const stopPatterns = [...DEFAULT_STOP_PATTERNS, ...(params.stopSequences ?? [])];
  const maxTokens = params.maxTokens ?? 64000;
  const temperature = params.temperature ?? 0.4;

  const configuration: CompletionConfiguration = {
    numCompletions: 1n,
    maxTokens: BigInt(maxTokens),
    maxNewlines: 200n,
    temperature,
    firstTemperature: temperature,
    topK: 50n,
    topP: params.topP ?? 1,
    stopPatterns,
    fimEotProbThreshold: 1,
  };

  const request: GetChatMessageRequest = {
    metadata: buildMetadata(token, auth.userJwt),
    prompt: params.systemPrompt,
    chatMessagePrompts: params.messages,
    chatModelUid: params.modelUid,
    configuration,
    tools: params.tools,
    disableParallelToolCalls: true,
    toolChoice: { optionName: "auto" },
    cascadeId,
    executionId: crypto.randomUUID(),
  };

  const reqBytes = encodeGetChatMessageRequest(request);
  const gz = gzipSync(reqBytes);
  const frame = Buffer.alloc(5 + gz.length);
  frame[0] = CONNECT_COMPRESSED_FLAG;
  frame.writeUInt32BE(gz.length, 1);
  frame.set(gz, 5);

  const response = await fetch(`${chatBaseUrl}${CHAT_MESSAGE_PATH}`, {
    method: "POST",
    headers: {
      "content-type": "application/connect+proto",
      "connect-protocol-version": "1",
      "connect-content-encoding": "gzip",
      "accept-encoding": "identity",
      "user-agent": "connect-go/1.18.1 (go1.26.3)",
      "connect-accept-encoding": "gzip",
    },
    body: frame,
    signal: params.signal,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Devin API ${response.status} ${response.statusText}: ${text}`);
  }
  if (!response.body) throw new Error("Devin API: empty response body");

  const reader = response.body.getReader();
  let pending = Buffer.alloc(0);
  let lastStopReason = 0;
  let lastUsage: GetChatMessageResponse["usage"] = null;

  for (;;) {
    const { done, value } = await reader.read();
    if (value && value.length > 0) {
      pending = Buffer.concat([pending, value]);
    }

    while (pending.length >= 5) {
      const flag = pending[0];
      const len = pending.readUInt32BE(1);
      if (len > MAX_FRAME_PAYLOAD) {
        throw new Error(`Connect frame length ${len} exceeds ${MAX_FRAME_PAYLOAD} bytes`);
      }
      if (pending.length < 5 + len) break;
      const payload = pending.subarray(5, 5 + len);
      pending = pending.subarray(5 + len);

      if (flag & CONNECT_END_STREAM_FLAG) {
        const trailerBytes = flag & CONNECT_COMPRESSED_FLAG ? gunzipSync(payload) : payload;
        const trailer = trailerBytes.toString("utf8").trim();
        if (trailer) {
          // Check for Connect error trailer
          try {
            const parsed = JSON.parse(trailer);
            if (parsed?.error?.code) {
              yield {
                type: "error",
                error: `Devin stream error ${parsed.error.code}: ${parsed.error.message ?? ""}`,
              };
              return;
            }
          } catch {
            // Non-JSON trailer — ignore
          }
        }
        continue;
      }

      const raw = flag & CONNECT_COMPRESSED_FLAG ? gunzipSync(payload) : payload;
      const msg = decodeGetChatMessageResponse(raw);

      if (msg.deltaText) {
        yield { type: "text", deltaText: msg.deltaText };
      }
      if (msg.deltaThinking) {
        yield {
          type: "thinking",
          deltaThinking: msg.deltaThinking,
          deltaSignature: msg.deltaSignature,
        };
      }
      if (msg.deltaToolCalls.length > 0) {
        yield { type: "toolcall", toolCalls: msg.deltaToolCalls };
      }
      if (msg.usage) {
        lastUsage = msg.usage;
        yield { type: "usage", usage: msg.usage };
      }
      if (msg.stopReason !== 0) {
        lastStopReason = msg.stopReason;
      }
    }

    if (done) break;
  }

  yield { type: "done", stopReason: lastStopReason, usage: lastUsage };
}

// ─── Model discovery (optional) ──────────────────────────────────────────────

export interface DiscoveredModel {
  id: string;
  name: string;
  contextWindow: number;
  maxTokens: number;
  reasoning: boolean;
}

const GET_CLI_MODEL_CONFIGS_PATH = "/exa.api_server_pb.ApiServerService/GetCliModelConfigs";

export async function discoverModels(
  apiKey: string,
  baseUrl: string = DEVIN_API_URL,
  signal?: AbortSignal,
): Promise<DiscoveredModel[]> {
  const token = normalizeToken(apiKey);
  const enc = new ProtoEncoder();
  enc.message(1, (e) => {
    e.string(1, "windsurf");
    e.string(7, DEVIN_IDE_VERSION);
    e.string(12, "windsurf");
    e.string(2, DEVIN_EXTENSION_VERSION);
    e.string(3, token);
    e.string(4, "en");
  });
  const url = `${baseUrl.replace(/\/+$/, "")}${GET_CLI_MODEL_CONFIGS_PATH}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/proto",
      "connect-protocol-version": "1",
      accept: "*/*",
    },
    body: enc.finish(),
    signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Devin model discovery ${res.status} ${res.statusText}: ${text}`);
  }
  const data = new Uint8Array(await res.arrayBuffer());
  // Decode GetCliModelConfigsResponse and its repeated ClientModelConfig field.
  // Field numbers follow the reference Codeium proto; malformed payloads fail closed.
  try {
    return parseCliModelConfigs(data);
  } catch {
    return [];
  }
}

function parseCliModelConfigs(data: Uint8Array): DiscoveredModel[] {
  const models: DiscoveredModel[] = [];
  const decoder = new ProtoDecoder(data);

  while (!decoder.done) {
    const { field, wire } = decoder.readTag();
    if (field === 1 && wire === 2) {
      const model = decoder.readMessage(parseClientModelConfig);
      if (model) models.push(model);
    } else {
      decoder.skip(wire);
    }
  }

  return models;
}

function parseClientModelConfig(decoder: ProtoDecoder): DiscoveredModel | null {
  let id = "";
  let label = "";
  let disabled = false;
  let configuredMaxTokens = 0;

  while (!decoder.done) {
    const { field, wire } = decoder.readTag();
    if (field === 1 && wire === 2) {
      label = decoder.readString();
    } else if (field === 4 && wire === 0) {
      disabled = decoder.readVarint() !== 0n;
    } else if (field === 18 && wire === 0) {
      configuredMaxTokens = Number(decoder.readVarint());
    } else if (field === 22 && wire === 2) {
      id = decoder.readString();
    } else {
      decoder.skip(wire);
    }
  }

  if (disabled || !id.trim()) return null;

  const contextWindow = configuredMaxTokens > 0 ? configuredMaxTokens : 200_000;
  const maxTokens = Math.min(configuredMaxTokens > 0 ? configuredMaxTokens : 64_000, 64_000);
  return {
    id: id.trim(),
    name: label.trim() || id.trim(),
    contextWindow,
    maxTokens,
    reasoning: true,
  };
}
