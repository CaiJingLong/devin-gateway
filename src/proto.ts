/**
 * Minimal protobuf binary encode/decode for the Devin/Codeium Cascade Connect API.
 *
 * Only the message shapes and field numbers actually used by the gateway are
 * implemented.  Proto3 semantics: zero-valued scalar fields are omitted;
 * strings/bytes default to ""; repeated fields are emitted as repeated tags
 * (no packed encoding for message/string types).
 */

// ─── Encoder ────────────────────────────────────────────────────────────────

export class ProtoEncoder {
  private buf: number[] = [];

  private varint(n: number): void {
    n = n >>> 0;
    while (n > 0x7f) {
      this.buf.push((n & 0x7f) | 0x80);
      n = n >>> 7;
    }
    this.buf.push(n);
  }

  private varintBig(n: bigint): void {
    n = n & 0xffffffffffffffffn;
    while (n > 0x7fn) {
      this.buf.push(Number(n & 0x7fn) | 0x80);
      n = n >> 7n;
    }
    this.buf.push(Number(n));
  }

  private tag(field: number, wire: number): void {
    this.varint((field << 3) | wire);
  }

  string(field: number, value: string | undefined | null): void {
    if (!value) return;
    const bytes = new TextEncoder().encode(value);
    this.tag(field, 2);
    this.varint(bytes.length);
    for (const b of bytes) this.buf.push(b);
  }

  uint32(field: number, value: number | undefined): void {
    if (value === undefined || value === 0) return;
    this.tag(field, 0);
    this.varint(value);
  }

  uint64(field: number, value: bigint | number | undefined): void {
    if (value === undefined || value === 0n || value === 0) return;
    this.tag(field, 0);
    this.varintBig(typeof value === "bigint" ? value : BigInt(value));
  }

  bool(field: number, value: boolean | undefined): void {
    if (!value) return;
    this.tag(field, 0);
    this.varint(1);
  }

  double(field: number, value: number | undefined): void {
    if (value === undefined || value === 0) return;
    this.tag(field, 1);
    const buf = new ArrayBuffer(8);
    new DataView(buf).setFloat64(0, value, true);
    for (const b of new Uint8Array(buf)) this.buf.push(b);
  }

  message(field: number, encode: (e: ProtoEncoder) => void): void {
    const sub = new ProtoEncoder();
    encode(sub);
    const subBytes = sub.finish();
    this.tag(field, 2);
    this.varint(subBytes.length);
    for (const b of subBytes) this.buf.push(b);
  }

  repeatedMessage<T>(
    field: number,
    values: T[] | undefined,
    encode: (e: ProtoEncoder, v: T) => void,
  ): void {
    if (!values || values.length === 0) return;
    for (const v of values) {
      this.message(field, (e) => encode(e, v));
    }
  }

  repeatedString(field: number, values: string[] | undefined): void {
    if (!values || values.length === 0) return;
    for (const v of values) {
      this.string(field, v);
    }
  }

  finish(): Uint8Array {
    return new Uint8Array(this.buf);
  }
}

// ─── Decoder ────────────────────────────────────────────────────────────────

export class ProtoDecoder {
  private bytes: Uint8Array;
  private view: DataView;
  pos = 0;

  constructor(data: Uint8Array) {
    this.bytes = data;
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }

  readVarint(): bigint {
    let result = 0n;
    let shift = 0n;
    while (this.pos < this.bytes.length) {
      const byte = this.bytes[this.pos++];
      result |= BigInt(byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) break;
      shift += 7n;
    }
    return result;
  }

  readTag(): { field: number; wire: number } {
    const tag = Number(this.readVarint());
    return { field: tag >>> 3, wire: tag & 0x07 };
  }

  readString(): string {
    const len = Number(this.readVarint());
    const start = this.pos;
    this.pos += len;
    return new TextDecoder().decode(this.bytes.subarray(start, start + len));
  }

  readBytes(): Uint8Array {
    const len = Number(this.readVarint());
    const start = this.pos;
    this.pos += len;
    return this.bytes.subarray(start, start + len);
  }

  readDouble(): number {
    const val = this.view.getFloat64(this.pos, true);
    this.pos += 8;
    return val;
  }

