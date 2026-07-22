import { expect, test } from "bun:test";
import { unwatchFile } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

function restoreEnvironment(name: string, previous: string | undefined): void {
  if (previous === undefined) delete process.env[name];
  else process.env[name] = previous;
}

test("stopping the token watcher removes the polling fallback", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "devin-gateway-token-watch-"));
  const configDir = join(tempRoot, "config");
  const tokenFile = join(configDir, "token");
  const previousConfigDir = process.env.DEVIN_GATEWAY_CONFIG_DIR;
  let stop: (() => void) | undefined;

  try {
    await mkdir(configDir);
    await Bun.write(tokenFile, "before-stop");
    process.env.DEVIN_GATEWAY_CONFIG_DIR = configDir;
    const moduleUrl = new URL("../src/config.ts", import.meta.url);
    moduleUrl.searchParams.set("test", crypto.randomUUID());
    const { watchToken } = await import(moduleUrl.href);

    const observedTokens: string[] = [];
    stop = watchToken((token) => observedTokens.push(token));
    stop();

    await Bun.write(tokenFile, "changed-after-stop");
    await Bun.sleep(2_800);

    expect(observedTokens).toEqual([]);
  } finally {
    stop?.();
    unwatchFile(tokenFile);
    restoreEnvironment("DEVIN_GATEWAY_CONFIG_DIR", previousConfigDir);
    await rm(tempRoot, { recursive: true, force: true });
  }
}, 5_000);
