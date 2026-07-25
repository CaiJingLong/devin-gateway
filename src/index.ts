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

import { startServer } from "./server.js";

export * from "./proto.js";
export * from "./models.js";
export * from "./convert.js";
export * from "./config.js";
export * from "./devin.js";
export * from "./client.js";
export { startServer, type ServerOptions, type ServerHandle } from "./server.js";

if (import.meta.main) {
  await startServer();
}