  skip(wire: number): void {
    switch (wire) {
      case 0:
        this.readVarint();
        break;
      case 1:
        this.pos += 8;
        break;
      case 2: {
        const length = Number(this.readVarint());
        this.pos += length;
        break;
      }
      case 5:
        this.pos += 4;
        break;
      default:
        throw new Error(`Unknown wire type: ${wire}`);
    }
  }

  get done(): boolean {
    return this.pos >= this.bytes.length;
  }

  readMessage<T>(fn: (d: ProtoDecoder) => T): T {
    const sub = new ProtoDecoder(this.readBytes());
    return fn(sub);
  }
}

// ─── Domain message encoders/decoders ───────────────────────────────────────

// Enum constants (proto3 numeric values)
export const ChatMessageSource = {
  UNSPECIFIED: 0,
  USER: 1,
  SYSTEM: 2,
  UNKNOWN: 3,
  TOOL: 4,
  SYSTEM_PROMPT: 5,
} as const;

export const StopReason = {
  UNSPECIFIED: 0,
  MAX_TOKENS: 3,
  FUNCTION_CALL: 10,
} as const;

export const ChatMessageRequestType = {
  CASCADE: 5,
} as const;

export const ConversationalPlannerMode = {
  DEFAULT: 1,
} as const;

export const CacheControlType = {
  EPHEMERAL: 1,
} as const;

// ─── Metadata ───────────────────────────────────────────────────────────────

export interface Metadata {
  ideName: string;
  ideVersion: string;
  extensionName: string;
  extensionVersion: string;
  apiKey: string;
  locale: string;
  userJwt?: string;
}

export function encodeMetadata(e: ProtoEncoder, m: Metadata): void {
  e.string(1, m.ideName);
  e.string(7, m.ideVersion);
  e.string(12, m.extensionName);
  e.string(2, m.extensionVersion);
  e.string(3, m.apiKey);
  e.string(4, m.locale);
  e.string(21, m.userJwt);
}

// ─── GetUserJwt ─────────────────────────────────────────────────────────────

export function encodeGetUserJwtRequest(m: Metadata): Uint8Array {
  const enc = new ProtoEncoder();
  enc.message(1, (e) => encodeMetadata(e, m));
  return enc.finish();
}

export interface GetUserJwtResponse {
  userJwt: string;
  customApiServerUrl: string;
}

export function decodeGetUserJwtResponse(data: Uint8Array): GetUserJwtResponse {
  const d = new ProtoDecoder(data);
  const res: GetUserJwtResponse = { userJwt: "", customApiServerUrl: "" };
  while (!d.done) {
    const { field, wire } = d.readTag();
    if (wire !== 2) {
      d.skip(wire);
      continue;
    }
    if (field === 1) res.userJwt = d.readString();
    else if (field === 2) res.customApiServerUrl = d.readString();
    else d.skip(wire);
  }
  return res;
}

// ─── ChatToolCall ────────────────────────────────────────────────────────────

export interface ChatToolCall {
  id: string;
  name: string;
  argumentsJson: string;
  /** Raw arguments text when JSON parsing failed upstream. */
  invalidJsonStr?: string;
  /** Error message from upstream JSON parse failure. */
  invalidJsonErr?: string;
  /** True when the call targets a custom (non-built-in) tool. */
  isCustomToolCall?: boolean;
}

function encodeChatToolCall(e: ProtoEncoder, tc: ChatToolCall): void {
  e.string(1, tc.id);
  e.string(2, tc.name);
  e.string(3, tc.argumentsJson);
  e.string(4, tc.invalidJsonStr);
  e.string(5, tc.invalidJsonErr);
  e.bool(6, tc.isCustomToolCall);
}

export function decodeChatToolCall(d: ProtoDecoder): ChatToolCall {
  const tc: ChatToolCall = { id: "", name: "", argumentsJson: "" };
  while (!d.done) {
    const { field, wire } = d.readTag();
    switch (field) {
      case 1:
        tc.id = d.readString();
        break;
      case 2:
        tc.name = d.readString();
        break;
      case 3:
        tc.argumentsJson = d.readString();
        break;
      case 4:
        tc.invalidJsonStr = d.readString();
        break;
      case 5:
        tc.invalidJsonErr = d.readString();
        break;
      case 6:
        tc.isCustomToolCall = d.readVarint() !== 0n;
        break;
      default:
        d.skip(wire);
    }
  }
  return tc;
}

