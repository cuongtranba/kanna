import {
  DEFAULT_OPENAI_SDK_MODEL,
  DEFAULT_OPENROUTER_SDK_MODEL,
  type LlmProviderKind,
} from "../../shared/types"

export interface LlmProviderDraft {
  provider: LlmProviderKind
  apiKey: string
  model: string
  baseUrl: string
}

export function getDefaultLlmProviderModel(provider: LlmProviderKind): string {
  if (provider === "openai") return DEFAULT_OPENAI_SDK_MODEL
  if (provider === "openrouter") return DEFAULT_OPENROUTER_SDK_MODEL
  return ""
}

export function createLlmProviderDraftForSelection(
  current: LlmProviderDraft,
  nextProvider: LlmProviderKind,
): LlmProviderDraft {
  return {
    ...current,
    provider: nextProvider,
    model: getDefaultLlmProviderModel(nextProvider),
    baseUrl: nextProvider === "custom" ? current.baseUrl : "",
  }
}
