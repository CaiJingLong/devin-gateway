/**
 * Shared config: token file path + read/write helpers + file watcher.
 *
 * The token file lives at `$DEVIN_GATEWAY_CONFIG_DIR/token` (default
 * `~/.devin-gateway/token`).  Both the CLI login bin and the server read
 * and write through this module so they stay in sync.
 *
 * The server registers a watcher via {@link watchToken} so CLI logins
 * take effect immediately without a restart.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { unwatchFile, watch, watchFile } from "node:fs";

const CONFIG_DIR = process.env.DEVIN_GATEWAY_CONFIG_DIR ?? join(homedir(), ".devin-gateway");
export const TOKEN_FILE = join(CONFIG_DIR, "token");

export async function readToken(): Promise<string> {
  try {
    return (await Bun.file(TOKEN_FILE).text()).trim();
  } catch {
    return "";
  }
}

export async function writeToken(token: string): Promise<void> {
  await Bun.write(TOKEN_FILE, token.trim());
}

/**
 * Watch the token file for changes and call `onChange` with the new token.
 *
 * Uses two mechanisms in parallel:
 * 1. `fs.watch` — event-driven, works on native filesystems.
 * 2. `fs.watchFile` — polling fallback (every 2s), works on Docker bind
 *    mounts and network filesystems where `fs.watch` silently drops events.
 *
 * Returns a stop function.  Debounced 200ms to coalesce rapid writes.
 */
export function watchToken(onChange: (token: string) => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastToken = "";

  const fire = async () => {
    timer = undefined;
    const token = await readToken();
    if (token === lastToken) return;
    lastToken = token;
    onChange(token);
  };

  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(fire, 200);
  };

  // 1. Event-driven watcher (native fs)
  let watcher: ReturnType<typeof watch> | undefined;
  try {
    watcher = watch(CONFIG_DIR, (_event, filename) => {
      if (filename !== "token") return;
      schedule();
    });
  } catch {
    // Config dir may not exist yet — polling fallback still works.
  }

  // 2. Polling fallback — critical for Docker bind mounts where
  //    fs.watch does not receive inotify events from the host side.
  const pollingListener = () => {
    schedule();
  };
  watchFile(TOKEN_FILE, { interval: 2000 }, pollingListener);

  return () => {
    if (timer) clearTimeout(timer);
    watcher?.close();
    unwatchFile(TOKEN_FILE, pollingListener);
  };
}

export { CONFIG_DIR };