// ─── ImageData ───────────────────────────────────────────────────────────────

export interface ImageData {
  base64Data: string;
  mimeType: string;
}

function encodeImageData(e: ProtoEncoder, img: ImageData): void {
  e.string(1, img.base64Data);
  e.string(2, img.mimeType);
}

// ─── ChatMessagePrompt ───────────────────────────────────────────────────────

export interface ChatMessagePrompt {
  messageId: string;
  source: number;
  prompt: string;
  toolCalls?: ChatToolCall[];
  toolCallId?: string;
  toolResultIsError?: boolean;
  images?: ImageData[];
  thinking?: string;
  signature?: string;
  signatureType?: string;
}

export function encodeChatMessagePrompt(e: ProtoEncoder, p: ChatMessagePrompt): void {
  e.string(1, p.messageId);
  e.uint32(2, p.source);
  e.string(3, p.prompt);
  e.repeatedMessage(6, p.toolCalls, encodeChatToolCall);
  e.string(7, p.toolCallId);
  e.bool(9, p.toolResultIsError);
  e.repeatedMessage(10, p.images, encodeImageData);
  e.string(11, p.thinking);
  e.string(12, p.signature);
  e.string(18, p.signatureType);
}

// ─── ChatToolDefinition ──────────────────────────────────────────────────────

export interface ChatToolDefinition {
  name: string;
  description: string;
  jsonSchemaString: string;
  strict: boolean;
}

function encodeChatToolDefinition(e: ProtoEncoder, t: ChatToolDefinition): void {
  e.string(1, t.name);
  e.string(2, t.description);
  e.string(3, t.jsonSchemaString);
  e.bool(12, t.strict);
}

// ─── ChatToolChoice ──────────────────────────────────────────────────────────

export interface ChatToolChoice {
  optionName?: string;
  toolName?: string;
}

function encodeChatToolChoice(e: ProtoEncoder, c: ChatToolChoice): void {
  e.string(1, c.optionName);
  e.string(2, c.toolName);
}

// ─── CompletionConfiguration ─────────────────────────────────────────────────

export interface CompletionConfiguration {
  numCompletions: bigint;
  maxTokens: bigint;
  maxNewlines: bigint;
  temperature: number;
  firstTemperature: number;
  topK: bigint;
  topP: number;
  stopPatterns: string[];
  fimEotProbThreshold: number;
}

function encodeCompletionConfiguration(e: ProtoEncoder, c: CompletionConfiguration): void {
  e.uint64(1, c.numCompletions);
  e.uint64(2, c.maxTokens);
  e.uint64(3, c.maxNewlines);
  e.double(5, c.temperature);
  e.double(6, c.firstTemperature);
  e.uint64(7, c.topK);
  e.double(8, c.topP);
  e.repeatedString(9, c.stopPatterns);
  e.double(11, c.fimEotProbThreshold);
}

// ─── PromptCacheOptions ──────────────────────────────────────────────────────

function encodePromptCacheOptions(e: ProtoEncoder, type: number): void {
  e.uint32(1, type);
}

// ─── GetChatMessageRequest ───────────────────────────────────────────────────

export interface GetChatMessageRequest {
  metadata: Metadata;
  prompt: string;
  chatMessagePrompts: ChatMessagePrompt[];
  chatModelUid: string;
  configuration: CompletionConfiguration;
  tools: ChatToolDefinition[];
  disableParallelToolCalls: boolean;
  toolChoice: ChatToolChoice;
  cascadeId: string;
  executionId: string;
}

