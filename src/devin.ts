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
import { log } from "./log.js";
import { currentTrace } from "./error-trace.js";
import {
  type ChatMessagePrompt,
  type ChatToolCall,
  type ChatToolChoice,
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
} from "./proto.js";

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
  log.debug(`[auth] POST ${url}`);
  currentTrace()?.add("auth", `POST ${url}`);
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
    const detail = new TextDecoder().decode(payload);
    log.error(`[auth] upstream returned ${res.status} ${res.statusText}: ${detail}`);
    currentTrace()?.add("auth", `upstream returned ${res.status} ${res.statusText}`, { detail });
    throw new Error(`Devin auth ${res.status} ${res.statusText}: ${detail}`);
  }
  let decoded;
  try {
    decoded = decodeGetUserJwtResponse(payload);
  } catch {
    decoded = decodeGetUserJwtResponse(gunzipSync(payload));
  }
  if (!decoded.userJwt) {
    log.error("[auth] succeeded but user JWT is empty");
    currentTrace()?.add("auth", "succeeded but user JWT is empty");
    throw new Error("Devin auth: empty user JWT");
  }
  log.debug("[auth] got user JWT");
  currentTrace()?.add("auth", "got user JWT");
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
  /**
   * Max silence (ms) from the upstream chat stream before aborting. Default
   * 120000 (2 min). Re-armed on every received chunk, so only true silence
   * triggers it — long, active streams are unaffected.
   */
  upstreamIdleTimeoutMs?: number;
  /** Tool choice override; defaults to `{ optionName: "auto" }`. */
  toolChoice?: ChatToolChoice;
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

  // Resolve user JWT first. Auth is a quick handshake — cap it at 30s so a
  // stalled Codeium auth endpoint surfaces as an explicit error, not a hang.
  const authTimeout = AbortSignal.timeout(30_000);
  let auth;
  try {
    auth = await getUserJwt(token, baseUrl, params.signal ? AbortSignal.any([params.signal, authTimeout]) : authTimeout);
  } catch (err) {
    if (authTimeout.aborted) {
      log.error("[chat] auth timed out after 30s");
      currentTrace()?.add("auth", "timed out after 30s");
      throw new Error("Devin auth timed out after 30s");
    }
    log.error("[chat] auth failed:", err);
    currentTrace()?.add("auth", "failed", { error: String((err as Error).message ?? err) });
    throw err;
  }
  const chatBaseUrl = auth.baseUrl ?? baseUrl;

  const cascadeId = params.cascadeId ?? crypto.randomUUID();
  const stopPatterns = [...DEFAULT_STOP_PATTERNS, ...(params.stopSequences ?? [])];
  const maxTokens = params.maxTokens ?? 64000;
  // Codeium's upstream rejects temperature=0 with invalid_argument for some
  // models (e.g. glm-5-2). proto3 omits the field when it equals the default
  // (0.0), so the server sees an unset temperature and errors. Clamp 0 to a
  // negligible positive value that is indistinguishable from deterministic
  // output but keeps the upstream happy.
  const temperature = params.temperature === 0 ? 0.01 : (params.temperature ?? 0.4);

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
    toolChoice: params.toolChoice ?? { optionName: "auto" },
    cascadeId,
    executionId: crypto.randomUUID(),
  };

  const reqBytes = encodeGetChatMessageRequest(request);
  const gz = gzipSync(reqBytes);
  const frame = Buffer.alloc(5 + gz.length);
  frame[0] = CONNECT_COMPRESSED_FLAG;
  frame.writeUInt32BE(gz.length, 1);
  frame.set(gz, 5);

  // Upstream idle guard: abort if Codeium stops sending data for too long,
  // turning a silent hang into an explicit error instead of an infinite wait
  // (or a downstream EOF). Re-armed on every chunk so long, active streams
  // are not cut off — only true silence triggers it.
  const UPSTREAM_IDLE_MS = params.upstreamIdleTimeoutMs ?? 120_000;
  const chatController = new AbortController();
  const chatSignal = params.signal ? AbortSignal.any([params.signal, chatController.signal]) : chatController.signal;
  let idleTimer: Timer | undefined;
  const armIdleTimer = (): void => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => chatController.abort(new Error("upstream idle timeout")), UPSTREAM_IDLE_MS);
  };

  let response: Response;
  try {
    armIdleTimer();
    log.debug(`[chat] POST ${chatBaseUrl}${CHAT_MESSAGE_PATH} model=${params.modelUid} cascade=${cascadeId}`);
    currentTrace()?.add("chat", `POST ${chatBaseUrl}${CHAT_MESSAGE_PATH}`, { model: params.modelUid, cascadeId });
    response = await fetch(`${chatBaseUrl}${CHAT_MESSAGE_PATH}`, {
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
      signal: chatSignal,
    });
  } catch (err) {
    clearTimeout(idleTimer);
    if (chatController.signal.aborted) {
      log.error(`[chat] timed out: no response within ${UPSTREAM_IDLE_MS / 1000}s`);
      currentTrace()?.add("chat", `timed out: no response within ${UPSTREAM_IDLE_MS / 1000}s`);
      throw new Error(`Devin stream timed out: no response within ${UPSTREAM_IDLE_MS / 1000}s`);
    }
    log.error("[chat] fetch failed:", err);
    currentTrace()?.add("chat", "fetch failed", { error: String((err as Error).message ?? err) });
    throw err;
  }

  if (!response.ok) {
    const text = await response.text();
    log.error(`[chat] upstream returned ${response.status} ${response.statusText}: ${text}`);
    currentTrace()?.add("chat", `upstream returned ${response.status} ${response.statusText}`, { response: text });
    throw new Error(`Devin API ${response.status} ${response.statusText}: ${text}`);
  }
  if (!response.body) {
    log.error("[chat] upstream returned empty body");
    currentTrace()?.add("chat", "upstream returned empty body");
    throw new Error("Devin API: empty response body");
  }

  const reader = response.body.getReader();
  let pending = Buffer.alloc(0);
  let lastStopReason = 0;
  let lastUsage: GetChatMessageResponse["usage"] = null;

  for (;;) {
    let done: boolean, value: Uint8Array | undefined;
    try {
      ({ done, value } = await reader.read());
    } catch (err) {
      clearTimeout(idleTimer);
      if (chatController.signal.aborted) {
        log.error(`[chat] stream timed out: no upstream data for ${UPSTREAM_IDLE_MS / 1000}s`);
        currentTrace()?.add("chat", `stream timed out: no upstream data for ${UPSTREAM_IDLE_MS / 1000}s`);
        throw new Error(`Devin stream timed out: no upstream data for ${UPSTREAM_IDLE_MS / 1000}s`);
      }
      log.error("[chat] stream read failed:", err);
      currentTrace()?.add("chat", "stream read failed", { error: String((err as Error).message ?? err) });
      throw err;
    }
    if (!done) armIdleTimer();
    if (value && value.length > 0) {
      pending = Buffer.concat([pending, value]);
    }

    while (pending.length >= 5) {
      const flag = pending[0];
      const len = pending.readUInt32BE(1);
      if (len > MAX_FRAME_PAYLOAD) {
        clearTimeout(idleTimer);
        log.error(`[chat] frame length ${len} exceeds ${MAX_FRAME_PAYLOAD} bytes`);
        currentTrace()?.add("chat", `frame length ${len} exceeds ${MAX_FRAME_PAYLOAD} bytes`);
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
              const errMsg = `Devin stream error ${parsed.error.code}: ${parsed.error.message ?? ""}`;
              log.error(`[chat] upstream end-stream error: ${errMsg}`);
              currentTrace()?.add("chat", `upstream end-stream error: ${errMsg}`, { code: parsed.error.code });
              yield {
                type: "error",
                error: errMsg,
              };
              // Yield a terminal `done` so downstream consumers receive the
              // accumulated stopReason and a consistent termination signal.
              // Usage was already yielded inline as data frames arrived (the
              // end-stream trailer is always the last frame), so it is not
              // re-yielded here.
              clearTimeout(idleTimer);
              yield { type: "done", stopReason: lastStopReason, usage: lastUsage };
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

  clearTimeout(idleTimer);
  yield { type: "done", stopReason: lastStopReason, usage: lastUsage };
}

// ─── Model discovery (optional) ──────────────────────────────────────────────
export interface DiscoveredModel {
  id: string;
  name: string;
  contextWindow: number;
  maxTokens: number;
  reasoning: boolean;
  /** True when the model accepts image inputs. */
  supportsImages: boolean;
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
    log.error(`[discover] upstream returned ${res.status} ${res.statusText}: ${text}`);
    currentTrace()?.add("discover", `upstream returned ${res.status} ${res.statusText}`, { response: text });
    throw new Error(`Devin model discovery ${res.status} ${res.statusText}: ${text}`);
  }
  const data = new Uint8Array(await res.arrayBuffer());
  // Decode GetCliModelConfigsResponse and its repeated ClientModelConfig field.
  // Field numbers follow the reference Codeium proto; malformed payloads fail closed.
  try {
    return parseCliModelConfigs(data);
  } catch (err) {
    log.warn(`[discover] failed to parse model configs: ${(err as Error).message ?? err}`);
    currentTrace()?.add("discover", "failed to parse model configs", { error: String((err as Error).message ?? err) });
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


/** Label wording that implies a thinking / reasoning-effort variant. */
const REASONING_LABEL_PATTERN = /think|thinking|minimal|high|medium|low|xhigh|max|reasoning/i;
const NO_REASONING_LABEL_PATTERN = /\bno thinking\b/i;

/** Parse `ModelFeatures` (field 6 of `ModelInfo`) for `supports_thinking` (field 15). */
function parseModelFeaturesThinking(decoder: ProtoDecoder): boolean {
  while (!decoder.done) {
    const { field, wire } = decoder.readTag();
    if (field === 15 && wire === 0) {
      return decoder.readVarint() !== 0n;
    }
    decoder.skip(wire);
  }
  return false;
}

/** Parse `ModelInfo` (field 23 of `ClientModelConfig`) for its `model_features` (field 6). */
function parseModelInfoThinking(decoder: ProtoDecoder): boolean {
  while (!decoder.done) {
    const { field, wire } = decoder.readTag();
    if (field === 6 && wire === 2) {
      return decoder.readMessage(parseModelFeaturesThinking);
    }
    decoder.skip(wire);
  }
  return false;
}

function parseClientModelConfig(decoder: ProtoDecoder): DiscoveredModel | null {
  let id = "";
  let label = "";
  let disabled = false;
  let configuredMaxTokens = 0;
  let supportsImages = false;
  let supportsThinking = false;

  while (!decoder.done) {
    const { field, wire } = decoder.readTag();
    if (field === 1 && wire === 2) {
      label = decoder.readString();
    } else if (field === 4 && wire === 0) {
      disabled = decoder.readVarint() !== 0n;
    } else if (field === 5 && wire === 0) {
      supportsImages = decoder.readVarint() !== 0n;
    } else if (field === 18 && wire === 0) {
      configuredMaxTokens = Number(decoder.readVarint());
    } else if (field === 22 && wire === 2) {
      id = decoder.readString();
    } else if (field === 23 && wire === 2) {
      supportsThinking = decoder.readMessage(parseModelInfoThinking);
    } else {
      decoder.skip(wire);
    }
  }

  if (disabled || !id.trim()) return null;

  const reasoning = !NO_REASONING_LABEL_PATTERN.test(label) &&
    (supportsThinking || REASONING_LABEL_PATTERN.test(label));
  const contextWindow = configuredMaxTokens > 0 ? configuredMaxTokens : 200_000;
  const maxTokens = Math.min(configuredMaxTokens > 0 ? configuredMaxTokens : 64_000, 64_000);
  return {
    id: id.trim(),
    name: label.trim() || id.trim(),
    contextWindow,
    maxTokens,
    reasoning,
    supportsImages,
  };
}
