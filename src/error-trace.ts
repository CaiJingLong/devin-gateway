/**
 * Error trace — retroactive per-request error logging.
 *
 * Unlike DEBUG mode (which logs everything, always, to a single file),
 * error trace is silent on success and only writes a single file per
 * *failed* request to `logs/errors/{timestamp}-{reqId}.log`. Each file
 * captures the full request context — method, path, headers, body, token
 * fingerprint, upstream calls, timeline, and the error with stack trace —
 * so a failure can be diagnosed in isolation without sifting through a
 * giant debug log.
 *
 * Enabled by default; set `ERROR_TRACE=false` to disable.
 * Override the output directory with `ERROR_TRACE_DIR` (default `logs/errors`).
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";

// ─── Config ──────────────────────────────────────────────────────────────────

function truthy(raw: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test((raw ?? "").trim());
}

/** Error trace is on unless explicitly disabled with ERROR_TRACE=false. */
function errorTraceEnabled(): boolean {
  const raw = process.env.ERROR_TRACE;
  if (raw === undefined || raw.trim() === "") return true;
  return truthy(raw);
}

// ─── Redaction ───────────────────────────────────────────────────────────────

/** Mask a token, showing only the head and tail so it can be identified without leaking it. */
function maskToken(token: string): string {
  if (!token) return "(empty)";
  const t = token.startsWith("devin-session-token$") ? token.slice("devin-session-token$".length) : token;
  if (t.length <= 12) return `${t.slice(0, 4)}…${t.slice(-4)}`;
  return `${t.slice(0, 8)}…(${t.length} chars)…${t.slice(-4)}`;
}

/** Mask sensitive header values (Authorization, x-api-key, cookie). */
function maskHeader(key: string, value: string): string {
  const lk = key.toLowerCase();
  if (lk === "authorization" || lk === "x-api-key" || lk === "cookie") {
    return maskToken(value.replace(/^Bearer\s+/i, ""));
  }
  return value;
}

function safeStringify(v: unknown): string {
  if (v instanceof Error) return v.stack ?? `${v.name}: ${v.message}`;
  try { return JSON.stringify(v, null, 2); } catch { return String(v); }
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max) + `\n…<truncated, ${s.length - max} more bytes>`;
}

// ─── ErrorTrace ──────────────────────────────────────────────────────────────

interface TraceEntry {
  ts: string;
  stage: string;
  message: string;
  data?: string;
}

export class ErrorTrace {
  private entries: TraceEntry[] = [];
  private flushed = false;
  private _token = "";
  private _requestBody = "";
  private _requestHeaders: Record<string, string> = {};

  constructor(
    public readonly reqId: string,
    public readonly method: string,
    public readonly path: string,
  ) {}

  setToken(token: string): void { this._token = token; }
  setRequestBody(body: string): void { this._requestBody = body; }
  setRequestHeaders(headers: Record<string, string>): void { this._requestHeaders = headers; }

  /** Record a timeline event (upstream call, response, intermediate state, etc.). */
  add(stage: string, message: string, data?: unknown): void {
    this.entries.push({
      ts: new Date().toISOString(),
      stage,
      message,
      data: data !== undefined ? safeStringify(data) : undefined,
    });
  }

  /**
   * Write the trace to a single file under `logs/errors/`. Returns the file
   * path on success, or null when disabled / write failed / already flushed.
   */
  flush(error: unknown, status?: number): string | null {
    if (this.flushed) return null;
    this.flushed = true;
    if (!errorTraceEnabled()) return null;

    const dir = resolve(process.cwd(), process.env.ERROR_TRACE_DIR?.trim() || "logs/errors");
    try { mkdirSync(dir, { recursive: true }); } catch { return null; }

    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `${ts}-${this.reqId}.log`;
    const filepath = join(dir, filename);

    try {
      writeFileSync(filepath, this.format(error, status));
      return filepath;
    } catch {
      return null;
    }
  }

  private format(error: unknown, status?: number): string {
    const lines: string[] = [];
    lines.push("=== Devin Gateway — Error Trace ===");
    lines.push(`Request ID:  ${this.reqId}`);
    lines.push(`Method:      ${this.method}`);
    lines.push(`Path:        ${this.path}`);
    lines.push(`Status:      ${status ?? "n/a"}`);
    lines.push(`Time:        ${new Date().toISOString()}`);
    lines.push("");

    lines.push("--- Token ---");
    lines.push(maskToken(this._token));
    lines.push("");

    lines.push("--- Request Headers ---");
    if (Object.keys(this._requestHeaders).length > 0) {
      for (const [k, v] of Object.entries(this._requestHeaders)) {
        lines.push(`  ${k}: ${maskHeader(k, v)}`);
      }
    } else {
      lines.push("  (none)");
    }
    lines.push("");

    lines.push("--- Request Body ---");
    lines.push(this._requestBody ? truncate(this._requestBody, 10_000) : "(empty)");
    lines.push("");

    lines.push("--- Trace Timeline ---");
    if (this.entries.length > 0) {
      for (const e of this.entries) {
        lines.push(`[${e.ts}] [${e.stage}] ${e.message}`);
        if (e.data) lines.push(`  ${e.data}`);
      }
    } else {
      lines.push("(no upstream events recorded)");
    }
    lines.push("");

    lines.push("--- Error ---");
    if (error instanceof Error) {
      lines.push(`${error.name}: ${error.message}`);
      if (error.stack) lines.push(error.stack);
    } else {
      lines.push(safeStringify(error));
    }
    lines.push("");
    return lines.join("\n");
  }
}

// ─── AsyncLocalStorage bridge ────────────────────────────────────────────────

const als = new AsyncLocalStorage<ErrorTrace>();

/** Run `fn` with `trace` as the current trace (retrievable via `currentTrace()`). */
export function runTrace<T>(trace: ErrorTrace, fn: () => T): T {
  return als.run(trace, fn);
}

/** Run an async `fn` with `trace` as the current trace. */
export function runTraceAsync<T>(trace: ErrorTrace, fn: () => Promise<T>): Promise<T> {
  return als.run(trace, fn);
}

/** Get the trace for the current async context, or undefined when none is active. */
export function currentTrace(): ErrorTrace | undefined {
  return als.getStore();
}
