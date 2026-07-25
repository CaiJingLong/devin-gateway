import { expect, test, describe } from "bun:test";

import {
  ProtoEncoder,
  ProtoDecoder,
  ChatMessageSource,
  StopReason,
  encodeMetadata,
  encodeGetUserJwtRequest,
  decodeGetUserJwtResponse,
  decodeChatToolCall,
  encodeChatMessagePrompt,
  encodeGetChatMessageRequest,
  decodeGetChatMessageResponse,
  type Metadata,
  type ChatMessagePrompt,
  type ChatToolCall,
  type GetChatMessageRequest,
  type CompletionConfiguration,
  type ChatToolDefinition,
  type ChatToolChoice,
} from "../src/proto.ts";

// ─── Byte-construction helpers (raw wire format, decoder-side assertions) ───

function encodeVarint(value: number | bigint): number[] {
  const bytes: number[] = [];
  let n = BigInt(value);
  do {
    let byte = Number(n & 0x7fn);
    n >>= 7n;
    if (n !== 0n) byte |= 0x80;
    bytes.push(byte);
  } while (n !== 0n);
  return bytes;
}

function encodeTag(field: number, wire: number): number[] {
  return encodeVarint((field << 3) | wire);
}

function encodeString(field: number, value: string): number[] {
  const payload = new TextEncoder().encode(value);
  return [...encodeTag(field, 2), ...encodeVarint(payload.length), ...payload];
}

function encodeUint32(field: number, value: number): number[] {
  return [...encodeTag(field, 0), ...encodeVarint(value)];
}

function encodeFixed64(field: number, bytes: number[]): number[] {
  return [...encodeTag(field, 1), ...bytes];
}

function encodeMessage(field: number, payload: number[]): number[] {
  return [...encodeTag(field, 2), ...encodeVarint(payload.length), ...payload];
}

function encodeChatToolCallBytes(tc: ChatToolCall): number[] {
  return [...encodeString(1, tc.id), ...encodeString(2, tc.name), ...encodeString(3, tc.argumentsJson)];
}

function encodeModelUsageStatsBytes(s: {
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
}): number[] {
  return [
    ...encodeUint32(2, s.inputTokens),
    ...encodeUint32(3, s.outputTokens),
    ...encodeUint32(4, s.cacheWriteTokens),
    ...encodeUint32(5, s.cacheReadTokens),
  ];
}

// ─── Metadata / GetUserJwt ──────────────────────────────────────────────────

describe("encodeMetadata / encodeGetUserJwtRequest", () => {
  const meta: Metadata = {
    ideName: "vscode",
    ideVersion: "1.90.0",
    extensionName: "devin",
    extensionVersion: "0.1.0",
    apiKey: "key-abc",
    locale: "en-US",
    userJwt: "jwt-xyz",
  };

  test("encodeGetUserJwtRequest produces non-empty bytes with field 1 = metadata submessage", () => {
    const bytes = encodeGetUserJwtRequest(meta);
    expect(bytes.length).toBeGreaterThan(0);
    const dec = new ProtoDecoder(bytes);
    const { field, wire } = dec.readTag();
    expect(field).toBe(1);
    expect(wire).toBe(2);
    // The submessage should contain the metadata fields.
    const sub = dec.readMessage((d) => {
      const seen: Record<number, string> = {};
      while (!d.done) {
        const t = d.readTag();
        if (t.wire === 2) seen[t.field] = d.readString();
        else d.skip(t.wire);
      }
      return seen;
    });
    expect(sub[1]).toBe("vscode"); // ideName
    expect(sub[7]).toBe("1.90.0"); // ideVersion
    expect(sub[12]).toBe("devin"); // extensionName
    expect(sub[2]).toBe("0.1.0"); // extensionVersion
    expect(sub[3]).toBe("key-abc"); // apiKey
    expect(sub[4]).toBe("en-US"); // locale
    expect(sub[21]).toBe("jwt-xyz"); // userJwt
    expect(dec.done).toBe(true);
  });

  test("encodeMetadata omits empty userJwt", () => {
    const enc = new ProtoEncoder();
    encodeMetadata(enc, { ...meta, userJwt: undefined });
    const dec = new ProtoDecoder(enc.finish());
    let sawField21 = false;
    while (!dec.done) {
      const t = dec.readTag();
      if (t.field === 21) sawField21 = true;
      dec.skip(t.wire);
    }
    expect(sawField21).toBe(false);
  });
});

