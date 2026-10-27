import { isAgentProvider, type DefaultProviderPreference } from "../core-types"
import type { JsonValue } from "../json"
import {
  DEFAULT_CLAUDE_CHAT_MODEL,
  DEFAULT_CLAUDE_MODEL_OPTIONS,
  DEFAULT_CODEX_CHAT_MODEL,
  DEFAULT_CODEX_MODEL_OPTIONS,
  DEFAULT_OPENROUTER_SDK_MODEL,
  isClaudeReasoningEffort,
  isCodexReasoningEffort,
  normalizeClaudeContextWindow,
  normalizeClaudeModelId,
  normalizeClaudeReasoningEffort,
  normalizeCodexModelId,
  type ChatProviderPreferences,
  type ClaudeModelOptions,
  type CodexModelOptions,
  type CustomModelEntry,
  type ProviderPreference,
} from "../provider-model-types"

interface RawProviderPreference<TOptions> {
  model?: string
  effort?: string
  modelOptions?: Partial<Record<keyof TOptions, JsonValue>>
  planMode?: boolean
}

export interface RawProviderDefaults {
  claude?: RawProviderPreference<ClaudeModelOptions>
  codex?: RawProviderPreference<CodexModelOptions>
  openrouter?: { model?: string; planMode?: boolean }
  custom?: { model?: string; planMode?: boolean }
}

export function createDefaultProviderDefaults(): ChatProviderPreferences {
  return {
    claude: {
      model: DEFAULT_CLAUDE_CHAT_MODEL,
      modelOptions: { ...DEFAULT_CLAUDE_MODEL_OPTIONS },
      planMode: false,
    },
    codex: {
      model: DEFAULT_CODEX_CHAT_MODEL,
      modelOptions: { ...DEFAULT_CODEX_MODEL_OPTIONS },
      planMode: false,
    },
    openrouter: { model: DEFAULT_OPENROUTER_SDK_MODEL, modelOptions: {}, planMode: false },
    custom: { model: "", modelOptions: {}, planMode: false },
  }
}

export function normalizeDefaultProvider<T>(value: T): DefaultProviderPreference {
  return isAgentProvider(value) ? value : "last_used"
}

function stringOrUndefined<T>(value: T): string | undefined {
  return typeof value === "string" ? value : undefined
}

export function normalizeClaudePreference(
  value?: RawProviderPreference<ClaudeModelOptions>,
  customModels?: readonly CustomModelEntry[],
): ProviderPreference<ClaudeModelOptions> {
  const model = normalizeClaudeModelId(stringOrUndefined(value?.model), undefined, customModels)
  const effort = [value?.modelOptions?.reasoningEffort, value?.effort]
    .map(stringOrUndefined)
    .find(isClaudeReasoningEffort)
  return {
    model,
    modelOptions: {
      reasoningEffort: normalizeClaudeReasoningEffort(
        model,
        effort ?? DEFAULT_CLAUDE_MODEL_OPTIONS.reasoningEffort,
        customModels,
      ),
      contextWindow: normalizeClaudeContextWindow(
        model,
        stringOrUndefined(value?.modelOptions?.contextWindow),
        customModels,
      ),
    },
    planMode: value?.planMode === true,
  }
}

export function normalizeCodexPreference(
  value?: RawProviderPreference<CodexModelOptions>,
  customModels?: readonly CustomModelEntry[],
): ProviderPreference<CodexModelOptions> {
  const effort = [value?.modelOptions?.reasoningEffort, value?.effort]
    .map(stringOrUndefined)
    .find(isCodexReasoningEffort)
  const fastMode = value?.modelOptions?.fastMode
  return {
    model: normalizeCodexModelId(stringOrUndefined(value?.model), undefined, customModels),
    modelOptions: {
      reasoningEffort: effort ?? DEFAULT_CODEX_MODEL_OPTIONS.reasoningEffort,
      fastMode: typeof fastMode === "boolean" ? fastMode : DEFAULT_CODEX_MODEL_OPTIONS.fastMode,
    },
    planMode: value?.planMode === true,
  }
}

export function normalizeProviderDefaults(
  value?: RawProviderDefaults,
  customModels?: readonly CustomModelEntry[],
): ChatProviderPreferences {
  return {
    claude: normalizeClaudePreference(value?.claude, customModels),
    codex: normalizeCodexPreference(value?.codex, customModels),
    openrouter: {
      model: value?.openrouter?.model ?? DEFAULT_OPENROUTER_SDK_MODEL,
      modelOptions: {},
      planMode: Boolean(value?.openrouter?.planMode),
    },
    custom: { model: value?.custom?.model ?? "", modelOptions: {}, planMode: Boolean(value?.custom?.planMode) },
  }
}
