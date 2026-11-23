import {
  ANTIGRAVITY_REASONING_OPTIONS,
  CODEX_REASONING_OPTIONS,
  DEFAULT_ANTIGRAVITY_MODEL_OPTIONS,
  DEFAULT_CODEX_MODEL_OPTIONS,
  isAntigravityReasoningEffort,
  isCodexReasoningEffort,
  type SubagentInput,
} from "../../shared/types"

export interface SubagentEffortControl {
  value: string
  options: { value: string; label: string }[]
  apply: (effort: string) => SubagentInput["modelOptions"] | null
}

export function subagentEffortControl(
  draft: Pick<SubagentInput, "provider" | "modelOptions">,
): SubagentEffortControl | null {
  if (draft.provider === "codex") {
    const current = { ...DEFAULT_CODEX_MODEL_OPTIONS, ...("fastMode" in draft.modelOptions ? draft.modelOptions : {}) }
    return {
      value: current.reasoningEffort,
      options: CODEX_REASONING_OPTIONS.map((option) => ({ value: option.id, label: option.label })),
      apply: (effort) => isCodexReasoningEffort(effort) ? { ...current, reasoningEffort: effort } : null,
    }
  }
  if (draft.provider === "antigravity") {
    const stored = "reasoningEffort" in draft.modelOptions ? draft.modelOptions.reasoningEffort : undefined
    const value = isAntigravityReasoningEffort(stored) ? stored : DEFAULT_ANTIGRAVITY_MODEL_OPTIONS.reasoningEffort
    return {
      value,
      options: ANTIGRAVITY_REASONING_OPTIONS.map((option) => ({ value: option.id, label: option.label })),
      apply: (effort) => isAntigravityReasoningEffort(effort) ? { reasoningEffort: effort } : null,
    }
  }
  return null
}
