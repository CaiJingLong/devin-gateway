import { expect, test } from "bun:test";

import { listModels } from "../src/models.ts";
import { startServer } from "../src/server.ts";

const HOST = "127.0.0.1";
const REMOTE_MODEL_ID = "remote-fixture-model";

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

function encodeMessage(field: number, payload: number[]): number[] {
  return [...encodeTag(field, 2), ...encodeVarint(payload.length), ...payload];
}

function modelDiscoveryResponse(): Uint8Array {
  const model = [
    ...encodeString(1, "Remote Fixture Model"),
    ...encodeUint32(18, 128_000),
    ...encodeString(22, REMOTE_MODEL_ID),
  ];
  return Uint8Array.from(encodeMessage(1, model));
}

async function reservePort(): Promise<number> {
  const probe = Bun.serve({
    hostname: HOST,
    port: 0,
    fetch: () => new Response(null),
  });
  const port = probe.port;
  await probe.stop();
  return port;
}

interface ModelsResponse {
  source?: string;
  data: Array<{
    id: string;
    object: string;
    created: number;
    owned_by: string;
    context_window?: number;
    max_tokens?: number;
    reasoning?: boolean;
  }>;
}

test("selects remote models by default and the built-in catalog when source=local", async () => {
  const upstream = Bun.serve({
    hostname: HOST,
    port: 0,
    fetch: () => new Response(modelDiscoveryResponse(), {
      headers: { "content-type": "application/proto" },
    }),
  });
  const signals = ["SIGINT", "SIGTERM"] as const;
  const signalListenersBefore = new Map(
    signals.map((signal) => [signal, new Set(process.listeners(signal))]),
  );
  let gateway: Awaited<ReturnType<typeof startServer>> | undefined;

  try {
    const port = await reservePort();
    gateway = await startServer({
      host: HOST,
      port,
      token: "test-session-token",
      baseUrl: upstream.url.origin,
      watchTokenFile: false,
    });
    const gatewayUrl = `http://${HOST}:${port}`;

    const [defaultResponse, localResponse] = await Promise.all([
      fetch(`${gatewayUrl}/v1/models`),
      fetch(`${gatewayUrl}/v1/models?source=local`),
    ]);
    expect(defaultResponse.status).toBe(200);
    expect(localResponse.status).toBe(200);

    const defaultBody = await defaultResponse.json() as ModelsResponse;
    const localBody = await localResponse.json() as ModelsResponse;

    expect(localBody.data.map(({ id }) => id)).toEqual(listModels().map(({ id }) => id));
    expect(defaultBody.source).toBe("remote");
    expect(defaultBody.data).toEqual([{
      id: REMOTE_MODEL_ID,
      object: "model",
      created: 1700000000,
      owned_by: "devin",
      context_window: 128_000,
      max_tokens: 64_000,
      reasoning: true,
    }]);
  } finally {
    try {
      await gateway?.stop();
    } finally {
      try {
        await upstream.stop();
      } finally {
        for (const signal of signals) {
          const listenersBefore = signalListenersBefore.get(signal)!;
          for (const listener of process.listeners(signal)) {
            if (!listenersBefore.has(listener)) process.removeListener(signal, listener);
          }
        }
      }
    }
  }
}, 5_000);
