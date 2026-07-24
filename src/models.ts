/**
 * Static model catalog for the Devin provider.
 *
 * Catalog IDs are the exact Cascade model UIDs sent to the upstream API as
 * `chat_model_uid` — what the client sees is what the gateway forwards. No
 * aliasing, no effort routing: pick a UID from `GET /v1/models` and it is
 * passed through verbatim. Unknown IDs are also passed through untouched.
 */

export interface ModelInfo {
  id: string;
  name: string;
  contextWindow: number;
  maxTokens: number;
  reasoning: boolean;
}

const MODELS: ModelInfo[] = [
  // ── Claude Fable 5 ──
  { id: "claude-5-fable-low", name: "Claude Fable 5 Low", contextWindow: 1_000_000, maxTokens: 64_000, reasoning: true },
  { id: "claude-5-fable-medium", name: "Claude Fable 5 Medium", contextWindow: 1_000_000, maxTokens: 64_000, reasoning: true },
  { id: "claude-5-fable-high", name: "Claude Fable 5 High", contextWindow: 1_000_000, maxTokens: 64_000, reasoning: true },
  { id: "claude-5-fable-xhigh", name: "Claude Fable 5 XHigh", contextWindow: 1_000_000, maxTokens: 64_000, reasoning: true },
  { id: "claude-5-fable-max", name: "Claude Fable 5 Max", contextWindow: 1_000_000, maxTokens: 64_000, reasoning: true },

  // ── Claude Opus 4.6 ──
  { id: "claude-opus-4-6", name: "Claude Opus 4.6", contextWindow: 200_000, maxTokens: 64_000, reasoning: true },
  { id: "claude-opus-4-6-1m", name: "Claude Opus 4.6 1M", contextWindow: 1_000_000, maxTokens: 64_000, reasoning: true },

  // ── Claude Opus 4.7 ──
  { id: "claude-opus-4-7-low", name: "Claude Opus 4.7 Low", contextWindow: 1_000_000, maxTokens: 64_000, reasoning: true },
  { id: "claude-opus-4-7-medium", name: "Claude Opus 4.7 Medium", contextWindow: 1_000_000, maxTokens: 64_000, reasoning: true },
  { id: "claude-opus-4-7-high", name: "Claude Opus 4.7 High", contextWindow: 1_000_000, maxTokens: 64_000, reasoning: true },
  { id: "claude-opus-4-7-xhigh", name: "Claude Opus 4.7 XHigh", contextWindow: 1_000_000, maxTokens: 64_000, reasoning: true },
  { id: "claude-opus-4-7-max", name: "Claude Opus 4.7 Max", contextWindow: 1_000_000, maxTokens: 64_000, reasoning: true },

  // ── Claude Opus 4.8 ──
  { id: "claude-opus-4-8-low", name: "Claude Opus 4.8 Low", contextWindow: 1_000_000, maxTokens: 64_000, reasoning: true },
  { id: "claude-opus-4-8-medium", name: "Claude Opus 4.8 Medium", contextWindow: 1_000_000, maxTokens: 64_000, reasoning: true },
  { id: "claude-opus-4-8-high", name: "Claude Opus 4.8 High", contextWindow: 1_000_000, maxTokens: 64_000, reasoning: true },
  { id: "claude-opus-4-8-xhigh", name: "Claude Opus 4.8 XHigh", contextWindow: 1_000_000, maxTokens: 64_000, reasoning: true },
  { id: "claude-opus-4-8-max", name: "Claude Opus 4.8 Max", contextWindow: 1_000_000, maxTokens: 64_000, reasoning: true },

  // ── Claude Opus 4.8 Fast ──
  { id: "claude-opus-4-8-low-fast", name: "Claude Opus 4.8 Low Fast", contextWindow: 1_000_000, maxTokens: 64_000, reasoning: true },
  { id: "claude-opus-4-8-medium-fast", name: "Claude Opus 4.8 Medium Fast", contextWindow: 1_000_000, maxTokens: 64_000, reasoning: true },
  { id: "claude-opus-4-8-high-fast", name: "Claude Opus 4.8 High Fast", contextWindow: 1_000_000, maxTokens: 64_000, reasoning: true },
  { id: "claude-opus-4-8-xhigh-fast", name: "Claude Opus 4.8 XHigh Fast", contextWindow: 1_000_000, maxTokens: 64_000, reasoning: true },
  { id: "claude-opus-4-8-max-fast", name: "Claude Opus 4.8 Max Fast", contextWindow: 1_000_000, maxTokens: 64_000, reasoning: true },

  // ── Claude Sonnet 4.6 ──
  { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", contextWindow: 200_000, maxTokens: 64_000, reasoning: true },
  { id: "claude-sonnet-4-6-1m", name: "Claude Sonnet 4.6 1M", contextWindow: 1_000_000, maxTokens: 64_000, reasoning: true },

  // ── Claude Sonnet 5 ──
  { id: "claude-sonnet-5-low", name: "Claude Sonnet 5 Low", contextWindow: 1_000_000, maxTokens: 64_000, reasoning: true },
  { id: "claude-sonnet-5-medium", name: "Claude Sonnet 5 Medium", contextWindow: 1_000_000, maxTokens: 64_000, reasoning: true },
  { id: "claude-sonnet-5-high", name: "Claude Sonnet 5 High", contextWindow: 1_000_000, maxTokens: 64_000, reasoning: true },
  { id: "claude-sonnet-5-xhigh", name: "Claude Sonnet 5 XHigh", contextWindow: 1_000_000, maxTokens: 64_000, reasoning: true },
  { id: "claude-sonnet-5-max", name: "Claude Sonnet 5 Max", contextWindow: 1_000_000, maxTokens: 64_000, reasoning: true },

  // ── DeepSeek ──
  { id: "deepseek-v4", name: "DeepSeek V4 Pro", contextWindow: 1_048_576, maxTokens: 64_000, reasoning: true },

  // ── Gemini 3.1 Pro ──
  { id: "gemini-3-1-pro-low", name: "Gemini 3.1 Pro Low", contextWindow: 1_048_576, maxTokens: 64_000, reasoning: true },
  { id: "gemini-3-1-pro-high", name: "Gemini 3.1 Pro High", contextWindow: 1_048_576, maxTokens: 64_000, reasoning: true },

  // ── Gemini 3.5 Flash ──
  { id: "gemini-3-5-flash-minimal", name: "Gemini 3.5 Flash Minimal", contextWindow: 1_048_576, maxTokens: 64_000, reasoning: true },
  { id: "gemini-3-5-flash-low", name: "Gemini 3.5 Flash Low", contextWindow: 1_048_576, maxTokens: 64_000, reasoning: true },
  { id: "gemini-3-5-flash-medium", name: "Gemini 3.5 Flash Medium", contextWindow: 1_048_576, maxTokens: 64_000, reasoning: true },
  { id: "gemini-3-5-flash-high", name: "Gemini 3.5 Flash High", contextWindow: 1_048_576, maxTokens: 64_000, reasoning: true },

  // ── Gemini 3 Flash ──
  { id: "MODEL_GOOGLE_GEMINI_3_0_FLASH_MINIMAL", name: "Gemini 3 Flash Minimal", contextWindow: 1_048_576, maxTokens: 64_000, reasoning: true },
  { id: "MODEL_GOOGLE_GEMINI_3_0_FLASH_LOW", name: "Gemini 3 Flash Low", contextWindow: 1_048_576, maxTokens: 64_000, reasoning: true },
  { id: "MODEL_GOOGLE_GEMINI_3_0_FLASH_MEDIUM", name: "Gemini 3 Flash Medium", contextWindow: 1_048_576, maxTokens: 64_000, reasoning: true },
  { id: "MODEL_GOOGLE_GEMINI_3_0_FLASH_HIGH", name: "Gemini 3 Flash High", contextWindow: 1_048_576, maxTokens: 64_000, reasoning: true },

  // ── GLM 5.2 (200K) ──
  { id: "glm-5-2", name: "GLM-5.2", contextWindow: 200_000, maxTokens: 64_000, reasoning: true },
  { id: "glm-5-2-none", name: "GLM-5.2 None", contextWindow: 200_000, maxTokens: 64_000, reasoning: true },
  { id: "glm-5-2-max", name: "GLM-5.2 Max", contextWindow: 200_000, maxTokens: 64_000, reasoning: true },

  // ── GLM 5.2 1M ──
  { id: "glm-5-2-1m", name: "GLM-5.2 1M", contextWindow: 1_000_000, maxTokens: 64_000, reasoning: true },
  { id: "glm-5-2-none-1m", name: "GLM-5.2 None 1M", contextWindow: 1_000_000, maxTokens: 64_000, reasoning: true },
  { id: "glm-5-2-max-1m", name: "GLM-5.2 Max 1M", contextWindow: 1_000_000, maxTokens: 64_000, reasoning: true },

  // ── GPT 5.2 ──
  { id: "MODEL_GPT_5_2_NONE", name: "GPT-5.2 None", contextWindow: 384_000, maxTokens: 64_000, reasoning: true },
  { id: "MODEL_GPT_5_2_LOW", name: "GPT-5.2 Low", contextWindow: 384_000, maxTokens: 64_000, reasoning: true },
  { id: "MODEL_GPT_5_2_MEDIUM", name: "GPT-5.2 Medium", contextWindow: 384_000, maxTokens: 64_000, reasoning: true },
  { id: "MODEL_GPT_5_2_HIGH", name: "GPT-5.2 High", contextWindow: 384_000, maxTokens: 64_000, reasoning: true },
  { id: "MODEL_GPT_5_2_XHIGH", name: "GPT-5.2 XHigh", contextWindow: 384_000, maxTokens: 64_000, reasoning: true },

  // ── GPT 5.3 Codex ──
  { id: "gpt-5-3-codex-low", name: "GPT-5.3 Codex Low", contextWindow: 400_000, maxTokens: 64_000, reasoning: true },
  { id: "gpt-5-3-codex-medium", name: "GPT-5.3 Codex Medium", contextWindow: 400_000, maxTokens: 64_000, reasoning: true },
  { id: "gpt-5-3-codex-high", name: "GPT-5.3 Codex High", contextWindow: 400_000, maxTokens: 64_000, reasoning: true },
  { id: "gpt-5-3-codex-xhigh", name: "GPT-5.3 Codex XHigh", contextWindow: 400_000, maxTokens: 64_000, reasoning: true },

  // ── GPT 5.3 Codex Fast (priority) ──
  { id: "gpt-5-3-codex-low-priority", name: "GPT-5.3 Codex Fast Low", contextWindow: 400_000, maxTokens: 64_000, reasoning: true },
  { id: "gpt-5-3-codex-medium-priority", name: "GPT-5.3 Codex Fast Medium", contextWindow: 400_000, maxTokens: 64_000, reasoning: true },
  { id: "gpt-5-3-codex-high-priority", name: "GPT-5.3 Codex Fast High", contextWindow: 400_000, maxTokens: 64_000, reasoning: true },
  { id: "gpt-5-3-codex-xhigh-priority", name: "GPT-5.3 Codex Fast XHigh", contextWindow: 400_000, maxTokens: 64_000, reasoning: true },

  // ── GPT 5.4 ──
  { id: "gpt-5-4-none", name: "GPT-5.4 None", contextWindow: 272_000, maxTokens: 64_000, reasoning: true },
  { id: "gpt-5-4-low", name: "GPT-5.4 Low", contextWindow: 272_000, maxTokens: 64_000, reasoning: true },
  { id: "gpt-5-4-medium", name: "GPT-5.4 Medium", contextWindow: 272_000, maxTokens: 64_000, reasoning: true },
  { id: "gpt-5-4-high", name: "GPT-5.4 High", contextWindow: 272_000, maxTokens: 64_000, reasoning: true },
  { id: "gpt-5-4-xhigh", name: "GPT-5.4 XHigh", contextWindow: 272_000, maxTokens: 64_000, reasoning: true },

  // ── GPT 5.4 Fast (priority) ──
  { id: "gpt-5-4-none-priority", name: "GPT-5.4 Fast None", contextWindow: 272_000, maxTokens: 64_000, reasoning: true },
  { id: "gpt-5-4-low-priority", name: "GPT-5.4 Fast Low", contextWindow: 272_000, maxTokens: 64_000, reasoning: true },
  { id: "gpt-5-4-medium-priority", name: "GPT-5.4 Fast Medium", contextWindow: 272_000, maxTokens: 64_000, reasoning: true },
  { id: "gpt-5-4-high-priority", name: "GPT-5.4 Fast High", contextWindow: 272_000, maxTokens: 64_000, reasoning: true },
  { id: "gpt-5-4-xhigh-priority", name: "GPT-5.4 Fast XHigh", contextWindow: 272_000, maxTokens: 64_000, reasoning: true },

  // ── GPT 5.4 Mini ──
  { id: "gpt-5-4-mini-low", name: "GPT-5.4 Mini Low", contextWindow: 400_000, maxTokens: 64_000, reasoning: true },
  { id: "gpt-5-4-mini-medium", name: "GPT-5.4 Mini Medium", contextWindow: 400_000, maxTokens: 64_000, reasoning: true },
  { id: "gpt-5-4-mini-high", name: "GPT-5.4 Mini High", contextWindow: 400_000, maxTokens: 64_000, reasoning: true },
  { id: "gpt-5-4-mini-xhigh", name: "GPT-5.4 Mini XHigh", contextWindow: 400_000, maxTokens: 64_000, reasoning: true },

  // ── GPT 5.5 ──
  { id: "gpt-5-5-none", name: "GPT-5.5 None", contextWindow: 272_000, maxTokens: 64_000, reasoning: true },
  { id: "gpt-5-5-low", name: "GPT-5.5 Low", contextWindow: 272_000, maxTokens: 64_000, reasoning: true },
  { id: "gpt-5-5-medium", name: "GPT-5.5 Medium", contextWindow: 272_000, maxTokens: 64_000, reasoning: true },
  { id: "gpt-5-5-high", name: "GPT-5.5 High", contextWindow: 272_000, maxTokens: 64_000, reasoning: true },
  { id: "gpt-5-5-xhigh", name: "GPT-5.5 XHigh", contextWindow: 272_000, maxTokens: 64_000, reasoning: true },

  // ── GPT 5.5 Fast (priority) ──
  { id: "gpt-5-5-none-priority", name: "GPT-5.5 Fast None", contextWindow: 272_000, maxTokens: 64_000, reasoning: true },
  { id: "gpt-5-5-low-priority", name: "GPT-5.5 Fast Low", contextWindow: 272_000, maxTokens: 64_000, reasoning: true },
  { id: "gpt-5-5-medium-priority", name: "GPT-5.5 Fast Medium", contextWindow: 272_000, maxTokens: 64_000, reasoning: true },
  { id: "gpt-5-5-high-priority", name: "GPT-5.5 Fast High", contextWindow: 272_000, maxTokens: 64_000, reasoning: true },
  { id: "gpt-5-5-xhigh-priority", name: "GPT-5.5 Fast XHigh", contextWindow: 272_000, maxTokens: 64_000, reasoning: true },

  // ── GPT 5.6 Luna ──
  { id: "gpt-5-6-luna-none", name: "GPT-5.6 Luna None", contextWindow: 1_000_000, maxTokens: 64_000, reasoning: true },
  { id: "gpt-5-6-luna-low", name: "GPT-5.6 Luna Low", contextWindow: 1_000_000, maxTokens: 64_000, reasoning: true },
  { id: "gpt-5-6-luna-medium", name: "GPT-5.6 Luna Medium", contextWindow: 1_000_000, maxTokens: 64_000, reasoning: true },
  { id: "gpt-5-6-luna-high", name: "GPT-5.6 Luna High", contextWindow: 1_000_000, maxTokens: 64_000, reasoning: true },
  { id: "gpt-5-6-luna-xhigh", name: "GPT-5.6 Luna XHigh", contextWindow: 1_000_000, maxTokens: 64_000, reasoning: true },
  { id: "gpt-5-6-luna-max", name: "GPT-5.6 Luna Max", contextWindow: 1_000_000, maxTokens: 64_000, reasoning: true },

  // ── GPT 5.6 Luna Fast (priority) ──
  { id: "gpt-5-6-luna-none-priority", name: "GPT-5.6 Luna Fast None", contextWindow: 1_000_000, maxTokens: 64_000, reasoning: true },
  { id: "gpt-5-6-luna-low-priority", name: "GPT-5.6 Luna Fast Low", contextWindow: 1_000_000, maxTokens: 64_000, reasoning: true },
  { id: "gpt-5-6-luna-medium-priority", name: "GPT-5.6 Luna Fast Medium", contextWindow: 1_000_000, maxTokens: 64_000, reasoning: true },
  { id: "gpt-5-6-luna-high-priority", name: "GPT-5.6 Luna Fast High", contextWindow: 1_000_000, maxTokens: 64_000, reasoning: true },
  { id: "gpt-5-6-luna-xhigh-priority", name: "GPT-5.6 Luna Fast XHigh", contextWindow: 1_000_000, maxTokens: 64_000, reasoning: true },

  // ── GPT 5.6 Sol ──
  { id: "gpt-5-6-sol-none", name: "GPT-5.6 Sol None", contextWindow: 1_000_000, maxTokens: 64_000, reasoning: true },
  { id: "gpt-5-6-sol-low", name: "GPT-5.6 Sol Low", contextWindow: 1_000_000, maxTokens: 64_000, reasoning: true },
  { id: "gpt-5-6-sol-medium", name: "GPT-5.6 Sol Medium", contextWindow: 1_000_000, maxTokens: 64_000, reasoning: true },
  { id: "gpt-5-6-sol-high", name: "GPT-5.6 Sol High", contextWindow: 1_000_000, maxTokens: 64_000, reasoning: true },
  { id: "gpt-5-6-sol-xhigh", name: "GPT-5.6 Sol XHigh", contextWindow: 1_000_000, maxTokens: 64_000, reasoning: true },
  { id: "gpt-5-6-sol-max", name: "GPT-5.6 Sol Max", contextWindow: 1_000_000, maxTokens: 64_000, reasoning: true },

  // ── GPT 5.6 Sol Fast (priority) ──
  { id: "gpt-5-6-sol-none-priority", name: "GPT-5.6 Sol Fast None", contextWindow: 1_000_000, maxTokens: 64_000, reasoning: true },
  { id: "gpt-5-6-sol-low-priority", name: "GPT-5.6 Sol Fast Low", contextWindow: 1_000_000, maxTokens: 64_000, reasoning: true },
  { id: "gpt-5-6-sol-medium-priority", name: "GPT-5.6 Sol Fast Medium", contextWindow: 1_000_000, maxTokens: 64_000, reasoning: true },
  { id: "gpt-5-6-sol-high-priority", name: "GPT-5.6 Sol Fast High", contextWindow: 1_000_000, maxTokens: 64_000, reasoning: true },
  { id: "gpt-5-6-sol-xhigh-priority", name: "GPT-5.6 Sol Fast XHigh", contextWindow: 1_000_000, maxTokens: 64_000, reasoning: true },

  // ── GPT 5.6 Terra ──
  { id: "gpt-5-6-terra-none", name: "GPT-5.6 Terra None", contextWindow: 1_000_000, maxTokens: 64_000, reasoning: true },
  { id: "gpt-5-6-terra-low", name: "GPT-5.6 Terra Low", contextWindow: 1_000_000, maxTokens: 64_000, reasoning: true },
  { id: "gpt-5-6-terra-medium", name: "GPT-5.6 Terra Medium", contextWindow: 1_000_000, maxTokens: 64_000, reasoning: true },
  { id: "gpt-5-6-terra-high", name: "GPT-5.6 Terra High", contextWindow: 1_000_000, maxTokens: 64_000, reasoning: true },
  { id: "gpt-5-6-terra-xhigh", name: "GPT-5.6 Terra XHigh", contextWindow: 1_000_000, maxTokens: 64_000, reasoning: true },
  { id: "gpt-5-6-terra-max", name: "GPT-5.6 Terra Max", contextWindow: 1_000_000, maxTokens: 64_000, reasoning: true },

  // ── GPT 5.6 Terra Fast (priority) ──
  { id: "gpt-5-6-terra-none-priority", name: "GPT-5.6 Terra Fast None", contextWindow: 1_000_000, maxTokens: 64_000, reasoning: true },
  { id: "gpt-5-6-terra-low-priority", name: "GPT-5.6 Terra Fast Low", contextWindow: 1_000_000, maxTokens: 64_000, reasoning: true },
  { id: "gpt-5-6-terra-medium-priority", name: "GPT-5.6 Terra Fast Medium", contextWindow: 1_000_000, maxTokens: 64_000, reasoning: true },
  { id: "gpt-5-6-terra-high-priority", name: "GPT-5.6 Terra Fast High", contextWindow: 1_000_000, maxTokens: 64_000, reasoning: true },
  { id: "gpt-5-6-terra-xhigh-priority", name: "GPT-5.6 Terra Fast XHigh", contextWindow: 1_000_000, maxTokens: 64_000, reasoning: true },

  // ── Grok 4.5 ──
  { id: "grok-4-5-low", name: "Grok 4.5 Low", contextWindow: 500_000, maxTokens: 64_000, reasoning: true },
  { id: "grok-4-5-medium", name: "Grok 4.5 Medium", contextWindow: 500_000, maxTokens: 64_000, reasoning: true },
  { id: "grok-4-5-high", name: "Grok 4.5 High", contextWindow: 500_000, maxTokens: 64_000, reasoning: true },

  // ── Kimi ──
  { id: "kimi-k2-6", name: "Kimi K2.6", contextWindow: 262_144, maxTokens: 64_000, reasoning: true },
  { id: "kimi-k2-7", name: "Kimi K2.7", contextWindow: 262_144, maxTokens: 64_000, reasoning: true },

  // ── Nemotron ──
  { id: "nemotron-3-ultra-nvfp4", name: "Nemotron 3 Ultra", contextWindow: 262_144, maxTokens: 64_000, reasoning: true },

  // ── SWE ──
  { id: "swe-1-6", name: "SWE-1.6", contextWindow: 200_000, maxTokens: 64_000, reasoning: true },
  { id: "swe-1-6-fast", name: "SWE-1.6 Fast", contextWindow: 200_000, maxTokens: 64_000, reasoning: true },
  { id: "swe-1-7", name: "SWE-1.7 Max", contextWindow: 262_000, maxTokens: 64_000, reasoning: true },
  { id: "swe-1-7-lightning", name: "SWE-1.7 Lightning", contextWindow: 202_752, maxTokens: 64_000, reasoning: true },
];

export function listModels(): ModelInfo[] {
  return MODELS;
}

export function listModels(): ModelInfo[] {
  return MODELS;
}
