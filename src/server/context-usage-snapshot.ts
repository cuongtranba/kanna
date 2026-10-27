import type { ContextWindowUsageSnapshot } from "../shared/types"

export interface MirroredUsage {
  usedTokens: number
  inputTokens?: number
  cachedInputTokens?: number
  outputTokens?: number
  reasoningOutputTokens?: number
  compactsAutomatically: boolean
}

export function mirroredUsageSnapshot(usage: MirroredUsage): ContextWindowUsageSnapshot {
  const { usedTokens, inputTokens, cachedInputTokens, outputTokens, reasoningOutputTokens } = usage
  return {
    usedTokens,
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(cachedInputTokens !== undefined ? { cachedInputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(reasoningOutputTokens !== undefined ? { reasoningOutputTokens } : {}),
    lastUsedTokens: usedTokens,
    ...(inputTokens !== undefined ? { lastInputTokens: inputTokens } : {}),
    ...(cachedInputTokens !== undefined ? { lastCachedInputTokens: cachedInputTokens } : {}),
    ...(outputTokens !== undefined ? { lastOutputTokens: outputTokens } : {}),
    ...(reasoningOutputTokens !== undefined ? { lastReasoningOutputTokens: reasoningOutputTokens } : {}),
    compactsAutomatically: usage.compactsAutomatically,
  }
}
