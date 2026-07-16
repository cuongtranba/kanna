import type {
  LoopProgressSnapshot,
  LoopRateLimitInfo,
  LoopRow,
  LoopRowStatus,
  SubagentRunSnapshot,
} from "./types"

/**
 * Loop Progress — a per-chat, read-only view of an armed autonomous loop's
 * work, surfaced as a checklist panel (mockup: a "Progress" card with one row
 * per chunk). Event-sourced per round: each background subagent delegation the
 * loop fires becomes one row, its status driven by the existing subagent-run
 * lifecycle events. A rate-limited loop (see the rate-limit-resilience fix)
 * surfaces a distinct "resume" affordance instead of looking silently stuck.
 *
 * These helpers are pure so the server read-model and the client share one
 * shape; the DTO types live in ./types to avoid a runtime import cycle.
 */

const MAX_LABEL = 80

/**
 * First non-blank line of a spawn prompt, stripped of a single leading markdown
 * marker (heading / list / quote / ordinal) and capped to a chip-friendly
 * length. Deterministic and side-effect free so it can run at delegate time on
 * the server and be asserted in unit tests.
 */
export function deriveChunkLabel(prompt: string): string {
  const firstLine =
    prompt
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? ""
  const stripped = firstLine.replace(/^(#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s+)/, "").trim()
  const cleaned = stripped.length > 0 ? stripped : firstLine
  if (cleaned.length <= MAX_LABEL) return cleaned
  return `${cleaned.slice(0, MAX_LABEL - 1).trimEnd()}…`
}

function rowStatusFor(run: SubagentRunSnapshot): LoopRowStatus {
  switch (run.status) {
    case "running":
      return "running"
    case "completed":
      return "done"
    default:
      // failed | cancelled | any future terminal-failure state
      return "failed"
  }
}

export interface BuildLoopProgressInput {
  chatId: string
  armed: boolean
  /** Timestamp of the current `loop_armed` event; rows before it are excluded. */
  loopArmedAt: number | null
  /** All subagent runs for the chat (any order). */
  runs: readonly SubagentRunSnapshot[]
  rateLimit: LoopRateLimitInfo | null
}

/**
 * Fold the chat's subagent runs + loop/rate-limit state into the panel DTO.
 * Only top-level (depth 0) runs started since the loop was armed count as loop
 * rows — nested sub-spawns and pre-loop delegations are excluded. Rows are
 * sorted newest-first.
 */
export function buildLoopProgress(input: BuildLoopProgressInput): LoopProgressSnapshot {
  const since = input.loopArmedAt ?? 0
  const rows: LoopRow[] = input.runs
    .filter((run) => run.depth === 0 && run.startedAt >= since)
    .map((run) => ({
      runId: run.runId,
      label: run.label ?? run.subagentName,
      status: rowStatusFor(run),
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
    }))
    .sort((a, b) => b.startedAt - a.startedAt)

  return {
    chatId: input.chatId,
    armed: input.armed,
    rows,
    rateLimit: input.rateLimit,
  }
}
