/**
 * Static model catalog for the Devin provider.
 *
 * Catalog IDs are the exact Cascade model UIDs sent to the upstream API as
 * `chat_model_uid` — what the client sees is what the gateway forwards. No
 * aliasing, no effort routing: pick a UID from `GET /v1/models` and it is
 * passed through verbatim. Unknown IDs are also passed through untouched.
 *
 * Regenerated from the account catalog rather than hand-maintained:
 * `devin models list --format json` (CLI 3000.10.31) / the
 * `GetCliModelConfigs` proto, snapshotted 2026-09-17. Per entry:
 * `contextWindow` = `max_context_tokens` (ClientModelConfig field 18),
 * `maxTokens` = `max_output_tokens` (field 23, inner field 13),
 * `supportsImages` = field 5, and `reasoning` = the same label +
 * `model_features.supports_thinking` rule that `discoverModels` applies.
 * The live catalog still comes from `discoverModels`; this list only backs
 * `?source=local` and offline startup.
 *
 * Fusion pairings and `adaptive` are client-side composites that carry no
 * context/output limits in the API catalog, so they are deliberately absent here.
 */

export interface ModelInfo {
  id: string;
  name: string;
  contextWindow: number;
  maxTokens: number;
  reasoning: boolean;
  supportsImages: boolean;
}

