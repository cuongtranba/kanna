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

function cap(text: string): string {
  if (text.length <= MAX_LABEL) return text
  return `${text.slice(0, MAX_LABEL - 1).trimEnd()}…`
}

/**
 * Explicit chunk marker at the head of a delegation prompt:
 * `[chunk: Wire session tabs to the store] Do the next chunk in …`.
 *
 * A loop's delegation prompt is server-rendered boilerplate (see
 * `renderLoopPrompt`), joined into ONE line and identical every iteration, so
 * its first line carries no chunk identity — every Progress row read the same.
 * The marker is the channel through which the orchestrator names the chunk it
 * is delegating; it is the only substitution it makes in an otherwise verbatim
 * call. A bracketed form is used rather than prose because the prompt is a
 * single line and any prose prefix would need sentence-splitting to cut.
 *
 * Returns null when absent or when the placeholder came through
 * unsubstituted (`[chunk: <one-line summary …>]`) — template noise must never
 * reach the UI, and the caller then falls back to the plan / first line.
 */
export function parseChunkMarker(prompt: string): string | null {
  const match = /^\s*\[chunk:\s*([^\]]*)\]/i.exec(prompt)
  if (!match) return null
  const body = (match[1] ?? "").trim()
  if (body.length === 0) return null
  if (body.startsWith("<") && body.endsWith(">")) return null
  return cap(body)
}

/**
 * Short human label for a run: the explicit `[chunk: …]` marker when the
 * caller supplied one, else the first non-blank line of the spawn prompt
 * stripped of a single leading markdown marker (heading / list / quote /
 * ordinal). Capped to a chip-friendly length. Deterministic and side-effect
 * free so it can run at delegate time on the server and be asserted in unit
 * tests.
 */
export function deriveChunkLabel(prompt: string): string {
  const marker = parseChunkMarker(prompt)
  if (marker !== null) return marker
  const firstLine =
    prompt
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? ""
  const stripped = firstLine.replace(/^(#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s+)/, "").trim()
  const cleaned = stripped.length > 0 ? stripped : firstLine
  return cap(cleaned)
}

/**
 * Label for the chunk a loop is about to delegate, read from the tracking
 * file's `## Next chunk` section as returned by `StructuredDoc.query` (heading
 * line included). This is the deterministic channel: at delegate time that
 * section IS the chunk being delegated — the worker only rewrites it once it
 * finishes — so the label never depends on the model substituting the marker.
 *
 * Returns "" when the section is empty or already says DONE, so the caller
 * treats it as "no label" rather than surfacing a placeholder.
 */
export function chunkLabelFromSection(sectionSource: string): string {
  const lines = sectionSource.split("\n")
  // Drop only the section's OWN heading — a `###` sub-heading further down is
  // legitimate chunk text, and deriveChunkLabel strips its marker anyway.
  const firstContent = lines.findIndex((line) => line.trim().length > 0)
  const body =
    firstContent >= 0 && /^\s*#{1,6}\s/.test(lines[firstContent] ?? "")
      ? lines.slice(firstContent + 1).join("\n")
      : sectionSource
  const label = deriveChunkLabel(body)
  if (label.toUpperCase() === "DONE") return ""
  return label
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
