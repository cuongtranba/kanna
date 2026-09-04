/**
 * providerOptionsPatch — narrow a loosely-typed model-options patch, or a
 * persisted provider string, to the provider contract being written.
 *
 * Extracted from chatPreferencesStore so these pure per-provider decoders do
 * not count against that module's architecture-budget ceiling.
 */

import {
  isClaudeContextWindow,
  isClaudeReasoningEffort,
  isCodexReasoningEffort,
  type ClaudeModelOptions,
  type CodexModelOptions,
  type DefaultProviderPreference,
} from "../../shared/types"

export function normalizeDefaultProvider(value?: string): DefaultProviderPreference {
  if (value === "claude" || value === "codex" || value === "openrouter") return value
  return "last_used"
}

/**
 * The readable shape of any model-options patch a caller may hand either
 * setter. Spelled structurally rather than as
 * `Partial<ClaudeModelOptions | CodexModelOptions | OpenRouterModelOptions>`
 * because `setProviderDefaultModelOptions` is generic in its provider: inside
 * that body the argument's type stays deferred, and only a structural target
 * is reachable through its constraint.
 */
export interface ProviderModelOptionsPatch {
  reasoningEffort?: string
  contextWindow?: string
  fastMode?: boolean
}

/**
 * Narrow a caller's patch to the provider being written. The setters take a
 * patch whose provider the compiler cannot correlate with the `provider`
 * argument, so each field is re-checked here against the enum that actually
 * governs it; a value the provider does not accept is dropped rather than
 * written through.
 */
export function claudeOptionsPatch(options: ProviderModelOptionsPatch): Partial<ClaudeModelOptions> {
  const patch: Partial<ClaudeModelOptions> = {}
  const reasoningEffort = options.reasoningEffort
  if (isClaudeReasoningEffort(reasoningEffort)) patch.reasoningEffort = reasoningEffort
  const contextWindow = options.contextWindow
  if (isClaudeContextWindow(contextWindow)) patch.contextWindow = contextWindow
  return patch
}

export function codexOptionsPatch(options: ProviderModelOptionsPatch): Partial<CodexModelOptions> {
  const patch: Partial<CodexModelOptions> = {}
  const reasoningEffort = options.reasoningEffort
  if (isCodexReasoningEffort(reasoningEffort)) patch.reasoningEffort = reasoningEffort
  const fastMode = options.fastMode
  if (typeof fastMode === "boolean") patch.fastMode = fastMode
  return patch
}
