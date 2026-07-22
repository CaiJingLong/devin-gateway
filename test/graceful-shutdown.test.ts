import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const projectDir = join(import.meta.dir, "..");

function waitForOutput(
  stream: ReadableStream<Uint8Array>,
  expected: string,
): { output: () => string; ready: Promise<void> } {
  const decoder = new TextDecoder();
  let output = "";
  let resolveReady: () => void;
  let rejectReady: (error: Error) => void;
  let found = false;

  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  void (async () => {
    try {
      for await (const chunk of stream) {
        output += decoder.decode(chunk, { stream: true });
        if (!found && output.includes(expected)) {
          found = true;
          resolveReady();
        }
      }
      output += decoder.decode();
      if (!found) rejectReady(new Error(`Process exited before printing ${JSON.stringify(expected)}:\n${output}`));
    } catch (error) {
      if (!found) rejectReady(error instanceof Error ? error : new Error(String(error)));
    }
  })();

  return { output: () => output, ready };
}

async function within<T>(promise: Promise<T>, milliseconds: number, message: () => string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message())), milliseconds);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

test("SIGTERM stops the server and exits normally", async () => {
  const configDir = await mkdtemp(join(tmpdir(), "devin-gateway-shutdown-"));
  let child: ReturnType<typeof Bun.spawn> | undefined;

  try {
    child = Bun.spawn(["bun", "run", "src/index.ts"], {
      cwd: projectDir,
      env: {
        ...process.env,
        DEVIN_GATEWAY_CONFIG_DIR: configDir,
        HOST: "127.0.0.1",
        PORT: "0",
      },
      stdout: "pipe",
      stderr: "inherit",
    });

    const startup = waitForOutput(child.stdout, "Devin Gateway running at");
    await within(startup.ready, 3_000, () => `Server did not start within 3s:\n${startup.output()}`);

    child.kill("SIGTERM");
    await within(child.exited, 2_000, () => "Server did not exit within 2s after SIGTERM");

    expect({ exitCode: child.exitCode, signalCode: child.signalCode }).toEqual({
      exitCode: 0,
      signalCode: null,
    });
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await child.exited;
    }
    await rm(configDir, { recursive: true, force: true });
  }
}, 7_000);