export function encodeGetChatMessageRequest(r: GetChatMessageRequest): Uint8Array {
  const enc = new ProtoEncoder();
  enc.message(1, (e) => encodeMetadata(e, r.metadata));
  enc.string(2, r.prompt);
  enc.repeatedMessage(3, r.chatMessagePrompts, encodeChatMessagePrompt);
  enc.string(21, r.chatModelUid);
  enc.uint32(7, ChatMessageRequestType.CASCADE);
  enc.message(8, (e) => encodeCompletionConfiguration(e, r.configuration));
  enc.repeatedMessage(10, r.tools, encodeChatToolDefinition);
  enc.bool(11, r.disableParallelToolCalls);
  enc.message(12, (e) => encodeChatToolChoice(e, r.toolChoice));
  enc.message(13, (e) => encodePromptCacheOptions(e, CacheControlType.EPHEMERAL));
  enc.string(16, r.cascadeId);
  enc.uint32(20, ConversationalPlannerMode.DEFAULT);
  enc.string(22, r.executionId);
  return enc.finish();
}

// ─── GetChatMessageResponse ──────────────────────────────────────────────────

export interface ModelUsageStats {
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  /** Server message id associated with this usage record. */
  messageId?: string;
  /** Model uid the server billed this turn under. */
  modelUid?: string;
}

export interface GetChatMessageResponse {
  messageId: string;
  deltaText: string;
  stopReason: number;
  deltaToolCalls: ChatToolCall[];
  usage: ModelUsageStats | null;
  deltaThinking: string;
  deltaSignature: string;
  /** True when the server redacted the delta text. */
  redact?: boolean;
  /** True when the server redacted the thinking content. */
  thinkingRedacted?: boolean;
  /** Signature type tag accompanying `deltaSignature` (e.g. provider-specific). */
  deltaSignatureType?: string;
  /** Server-assigned output id; threads assistant turns across requests. */
  outputId?: string;
  /** Server request id for debugging/log correlation. */
  requestId?: string;
  /** The model uid actually used (may differ from the requested uid). */
  actualModelUid?: string;
  /** Credit cost charged for this delta. */
  creditCost?: number;
}

export function decodeGetChatMessageResponse(data: Uint8Array): GetChatMessageResponse {
  const d = new ProtoDecoder(data);
  const res: GetChatMessageResponse = {
    messageId: "",
    deltaText: "",
    stopReason: 0,
    deltaToolCalls: [],
    usage: null,
    deltaThinking: "",
    deltaSignature: "",
  };
  while (!d.done) {
    const { field, wire } = d.readTag();
    switch (field) {
      case 1:
        res.messageId = d.readString();
        break;
      case 3:
        res.deltaText = d.readString();
        break;
      case 5:
        res.stopReason = Number(d.readVarint());
        break;
      case 6:
        res.deltaToolCalls.push(d.readMessage(decodeChatToolCall));
        break;
      case 7:
        res.usage = d.readMessage(decodeModelUsageStats);
        break;
      case 8:
        res.redact = d.readVarint() !== 0n;
        break;
      case 9:
        res.deltaThinking = d.readString();
        break;
      case 10:
        res.deltaSignature = d.readString();
        break;
      case 11:
        res.thinkingRedacted = d.readVarint() !== 0n;
        break;
      case 14:
        res.creditCost = Number(d.readVarint());
        break;
      case 15:
        res.outputId = d.readString();
        break;
      case 17:
        res.requestId = d.readString();
        break;
      case 21:
        res.deltaSignatureType = d.readString();
        break;
      case 23:
        res.actualModelUid = d.readString();
        break;
      default:
        d.skip(wire);
    }
  }
  return res;
}

function decodeModelUsageStats(d: ProtoDecoder): ModelUsageStats {
  const s: ModelUsageStats = {
    inputTokens: 0,
    outputTokens: 0,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
  };
  while (!d.done) {
    const { field, wire } = d.readTag();
    switch (field) {
      case 2:
        s.inputTokens = Number(d.readVarint());
        break;
      case 3:
        s.outputTokens = Number(d.readVarint());
        break;
      case 4:
        s.cacheWriteTokens = Number(d.readVarint());
        break;
      case 5:
        s.cacheReadTokens = Number(d.readVarint());
        break;
      case 7:
        s.messageId = d.readString();
        break;
      case 9:
        s.modelUid = d.readString();
        break;
      default:
        d.skip(wire);
    }
  }
  return s;
}