describe("decodeGetUserJwtResponse", () => {
  test("empty data returns {userJwt:'', customApiServerUrl:''}", () => {
    expect(decodeGetUserJwtResponse(new Uint8Array(0))).toEqual({
      userJwt: "",
      customApiServerUrl: "",
    });
  });

  test("parses field1=userJwt and field2=customApiServerUrl", () => {
    const bytes = Uint8Array.from([
      ...encodeString(1, "the-jwt"),
      ...encodeString(2, "https://api.example.com"),
    ]);
    expect(decodeGetUserJwtResponse(bytes)).toEqual({
      userJwt: "the-jwt",
      customApiServerUrl: "https://api.example.com",
    });
  });

  test("non wire-2 fields are skipped, known fields still parsed", () => {
    const bytes = Uint8Array.from([
      ...encodeUint32(99, 7), // unknown varint field
      ...encodeString(1, "jwt"),
      ...encodeFixed64(50, [0, 0, 0, 0, 0, 0, 0, 0]), // unknown fixed64
      ...encodeString(2, "url"),
    ]);
    expect(decodeGetUserJwtResponse(bytes)).toEqual({
      userJwt: "jwt",
      customApiServerUrl: "url",
    });
  });
});

// ─── ChatToolCall (via decodeChatToolCall) ──────────────────────────────────

describe("decodeChatToolCall", () => {
  test("parses id/name/argumentsJson from raw bytes", () => {
    const bytes = Uint8Array.from(
      encodeChatToolCallBytes({
        id: "call_1",
        name: "search",
        argumentsJson: '{"q":"hello"}',
      }),
    );
    const dec = new ProtoDecoder(bytes);
    expect(decodeChatToolCall(dec)).toEqual({
      id: "call_1",
      name: "search",
      argumentsJson: '{"q":"hello"}',
    });
  });

  test("empty data returns all defaults", () => {
    const dec = new ProtoDecoder(new Uint8Array(0));
    expect(decodeChatToolCall(dec)).toEqual({ id: "", name: "", argumentsJson: "" });
  });

  test("unknown fields are skipped, known fields still parsed", () => {
    const bytes = Uint8Array.from([
      ...encodeUint32(99, 5), // unknown varint
      ...encodeString(1, "id"),
      ...encodeMessage(50, [0x01, 0x02]), // unknown length-delimited
      ...encodeString(2, "name"),
      ...encodeString(3, "{}"),
    ]);
    const dec = new ProtoDecoder(bytes);
    expect(decodeChatToolCall(dec)).toEqual({ id: "id", name: "name", argumentsJson: "{}" });
  });

  test("round-trips through encodeChatMessagePrompt's toolCalls encoding", () => {
    const prompt: ChatMessagePrompt = {
      messageId: "m1",
      source: ChatMessageSource.USER,
      prompt: "hi",
      toolCalls: [
        { id: "c1", name: "foo", argumentsJson: '{"a":1}' },
        { id: "c2", name: "bar", argumentsJson: '{"b":2}' },
      ],
    };
    const enc = new ProtoEncoder();
    encodeChatMessagePrompt(enc, prompt);
    const dec = new ProtoDecoder(enc.finish());
    const toolCalls: ChatToolCall[] = [];
    while (!dec.done) {
      const { field, wire } = dec.readTag();
      if (field === 6 && wire === 2) {
        toolCalls.push(dec.readMessage(decodeChatToolCall));
      } else {
        dec.skip(wire);
      }
    }
    expect(toolCalls).toEqual([
      { id: "c1", name: "foo", argumentsJson: '{"a":1}' },
      { id: "c2", name: "bar", argumentsJson: '{"b":2}' },
    ]);
  });
});

// ─── encodeChatMessagePrompt ────────────────────────────────────────────────

