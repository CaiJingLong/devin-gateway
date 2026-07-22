/**
 * Devin OAuth CLI login flow.
 *
 * 1. Generate PKCE pair + state.
 * 2. User visits https://app.devin.ai/auth/cli/continue?...
 * 3. Browser redirects to callback URL with `code` and `state`.
 * 4. Exchange code + verifier for a JWT token at https://api.devin.ai/auth/cli/token.
 */

const DEVIN_WEBAPP_URL = "https://app.devin.ai";
const DEVIN_API_URL = "https://api.devin.ai";
const TOKEN_PATH = "/auth/cli/token";

export interface LoginSession {
  state: string;
  verifier: string;
  challenge: string;
  authUrl: string;
  redirectUri: string;
}

async function generatePKCE(): Promise<{ verifier: string; challenge: string }> {
  const verifierBytes = new Uint8Array(32);
  crypto.getRandomValues(verifierBytes);
  const verifier = base64UrlEncode(verifierBytes);
  const challengeBytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  const challenge = base64UrlEncode(challengeBytes);
  return { verifier, challenge };
}

function base64UrlEncode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function startLoginFlow(redirectUri: string): Promise<LoginSession> {
  const state = crypto.randomUUID();
  const { verifier, challenge } = await generatePKCE();
  const params = new URLSearchParams({
    redirect_uri: redirectUri,
    state,
    prompt: "select_account",
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  const authUrl = `${DEVIN_WEBAPP_URL}/auth/cli/continue?${params.toString()}`;
  return { state, verifier, challenge, authUrl, redirectUri };
}

export async function completeLoginWithUrl(
  session: LoginSession,
  _redirectUrl: string,
): Promise<string> {
  // Parse the redirect URL to extract code
  const url = new URL(_redirectUrl, "http://localhost");
  const code = url.searchParams.get("code");
  if (!code) throw new Error("No code in redirect URL");

  return exchangeToken(code, session.verifier);
}

export async function exchangeToken(code: string, verifier: string): Promise<string> {
  const res = await fetch(`${DEVIN_API_URL}${TOKEN_PATH}`, {
    method: "POST",
    headers: { "Accept": "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ code, code_verifier: verifier }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed: ${res.status} ${text}`);
  }
  const data = (await res.json()) as { token?: string };
  if (!data.token) throw new Error("Token exchange returned empty token");
  return data.token;
}
