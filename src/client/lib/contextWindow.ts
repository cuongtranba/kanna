import type { ContextWindowUsageSnapshot, ProviderUsage, TranscriptEntry } from "../../shared/types"

export interface ContextWindowSnapshot extends ContextWindowUsageSnapshot {
  remainingTokens: number | null
  usedPercentage: number | null
  remainingPercentage: number | null
  updatedAt: string
}

function withDerivedMetrics(
  usage: ContextWindowUsageSnapshot,
  updatedAt: string,
  compactsAutomatically: boolean,
): ContextWindowSnapshot {
  const maxTokens = typeof usage.maxTokens === "number" && Number.isFinite(usage.maxTokens)
    ? usage.maxTokens
    : null
  const usedPercentage = maxTokens && maxTokens > 0
    ? Math.min(100, (usage.usedTokens / maxTokens) * 100)
    : null
  const remainingTokens = maxTokens !== null
    ? Math.max(0, Math.round(maxTokens - usage.usedTokens))
    : null
  const remainingPercentage = usedPercentage !== null
    ? Math.max(0, 100 - usedPercentage)
    : null

  return {
    ...usage,
    compactsAutomatically: usage.compactsAutomatically || compactsAutomatically,
    maxTokens: maxTokens ?? undefined,
    remainingTokens,
    usedPercentage,
    remainingPercentage,
    updatedAt,
  }
}

export function deriveLatestContextWindowSnapshot(
  entries: ReadonlyArray<TranscriptEntry>,
): ContextWindowSnapshot | null {
  const compactsAutomatically = entries.some((entry) =>
    entry.kind === "compact_boundary"
    || entry.kind === "compact_summary"
    || entry.kind === "context_cleared"
  )

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    if (!entry) continue

    if (entry.kind !== "context_window_updated" || entry.usage.usedTokens <= 0) {
      continue
    }

    return withDerivedMetrics(entry.usage, new Date(entry.createdAt).toISOString(), compactsAutomatically)
  }

  return null
}

export function overrideContextWindowMaxTokens(
  snapshot: ContextWindowSnapshot | null,
  maxTokens: number | null,
): ContextWindowSnapshot | null {
  if (!snapshot || maxTokens === null || !Number.isFinite(maxTokens) || maxTokens <= 0) {
    return snapshot
  }

  return withDerivedMetrics(
    {
      ...snapshot,
      maxTokens,
    },
    snapshot.updatedAt,
    snapshot.compactsAutomatically,
  )
}

export interface SessionTokenSummary {
  input: number
  output: number
  cached: number
  cacheHitPercentage: number | null
}

export function computeSessionTokenSummary(
  snapshot: ContextWindowSnapshot | null,
): SessionTokenSummary | null {
  if (!snapshot) return null

  const input = toNonNegative(snapshot.inputTokens)
  const output = toNonNegative(snapshot.outputTokens)
  const cached = toNonNegative(snapshot.cachedInputTokens)

  if (input === 0 && output === 0 && cached === 0) {
    return null
  }

  const billedAndCached = input + cached
  const cacheHitPercentage = billedAndCached > 0
    ? (cached / billedAndCached) * 100
    : null

  return { input, output, cached, cacheHitPercentage }
}

function toNonNegative(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value < 0) return 0
  return value
}

export interface SessionTotals {
  inputTokens: number
  outputTokens: number
  cachedTokens: number
  costUsd: number
  cacheHitPercentage: number | null
}

export function computeSessionTotals(
  entries: ReadonlyArray<TranscriptEntry>,
  subagentRuns: ReadonlyArray<{ usage: ProviderUsage | null }>,
): SessionTotals | null {
  let input = 0
  let output = 0
  let cached = 0
  let cost = 0

  for (const entry of entries) {
    if (entry.kind !== "result") continue
    const u = entry.usage
    if (u) {
      input += toNonNegative(u.inputTokens)
      output += toNonNegative(u.outputTokens)
      cached += toNonNegative(u.cachedInputTokens)
    }
    cost += toNonNegative(entry.costUsd ?? u?.costUsd)
  }
  for (const run of subagentRuns) {
    const u = run.usage
    if (!u) continue
    input += toNonNegative(u.inputTokens)
    output += toNonNegative(u.outputTokens)
    cached += toNonNegative(u.cachedInputTokens)
    cost += toNonNegative(u.costUsd)
  }

  if (input === 0 && output === 0 && cached === 0 && cost === 0) return null

  const billedAndCached = input + cached
  const cacheHitPercentage = billedAndCached > 0 ? (cached / billedAndCached) * 100 : null
  return { inputTokens: input, outputTokens: output, cachedTokens: cached, costUsd: cost, cacheHitPercentage }
}

export function formatCostUsd(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "$0.00"
  if (value < 0.01) return "<$0.01"
  return `$${value.toFixed(2)}`
}

export function formatContextWindowTokens(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "0"
  }
  if (value < 1_000) {
    return `${Math.round(value)}`
  }
  if (value < 10_000) {
    return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}k`
  }
  if (value < 1_000_000) {
    return `${Math.round(value / 1_000)}k`
  }
  return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`
}
