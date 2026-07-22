#!/usr/bin/env bun
/**
 * devin-gateway login CLI.
 *
 * Runs the Devin OAuth PKCE flow on a local callback server, then saves the
 * token to ~/.devin-gateway/token (or $DEVIN_GATEWAY_CONFIG_DIR/token).
 *
 * Usage:
 *   bun run src/cli/login.ts              # interactive — opens browser
 *   bun run src/cli/login.ts --paste      # paste redirect URL manually
 *   bun run src/cli/login.ts --print      # print token only, don't save
 *   bun run src/cli/login.ts --status     # show current saved token status
 */

import { startLoginFlow, completeLoginWithUrl, exchangeToken } from "../login.ts";
import { readToken, writeToken, TOKEN_FILE, CONFIG_DIR } from "../config.ts";

const CALLBACK_PORT = 59653;
const CALLBACK_PATH = "/callback";
const TIMEOUT_MS = 5 * 60 * 1000;

const args = process.argv.slice(2);
const pasteMode = args.includes("--paste");
const printOnly = args.includes("--print");
const statusMode = args.includes("--status");

// ─── Status ──────────────────────────────────────────────────────────────────

if (statusMode) {
  const token = await readToken();
  if (token) {
    console.log(`Token file: ${TOKEN_FILE}`);
    console.log(`Token:      ${token.slice(0, 20)}...${token.slice(-8)}`);
    console.log(`Length:     ${token.length}`);
  } else {
    console.log(`No token found at ${TOKEN_FILE}`);
    console.log("Run `bun run src/cli/login.ts` to login.");
  }
  process.exit(0);
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
    await finishLogin(token);
  } catch (err) {
    console.error(`Login failed: ${String((err as Error).message ?? err)}`);
    process.exit(1);
  }
} else {
  // Auto mode: start local callback server and wait
  const callbackPromise = startCallbackServer(session);

  // Try to open the browser automatically
  try {
    const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? `cmd /c start ""` : "xdg-open";
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
    const token = await callbackPromise;
    await finishLogin(token);
  } catch (err) {
    console.error(`Login failed: ${String((err as Error).message ?? err)}`);
    process.exit(1);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function finishLogin(token: string): Promise<void> {
  if (printOnly) {
    console.log(token);
    return;
  }
  await writeToken(token);
  console.log("  ✅ Login successful!");
  console.log("");
  console.log(`  Token saved to: ${TOKEN_FILE}`);
  console.log("");
  console.log("  You can now start the gateway server:");
  console.log("    bun run src/index.ts");
  console.log("");
}

async function startCallbackServer(session: { state: string; verifier: string }): Promise<string> {
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  let settled = false;

  const timeout = setTimeout(() => {
    if (!settled) {
      settled = true;
      server.stop();
      reject(new Error("Login timed out"));
    }
  }, TIMEOUT_MS);

  const server = Bun.serve({
    port: CALLBACK_PORT,
    hostname: "127.0.0.1",
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname !== CALLBACK_PATH) {
        return new Response("Not Found", { status: 404 });
      }

      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const error = url.searchParams.get("error");

      if (error) {
        const desc = url.searchParams.get("error_description") ?? error;
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          server.stop();
          reject(new Error(`Authorization failed: ${desc}`));
        }
        return htmlResponse(`❌ Login failed: ${desc}`);
      }

      if (!code || state !== session.state) {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          server.stop();
          reject(new Error("Invalid callback: missing code or state mismatch"));
        }
        return htmlResponse("❌ Invalid callback");
      }

      // Exchange token
      exchangeToken(code, session.verifier)
        .then((token) => {
          if (!settled) {
            settled = true;
            clearTimeout(timeout);
            server.stop();
            resolve(token);
          }
        })
        .catch((err) => {
          if (!settled) {
            settled = true;
            clearTimeout(timeout);
            server.stop();
            reject(err);
          }
        });

      return htmlResponse("✅ Login successful! You can close this tab.");
    },
  });

  return promise;
}

function htmlResponse(message: string): Response {
  return new Response(
    `<!doctype html><html><body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f9fafb"><div style="text-align:center;padding:2em;background:#fff;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.1)"><h1 style="font-size:1.5em;margin-bottom:0.5em">${message}</h1><p style="color:#666">You can close this tab.</p></div></body></html>`,
    { headers: { "content-type": "text/html" } },
  );
}

async function prompt(message: string): Promise<string> {
  process.stdout.write(message);
  const reader = Bun.stdin.stream();
  const decoder = new TextDecoder();
  let line = "";
  for await (const chunk of reader) {
    line += decoder.decode(chunk);
    if (line.includes("\n")) break;
  }
  return line.trim();
}

function execAsync(cmd: string): void {
  const { exec } = import.meta.require("node:child_process");
  exec(cmd, () => {});
}
