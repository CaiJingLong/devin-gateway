/**
 * Shared config: token file path + read/write helpers.
 *
 * The token file lives at `$DEVIN_GATEWAY_CONFIG_DIR/token` (default
 * `~/.devin-gateway/token`). The CLI login bin writes here; the server no
 * longer reads it — clients pass their own token per request.
 */

import { homedir } from "node:os";
import { join } from "node:path";

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

export { CONFIG_DIR };
