#!/usr/bin/env node
/**
 * `devin-gateway` CLI entry point.
 *
 * Default action: run the Devin OAuth login flow and print the token — the
 * convenient path for obtaining credentials. Works under both Node.js (>=20)
 * and Bun.
 *
 * Subcommands:
 *   devin-gateway [login] [--paste|--print|--status]   # login + print token
 *   devin-gateway server                                # start HTTP gateway (Bun only)
 *
 * The HTTP gateway uses `Bun.serve`, so `server` requires the Bun runtime.
 * On Node it prints a clear error and exits. The login flow is runtime-agnostic.
 */
import { runLogin } from "../cli/login.js";

const args = process.argv.slice(2);

if (args[0] === "server") {
  if (!("Bun" in globalThis)) {
    console.error("The devin-gateway HTTP server requires the Bun runtime (Bun.serve).");
    console.error("  Run with:    bun run src/index.ts");
    console.error("  Or via Docker: ghcr.io/caijinglong/devin-gateway");
    process.exit(1);
  }
  const { startServer } = await import("../server.js");
  await startServer();
} else {
  // Allow an optional leading "login" subcommand for clarity.
  const loginArgs = args[0] === "login" ? args.slice(1) : args;
  await runLogin(loginArgs);
}
