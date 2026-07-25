import { expect, test, describe } from "bun:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

/**
 * config.ts reads DEVIN_GATEWAY_CONFIG_DIR at module load time to compute
 * TOKEN_FILE / CONFIG_DIR constants. To isolate each test against a fresh
 * temp dir (and never touch the user's real ~/.devin-gateway/token), we set
 * the env var BEFORE a dynamic import and force a module reload via a unique
 * query string so Bun does not serve a cached instance.
 */
async function loadConfig() {
  const tag = `${Date.now()}-${randomUUID()}`;
  return await import(`../src/config.ts?t=${tag}`);
}

async function freshConfigDir(): Promise<string> {
  // mkdtemp gives a unique, real directory; we delete it in tests that need
  // to assert auto-creation, otherwise keep it for normal round-trips.
  return await mkdtemp(join(tmpdir(), "devin-gw-cfg-"));
}

const SAVED_ENV = process.env.DEVIN_GATEWAY_CONFIG_DIR;

describe("config token storage", () => {
  // Snapshot once; each test restores the env to the pre-test value so a
  // leaked env var can never point subsequent tests at the real config dir.
  const savedEnv = process.env.DEVIN_GATEWAY_CONFIG_DIR;

  test("readToken returns empty string when token file is absent", async () => {
    const dir = await freshConfigDir();
    process.env.DEVIN_GATEWAY_CONFIG_DIR = dir;
    try {
      const { readToken, TOKEN_FILE } = await loadConfig();
      expect(TOKEN_FILE).toBe(join(dir, "token"));
      expect(await readToken()).toBe("");
    } finally {
      process.env.DEVIN_GATEWAY_CONFIG_DIR = savedEnv;
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("writeToken then readToken round-trips a trimmed token", async () => {
    const dir = await freshConfigDir();
    process.env.DEVIN_GATEWAY_CONFIG_DIR = dir;
    try {
      const mod = await loadConfig();
      await mod.writeToken("abc123");
      expect(await mod.readToken()).toBe("abc123");

      // trim is applied on both write and read, so surrounding whitespace
      // must not survive.
      const mod2 = await loadConfig();
      await mod2.writeToken("  xyz  ");
      expect(await mod2.readToken()).toBe("xyz");
      // Confirm the bytes on disk are trimmed (write trims).
      expect((await readFile(mod2.TOKEN_FILE, "utf8")).trim()).toBe("xyz");
    } finally {
      process.env.DEVIN_GATEWAY_CONFIG_DIR = savedEnv;
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("writeToken auto-creates a missing CONFIG_DIR", async () => {
    const dir = await freshConfigDir();
    // Remove it so the directory does not exist before writing.
    await rm(dir, { recursive: true, force: true });
    process.env.DEVIN_GATEWAY_CONFIG_DIR = dir;
    try {
      const { writeToken, readToken, TOKEN_FILE } = await loadConfig();
      expect(TOKEN_FILE).toBe(join(dir, "token"));
      await writeToken("auto-created");
      // Directory and token file now exist and content round-trips.
      expect(await readToken()).toBe("auto-created");
    } finally {
      process.env.DEVIN_GATEWAY_CONFIG_DIR = savedEnv;
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// Belt-and-suspenders: restore the original env in case a test threw before
// its finally block ran (e.g. on assertion failure inside try/finally the
// finally still runs, but keep this for symmetry / process-state hygiene).
process.env.DEVIN_GATEWAY_CONFIG_DIR = SAVED_ENV;
