import type { ChatProviderPreferences, ClaudeModelOptions, CodexModelOptions } from "../../shared/types"

function claudeModelOptionsEqual(a: ClaudeModelOptions, b: ClaudeModelOptions) {
  return a.reasoningEffort === b.reasoningEffort && a.contextWindow === b.contextWindow
}

function codexModelOptionsEqual(a: CodexModelOptions, b: CodexModelOptions) {
  return a.reasoningEffort === b.reasoningEffort && a.fastMode === b.fastMode
}

export function providerDefaultsEqual(a: ChatProviderPreferences, b: ChatProviderPreferences) {
  return (
    a.claude.model === b.claude.model
    && a.claude.planMode === b.claude.planMode
    && claudeModelOptionsEqual(a.claude.modelOptions, b.claude.modelOptions)
    && a.codex.model === b.codex.model
    && a.codex.planMode === b.codex.planMode
    && codexModelOptionsEqual(a.codex.modelOptions, b.codex.modelOptions)
    && a.openrouter.model === b.openrouter.model
    && a.openrouter.planMode === b.openrouter.planMode
  )
}
