import type { ContextWindowUsageSnapshot, TranscriptEntry } from "../shared/types"

export const MAX_OUTPUT_TOKENS_FOR_SUMMARY = 20_000
export const AUTOCOMPACT_BUFFER_TOKENS = 13_000
export const MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3

export function getEffectiveContextWindow(
  maxContextWindow: number,
  maxOutputTokens: number = MAX_OUTPUT_TOKENS_FOR_SUMMARY,
): number {
  const reserved = Math.min(maxOutputTokens, MAX_OUTPUT_TOKENS_FOR_SUMMARY)
  return Math.max(0, maxContextWindow - reserved)
}

export function getAutoCompactPctOverride(env: NodeJS.ProcessEnv = process.env): number | undefined {
  const raw = env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE
  if (!raw) return undefined
  const pct = Number.parseFloat(raw)
  if (!Number.isFinite(pct) || pct <= 0 || pct > 100) return undefined
  return pct
}

export function getAutoCompactThreshold(
  maxContextWindow: number,
  maxOutputTokens: number = MAX_OUTPUT_TOKENS_FOR_SUMMARY,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const effective = getEffectiveContextWindow(maxContextWindow, maxOutputTokens)
  const defaultThreshold = Math.max(0, effective - AUTOCOMPACT_BUFFER_TOKENS)
  const pct = getAutoCompactPctOverride(env)
  if (pct === undefined) return defaultThreshold
  return Math.min(Math.floor(effective * (pct / 100)), defaultThreshold)
}

export function shouldProactivelyCompact(
  usage: Pick<ContextWindowUsageSnapshot, "usedTokens" | "maxTokens"> | null,
  maxOutputTokens: number = MAX_OUTPUT_TOKENS_FOR_SUMMARY,
): boolean {
  if (!usage) return false
  const max = usage.maxTokens
  const used = usage.usedTokens
  if (typeof max !== "number" || max <= 0) return false
  if (typeof used !== "number" || used <= 0) return false
  return used >= getAutoCompactThreshold(max, maxOutputTokens)
}

export type LatestContextWindowUsageScan =
  | { found: true; usage: ContextWindowUsageSnapshot | null }
  | { found: false }

export function scanLatestContextWindowUsage(
  messages: readonly TranscriptEntry[],
): LatestContextWindowUsageScan {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const entry = messages[i]
    if (entry.kind === "context_window_updated") return { found: true, usage: entry.usage }
    if (entry.kind === "compact_boundary") return { found: true, usage: null }
  }
  return { found: false }
}

export function getLatestContextWindowUsage(
  messages: readonly TranscriptEntry[],
): ContextWindowUsageSnapshot | null {
  const scan = scanLatestContextWindowUsage(messages)
  return scan.found ? scan.usage : null
}
