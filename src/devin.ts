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
  // Minimal decode: extract repeated ClientModelConfig (field 1)
  // Each config has: model_uid (field 1), label (field 3), disabled (field 6)
  // This is a best-effort parse — fall back to null on any error
  try {
    return parseCliModelConfigs(data);
  } catch {
    return [];
  }
}

function parseCliModelConfigs(data: Uint8Array): DiscoveredModel[] {
  // Lightweight parse of GetCliModelConfigsResponse { repeated ClientModelConfig client_model_configs = 1; }
  // ClientModelConfig fields we care about: model_uid=1, label=3, disabled=6, context_length=8, max_output_tokens=9
  const models: DiscoveredModel[] = [];
  const d = new (class {
    bytes = data;
    pos = 0;
    view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    readVarint(): bigint {
      let r = 0n, s = 0n;
      while (this.pos < this.bytes.length) {
        const b = this.bytes[this.pos++];
        r |= BigInt(b & 0x7f) << s;
        if ((b & 0x80) === 0) break;
        s += 7n;
      }
      return r;
    }
    readTag() { const t = Number(this.readVarint()); return { field: t >>> 3, wire: t & 7 }; }
    readString() { const l = Number(this.readVarint()); const s = this.pos; this.pos += l; return new TextDecoder().decode(this.bytes.subarray(s, s + l)); }
    readBytes() { const l = Number(this.readVarint()); const s = this.pos; this.pos += l; return this.bytes.subarray(s, s + l); }
    skip(w: number) { if (w === 0) this.readVarint(); else if (w === 1) this.pos += 8; else if (w === 2) this.pos += Number(this.readVarint()); else if (w === 5) this.pos += 4; }
    get done() { return this.pos >= this.bytes.length; }
  })();

  while (!d.done) {
    const { field, wire } = d.readTag();
    if (field === 1 && wire === 2) {
      const subData = d.readBytes();
      const model = parseClientModelConfig(subData);
      if (model) models.push(model);
    } else {
      d.skip(wire);
    }
  }
  return models;
}

function parseClientModelConfig(data: Uint8Array): DiscoveredModel | null {
  let id = "", label = "", disabled = false, contextWindow = 200_000, maxTokens = 64_000;
  let pos = 0;
  const bytes = data;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const readVarint = (): bigint => {
    let r = 0n, s = 0n;
    while (pos < bytes.length) {
      const b = bytes[pos++];
      r |= BigInt(b & 0x7f) << s;
      if ((b & 0x80) === 0) break;
      s += 7n;
    }
    return r;
  };
  const readString = (): string => {
    const l = Number(readVarint());
    const s = pos;
    pos += l;
    return new TextDecoder().decode(bytes.subarray(s, s + l));
  };
  const skip = (w: number) => {
    if (w === 0) readVarint();
    else if (w === 1) pos += 8;
    else if (w === 2) pos += Number(readVarint());
    else if (w === 5) pos += 4;
  };

  while (pos < bytes.length) {
    const tag = Number(readVarint());
    const field = tag >>> 3;
    const wire = tag & 7;
    switch (field) {
      case 1: id = readString(); break;
      case 3: label = readString(); break;
      case 6: disabled = readVarint() !== 0n; break;
      case 8: contextWindow = Number(readVarint()); break;
      case 9: maxTokens = Number(readVarint()); break;
      default: skip(wire);
    }
  }
  if (disabled || !id) return null;
  return {
    id,
    name: label.trim() || id,
    contextWindow,
    maxTokens,
    reasoning: true,
  };
}
