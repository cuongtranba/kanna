import type { AgentProvider } from "./core-types"
import type { ChatProviderPreferences, ModelOptions } from "./provider-model-types"

export interface TurnModelSelection {
  model?: string
  modelOptions?: ModelOptions
}

export function providerDefaultSelection(
  provider: AgentProvider,
  preferences: ChatProviderPreferences | undefined,
): TurnModelSelection {
  if (!preferences) return {}
  if (provider === "claude") {
    const preference = preferences.claude
    if (!preference?.model) return {}
    return { model: preference.model, modelOptions: { claude: preference.modelOptions } }
  }
  if (provider === "codex") {
    const preference = preferences.codex
    if (!preference?.model) return {}
    return { model: preference.model, modelOptions: { codex: preference.modelOptions } }
  }
  const preference = preferences.openrouter
  if (!preference?.model) return {}
  return { model: preference.model, modelOptions: { openrouter: preference.modelOptions } }
}

export function resolveTurnModelSelection(
  layers: readonly (TurnModelSelection | null | undefined)[],
): TurnModelSelection {
  return {
    model: layers.find((layer) => layer?.model)?.model,
    modelOptions: layers.find((layer) => layer?.modelOptions)?.modelOptions,
  }
}