describe("encodeChatMessagePrompt", () => {
  test("encodes source/prompt/thinking/images/toolCalls with correct field numbers", () => {
    const prompt: ChatMessagePrompt = {
      messageId: "mid-9",
      source: ChatMessageSource.SYSTEM,
      prompt: "do thing",
      thinking: "reasoning here",
      images: [
        { base64Data: "b64A", mimeType: "image/png" },
        { base64Data: "b64B", mimeType: "image/jpeg" },
      ],
      toolCalls: [{ id: "t1", name: "n", argumentsJson: "{}" }],
    };
    const enc = new ProtoEncoder();
    encodeChatMessagePrompt(enc, prompt);
    const dec = new ProtoDecoder(enc.finish());

    const fields: Record<number, unknown> = {};
    let imageCount = 0;
    let toolCallCount = 0;
    while (!dec.done) {
      const { field, wire } = dec.readTag();
      switch (field) {
        case 1:
          fields[1] = dec.readString();
          break;
        case 2:
          fields[2] = Number(dec.readVarint());
          break;
        case 3:
          fields[3] = dec.readString();
          break;
        case 6:
          dec.readMessage(() => {});
          toolCallCount++;
          break;
        case 10:
          dec.readMessage(() => {});
          imageCount++;
          break;
        case 11:
          fields[11] = dec.readString();
          break;
        default:
          dec.skip(wire);
      }
    }
    expect(fields[1]).toBe("mid-9");
    expect(fields[2]).toBe(ChatMessageSource.SYSTEM);
    expect(fields[3]).toBe("do thing");
    expect(fields[11]).toBe("reasoning here");
    expect(imageCount).toBe(2);
    expect(toolCallCount).toBe(1);
  });

  test("omits zero-value source and empty optional fields", () => {
    const enc = new ProtoEncoder();
    encodeChatMessagePrompt(enc, {
      messageId: "",
      source: 0,
      prompt: "",
    });
    // All fields are zero/empty -> no bytes.
    expect(enc.finish().length).toBe(0);
  });

  test("encodes toolCallId and toolResultIsError", () => {
    const enc = new ProtoEncoder();
    encodeChatMessagePrompt(enc, {
      messageId: "m",
      source: ChatMessageSource.TOOL,
      prompt: "result",
      toolCallId: "tc-1",
      toolResultIsError: true,
    });
    const dec = new ProtoDecoder(enc.finish());
    let toolCallId: string | undefined;
    let isError: bigint | undefined;
    let source: bigint | undefined;
    while (!dec.done) {
      const { field, wire } = dec.readTag();
      if (field === 2) source = dec.readVarint();
      else if (field === 7) toolCallId = dec.readString();
      else if (field === 9) isError = dec.readVarint();
      else dec.skip(wire);
    }
    expect(source).toBe(BigInt(ChatMessageSource.TOOL));
    expect(toolCallId).toBe("tc-1");
    expect(isError).toBe(1n);
  });
});

// ─── encodeGetChatMessageRequest ────────────────────────────────────────────

