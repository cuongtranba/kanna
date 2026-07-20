/**
 * claude-usage-math.ts
 *
 * Pure context-window usage math: normalises raw SDK token-count shapes into
 * typed ContextWindowUsageSnapshot values. No IO, no side effects.
 *
 * Extracted from agent.ts — see decompose-large-files loop.
 */
import type { ContextWindowUsageSnapshot } from "../shared/types"
import { isRecord } from "../shared/errors"

// ---------------------------------------------------------------------------
// Private narrowing helpers
// ---------------------------------------------------------------------------

function asRecord<T>(value: T): Record<string, unknown> | null {
  return isRecord(value) ? value : null
}

function asNumber<T>(value: T): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

// ---------------------------------------------------------------------------
// Public exports
// ---------------------------------------------------------------------------

/**
 * Normalise the raw `usage` object from a Claude SDK assistant/result message
 * into a typed ContextWindowUsageSnapshot, returning null when the value is
 * empty or contains no positive token counts.
 *
 * Accepts both camelCase (SDK internal) and snake_case (JSON-wire) field names.
 */
export function normalizeClaudeUsageSnapshot<T>(
  value: T,
  maxTokens?: number,
): ContextWindowUsageSnapshot | null {
  const usage = asRecord(value)
  if (!usage) return null

  const directInputTokens = asNumber(usage.input_tokens) ?? asNumber(usage.inputTokens) ?? 0
  const cacheCreationInputTokens =
    asNumber(usage.cache_creation_input_tokens) ?? asNumber(usage.cacheCreationInputTokens) ?? 0
  const cacheReadInputTokens =
    asNumber(usage.cache_read_input_tokens) ?? asNumber(usage.cacheReadInputTokens) ?? 0
  const outputTokens = asNumber(usage.output_tokens) ?? asNumber(usage.outputTokens) ?? 0
  const reasoningOutputTokens =
    asNumber(usage.reasoning_output_tokens) ?? asNumber(usage.reasoningOutputTokens)
  const toolUses = asNumber(usage.tool_uses) ?? asNumber(usage.toolUses)
  const durationMs = asNumber(usage.duration_ms) ?? asNumber(usage.durationMs)

  const inputTokens = directInputTokens + cacheCreationInputTokens + cacheReadInputTokens
  const usedTokens = inputTokens + outputTokens
  if (usedTokens <= 0) {
    return null
  }

  return {
    usedTokens,
    inputTokens,
    ...(cacheReadInputTokens > 0 ? { cachedInputTokens: cacheReadInputTokens } : {}),
    ...(outputTokens > 0 ? { outputTokens } : {}),
    ...(reasoningOutputTokens !== undefined ? { reasoningOutputTokens } : {}),
    lastUsedTokens: usedTokens,
    lastInputTokens: inputTokens,
    ...(cacheReadInputTokens > 0 ? { lastCachedInputTokens: cacheReadInputTokens } : {}),
    ...(outputTokens > 0 ? { lastOutputTokens: outputTokens } : {}),
    ...(reasoningOutputTokens !== undefined ? { lastReasoningOutputTokens: reasoningOutputTokens } : {}),
    ...(toolUses !== undefined ? { toolUses } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(typeof maxTokens === "number" && maxTokens > 0 ? { maxTokens } : {}),
    compactsAutomatically: false,
  }
}

// Resolve the single `context_window_updated` snapshot emitted at end of a
// turn. `latestUsageSnapshot` is the last per-`assistant`-message usage — a
// single-request view, the real live context size. `accumulatedUsage` is
// derived from SDK `result.usage`, which is CUMULATIVE: it re-counts
// `cache_read_input_tokens` on every tool round-trip, so its `usedTokens`
// balloons to millions on long turns.
//
// The cumulative figure must never become `usedTokens` — proactive-compact
// reads `usedTokens` and would trip far below the real threshold, then the
// no-assistant-usage compact turn would re-inflate and force a second
// compact (the double-compact bug). So cumulative only ever enriches
// `totalProcessedTokens`. When no per-assistant snapshot exists (compact /
// system turns), return null: the caller skips emission and proactive-compact
// falls back to the prior live snapshot (or a compact_boundary → no compact).
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

/**
 * Extracts the maximum context window reported across all models in the SDK's
 * `result.modelUsage` map. Returns undefined when the value is not a
 * record or contains no numeric contextWindow fields.
 */
export function maxClaudeContextWindowFromModelUsage<T>(modelUsage: T): number | undefined {
  const record = asRecord(modelUsage)
  if (!record) return undefined

  let maxContextWindow: number | undefined
  for (const value of Object.values(record)) {
    const usage = asRecord(value)
    const contextWindow = asNumber(usage?.contextWindow) ?? asNumber(usage?.context_window)
    if (contextWindow === undefined) continue
    maxContextWindow = Math.max(maxContextWindow ?? 0, contextWindow)
  }
  return maxContextWindow
}

// The SDK's `result.modelUsage[*].contextWindow` can lie: it reports 200_000 even
// when the user opted into the 1M beta via the `[1m]` model id suffix
// (claude-agent-sdk-typescript#238). Without this hint, proactive-compact would
// trip at 167k tokens — ~17% of the real 1M window — and compact far too often.
// We derive the configured window from the SDK model id and use it as a floor.
export function parseConfiguredContextWindowFromModelId(modelId: string): number | undefined {
  return modelId.endsWith("[1m]") ? 1_000_000 : undefined
}
