/**
 * Devin Gateway — public entry point.
 *
 * Re-exports the programmatic API for external consumers (GitHub Actions,
 * scripts, other packages) and starts the HTTP server when run directly:
 *
 *   bun run src/index.ts
 *
 * Library callers import from this module without triggering the server:
 *
 *   import { chat, startServer } from "devin-gateway";
 */

import { startServer } from "./server.ts";

export * from "./proto.ts";
export * from "./models.ts";
export * from "./convert.ts";
export * from "./config.ts";
export * from "./devin.ts";
export * from "./client.ts";
export { startServer, type ServerOptions, type ServerHandle } from "./server.ts";

if (import.meta.main) {
  await startServer();
}
