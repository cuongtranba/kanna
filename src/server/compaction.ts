import type { Attributes } from "@opentelemetry/api"
import type { AgentProvider } from "../shared/types"
import type {
  CompactBoundaryMetadata,
  CompactionTrigger,
  CompactSummaryEntry,
} from "../shared/transcript-types"
import { timestamped } from "./claude-message-normalizer"
import {
  addCounter,
  recordHistogram,
  COMPACTION_FINISHED,
  COMPACTION_POST_TOKENS,
  COMPACTION_PRE_TOKENS,
  COMPACTION_STARTED,
} from "./observability"

const UNKNOWN = "unknown"

function compactionAttributes(
  provider: AgentProvider | null | undefined,
  trigger: CompactionTrigger | undefined,
): Attributes {
  return { provider: provider ?? UNKNOWN, trigger: trigger ?? UNKNOWN }
}

export function recordCompactionStarted(
  provider: AgentProvider | null | undefined,
  trigger: CompactionTrigger | undefined,
): void {
  addCounter(COMPACTION_STARTED, 1, compactionAttributes(provider, trigger))
}

export function recordCompactionFinished(
  provider: AgentProvider | null | undefined,
  metadata: CompactBoundaryMetadata | undefined,
): void {
  const attributes = compactionAttributes(provider, metadata?.trigger)
  addCounter(COMPACTION_FINISHED, 1, attributes)
  if (metadata?.preTokens !== undefined) {
    recordHistogram(COMPACTION_PRE_TOKENS, metadata.preTokens, attributes)
  }
  if (metadata?.postTokens !== undefined) {
    recordHistogram(COMPACTION_POST_TOKENS, metadata.postTokens, attributes)
  }
}

function fnv1aHex(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, "0")
}

export function compactSummaryMessageId(sessionId: string, summary: string): string {
  return `compact-${sessionId}-${fnv1aHex(summary)}`
}

export function buildCompactSummaryEntry(
  args: { sessionId: string; summary: string },
): CompactSummaryEntry | null {
  const summary = args.summary.trim()
  if (summary.length === 0) return null
  return timestamped({
    kind: "compact_summary",
    summary,
    messageId: compactSummaryMessageId(args.sessionId, summary),
  })
}