const MODELS: ModelInfo[] = [
  // ── Claude Opus 5 ──
  { id: "claude-opus-5-medium", name: "Claude Opus 5 Medium", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "claude-opus-5-low", name: "Claude Opus 5 Low", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "claude-opus-5-high", name: "Claude Opus 5 High", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "claude-opus-5-xhigh", name: "Claude Opus 5 XHigh", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "claude-opus-5-max", name: "Claude Opus 5 Max", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "claude-opus-5-low-fast", name: "Claude Opus 5 Low Fast", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "claude-opus-5-medium-fast", name: "Claude Opus 5 Medium Fast", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "claude-opus-5-high-fast", name: "Claude Opus 5 High Fast", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "claude-opus-5-xhigh-fast", name: "Claude Opus 5 XHigh Fast", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "claude-opus-5-max-fast", name: "Claude Opus 5 Max Fast", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, supportsImages: true },

  // ── Claude Fable 5.1 ──
  { id: "claude-fable-5-1-medium", name: "Claude Fable 5.1 Medium", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "claude-fable-5-1-low", name: "Claude Fable 5.1 Low", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "claude-fable-5-1-high", name: "Claude Fable 5.1 High", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "claude-fable-5-1-xhigh", name: "Claude Fable 5.1 XHigh", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "claude-fable-5-1-max", name: "Claude Fable 5.1 Max", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, supportsImages: true },

  // ── Claude Sonnet 5 ──
  { id: "claude-sonnet-5-medium", name: "Claude Sonnet 5 Medium", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "claude-sonnet-5-low", name: "Claude Sonnet 5 Low", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "claude-sonnet-5-high", name: "Claude Sonnet 5 High", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "claude-sonnet-5-xhigh", name: "Claude Sonnet 5 XHigh", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "claude-sonnet-5-max", name: "Claude Sonnet 5 Max", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, supportsImages: true },

  // ── Gemini 3.8 Flash ──
  { id: "gemini-3-8-flash-medium", name: "Gemini 3.8 Flash Medium", contextWindow: 1_048_576, maxTokens: 65_535, reasoning: true, supportsImages: true },
  { id: "gemini-3-8-flash-low", name: "Gemini 3.8 Flash Low", contextWindow: 1_048_576, maxTokens: 65_535, reasoning: true, supportsImages: true },
  { id: "gemini-3-8-flash-high", name: "Gemini 3.8 Flash High", contextWindow: 1_048_576, maxTokens: 65_535, reasoning: true, supportsImages: true },

  // ── GPT-5.6 Sol ──
  { id: "gpt-5-6-sol-medium", name: "GPT-5.6 Sol Medium Thinking", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "gpt-5-6-sol-none", name: "GPT-5.6 Sol No Thinking", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: false, supportsImages: true },
  { id: "gpt-5-6-sol-low", name: "GPT-5.6 Sol Low Thinking", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "gpt-5-6-sol-high", name: "GPT-5.6 Sol High Thinking", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "gpt-5-6-sol-xhigh", name: "GPT-5.6 Sol XHigh Thinking", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "gpt-5-6-sol-max", name: "GPT-5.6 Sol Max Thinking", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "gpt-5-6-sol-none-priority", name: "GPT-5.6 Sol No Thinking Fast", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: false, supportsImages: true },
  { id: "gpt-5-6-sol-low-priority", name: "GPT-5.6 Sol Low Thinking Fast", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "gpt-5-6-sol-medium-priority", name: "GPT-5.6 Sol Medium Thinking Fast", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "gpt-5-6-sol-high-priority", name: "GPT-5.6 Sol High Thinking Fast", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "gpt-5-6-sol-xhigh-priority", name: "GPT-5.6 Sol XHigh Thinking Fast", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "gpt-5-6-sol-max-priority", name: "GPT-5.6 Sol Max Thinking Fast", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, supportsImages: true },

  // ── GPT-5.6 Luna ──
  { id: "gpt-5-6-luna-medium", name: "GPT-5.6 Luna Medium Thinking", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "gpt-5-6-luna-none", name: "GPT-5.6 Luna No Thinking", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: false, supportsImages: true },
  { id: "gpt-5-6-luna-low", name: "GPT-5.6 Luna Low Thinking", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "gpt-5-6-luna-high", name: "GPT-5.6 Luna High Thinking", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "gpt-5-6-luna-xhigh", name: "GPT-5.6 Luna XHigh Thinking", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "gpt-5-6-luna-max", name: "GPT-5.6 Luna Max Thinking", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "gpt-5-6-luna-none-priority", name: "GPT-5.6 Luna No Thinking Fast", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: false, supportsImages: true },
  { id: "gpt-5-6-luna-low-priority", name: "GPT-5.6 Luna Low Thinking Fast", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "gpt-5-6-luna-medium-priority", name: "GPT-5.6 Luna Medium Thinking Fast", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "gpt-5-6-luna-high-priority", name: "GPT-5.6 Luna High Thinking Fast", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "gpt-5-6-luna-xhigh-priority", name: "GPT-5.6 Luna XHigh Thinking Fast", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "gpt-5-6-luna-max-priority", name: "GPT-5.6 Luna Max Thinking Fast", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, supportsImages: true },

  // ── GPT-6 Astra ──
  { id: "gpt-6-astra-medium", name: "GPT-6 Astra Medium Thinking", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "gpt-6-astra-low", name: "GPT-6 Astra Low Thinking", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "gpt-6-astra-high", name: "GPT-6 Astra High Thinking", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "gpt-6-astra-xhigh", name: "GPT-6 Astra XHigh Thinking", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "gpt-6-astra-max", name: "GPT-6 Astra Max Thinking", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "gpt-6-astra-low-priority", name: "GPT-6 Astra Low Thinking Fast", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "gpt-6-astra-medium-priority", name: "GPT-6 Astra Medium Thinking Fast", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "gpt-6-astra-high-priority", name: "GPT-6 Astra High Thinking Fast", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "gpt-6-astra-xhigh-priority", name: "GPT-6 Astra XHigh Thinking Fast", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "gpt-6-astra-max-priority", name: "GPT-6 Astra Max Thinking Fast", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, supportsImages: true },

  // ── GLM-5.2 ──
  { id: "glm-5-2", name: "GLM-5.2 High", contextWindow: 200_000, maxTokens: 128_000, reasoning: true, supportsImages: false },
  { id: "glm-5-2-max", name: "GLM-5.2 Max", contextWindow: 200_000, maxTokens: 128_000, reasoning: true, supportsImages: false },
  { id: "glm-5-2-1m", name: "GLM-5.2 High 1M", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, supportsImages: false },
  { id: "glm-5-2-max-1m", name: "GLM-5.2 Max 1M", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, supportsImages: false },
  { id: "glm-5-2-none", name: "GLM-5.2 No Thinking", contextWindow: 200_000, maxTokens: 128_000, reasoning: false, supportsImages: false },
  { id: "glm-5-2-none-1m", name: "GLM-5.2 No Thinking 1M", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: false, supportsImages: false },

  // ── Kimi K3 ──
  { id: "kimi-k3-high", name: "Kimi K3 High", contextWindow: 1_048_576, maxTokens: 131_072, reasoning: true, supportsImages: true },
  { id: "kimi-k3-low", name: "Kimi K3 Low", contextWindow: 1_048_576, maxTokens: 131_072, reasoning: true, supportsImages: true },
  { id: "kimi-k3-max", name: "Kimi K3 Max", contextWindow: 1_048_576, maxTokens: 131_072, reasoning: true, supportsImages: true },

  // ── GLM-5.3 ──
  { id: "glm-5-3-low", name: "GLM-5.3 Low", contextWindow: 1_048_576, maxTokens: 128_000, reasoning: true, supportsImages: false },
  { id: "glm-5-3-high", name: "GLM-5.3 High", contextWindow: 1_048_576, maxTokens: 128_000, reasoning: true, supportsImages: false },
  { id: "glm-5-3-max", name: "GLM-5.3 Max", contextWindow: 1_048_576, maxTokens: 128_000, reasoning: true, supportsImages: false },

  // ── SWE-1.7 Lightning ──
  { id: "swe-1-7-lightning", name: "SWE-1.7 Lightning Max", contextWindow: 202_752, maxTokens: 96_000, reasoning: true, supportsImages: true },
  { id: "swe-1-7-lightning-medium", name: "SWE-1.7 Lightning Medium", contextWindow: 202_752, maxTokens: 96_000, reasoning: true, supportsImages: true },

  // ── SWE-2 ──
  { id: "swe-2-high", name: "SWE-2 High", contextWindow: 262_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "swe-2-medium", name: "SWE-2 Medium", contextWindow: 262_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "swe-2-max", name: "SWE-2 Max", contextWindow: 262_000, maxTokens: 128_000, reasoning: true, supportsImages: true },

  // ── Claude Opus 4.7 ──
  { id: "claude-opus-4-7-medium", name: "Claude Opus 4.7 Medium", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "claude-opus-4-7-low", name: "Claude Opus 4.7 Low", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "claude-opus-4-7-high", name: "Claude Opus 4.7 High", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "claude-opus-4-7-xhigh", name: "Claude Opus 4.7 XHigh", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "claude-opus-4-7-max", name: "Claude Opus 4.7 Max", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, supportsImages: true },

  // ── Claude Opus 4.8 ──
  { id: "claude-opus-4-8-medium", name: "Claude Opus 4.8 Medium", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "claude-opus-4-8-low", name: "Claude Opus 4.8 Low", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "claude-opus-4-8-high", name: "Claude Opus 4.8 High", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "claude-opus-4-8-xhigh", name: "Claude Opus 4.8 XHigh", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "claude-opus-4-8-max", name: "Claude Opus 4.8 Max", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "claude-opus-4-8-low-fast", name: "Claude Opus 4.8 Low Fast", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "claude-opus-4-8-medium-fast", name: "Claude Opus 4.8 Medium Fast", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "claude-opus-4-8-high-fast", name: "Claude Opus 4.8 High Fast", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "claude-opus-4-8-xhigh-fast", name: "Claude Opus 4.8 XHigh Fast", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "claude-opus-4-8-max-fast", name: "Claude Opus 4.8 Max Fast", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, supportsImages: true },

  // ── Claude Fable 5 ──
  { id: "claude-5-fable-low", name: "Claude Fable 5 Low", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "claude-5-fable-medium", name: "Claude Fable 5 Medium", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "claude-5-fable-high", name: "Claude Fable 5 High", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "claude-5-fable-xhigh", name: "Claude Fable 5 XHigh", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "claude-5-fable-max", name: "Claude Fable 5 Max", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, supportsImages: true },

  // ── Gemini 3.5 Flash ──
  { id: "gemini-3-5-flash-minimal", name: "Gemini 3.5 Flash Minimal", contextWindow: 1_048_576, maxTokens: 65_535, reasoning: true, supportsImages: true },
  { id: "gemini-3-5-flash-low", name: "Gemini 3.5 Flash Low", contextWindow: 1_048_576, maxTokens: 65_535, reasoning: true, supportsImages: true },
  { id: "gemini-3-5-flash-medium", name: "Gemini 3.5 Flash Medium", contextWindow: 1_048_576, maxTokens: 65_535, reasoning: true, supportsImages: true },
  { id: "gemini-3-5-flash-high", name: "Gemini 3.5 Flash High", contextWindow: 1_048_576, maxTokens: 65_535, reasoning: true, supportsImages: true },

  // ── Gemini 3.6 Flash ──
  { id: "gemini-3-6-flash-minimal", name: "Gemini 3.6 Flash Minimal", contextWindow: 1_048_576, maxTokens: 65_535, reasoning: true, supportsImages: true },
  { id: "gemini-3-6-flash-low", name: "Gemini 3.6 Flash Low", contextWindow: 1_048_576, maxTokens: 65_535, reasoning: true, supportsImages: true },
  { id: "gemini-3-6-flash-medium", name: "Gemini 3.6 Flash Medium", contextWindow: 1_048_576, maxTokens: 65_535, reasoning: true, supportsImages: true },
  { id: "gemini-3-6-flash-high", name: "Gemini 3.6 Flash High", contextWindow: 1_048_576, maxTokens: 65_535, reasoning: true, supportsImages: true },

  // ── Gemini 3.7 Flash ──
  { id: "gemini-3-7-flash-low", name: "Gemini 3.7 Flash Low", contextWindow: 1_048_576, maxTokens: 65_535, reasoning: true, supportsImages: true },
  { id: "gemini-3-7-flash-medium", name: "Gemini 3.7 Flash Medium", contextWindow: 1_048_576, maxTokens: 65_535, reasoning: true, supportsImages: true },
  { id: "gemini-3-7-flash-high", name: "Gemini 3.7 Flash High", contextWindow: 1_048_576, maxTokens: 65_535, reasoning: true, supportsImages: true },

  // ── GPT-5.6 Terra ──
  { id: "gpt-5-6-terra-none", name: "GPT-5.6 Terra No Thinking", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: false, supportsImages: true },
  { id: "gpt-5-6-terra-low", name: "GPT-5.6 Terra Low Thinking", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "gpt-5-6-terra-medium", name: "GPT-5.6 Terra Medium Thinking", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "gpt-5-6-terra-high", name: "GPT-5.6 Terra High Thinking", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "gpt-5-6-terra-xhigh", name: "GPT-5.6 Terra XHigh Thinking", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "gpt-5-6-terra-max", name: "GPT-5.6 Terra Max Thinking", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "gpt-5-6-terra-none-priority", name: "GPT-5.6 Terra No Thinking Fast", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: false, supportsImages: true },
  { id: "gpt-5-6-terra-low-priority", name: "GPT-5.6 Terra Low Thinking Fast", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "gpt-5-6-terra-medium-priority", name: "GPT-5.6 Terra Medium Thinking Fast", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "gpt-5-6-terra-high-priority", name: "GPT-5.6 Terra High Thinking Fast", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "gpt-5-6-terra-xhigh-priority", name: "GPT-5.6 Terra XHigh Thinking Fast", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "gpt-5-6-terra-max-priority", name: "GPT-5.6 Terra Max Thinking Fast", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, supportsImages: true },

  // ── Grok 4.5 ──
  { id: "grok-4-5-low", name: "Grok 4.5 Low", contextWindow: 500_000, maxTokens: 100_000, reasoning: true, supportsImages: true },
  { id: "grok-4-5-medium", name: "Grok 4.5 Medium", contextWindow: 500_000, maxTokens: 100_000, reasoning: true, supportsImages: true },
  { id: "grok-4-5-high", name: "Grok 4.5 High", contextWindow: 500_000, maxTokens: 100_000, reasoning: true, supportsImages: true },

  // ── Grok 4.6 ──
  { id: "grok-4-6-low", name: "Grok 4.6 Low", contextWindow: 500_000, maxTokens: 100_000, reasoning: true, supportsImages: true },
  { id: "grok-4-6-medium", name: "Grok 4.6 Medium", contextWindow: 500_000, maxTokens: 100_000, reasoning: true, supportsImages: true },
  { id: "grok-4-6-high", name: "Grok 4.6 High", contextWindow: 500_000, maxTokens: 100_000, reasoning: true, supportsImages: true },
  { id: "grok-4-6-xhigh", name: "Grok 4.6 XHigh", contextWindow: 500_000, maxTokens: 100_000, reasoning: true, supportsImages: true },

  // ── Inkling ──
  { id: "inkling-none", name: "Inkling None", contextWindow: 1_048_576, maxTokens: 131_072, reasoning: true, supportsImages: false },
  { id: "inkling-low", name: "Inkling Low", contextWindow: 1_048_576, maxTokens: 131_072, reasoning: true, supportsImages: false },
  { id: "inkling-medium", name: "Inkling Medium", contextWindow: 1_048_576, maxTokens: 131_072, reasoning: true, supportsImages: false },
  { id: "inkling-high", name: "Inkling High", contextWindow: 1_048_576, maxTokens: 131_072, reasoning: true, supportsImages: false },
  { id: "inkling-xhigh", name: "Inkling X-High", contextWindow: 1_048_576, maxTokens: 131_072, reasoning: true, supportsImages: false },
  { id: "inkling-max", name: "Inkling Max", contextWindow: 1_048_576, maxTokens: 131_072, reasoning: true, supportsImages: false },

  // ── GLM-5.3 Flash ──
  { id: "glm-5-3-flash-low", name: "GLM-5.3 Flash Low", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "glm-5-3-flash-high", name: "GLM-5.3 Flash High", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "glm-5-3-flash-max", name: "GLM-5.3 Flash Max", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, supportsImages: true },

  // ── DeepSeek V4 Flash ──
  { id: "deepseek-v4-flash-high", name: "DeepSeek V4 Flash High", contextWindow: 1_048_576, maxTokens: 384_000, reasoning: true, supportsImages: false },
  { id: "deepseek-v4-flash-max", name: "DeepSeek V4 Flash Max", contextWindow: 1_048_576, maxTokens: 384_000, reasoning: true, supportsImages: false },

  // ── DeepSeek V4.1 Flash ──
  { id: "deepseek-v4-1-flash-high", name: "DeepSeek V4.1 Flash High", contextWindow: 1_048_576, maxTokens: 384_000, reasoning: true, supportsImages: true },
  { id: "deepseek-v4-1-flash-max", name: "DeepSeek V4.1 Flash Max", contextWindow: 1_048_576, maxTokens: 384_000, reasoning: true, supportsImages: true },

  // ── SWE-1.7 ──
  { id: "swe-1-7", name: "SWE-1.7 Max", contextWindow: 262_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "swe-1-7-medium", name: "SWE-1.7 Medium", contextWindow: 262_000, maxTokens: 128_000, reasoning: true, supportsImages: true },

  // ── Claude Opus 4.6 ──
  { id: "claude-opus-4-6", name: "Claude Opus 4.6", contextWindow: 200_000, maxTokens: 128_000, reasoning: false, supportsImages: true },
  { id: "claude-opus-4-6-thinking", name: "Claude Opus 4.6 Thinking", contextWindow: 200_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "claude-opus-4-6-1m", name: "Claude Opus 4.6 1M", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: false, supportsImages: true },
  { id: "claude-opus-4-6-thinking-1m", name: "Claude Opus 4.6 Thinking 1M", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, supportsImages: true },

  // ── GPT-5.4 ──
  { id: "gpt-5-4-none", name: "GPT-5.4 No Thinking", contextWindow: 272_000, maxTokens: 128_000, reasoning: false, supportsImages: true },
  { id: "gpt-5-4-low", name: "GPT-5.4 Low Thinking", contextWindow: 272_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "gpt-5-4-medium", name: "GPT-5.4 Medium Thinking", contextWindow: 272_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "gpt-5-4-high", name: "GPT-5.4 High Thinking", contextWindow: 272_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "gpt-5-4-xhigh", name: "GPT-5.4 XHigh Thinking", contextWindow: 272_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "gpt-5-4-none-priority", name: "GPT-5.4 No Thinking Fast", contextWindow: 272_000, maxTokens: 128_000, reasoning: false, supportsImages: true },
  { id: "gpt-5-4-low-priority", name: "GPT-5.4 Low Thinking Fast", contextWindow: 272_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "gpt-5-4-medium-priority", name: "GPT-5.4 Medium Thinking Fast", contextWindow: 272_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "gpt-5-4-high-priority", name: "GPT-5.4 High Thinking Fast", contextWindow: 272_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "gpt-5-4-xhigh-priority", name: "GPT-5.4 XHigh Thinking Fast", contextWindow: 272_000, maxTokens: 128_000, reasoning: true, supportsImages: true },

  // ── GPT-5.5 ──
  { id: "gpt-5-5-none", name: "GPT-5.5 No Thinking", contextWindow: 272_000, maxTokens: 128_000, reasoning: false, supportsImages: true },
  { id: "gpt-5-5-low", name: "GPT-5.5 Low Thinking", contextWindow: 272_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "gpt-5-5-medium", name: "GPT-5.5 Medium Thinking", contextWindow: 272_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "gpt-5-5-high", name: "GPT-5.5 High Thinking", contextWindow: 272_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "gpt-5-5-xhigh", name: "GPT-5.5 XHigh Thinking", contextWindow: 272_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "gpt-5-5-none-priority", name: "GPT-5.5 No Thinking Fast", contextWindow: 272_000, maxTokens: 128_000, reasoning: false, supportsImages: true },
  { id: "gpt-5-5-low-priority", name: "GPT-5.5 Low Thinking Fast", contextWindow: 272_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "gpt-5-5-medium-priority", name: "GPT-5.5 Medium Thinking Fast", contextWindow: 272_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "gpt-5-5-high-priority", name: "GPT-5.5 High Thinking Fast", contextWindow: 272_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "gpt-5-5-xhigh-priority", name: "GPT-5.5 XHigh Thinking Fast", contextWindow: 272_000, maxTokens: 128_000, reasoning: true, supportsImages: true },

  // ── GPT-5.4 Mini ──
  { id: "gpt-5-4-mini-low", name: "GPT-5.4 Mini Low Thinking", contextWindow: 400_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "gpt-5-4-mini-medium", name: "GPT-5.4 Mini Medium Thinking", contextWindow: 400_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "gpt-5-4-mini-high", name: "GPT-5.4 Mini High Thinking", contextWindow: 400_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "gpt-5-4-mini-xhigh", name: "GPT-5.4 Mini XHigh Thinking", contextWindow: 400_000, maxTokens: 128_000, reasoning: true, supportsImages: true },

  // ── Claude Sonnet 4.6 ──
  { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", contextWindow: 200_000, maxTokens: 128_000, reasoning: false, supportsImages: true },
  { id: "claude-sonnet-4-6-thinking", name: "Claude Sonnet 4.6 Thinking", contextWindow: 200_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "claude-sonnet-4-6-1m", name: "Claude Sonnet 4.6 1M", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: false, supportsImages: true },
  { id: "claude-sonnet-4-6-thinking-1m", name: "Claude Sonnet 4.6 Thinking 1M", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, supportsImages: true },

  // ── GPT-5.2 ──
  { id: "MODEL_GPT_5_2_LOW", name: "GPT-5.2 Low Thinking", contextWindow: 384_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "MODEL_GPT_5_2_MEDIUM", name: "GPT-5.2 Medium Thinking", contextWindow: 384_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "MODEL_GPT_5_2_NONE", name: "GPT-5.2 No Thinking", contextWindow: 384_000, maxTokens: 128_000, reasoning: false, supportsImages: true },
  { id: "MODEL_GPT_5_2_HIGH", name: "GPT-5.2 High Thinking", contextWindow: 384_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "MODEL_GPT_5_2_XHIGH", name: "GPT-5.2 XHigh Thinking", contextWindow: 384_000, maxTokens: 128_000, reasoning: true, supportsImages: true },

  // ── Claude Opus 4.5 ──
  { id: "MODEL_CLAUDE_4_5_OPUS", name: "Claude Opus 4.5", contextWindow: 200_000, maxTokens: 64_000, reasoning: false, supportsImages: true },
  { id: "MODEL_CLAUDE_4_5_OPUS_THINKING", name: "Claude Opus 4.5 Thinking", contextWindow: 200_000, maxTokens: 64_000, reasoning: true, supportsImages: true },

  // ── Claude Haiku 4.5 ──
  { id: "MODEL_PRIVATE_11", name: "Claude Haiku 4.5", contextWindow: 200_000, maxTokens: 64_000, reasoning: false, supportsImages: true },

  // ── Claude Sonnet 4.5 ──
  { id: "MODEL_PRIVATE_2", name: "Claude Sonnet 4.5", contextWindow: 200_000, maxTokens: 64_000, reasoning: false, supportsImages: true },
  { id: "MODEL_PRIVATE_3", name: "Claude Sonnet 4.5 Thinking", contextWindow: 200_000, maxTokens: 64_000, reasoning: true, supportsImages: true },

  // ── GPT-4.1 ──
  { id: "MODEL_CHAT_GPT_4_1_2025_04_14", name: "GPT-4.1", contextWindow: 1_047_576, maxTokens: 32_768, reasoning: false, supportsImages: true },

  // ── GPT-5.1 ──
  { id: "MODEL_PRIVATE_12", name: "GPT-5.1 No Thinking", contextWindow: 272_000, maxTokens: 128_000, reasoning: false, supportsImages: true },
  { id: "MODEL_PRIVATE_13", name: "GPT-5.1 Low Thinking", contextWindow: 272_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "MODEL_PRIVATE_14", name: "GPT-5.1 Medium Thinking", contextWindow: 272_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "MODEL_PRIVATE_15", name: "GPT-5.1 High Thinking", contextWindow: 272_000, maxTokens: 128_000, reasoning: true, supportsImages: true },

  // ── GPT-5.3-Codex ──
  { id: "gpt-5-3-codex-low", name: "GPT-5.3-Codex Low", contextWindow: 400_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "gpt-5-3-codex-medium", name: "GPT-5.3-Codex Medium", contextWindow: 400_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "gpt-5-3-codex-high", name: "GPT-5.3-Codex High", contextWindow: 400_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "gpt-5-3-codex-xhigh", name: "GPT-5.3-Codex X-High", contextWindow: 400_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "gpt-5-3-codex-low-priority", name: "GPT-5.3-Codex Low Fast", contextWindow: 400_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "gpt-5-3-codex-medium-priority", name: "GPT-5.3-Codex Medium Fast", contextWindow: 400_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "gpt-5-3-codex-high-priority", name: "GPT-5.3-Codex High Fast", contextWindow: 400_000, maxTokens: 128_000, reasoning: true, supportsImages: true },
  { id: "gpt-5-3-codex-xhigh-priority", name: "GPT-5.3-Codex XHigh Fast", contextWindow: 400_000, maxTokens: 128_000, reasoning: true, supportsImages: true },

  // ── Kimi K2.6 ──
  { id: "kimi-k2-6", name: "Kimi K2.6", contextWindow: 262_144, maxTokens: 8_192, reasoning: true, supportsImages: true },

  // ── Kimi K2.7 ──
  { id: "kimi-k2-7", name: "Kimi K2.7", contextWindow: 262_144, maxTokens: 16_000, reasoning: true, supportsImages: true },

  // ── Nemotron 3 Ultra ──
  { id: "nemotron-3-ultra-none", name: "Nemotron 3 Ultra None", contextWindow: 1_000_000, maxTokens: 32_768, reasoning: true, supportsImages: false },
  { id: "nemotron-3-ultra-medium", name: "Nemotron 3 Ultra Medium", contextWindow: 1_000_000, maxTokens: 32_768, reasoning: true, supportsImages: false },
  { id: "nemotron-3-ultra-high", name: "Nemotron 3 Ultra High", contextWindow: 1_000_000, maxTokens: 32_768, reasoning: true, supportsImages: false },

  // ── SWE-1.6 ──
  { id: "swe-1-6", name: "SWE-1.6", contextWindow: 200_000, maxTokens: 128_000, reasoning: true, supportsImages: true },

  // ── SWE-1.6 Fast ──
  { id: "swe-1-6-fast", name: "SWE-1.6 Fast", contextWindow: 200_000, maxTokens: 128_000, reasoning: true, supportsImages: true },

  // ── Gemini 3.1 Pro ──
  { id: "gemini-3-1-pro-low", name: "Gemini 3.1 Pro Low Thinking", contextWindow: 1_048_576, maxTokens: 65_535, reasoning: true, supportsImages: true },
  { id: "gemini-3-1-pro-high", name: "Gemini 3.1 Pro High Thinking", contextWindow: 1_048_576, maxTokens: 65_535, reasoning: true, supportsImages: true },

  // ── Gemini 3 Flash ──
  { id: "MODEL_GOOGLE_GEMINI_3_0_FLASH_MINIMAL", name: "Gemini 3 Flash Minimal", contextWindow: 1_048_576, maxTokens: 65_535, reasoning: true, supportsImages: true },
  { id: "MODEL_GOOGLE_GEMINI_3_0_FLASH_LOW", name: "Gemini 3 Flash Low", contextWindow: 1_048_576, maxTokens: 65_535, reasoning: true, supportsImages: true },
  { id: "MODEL_GOOGLE_GEMINI_3_0_FLASH_MEDIUM", name: "Gemini 3 Flash Medium", contextWindow: 1_048_576, maxTokens: 65_535, reasoning: true, supportsImages: true },
  { id: "MODEL_GOOGLE_GEMINI_3_0_FLASH_HIGH", name: "Gemini 3 Flash High", contextWindow: 1_048_576, maxTokens: 65_535, reasoning: true, supportsImages: true },

  // ── DeepSeek V4 Pro ──
  { id: "deepseek-v4-pro-high", name: "DeepSeek V4 Pro High", contextWindow: 1_048_576, maxTokens: 384_000, reasoning: true, supportsImages: false },
  { id: "deepseek-v4-pro-max", name: "DeepSeek V4 Pro Max", contextWindow: 1_048_576, maxTokens: 384_000, reasoning: true, supportsImages: false },
];

export function listModels(): ModelInfo[] {
  return MODELS;
}
