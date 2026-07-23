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
}): number[] {
  return [
    ...encodeString(1, config.label),
    ...encodeFloat(3, 1.25),
    ...encodeUint32(4, config.disabled ? 1 : 0),
    ...encodeString(8, "beta"),
    ...encodeUint32(18, config.maxTokens),
    ...encodeString(22, config.modelUid),
  ];
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

    expect(models.map(({ id, name, contextWindow, maxTokens }) => ({
      id,
      name,
      contextWindow,
      maxTokens,
    }))).toEqual([{
      id: "stable-model-uid",
      name: "Stable Model",
      contextWindow: 128_000,
      maxTokens: 64_000,
    }]);
  } finally {
    await server.stop();
  }
});