describe("encodeGetChatMessageRequest", () => {
  function sampleRequest(): GetChatMessageRequest {
    const configuration: CompletionConfiguration = {
      numCompletions: 1n,
      maxTokens: 4096n,
      maxNewlines: 10n,
      temperature: 0.2,
      firstTemperature: 0.1,
      topK: 40n,
      topP: 0.95,
      stopPatterns: ["stop1", "stop2"],
      fimEotProbThreshold: 0.0,
    };
    const tools: ChatToolDefinition[] = [
      { name: "toolA", description: "desc A", jsonSchemaString: '{"type":"object"}', strict: true },
    ];
    const toolChoice: ChatToolChoice = { optionName: "auto", toolName: undefined };
    return {
      metadata: {
        ideName: "ide",
        ideVersion: "1.0",
        extensionName: "ext",
        extensionVersion: "0.1",
        apiKey: "k",
        locale: "en",
      },
      prompt: "main prompt",
      chatMessagePrompts: [
        { messageId: "p1", source: ChatMessageSource.USER, prompt: "hello" },
        { messageId: "p2", source: ChatMessageSource.SYSTEM, prompt: "hi back" },
      ],
      chatModelUid: "model-uid-7",
      configuration,
      tools,
      disableParallelToolCalls: true,
      toolChoice,
      cascadeId: "cascade-1",
      executionId: "exec-1",
    };
  }

  test("produces non-empty bytes", () => {
    expect(encodeGetChatMessageRequest(sampleRequest()).length).toBeGreaterThan(0);
  });

  test("top-level field 1 is metadata submessage", () => {
    const dec = new ProtoDecoder(encodeGetChatMessageRequest(sampleRequest()));
    const { field, wire } = dec.readTag();
    expect(field).toBe(1);
    expect(wire).toBe(2);
  });

  test("top-level field 21 is chatModelUid", () => {
    const dec = new ProtoDecoder(encodeGetChatMessageRequest(sampleRequest()));
    let chatModelUid: string | undefined;
    while (!dec.done) {
      const { field, wire } = dec.readTag();
      if (field === 21) chatModelUid = dec.readString();
      else dec.skip(wire);
    }
    expect(chatModelUid).toBe("model-uid-7");
  });

  test("field 3 is repeated prompts with two entries", () => {
    const dec = new ProtoDecoder(encodeGetChatMessageRequest(sampleRequest()));
    let promptCount = 0;
    while (!dec.done) {
      const { field, wire } = dec.readTag();
      if (field === 3) {
        promptCount++;
        dec.readMessage(() => {});
      } else {
        dec.skip(wire);
      }
    }
    expect(promptCount).toBe(2);
  });

  test("field 2 is the prompt string", () => {
    const dec = new ProtoDecoder(encodeGetChatMessageRequest(sampleRequest()));
    let prompt: string | undefined;
    while (!dec.done) {
      const { field, wire } = dec.readTag();
      if (field === 2) prompt = dec.readString();
      else dec.skip(wire);
    }
    expect(prompt).toBe("main prompt");
  });

  test("field 16 is cascadeId, field 22 is executionId", () => {
    const dec = new ProtoDecoder(encodeGetChatMessageRequest(sampleRequest()));
    let cascadeId: string | undefined;
    let executionId: string | undefined;
    while (!dec.done) {
      const { field, wire } = dec.readTag();
      if (field === 16) cascadeId = dec.readString();
      else if (field === 22) executionId = dec.readString();
      else dec.skip(wire);
    }
    expect(cascadeId).toBe("cascade-1");
    expect(executionId).toBe("exec-1");
  });
});

// ─── decodeGetChatMessageResponse ───────────────────────────────────────────

