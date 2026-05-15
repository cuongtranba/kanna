import type { ContextWindowUsageSnapshot, TranscriptEntry } from "../shared/types"

// Mirrors anthropics/claude-code's `src/services/compact/autoCompact.ts`
// constants so Kanna's proactive compact trigger matches the CLI's built-in
// auto-compact strategy. The CLI runs auto-compact inside its REPL main loop,
// but the SDK `query()` driver Kanna uses spawns a fresh subprocess per turn
// and never enters that loop — so the CLI's compact never fires by itself.
// Kanna therefore reads the latest `context_window_updated` usage snapshot
// and injects a synthetic `/compact` prompt before the user's real turn
// when usage crosses the same threshold the CLI would have tripped.
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

// Mirrors upstream claude-code's CLAUDE_AUTOCOMPACT_PCT_OVERRIDE env knob.
// Returns a percentage in (0, 100], or undefined when unset/invalid. The
// override can only LOWER the trigger (fire earlier); upstream caps it at the
// default threshold via Math.min in kP_().
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

export function getLatestContextWindowUsage(
  messages: readonly TranscriptEntry[],
): ContextWindowUsageSnapshot | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const entry = messages[i]
    if (entry.kind === "context_window_updated") return entry.usage
    // Treat a recent compact_boundary as "context already compacted" — its
    // own usage snapshot will follow on the next turn's result. Stopping
    // here keeps us from triggering another compact off the pre-compaction
    // usage entries that linger before the boundary.
    if (entry.kind === "compact_boundary") return null
  }
  return null
}
