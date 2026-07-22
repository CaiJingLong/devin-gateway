/**
 * Static model catalog for the Devin provider.
 *
 * These are the known Cascade model UIDs.  The user may also pass any
 * model UID the server accepts even if it is not listed here.
 */

export interface ModelInfo {
  id: string;
  name: string;
  contextWindow: number;
  maxTokens: number;
  reasoning: boolean;
  /** Wire model UID to send as `chat_model_uid`; falls back to `id`. */
  requestModelId?: string;
  /** Maps reasoning effort → routed model UID. */
  effortRouting?: Record<string, string>;
}

const MODELS: ModelInfo[] = [
  { id: "claude-5-fable-low", name: "Claude Fable 5 Low", contextWindow: 1_000_000, maxTokens: 64_000, reasoning: true },
  { id: "claude-5-fable-medium", name: "Claude Fable 5 Medium", contextWindow: 1_000_000, maxTokens: 64_000, reasoning: true },
  { id: "claude-5-fable-high", name: "Claude Fable 5 High", contextWindow: 1_000_000, maxTokens: 64_000, reasoning: true },
  { id: "claude-5-fable-xhigh", name: "Claude Fable 5 XHigh", contextWindow: 1_000_000, maxTokens: 64_000, reasoning: true },
  { id: "claude-5-fable-max", name: "Claude Fable 5 Max", contextWindow: 1_000_000, maxTokens: 64_000, reasoning: true },
  { id: "claude-opus-4-6", name: "Claude Opus 4.6", contextWindow: 200_000, maxTokens: 64_000, reasoning: true },
  { id: "claude-opus-4-6-1m", name: "Claude Opus 4.6 1M", contextWindow: 1_000_000, maxTokens: 64_000, reasoning: true },
  {
    id: "claude-opus-4-7", name: "Claude Opus 4.7", contextWindow: 1_000_000, maxTokens: 64_000, reasoning: true,
    requestModelId: "claude-opus-4-7-low",
    effortRouting: { low: "claude-opus-4-7-low", medium: "claude-opus-4-7-medium", high: "claude-opus-4-7-high", xhigh: "claude-opus-4-7-xhigh", max: "claude-opus-4-7-max" },
  },
  {
    id: "claude-opus-4-7-fast", name: "Claude Opus 4.7 Fast", contextWindow: 1_000_000, maxTokens: 64_000, reasoning: true,
    requestModelId: "claude-opus-4-7-low-fast",
    effortRouting: { low: "claude-opus-4-7-low-fast", medium: "claude-opus-4-7-medium-fast", high: "claude-opus-4-7-high-fast", xhigh: "claude-opus-4-7-xhigh-fast", max: "claude-opus-4-7-max-fast" },
  },
  {
    id: "claude-opus-4-8", name: "Claude Opus 4.8", contextWindow: 1_000_000, maxTokens: 64_000, reasoning: true,
    requestModelId: "claude-opus-4-8-low",
    effortRouting: { low: "claude-opus-4-8-low", medium: "claude-opus-4-8-medium", high: "claude-opus-4-8-high", xhigh: "claude-opus-4-8-xhigh", max: "claude-opus-4-8-max" },
  },
  {
    id: "claude-opus-4-8-fast", name: "Claude Opus 4.8 Fast", contextWindow: 1_000_000, maxTokens: 64_000, reasoning: true,
    requestModelId: "claude-opus-4-8-low-fast",
    effortRouting: { low: "claude-opus-4-8-low-fast", medium: "claude-opus-4-8-medium-fast", high: "claude-opus-4-8-high-fast", xhigh: "claude-opus-4-8-xhigh-fast", max: "claude-opus-4-8-max-fast" },
  },
  { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", contextWindow: 200_000, maxTokens: 64_000, reasoning: true },
  { id: "claude-sonnet-4-6-1m", name: "Claude Sonnet 4.6 1M", contextWindow: 1_000_000, maxTokens: 64_000, reasoning: true },
  { id: "claude-sonnet-5-low", name: "Claude Sonnet 5 Low", contextWindow: 1_000_000, maxTokens: 64_000, reasoning: true },
  { id: "claude-sonnet-5-medium", name: "Claude Sonnet 5 Medium", contextWindow: 1_000_000, maxTokens: 64_000, reasoning: true },
  { id: "claude-sonnet-5-high", name: "Claude Sonnet 5 High", contextWindow: 1_000_000, maxTokens: 64_000, reasoning: true },
  { id: "claude-sonnet-5-xhigh", name: "Claude Sonnet 5 XHigh", contextWindow: 1_000_000, maxTokens: 64_000, reasoning: true },
  { id: "claude-sonnet-5-max", name: "Claude Sonnet 5 Max", contextWindow: 1_000_000, maxTokens: 64_000, reasoning: true },
  { id: "deepseek-v4", name: "DeepSeek V4 Pro", contextWindow: 1_048_576, maxTokens: 64_000, reasoning: true },
  {
    id: "gemini-3-1-pro", name: "Gemini 3.1 Pro", contextWindow: 1_048_576, maxTokens: 64_000, reasoning: true,
    requestModelId: "gemini-3-1-pro-low",
  },
  {
    id: "gemini-3-5-flash", name: "Gemini 3.5 Flash", contextWindow: 1_048_576, maxTokens: 64_000, reasoning: true,
    requestModelId: "gemini-3-5-flash-minimal",
  },
  {
    id: "gemini-3-flash", name: "Gemini 3 Flash", contextWindow: 1_048_576, maxTokens: 64_000, reasoning: true,
    requestModelId: "MODEL_GOOGLE_GEMINI_3_0_FLASH_MINIMAL",
  },
  { id: "glm-5-2", name: "GLM-5.2", contextWindow: 200_000, maxTokens: 64_000, reasoning: true },
  { id: "glm-5-2-1m", name: "GLM-5.2 1M", contextWindow: 1_000_000, maxTokens: 64_000, reasoning: true, requestModelId: "glm-5-2-none-1m" },
  {
    id: "gpt-5-2", name: "GPT-5.2", contextWindow: 384_000, maxTokens: 64_000, reasoning: true,
    requestModelId: "MODEL_GPT_5_2_NONE",
  },
  {
    id: "gpt-5-3-codex", name: "GPT-5.3 Codex", contextWindow: 400_000, maxTokens: 64_000, reasoning: true,
    requestModelId: "gpt-5-3-codex-low",
  },
  {
    id: "gpt-5-3-codex-fast", name: "GPT-5.3 Codex Fast", contextWindow: 400_000, maxTokens: 64_000, reasoning: true,
    requestModelId: "gpt-5-3-codex-low-priority",
  },
  {
    id: "gpt-5-4", name: "GPT-5.4", contextWindow: 272_000, maxTokens: 64_000, reasoning: true,
    requestModelId: "gpt-5-4-none",
  },
  {
    id: "gpt-5-4-fast", name: "GPT-5.4 Fast", contextWindow: 272_000, maxTokens: 64_000, reasoning: true,
    requestModelId: "gpt-5-4-none-priority",
  },
  {
    id: "gpt-5-4-mini", name: "GPT-5.4 Mini", contextWindow: 400_000, maxTokens: 64_000, reasoning: true,
    requestModelId: "gpt-5-4-mini-low",
  },
  {
    id: "gpt-5-5", name: "GPT-5.5", contextWindow: 272_000, maxTokens: 64_000, reasoning: true,
    requestModelId: "gpt-5-5-none",
  },
  {
    id: "gpt-5-5-fast", name: "GPT-5.5 Fast", contextWindow: 272_000, maxTokens: 64_000, reasoning: true,
    requestModelId: "gpt-5-5-none-priority",
  },
  {
    id: "gpt-5-6-luna", name: "GPT-5.6 Luna", contextWindow: 1_000_000, maxTokens: 64_000, reasoning: true,
    requestModelId: "gpt-5-6-luna-none",
  },
  {
    id: "gpt-5-6-luna-fast", name: "GPT-5.6 Luna Fast", contextWindow: 1_000_000, maxTokens: 64_000, reasoning: true,
    requestModelId: "gpt-5-6-luna-none-priority",
  },
  {
    id: "gpt-5-6-sol", name: "GPT-5.6 Sol", contextWindow: 1_000_000, maxTokens: 64_000, reasoning: true,
    requestModelId: "gpt-5-6-sol-none",
  },
  {
    id: "gpt-5-6-sol-fast", name: "GPT-5.6 Sol Fast", contextWindow: 1_000_000, maxTokens: 64_000, reasoning: true,
    requestModelId: "gpt-5-6-sol-none-priority",
  },
  {
    id: "gpt-5-6-terra", name: "GPT-5.6 Terra", contextWindow: 1_000_000, maxTokens: 64_000, reasoning: true,
    requestModelId: "gpt-5-6-terra-none",
  },
  {
    id: "gpt-5-6-terra-fast", name: "GPT-5.6 Terra Fast", contextWindow: 1_000_000, maxTokens: 64_000, reasoning: true,
    requestModelId: "gpt-5-6-terra-none-priority",
  },
  { id: "grok-4-5-low", name: "Grok 4.5 Low", contextWindow: 500_000, maxTokens: 64_000, reasoning: true },
  { id: "grok-4-5-medium", name: "Grok 4.5 Medium", contextWindow: 500_000, maxTokens: 64_000, reasoning: true },
  { id: "grok-4-5-high", name: "Grok 4.5 High", contextWindow: 500_000, maxTokens: 64_000, reasoning: true },
  { id: "kimi-k2-6", name: "Kimi K2.6", contextWindow: 262_144, maxTokens: 64_000, reasoning: true },
  { id: "kimi-k2-7", name: "Kimi K2.7", contextWindow: 262_144, maxTokens: 64_000, reasoning: true },
  { id: "nemotron-3-ultra-nvfp4", name: "Nemotron 3 Ultra", contextWindow: 262_144, maxTokens: 64_000, reasoning: true },
  { id: "swe-1-6", name: "SWE-1.6", contextWindow: 200_000, maxTokens: 64_000, reasoning: true },
  { id: "swe-1-6-fast", name: "SWE-1.6 Fast", contextWindow: 200_000, maxTokens: 64_000, reasoning: true },
  { id: "swe-1-7", name: "SWE-1.7 Max", contextWindow: 262_000, maxTokens: 64_000, reasoning: true },
  { id: "swe-1-7-lightning", name: "SWE-1.7 Lightning", contextWindow: 202_752, maxTokens: 64_000, reasoning: true },
];

const MODEL_MAP = new Map(MODELS.map((m) => [m.id, m]));

export function getModel(id: string): ModelInfo | undefined {
  return MODEL_MAP.get(id);
}

export function resolveModelUid(modelId: string, effort?: string): string {
  const model = getModel(modelId);
  if (!model) return modelId; // pass-through unknown model UIDs
  if (effort && model.effortRouting?.[effort]) {
    return model.effortRouting[effort];
  }
  return model.requestModelId ?? model.id;
}

export function listModels(): ModelInfo[] {
  return MODELS;
}
