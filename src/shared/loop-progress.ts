import type {
  LoopProgressSnapshot,
  LoopRateLimitInfo,
  LoopRow,
  LoopRowStatus,
  SubagentRunSnapshot,
} from "./types"
import {
  APPEND_TRACKING_ROW_TOOL_NAME,
  DELEGATE_SUBAGENT_TOOL_NAME,
  QUERY_TRACKING_FILE_TOOL_NAME,
  REPLACE_TRACKING_SECTION_TOOL_NAME,
  STOP_LOOP_TOOL_NAME,
} from "./tools"

export const LOOP_SECTIONS = {
  nextChunk: "Next chunk",
  progress: "Progress",
  failedApproaches: "Failed approaches",
} as const

export type LoopOracleExit = 0 | "nonzero"
export type LoopChunkState = "empty" | "has_work"
export type LoopAction = "GOAL_MET" | "ORACLE_TOO_WEAK" | "DELEGATE" | "WRITE_CHUNK"

export function decideLoopAction(oracleExit: LoopOracleExit, nextChunk: LoopChunkState): LoopAction {
  if (oracleExit === 0) {
    return nextChunk === "empty" ? "GOAL_MET" : "ORACLE_TOO_WEAK"
  }
  return nextChunk === "has_work" ? "DELEGATE" : "WRITE_CHUNK"
}

export const LOOP_STEP_INVARIANTS: readonly { readonly id: string; readonly requires: readonly string[] }[] = [
  { id: "read-plan", requires: [QUERY_TRACKING_FILE_TOOL_NAME] },
  { id: "decide", requires: ["BOTH", "GOAL MET", "ORACLE TOO WEAK", "TERMINAL CHECK", "EVERY section", "with NO sections filter", "loop-end summary"] },
  { id: "delegate", requires: [DELEGATE_SUBAGENT_TOOL_NAME, "run_in_background: true", "[chunk:", "END THIS TURN"] },
  { id: "stop", requires: [STOP_LOOP_TOOL_NAME] },
  { id: "worker", requires: [APPEND_TRACKING_ROW_TOOL_NAME, REPLACE_TRACKING_SECTION_TOOL_NAME, "Before writing DONE", "git add -A"] },
  { id: "hard-rules", requires: ["NEVER edit code yourself", "/clear"] },
  { id: "retry", requires: ["AUTH_REQUIRED", "do NOT call stop_loop", LOOP_SECTIONS.failedApproaches] },
]


const MAX_LABEL = 80

function cap(text: string): string {
  if (text.length <= MAX_LABEL) return text
  return `${text.slice(0, MAX_LABEL - 1).trimEnd()}…`
}

export function parseChunkMarker(prompt: string): string | null {
  const match = /^\s*\[chunk:\s*([^\]]*)\]/i.exec(prompt)
  if (!match) return null
  const body = (match[1] ?? "").trim()
  if (body.length === 0) return null
  if (body.startsWith("<") && body.endsWith(">")) return null
  return cap(body)
}

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

export function chunkLabelFromSection(sectionSource: string): string {
  const lines = sectionSource.split("\n")
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
      return "failed"
  }
}

export interface LoopTrackingSnapshot {
  doneEntries: readonly string[]
  nextChunkSection: string
}

export interface BuildLoopProgressInput {
  chatId: string
  armed: boolean
  loopArmedAt: number | null
  runs: readonly SubagentRunSnapshot[]
  rateLimit: LoopRateLimitInfo | null
  tracking?: LoopTrackingSnapshot | null
}

function runRow(run: SubagentRunSnapshot): LoopRow {
  return {
    runId: run.runId,
    label: run.label ?? run.subagentName,
    status: rowStatusFor(run),
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
  }
}

function trackedRows(
  runs: readonly SubagentRunSnapshot[],
  tracking: LoopTrackingSnapshot,
  armed: boolean,
): LoopRow[] {
  const rows: LoopRow[] = [...tracking.doneEntries].reverse().map((entry, index) => ({
    runId: `progress:${index}`,
    label: deriveChunkLabel(entry),
    status: "done" as const,
    startedAt: 0,
    finishedAt: null,
  }))

  const completed = runs.filter((run) => run.status === "completed")
  const unrecorded = completed.length - tracking.doneEntries.length
  if (unrecorded > 0) rows.push(...completed.slice(-unrecorded).map(runRow))

  rows.push(
    ...runs.filter((run) => run.status !== "completed" && run.status !== "running").map(runRow),
  )

  const live = runs.filter((run) => run.status === "running")
  if (live.length > 0) {
    rows.push(...live.map(runRow))
    return rows
  }

  const nextLabel = armed ? chunkLabelFromSection(tracking.nextChunkSection) : ""
  if (nextLabel.length > 0) {
    rows.push({ runId: "next", label: nextLabel, status: "pending", startedAt: 0, finishedAt: null })
  }
  return rows
}

export function buildLoopProgress(input: BuildLoopProgressInput): LoopProgressSnapshot {
  const runs = input.runs
    .filter((run) => run.depth === 0 && run.startedAt >= (input.loopArmedAt ?? 0))
    .sort((a, b) => a.startedAt - b.startedAt)

  return {
    chatId: input.chatId,
    armed: input.armed,
    rows: input.tracking ? trackedRows(runs, input.tracking, input.armed) : runs.map(runRow),
    rateLimit: input.rateLimit,
  }
}
