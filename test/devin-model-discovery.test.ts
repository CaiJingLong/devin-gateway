import { expect, test } from "bun:test";

import { discoverModels } from "../src/devin.ts";

function encodeVarint(value: number): number[] {
  const bytes: number[] = [];
  let remaining = BigInt(value);
  do {
    let byte = Number(remaining & 0x7fn);
    remaining >>= 7n;
    if (remaining !== 0n) byte |= 0x80;
    bytes.push(byte);
  } while (remaining !== 0n);
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

function encodeFloat(field: number, value: number): number[] {
  const payload = new Uint8Array(4);
  new DataView(payload.buffer).setFloat32(0, value, true);
  return [...encodeTag(field, 5), ...payload];
}

function encodeMessage(field: number, payload: number[]): number[] {
  return [...encodeTag(field, 2), ...encodeVarint(payload.length), ...payload];
}

function encodeClientModelConfig(config: {
  label: string;
  modelUid: string;
  disabled: boolean;
  maxTokens: number;
  supportsImages?: boolean;
  supportsThinking?: boolean;
}): number[] {
  const bytes = [
    ...encodeString(1, config.label),
    ...encodeFloat(3, 1.25),
    ...encodeUint32(4, config.disabled ? 1 : 0),
    ...encodeString(8, "beta"),
    ...encodeUint32(18, config.maxTokens),
    ...encodeString(22, config.modelUid),
  ];
  if (config.supportsImages) bytes.push(...encodeUint32(5, 1));
  if (config.supportsThinking !== undefined) {
    const modelFeatures = [...encodeUint32(15, config.supportsThinking ? 1 : 0)];
    const modelInfo = [...encodeMessage(6, modelFeatures)];
    bytes.push(...encodeMessage(23, modelInfo));
  }
  return bytes;
}

test("discovers models from the reference ClientModelConfig protobuf fields", async () => {
  const response = Uint8Array.from([
    ...encodeMessage(1, encodeClientModelConfig({
      label: "Stable Model",
      modelUid: "stable-model-uid",
      disabled: false,
      maxTokens: 128_000,
    })),
    ...encodeMessage(1, encodeClientModelConfig({
      label: "Disabled Model",
      modelUid: "disabled-model-uid",
      disabled: true,
      maxTokens: 32_000,
    })),
  ]);
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response(response, {
      headers: { "content-type": "application/proto" },
    }),
  });

  try {
    const models = await discoverModels("test-session-token", server.url.origin);

    expect(models.map(({ id, name, contextWindow, maxTokens, reasoning, supportsImages }) => ({
      id,
      name,
      contextWindow,
      maxTokens,
      reasoning,
      supportsImages,
    }))).toEqual([{
      id: "stable-model-uid",
      name: "Stable Model",
      contextWindow: 128_000,
      maxTokens: 64_000,
      reasoning: false,
      supportsImages: false,
    }]);
  } finally {
    await server.stop();
  }
});

test("supportsImages (field 5) and supportsThinking (field 23→6→15) are decoded", async () => {
  const response = Uint8Array.from([
    ...encodeMessage(1, encodeClientModelConfig({
      label: "Vision Thinking Model",
      modelUid: "vision-thinking",
      disabled: false,
      maxTokens: 200_000,
      supportsImages: true,
      supportsThinking: true,
    })),
  ]);
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response(response, {
      headers: { "content-type": "application/proto" },
    }),
  });
  try {
    const models = await discoverModels("tok", server.url.origin);
    expect(models[0].supportsImages).toBe(true);
    expect(models[0].reasoning).toBe(true);
  } finally {
    await server.stop();
  }
});

test("reasoning falls back to label pattern when supportsThinking is false", async () => {
  const response = Uint8Array.from([
    ...encodeMessage(1, encodeClientModelConfig({
      label: "GPT-4o Thinking",
      modelUid: "gpt-4o-think",
      disabled: false,
      maxTokens: 128_000,
      supportsThinking: false,
    })),
  ]);
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response(response, {
      headers: { "content-type": "application/proto" },
    }),
  });
  try {
    const models = await discoverModels("tok", server.url.origin);
    expect(models[0].reasoning).toBe(true); // label contains "thinking"
  } finally {
    await server.stop();
  }
});

test("'no thinking' label overrides supportsThinking=true → reasoning false", async () => {
  const response = Uint8Array.from([
    ...encodeMessage(1, encodeClientModelConfig({
      label: "Claude no thinking",
      modelUid: "claude-no-think",
      disabled: false,
      maxTokens: 128_000,
      supportsThinking: true,
    })),
  ]);
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response(response, {
      headers: { "content-type": "application/proto" },
    }),
  });
  try {
    const models = await discoverModels("tok", server.url.origin);
    expect(models[0].reasoning).toBe(false);
  } finally {
    await server.stop();
  }
});

test("supportsThinking=false and neutral label → reasoning false", async () => {
  const response = Uint8Array.from([
    ...encodeMessage(1, encodeClientModelConfig({
      label: "Standard Model",
      modelUid: "standard",
      disabled: false,
      maxTokens: 128_000,
      supportsThinking: false,
    })),
  ]);
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response(response, {
      headers: { "content-type": "application/proto" },
    }),
  });
  try {
    const models = await discoverModels("tok", server.url.origin);
    expect(models[0].reasoning).toBe(false);
  } finally {
    await server.stop();
  }
});
