/**
 * CLI wrapper around the high-level `chat()` client for GitHub Actions.
 *
 * Reads inputs from environment variables (set by the workflow) or argv,
 * runs a single Devin completion, prints the response to stdout, and writes
 * it to `$GITHUB_OUTPUT` under the `response` key so the calling workflow
 * can consume it via `${{ steps.chat.outputs.response }}`.
 *
 * Usage:
 *   bun run scripts/chat.ts
 *
 * Env:
 *   DEVIN_TOKEN        (required) Devin session token
 *   INPUT_PROMPT       (required) user prompt
 *   INPUT_SYSTEM       (optional) system prompt
 *   INPUT_EFFORT       (optional) reasoning effort
 *   INPUT_MAX_TOKENS   (optional)
 *   INPUT_TEMPERATURE  (optional)
 *   INPUT_TOP_P        (optional)
 *   INPUT_BASE_URL     (optional) override Devin API base URL
 */

import { appendFileSync } from "node:fs";
import { chat } from "../src/client.ts";

const token = process.env.DEVIN_TOKEN ?? "";
const prompt = process.env.INPUT_PROMPT ?? "";
const system = process.env.INPUT_SYSTEM ?? "";
const model = process.env.INPUT_MODEL ?? "glm-5-2";
const effort = process.env.INPUT_EFFORT || "high";
const maxTokens = process.env.INPUT_MAX_TOKENS ? Number(process.env.INPUT_MAX_TOKENS) : undefined;
const temperature = process.env.INPUT_TEMPERATURE ? Number(process.env.INPUT_TEMPERATURE) : undefined;
const topP = process.env.INPUT_TOP_P ? Number(process.env.INPUT_TOP_P) : undefined;
const baseUrl = process.env.INPUT_BASE_URL || undefined;

if (!token) {
  console.error("DEVIN_TOKEN is required");
  process.exit(1);
}
if (!prompt) {
  console.error("INPUT_PROMPT is required");
  process.exit(1);
}

const messages = [
  ...(system ? [{ role: "system" as const, content: system }] : []),
  { role: "user" as const, content: prompt },
];

const result = await chat({
  token,
  model,
  messages,
  effort,
  maxTokens,
  temperature,
  topP,
  baseUrl,
});

// Print to stdout so logs show the answer.
console.log(result.text);
if (result.thinking) {
  console.log("\n--- thinking ---\n" + result.thinking);
}
if (result.toolCalls.length > 0) {
  console.log("\n--- tool calls ---");
  for (const tc of result.toolCalls) console.log(`${tc.name}(${tc.arguments})`);
}
if (result.usage) {
  console.log(
    `\n--- usage ---\nin=${result.usage.inputTokens} out=${result.usage.outputTokens} ` +
      `cache_read=${result.usage.cacheReadTokens} cache_write=${result.usage.cacheWriteTokens}`,
  );
}

// Expose to the workflow step via $GITHUB_OUTPUT (multi-line safe).
const outputFile = process.env.GITHUB_OUTPUT;
if (outputFile) {
  const delimiter = `ghadelimiter_${crypto.randomUUID()}`;
  appendFileSync(outputFile, `response<<${delimiter}\n${result.text}\n${delimiter}\n`);
  appendFileSync(
    outputFile,
    `finish_reason=${result.finishReason}\n`,
  );
}