describe("decodeGetChatMessageResponse", () => {
  test("empty data returns all defaults", () => {
    expect(decodeGetChatMessageResponse(new Uint8Array(0))).toEqual({
      messageId: "",
      deltaText: "",
      stopReason: 0,
      deltaToolCalls: [],
      usage: null,
      deltaThinking: "",
      deltaSignature: "",
    });
  });

  test("parses messageId/deltaText/stopReason/deltaThinking/deltaSignature", () => {
    const bytes = Uint8Array.from([
      ...encodeString(1, "msg-1"),
      ...encodeString(3, "delta body"),
      ...encodeUint32(5, StopReason.MAX_TOKENS),
      ...encodeString(9, "thinking..."),
      ...encodeString(10, "sig"),
    ]);
    expect(decodeGetChatMessageResponse(bytes)).toEqual({
      messageId: "msg-1",
      deltaText: "delta body",
      stopReason: StopReason.MAX_TOKENS,
      deltaToolCalls: [],
      usage: null,
      deltaThinking: "thinking...",
      deltaSignature: "sig",
    });
  });

  test("parses field 6 ChatToolCall submessages into deltaToolCalls", () => {
    const bytes = Uint8Array.from([
      ...encodeMessage(6, encodeChatToolCallBytes({ id: "c1", name: "n1", argumentsJson: "{}" })),
      ...encodeMessage(6, encodeChatToolCallBytes({ id: "c2", name: "n2", argumentsJson: "[]" })),
    ]);
    const res = decodeGetChatMessageResponse(bytes);
    expect(res.deltaToolCalls).toEqual([
      { id: "c1", name: "n1", argumentsJson: "{}" },
      { id: "c2", name: "n2", argumentsJson: "[]" },
    ]);
  });

  test("parses field 7 ModelUsageStats submessage into usage", () => {
    const bytes = Uint8Array.from([
      ...encodeMessage(7, encodeModelUsageStatsBytes({
        inputTokens: 100,
        outputTokens: 200,
        cacheWriteTokens: 300,
        cacheReadTokens: 400,
      })),
    ]);
    expect(decodeGetChatMessageResponse(bytes).usage).toEqual({
      inputTokens: 100,
      outputTokens: 200,
      cacheWriteTokens: 300,
      cacheReadTokens: 400,
    });
  });

  test("unknown length-delimited field (field 2) is skipped, deltaText still parsed", () => {
    const bytes = Uint8Array.from([
      ...encodeMessage(2, [0xaa, 0xbb, 0xcc]),
      ...encodeString(3, "after"),
    ]);
    expect(decodeGetChatMessageResponse(bytes).deltaText).toBe("after");
  });

  test("unknown varint field (field 4) is skipped, deltaText still parsed", () => {
    const bytes = Uint8Array.from([
      ...encodeUint32(4, 12345),
      ...encodeString(3, "after-varint"),
    ]);
    expect(decodeGetChatMessageResponse(bytes).deltaText).toBe("after-varint");
  });

  test("unknown fixed64 field (field 8) is skipped, deltaText still parsed", () => {
    const bytes = Uint8Array.from([
      ...encodeFixed64(8, [1, 2, 3, 4, 5, 6, 7, 8]),
      ...encodeString(3, "after-fixed64"),
    ]);
    expect(decodeGetChatMessageResponse(bytes).deltaText).toBe("after-fixed64");
  });

  test("full response with mixed known and unknown fields", () => {
    const bytes = Uint8Array.from([
      ...encodeString(1, "msg-full"),
      ...encodeUint32(4, 999), // unknown varint
      ...encodeString(3, "text"),
      ...encodeMessage(6, encodeChatToolCallBytes({ id: "tc", name: "tool", argumentsJson: '{"x":1}' })),
      ...encodeMessage(7, encodeModelUsageStatsBytes({
        inputTokens: 10,
        outputTokens: 20,
        cacheWriteTokens: 0,
        cacheReadTokens: 0,
      })),
      ...encodeFixed64(8, [0, 0, 0, 0, 0, 0, 0, 0]), // unknown fixed64
      ...encodeUint32(5, StopReason.FUNCTION_CALL),
      ...encodeString(9, "think"),
      ...encodeString(10, "sig"),
    ]);
    expect(decodeGetChatMessageResponse(bytes)).toEqual({
      messageId: "msg-full",
      deltaText: "text",
      stopReason: StopReason.FUNCTION_CALL,
      deltaToolCalls: [{ id: "tc", name: "tool", argumentsJson: '{"x":1}' }],
      usage: { inputTokens: 10, outputTokens: 20, cacheWriteTokens: 0, cacheReadTokens: 0 },
      deltaThinking: "think",
      deltaSignature: "sig",
    });
  });
});

// ─── ModelUsageStats (via decodeGetChatMessageResponse field 7) ─────────────

describe("ModelUsageStats decoding", () => {
  test("field2=inputTokens, field3=outputTokens, field4=cacheWriteTokens, field5=cacheReadTokens", () => {
    const bytes = Uint8Array.from([
      ...encodeMessage(7, [
        ...encodeUint32(2, 11),
        ...encodeUint32(3, 22),
        ...encodeUint32(4, 33),
        ...encodeUint32(5, 44),
      ]),
    ]);
    expect(decodeGetChatMessageResponse(bytes).usage).toEqual({
      inputTokens: 11,
      outputTokens: 22,
      cacheWriteTokens: 33,
      cacheReadTokens: 44,
    });
  });

  test("empty usage submessage returns all-zero stats", () => {
    const bytes = Uint8Array.from([...encodeMessage(7, [])]);
    expect(decodeGetChatMessageResponse(bytes).usage).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
    });
  });

  test("unknown field inside usage submessage is skipped", () => {
    const bytes = Uint8Array.from([
      ...encodeMessage(7, [
        ...encodeUint32(99, 7), // unknown
        ...encodeUint32(2, 111),
        ...encodeMessage(50, [0x01]), // unknown length-delimited
        ...encodeUint32(3, 222),
      ]),
    ]);
    const usage = decodeGetChatMessageResponse(bytes).usage!;
    expect(usage.inputTokens).toBe(111);
    expect(usage.outputTokens).toBe(222);
    expect(usage.cacheWriteTokens).toBe(0);
    expect(usage.cacheReadTokens).toBe(0);
  });
});
