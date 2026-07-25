import { expect, test, describe } from "bun:test";

import {
  startLoginFlow,
  completeLoginWithUrl,
  exchangeToken,
  type LoginSession,
} from "../src/login.ts";

const TOKEN_ENDPOINT = "https://api.devin.ai/auth/cli/token";

// A fetch double that records the request and returns a fresh Response per call
// (Response bodies are single-use, so a factory is required for repeated calls).
function recordingFetch(
  sink: { url: string; init?: RequestInit } | null,
  respond: () => Response,
): typeof fetch {
  return async (input: string | Request | URL, init?: RequestInit) => {
    if (sink) {
      sink.url = input.toString();
      sink.init = init;
    }
    return respond();
  };
}

function jsonRespond(body: unknown, status = 200): () => Response {
  return () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
}

describe("startLoginFlow", () => {
  test("returns a well-formed PKCE login session", async () => {
    const redirectUri = "http://localhost:8787/callback";
    const session = await startLoginFlow(redirectUri);

    expect(session.redirectUri).toBe(redirectUri);
    expect(typeof session.state).toBe("string");
    expect(session.state.length).toBeGreaterThan(0);
    expect(typeof session.verifier).toBe("string");
    expect(session.verifier.length).toBeGreaterThan(0);
    expect(typeof session.challenge).toBe("string");
    expect(session.challenge.length).toBe(43); // base64url(SHA256) of verifier

    // base64url alphabet: no padding, no +, no /
    expect(session.challenge).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(session.verifier).toMatch(/^[A-Za-z0-9_-]+$/);

    expect(session.authUrl.startsWith("https://app.devin.ai/auth/cli/continue?")).toBe(true);

    const url = new URL(session.authUrl);
    expect(url.searchParams.get("redirect_uri")).toBe(redirectUri);
    expect(url.searchParams.get("state")).toBe(session.state);
    expect(url.searchParams.get("prompt")).toBe("select_account");
    expect(url.searchParams.get("code_challenge")).toBe(session.challenge);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });

  test("challenge is the base64url SHA-256 of the verifier", async () => {
    const session = await startLoginFlow("http://localhost/cb");
    const digest = new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(session.verifier)),
    );
    const expected = btoa(String.fromCharCode(...digest))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(session.challenge).toBe(expected);
  });

  test("two flows produce independent state and verifier", async () => {
    const a = await startLoginFlow("http://localhost/cb");
    const b = await startLoginFlow("http://localhost/cb");
    expect(a.state).not.toBe(b.state);
    expect(a.verifier).not.toBe(b.verifier);
    expect(a.challenge).not.toBe(b.challenge);
  });
});

describe("exchangeToken", () => {
  test("posts code+verifier and returns the token on success", async () => {
    const real = globalThis.fetch;
    const captured: { url: string; init?: RequestInit } = { url: "", init: undefined };
    try {
      globalThis.fetch = recordingFetch(captured, jsonRespond({ token: "jwt-xyz" }));

      const token = await exchangeToken("code123", "verifier456");
      expect(token).toBe("jwt-xyz");

      expect(captured.url).toBe(TOKEN_ENDPOINT);
      expect(captured.init?.method).toBe("POST");
      const headers = new Headers(captured.init?.headers);
      expect(headers.get("content-type")).toBe("application/json");
      expect(captured.init?.body).toBe(
        JSON.stringify({ code: "code123", code_verifier: "verifier456" }),
      );
    } finally {
      globalThis.fetch = real;
    }
  });

  test("throws on non-ok response including status and body text", async () => {
    const real = globalThis.fetch;
    try {
      globalThis.fetch = recordingFetch(null, () =>
        new Response("bad request body", { status: 400 }),
      );

      await expect(exchangeToken("c", "v")).rejects.toThrow(/400/);
      await expect(exchangeToken("c", "v")).rejects.toThrow(/bad request body/);
    } finally {
      globalThis.fetch = real;
    }
  });

  test("throws on ok response with empty token", async () => {
    const real = globalThis.fetch;
    try {
      globalThis.fetch = recordingFetch(null, jsonRespond({ token: "" }));
      await expect(exchangeToken("c", "v")).rejects.toThrow(/empty token/);
    } finally {
      globalThis.fetch = real;
    }
  });

  test("throws on ok response missing token field", async () => {
    const real = globalThis.fetch;
    try {
      globalThis.fetch = recordingFetch(null, jsonRespond({ other: "x" }));
      await expect(exchangeToken("c", "v")).rejects.toThrow(/empty token/);
    } finally {
      globalThis.fetch = real;
    }
  });
});

describe("completeLoginWithUrl", () => {
  test("extracts code from redirect URL and exchanges it", async () => {
    const real = globalThis.fetch;
    try {
      globalThis.fetch = recordingFetch(null, jsonRespond({ token: "t" }));

      const session: LoginSession = await startLoginFlow("http://localhost/cb");
      const redirectUrl = `http://localhost/cb?code=abc&state=${session.state}`;
      const token = await completeLoginWithUrl(session, redirectUrl);
      expect(token).toBe("t");
    } finally {
      globalThis.fetch = real;
    }
  });

  test("throws when redirect URL has no code parameter", async () => {
    const session = await startLoginFlow("http://localhost/cb");
    const redirectUrl = `http://localhost/cb?state=${session.state}`;
    await expect(completeLoginWithUrl(session, redirectUrl)).rejects.toThrow(/No code/);
  });

  test("parses a relative redirect URL against the localhost base", async () => {
    const real = globalThis.fetch;
    const captured: { url: string; init?: RequestInit } = { url: "", init: undefined };
    try {
      globalThis.fetch = recordingFetch(captured, jsonRespond({ token: "rel" }));

      const session = await startLoginFlow("http://localhost/cb");
      const token = await completeLoginWithUrl(session, "/cb?code=abc");
      expect(token).toBe("rel");
      expect(captured.init?.body).toBe(
        JSON.stringify({ code: "abc", code_verifier: session.verifier }),
      );
    } finally {
      globalThis.fetch = real;
    }
  });
});
