/**
 * Level-aware logger for Devin Gateway.
 *
 * Levels (low → high): debug < info < warn < error.
 * Controlled by `LOG_LEVEL` env (default: info). Output goes to stderr so
 * `docker-compose logs -f` (a.k.a. `dclf`) captures it without interfering
 * with any stdout piping.
 *
 * Debug mode (`DEBUG=true|1|yes`) forces the effective level to `debug` and
 * tees every line to a file (`LOG_FILE`, default `logs/gateway.log` relative
 * to CWD) so containerised runs can persist diagnostics to a mounted volume.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function truthy(raw: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test((raw ?? "").trim());
}

function currentLevel(): LogLevel {
  // DEBUG overrides LOG_LEVEL when explicitly enabled.
  if (truthy(process.env.DEBUG)) return "debug";
  const raw = (process.env.LOG_LEVEL ?? "info").toLowerCase();
  return raw in ORDER ? (raw as LogLevel) : "info";
}

let level = currentLevel();
const enabled = (l: LogLevel): boolean => ORDER[l] >= ORDER[level];

// ─── File sink (only active in debug mode) ──────────────────────────────────

let logFile: string | null = null;

function initFileSink(): void {
  if (!truthy(process.env.DEBUG)) return;
  // Treat empty string as unset so `.env`'s `LOG_FILE=` doesn't override the
  // Dockerfile default with a blank path (which would resolve to CWD itself).
  const target = process.env.LOG_FILE?.trim() || "logs/gateway.log";
  logFile = resolve(process.cwd(), target);
  try {
    mkdirSync(dirname(logFile), { recursive: true });
    // Touch + write a startup banner so users can confirm the sink works.
    appendFileSync(logFile, `\n--- Devin Gateway debug log started ${new Date().toISOString()} ---\n`);
  } catch {
    // If the path is not writable, keep stderr-only behaviour.
    logFile = null;
  }
}

initFileSink();

function emit(l: LogLevel, msg: string, extra?: unknown): void {
  if (!enabled(l)) return;
  const prefix = `[${l.toUpperCase()}]`;
  const ts = new Date().toISOString();
  const line = extra !== undefined ? `${prefix} ${msg} ${safeStringify(extra)}` : `${prefix} ${msg}`;
  // Stderr stays primary so `docker logs` / `dclf` keep working.
  if (extra !== undefined) console.error(prefix, msg, extra);
  else console.error(line);
  // Tee to file when debug mode is on and the sink is healthy.
  if (logFile) {
    try { appendFileSync(logFile, `${ts} ${line}\n`); } catch { /* drop */ }
  }
}

function safeStringify(v: unknown): string {
  if (v instanceof Error) return v.stack ?? `${v.name}: ${v.message}`;
  try { return JSON.stringify(v); } catch { return String(v); }
}

export const log = {
  /** Re-read `LOG_LEVEL`/`DEBUG` from the environment. Used by tests. */
  refresh(): void {
    level = currentLevel();
    initFileSink();
  },
  enabled,
  /** Whether debug mode (file tee + forced debug level) is active. */
  get debugMode(): boolean { return logFile !== null; },
  /** Resolved log file path, or null when debug mode is off / sink failed. */
  get filePath(): string | null { return logFile; },
  debug: (msg: string) => emit("debug", msg),
  info: (msg: string) => emit("info", msg),
  warn: (msg: string) => emit("warn", msg),
  error: (msg: string, extra?: unknown) => emit("error", msg, extra),
};

/** Truncate a string to `max` chars, appending an ellipsis when cut. */
export function truncate(s: string, max = 2000): string {
  return s.length <= max ? s : s.slice(0, max) + `…<+${s.length - max}b>`;
}
