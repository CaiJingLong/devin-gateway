#!/usr/bin/env node
/**
 * devin-gateway login CLI.
 *
 * Runs the Devin OAuth PKCE flow on a local callback server, then saves the
 * token to ~/.devin-gateway/token (or $DEVIN_GATEWAY_CONFIG_DIR/token).
 *
 * Runtime: works under both Node.js (>=20) and Bun — uses only `node:http`,
 * `node:readline`, `node:child_process`, and the Web Crypto/fetch globals.
 *
 * Usage:
 *   devin-gateway login              # interactive — opens browser
 *   devin-gateway login --paste      # paste redirect URL manually
 *   devin-gateway login --print      # print token only, don't save
 *   devin-gateway login --status     # show current saved token status
 *
 * Also runnable directly:
 *   bun run src/cli/login.ts
 *   node src/cli/login.ts --status
 */
import { exec } from "node:child_process";
import { createServer, type Server } from "node:http";
import { createInterface } from "node:readline";
import { startLoginFlow, completeLoginWithUrl, exchangeToken } from "../login.js";
import { readToken, writeToken, TOKEN_FILE } from "../config.js";

const CALLBACK_PORT = 59653;
const CALLBACK_PATH = "/callback";
const TIMEOUT_MS = 5 * 60 * 1000;

