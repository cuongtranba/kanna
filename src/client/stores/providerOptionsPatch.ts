
import {
  isAntigravityReasoningEffort,
  isClaudeContextWindow,
  isClaudeReasoningEffort,
  isCodexReasoningEffort,
  type AntigravityModelOptions,
  type ClaudeModelOptions,
  type CodexModelOptions,
} from "../../shared/types"

export interface ProviderModelOptionsPatch {
  reasoningEffort?: string
  contextWindow?: string
  fastMode?: boolean
}

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

export function antigravityOptionsPatch(options: ProviderModelOptionsPatch): Partial<AntigravityModelOptions> {
  const patch: Partial<AntigravityModelOptions> = {}
  const reasoningEffort = options.reasoningEffort
  if (isAntigravityReasoningEffort(reasoningEffort)) patch.reasoningEffort = reasoningEffort
  return patch
}
