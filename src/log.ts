/**
 * Level-aware logger for Devin Gateway.
 *
 * Levels (low → high): debug < info < warn < error.
 * Controlled by `LOG_LEVEL` env (default: info). Output goes to stderr so
 * `docker-compose logs -f` (a.k.a. `dclf`) captures it without interfering
 * with any stdout piping.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function currentLevel(): LogLevel {
  const raw = (process.env.LOG_LEVEL ?? "info").toLowerCase();
  return raw in ORDER ? (raw as LogLevel) : "info";
}

let level = currentLevel();
const enabled = (l: LogLevel): boolean => ORDER[l] >= ORDER[level];

function emit(l: LogLevel, msg: string, extra?: unknown): void {
  if (!enabled(l)) return;
  const prefix = `[${l.toUpperCase()}]`;
  if (extra !== undefined) console.error(prefix, msg, extra);
  else console.error(`${prefix} ${msg}`);
}

export const log = {
  /** Re-read `LOG_LEVEL` from the environment. Used by tests. */
  refresh(): void { level = currentLevel(); },
  enabled,
  debug: (msg: string) => emit("debug", msg),
  info: (msg: string) => emit("info", msg),
  warn: (msg: string) => emit("warn", msg),
  error: (msg: string, extra?: unknown) => emit("error", msg, extra),
};

/** Truncate a string to `max` chars, appending an ellipsis when cut. */
export function truncate(s: string, max = 2000): string {
  return s.length <= max ? s : s.slice(0, max) + `…<+${s.length - max}b>`;
}