export async function runLogin(argv: string[]): Promise<void> {
  const pasteMode = argv.includes("--paste");
  const printOnly = argv.includes("--print");
  const statusMode = argv.includes("--status");

  // ─── Status ──────────────────────────────────────────────────────────────────
  if (statusMode) {
    const token = await readToken();
    if (token) {
      console.log(`Token file: ${TOKEN_FILE}`);
      console.log(`Token:      ${token.slice(0, 20)}...${token.slice(-8)}`);
      console.log(`Length:     ${token.length}`);
    } else {
      console.log(`No token found at ${TOKEN_FILE}`);
      console.log("Run `devin-gateway login` to login.");
    }
    return;
  }

  // ─── Login flow ──────────────────────────────────────────────────────────────
  const redirectUri = `http://127.0.0.1:${CALLBACK_PORT}${CALLBACK_PATH}`;
  const session = await startLoginFlow(redirectUri);

  console.log("");
  console.log("  Devin Gateway — Login");
  console.log("  ─────────────────────────────────────────────────────");
  console.log("");
  console.log("  Open this URL in your browser to sign in to Devin:");
  console.log("");
  console.log(`  ${session.authUrl}`);
  console.log("");

  if (pasteMode) {
    // Manual paste mode: no local server, user pastes the redirect URL
    console.log("  After signing in, you'll be redirected to a URL like:");
    console.log(`  http://127.0.0.1:${CALLBACK_PORT}${CALLBACK_PATH}?code=...&state=...`);
    console.log("  Paste that full URL here:");
    console.log("");

    const input = await prompt("  > ");
    if (!input) {
      console.error("No URL provided.");
      process.exit(1);
    }

    try {
      const token = await completeLoginWithUrl(session, input.trim());
      await finishLogin(token, printOnly);
    } catch (err) {
      console.error(`Login failed: ${String((err as Error).message ?? err)}`);
      process.exit(1);
    }
  } else {
    // Auto mode: start local callback server, wait for it to be listening, then
    // open the browser — so the callback URL is reachable the instant it loads.
    const { ready, token } = startCallbackServer(session);

    try {
      await ready; // throws on EADDRINUSE / other listen failures
    } catch (err) {
      console.error(`Login failed: ${String((err as Error).message ?? err)}`);
      process.exit(1);
    }

    // Try to open the browser automatically
    try {
      const cmd =
        process.platform === "darwin"
          ? "open"
          : process.platform === "win32"
            ? `cmd /c start ""`
            : "xdg-open";
      execAsync(`${cmd} "${session.authUrl}"`);
      console.log("  (Attempting to open browser automatically...)");
    } catch {
      console.log("  (Could not open browser automatically — please open the URL manually)");
    }
    console.log("");
    console.log(`  Waiting for callback on http://127.0.0.1:${CALLBACK_PORT}...`);
    console.log(`  (Timeout: ${TIMEOUT_MS / 1000}s — press Ctrl+C to cancel)`);
    console.log("");

    try {
      const t = await token;
      await finishLogin(t, printOnly);
    } catch (err) {
      console.error(`Login failed: ${String((err as Error).message ?? err)}`);
      process.exit(1);
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function finishLogin(token: string, printOnly: boolean): Promise<void> {
  if (printOnly) {
    console.log(token);
    return;
  }
  await writeToken(token);
  console.log("  ✅ Login successful!");
  console.log("");
  console.log(`  Token saved to: ${TOKEN_FILE}`);
  console.log("");
  console.log("  Token (copy to your client's API key field):");
  console.log(`  ${token}`);
  console.log("");
  console.log("  Start the gateway and point your client at it:");
  console.log("    bun run src/index.ts");
  console.log("");
}

function startCallbackServer(session: {
  state: string;
  verifier: string;
}): { ready: Promise<void>; token: Promise<string> } {
  let resolveToken!: (v: string) => void;
  let rejectToken!: (e: unknown) => void;
  const token = new Promise<string>((res, rej) => {
    resolveToken = res;
    rejectToken = rej;
  });

  let resolveReady!: () => void;
  let rejectReady!: (e: unknown) => void;
  const ready = new Promise<void>((res, rej) => {
    resolveReady = res;
    rejectReady = rej;
  });

  let settled = false;
  let server: Server;

  const timeout = setTimeout(() => {
    if (!settled) {
      settled = true;
      server.close();
      rejectToken(new Error("Login timed out"));
    }
  }, TIMEOUT_MS);

  const fail = (err: unknown): void => {
    if (!settled) {
      settled = true;
      clearTimeout(timeout);
      server.close();
      rejectToken(err);
    }
  };

  server = createServer((req, res) => {
    const url = new URL(req.url ?? "", `http://127.0.0.1:${CALLBACK_PORT}`);
    if (url.pathname !== CALLBACK_PATH) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("Not Found");
      return;
    }

    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    const sendHtml = (message: string): void => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(htmlBody(message));
    };

    if (error) {
      const desc = url.searchParams.get("error_description") ?? error;
      fail(new Error(`Authorization failed: ${desc}`));
      sendHtml(`❌ Login failed: ${desc}`);
      return;
    }

    if (!code || state !== session.state) {
      fail(new Error("Invalid callback: missing code or state mismatch"));
      sendHtml("❌ Invalid callback");
      return;
    }

    // Exchange token
    exchangeToken(code, session.verifier)
      .then((t) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          server.close();
          resolveToken(t);
        }
      })
      .catch(fail);

    sendHtml("✅ Login successful! You can close this tab.");
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      rejectReady(
        new Error(
          `Port ${CALLBACK_PORT} is already in use (another login in progress?). Free it and retry.`,
        ),
      );
    } else {
      rejectReady(err);
    }
    fail(err);
  });

  server.once("listening", () => resolveReady());
  server.listen(CALLBACK_PORT, "127.0.0.1");

  return { ready, token };
}

function htmlBody(message: string): string {
  return `<!doctype html><html><body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f9fafb"><div style="text-align:center;padding:2em;background:#fff;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.1)"><h1 style="font-size:1.5em;margin-bottom:0.5em">${message}</h1><p style="color:#666">You can close this tab.</p></div></body></html>`;
}

async function prompt(message: string): Promise<string> {
  process.stdout.write(message);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await new Promise<string>((resolve) => rl.question("", resolve));
    return answer.trim();
  } finally {
    rl.close();
  }
}

function execAsync(cmd: string): void {
  exec(cmd, () => {});
}

// ─── Direct-run guard (Bun: import.meta.main; Node: no-op via bin) ───────────
if (import.meta.main) {
  await runLogin(process.argv.slice(2));
}
