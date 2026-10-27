import type { ContextWindowUsageSnapshot } from "../shared/types"
import { asRecord } from "../shared/errors"
import { asFiniteNumber } from "../shared/numeric"
import { mirroredUsageSnapshot } from "./context-usage-snapshot"

export function normalizeClaudeUsageSnapshot<T>(
  value: T,
  maxTokens?: number,
): ContextWindowUsageSnapshot | null {
  const usage = asRecord(value)
  if (!usage) return null

  const directInputTokens = asFiniteNumber(usage.input_tokens) ?? asFiniteNumber(usage.inputTokens) ?? 0
  const cacheCreationInputTokens =
    asFiniteNumber(usage.cache_creation_input_tokens) ?? asFiniteNumber(usage.cacheCreationInputTokens) ?? 0
  const cacheReadInputTokens =
    asFiniteNumber(usage.cache_read_input_tokens) ?? asFiniteNumber(usage.cacheReadInputTokens) ?? 0
  const outputTokens = asFiniteNumber(usage.output_tokens) ?? asFiniteNumber(usage.outputTokens) ?? 0
  const reasoningOutputTokens =
    asFiniteNumber(usage.reasoning_output_tokens) ?? asFiniteNumber(usage.reasoningOutputTokens)
  const toolUses = asFiniteNumber(usage.tool_uses) ?? asFiniteNumber(usage.toolUses)
  const durationMs = asFiniteNumber(usage.duration_ms) ?? asFiniteNumber(usage.durationMs)

  const inputTokens = directInputTokens + cacheCreationInputTokens + cacheReadInputTokens
  const usedTokens = inputTokens + outputTokens
  if (usedTokens <= 0) {
    return null
  }

  return {
    ...mirroredUsageSnapshot({
      usedTokens,
      inputTokens,
      cachedInputTokens: cacheReadInputTokens > 0 ? cacheReadInputTokens : undefined,
      outputTokens: outputTokens > 0 ? outputTokens : undefined,
      reasoningOutputTokens,
      compactsAutomatically: false,
    }),
    ...(toolUses !== undefined ? { toolUses } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(typeof maxTokens === "number" && maxTokens > 0 ? { maxTokens } : {}),
  }
}

export function resolveFinalTurnUsage(
  latestUsageSnapshot: ContextWindowUsageSnapshot | null,
  accumulatedUsage: ContextWindowUsageSnapshot | null,
  lastKnownContextWindow: number | undefined,
): ContextWindowUsageSnapshot | null {
  if (!latestUsageSnapshot) return null
  return {
    ...latestUsageSnapshot,
    ...(typeof lastKnownContextWindow === "number" ? { maxTokens: lastKnownContextWindow } : {}),
    ...(accumulatedUsage && accumulatedUsage.usedTokens > latestUsageSnapshot.usedTokens
      ? { totalProcessedTokens: accumulatedUsage.usedTokens }
      : {}),
  }
}

export function maxClaudeContextWindowFromModelUsage<T>(modelUsage: T): number | undefined {
  const record = asRecord(modelUsage)
  if (!record) return undefined

  let maxContextWindow: number | undefined
  for (const value of Object.values(record)) {
    const usage = asRecord(value)
    const contextWindow = asFiniteNumber(usage?.contextWindow) ?? asFiniteNumber(usage?.context_window)
    if (contextWindow === undefined) continue
    maxContextWindow = Math.max(maxContextWindow ?? 0, contextWindow)
  }
  return maxContextWindow
}

export function modelUsageHasUnpricedModel<T>(modelUsage: T): boolean {
  const record = asRecord(modelUsage)
  if (!record) return false
  return Object.values(record).some((value) => asRecord(value)?.costBasis === "unknown")
}

export function parseConfiguredContextWindowFromModelId(modelId: string): number | undefined {
  return modelId.endsWith("[1m]") ? 1_000_000 : undefined
}
