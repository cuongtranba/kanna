import type {
  LoopProgressSnapshot,
  LoopRateLimitInfo,
  LoopRow,
  LoopRowStatus,
  SubagentRunSnapshot,
} from "./types"
import type { ChatTaskRecord } from "./chat-tasks/types"
import { isBlockedByNeeds } from "./chat-tasks/schedule"
import {
  DELEGATE_SUBAGENT_TOOL_NAME,
  STOP_LOOP_TOOL_NAME,
  TASK_CLAIM_TOOL_NAME,
  TASK_CREATE_TOOL_NAME,
  TASK_INTEGRATE_TOOL_NAME,
  TASK_LIST_TOOL_NAME,
  TASK_NOTE_TOOL_NAME,
  TASK_SETTLE_TOOL_NAME,
  TASK_UPDATE_TOOL_NAME,
} from "./tools"

export const LOOP_SECTIONS = {
  nextChunk: "Next chunk",
  progress: "Progress",
  failedApproaches: "Failed approaches",
  taskQueue: "Task queue",
} as const

export const MAX_CONSECUTIVE_LOOP_FAILURES = 3

export function loopFailureBudget(parallelism: number): number {
  return MAX_CONSECUTIVE_LOOP_FAILURES + Math.max(0, parallelism - 1)
}

export type LoopOracleExit = 0 | "nonzero"
export type LoopChunkState = "empty" | "has_work"
export type LoopQueueState = "claimable" | "waiting" | "blocked" | "exhausted"
export type LoopAction =
  | "GOAL_MET"
  | "ORACLE_TOO_WEAK"
  | "DELEGATE"
  | "WRITE_CHUNK"
  | "WAIT"
  | "QUEUE_BLOCKED"

function decideQueueAction(oracleExit: LoopOracleExit, queue: LoopQueueState): LoopAction {
  if (oracleExit === 0) return queue === "exhausted" ? "GOAL_MET" : "ORACLE_TOO_WEAK"
  if (queue === "claimable") return "DELEGATE"
  if (queue === "waiting") return "WAIT"
  return queue === "blocked" ? "QUEUE_BLOCKED" : "WRITE_CHUNK"
}

export function decideLoopAction(
  oracleExit: LoopOracleExit,
  nextChunk: LoopChunkState,
  queue?: LoopQueueState,
): LoopAction {
  if (queue !== undefined) return decideQueueAction(oracleExit, queue)
  if (oracleExit === 0) {
    return nextChunk === "empty" ? "GOAL_MET" : "ORACLE_TOO_WEAK"
  }
  return nextChunk === "has_work" ? "DELEGATE" : "WRITE_CHUNK"
}

export const LOOP_STEP_INVARIANTS: readonly { readonly id: string; readonly requires: readonly string[] }[] = [
  { id: "read-plan", requires: [TASK_LIST_TOOL_NAME] },
  { id: "decide", requires: ["BOTH", "GOAL MET", "ORACLE TOO WEAK", "TERMINAL CHECK", "EVERY task", "with NO status filter", "loop-end summary"] },
  { id: "delegate", requires: [DELEGATE_SUBAGENT_TOOL_NAME, "run_in_background: true", "[chunk:", "END THIS TURN"] },
  { id: "stop", requires: [STOP_LOOP_TOOL_NAME] },
  { id: "worker", requires: [TASK_UPDATE_TOOL_NAME, TASK_NOTE_TOOL_NAME, "Before you mark the last task completed", "git add -A"] },
  { id: "plan", requires: [TASK_CREATE_TOOL_NAME] },
  { id: "hard-rules", requires: ["NEVER edit code yourself", "/clear"] },
  { id: "retry", requires: ["AUTH_REQUIRED", "do NOT call stop_loop", "failed_approach"] },
]

export const LOOP_PARALLEL_STEP_INVARIANTS: readonly {
  readonly id: string
  readonly requires: readonly string[]
}[] = [
  { id: "read-plan", requires: [TASK_LIST_TOOL_NAME] },
  { id: "integrate", requires: [TASK_INTEGRATE_TOOL_NAME, "BEFORE you claim"] },
  { id: "claim", requires: [TASK_CLAIM_TOOL_NAME, "claim_id"] },
  {
    id: "decide",
    requires: [
      "GOAL MET",
      "ORACLE TOO WEAK",
      "TERMINAL CHECK",
      "EVERY task",
      "with NO status filter",
      "loop-end summary",
      "WAIT",
      "QUEUE BLOCKED",
      "do NOT delegate",
    ],
  },
  {
    id: "delegate",
    requires: [DELEGATE_SUBAGENT_TOOL_NAME, "run_in_background: true", "[chunk:", "END THIS TURN"],
  },
  { id: "stop", requires: [STOP_LOOP_TOOL_NAME] },
  {
    id: "worker-settle",
    requires: [TASK_SETTLE_TOOL_NAME, "release", TASK_NOTE_TOOL_NAME],
  },
  { id: "worktree", requires: ["its OWN git worktree", "git -C"] },
  { id: "hard-rules", requires: ["NEVER edit code yourself", "/clear"] },
  { id: "retry", requires: ["AUTH_REQUIRED", "do NOT call stop_loop", "failed_approach"] },
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

export interface BuildLoopProgressInput {
  chatId: string
  armed: boolean
  loopArmedAt: number | null
  runs: readonly SubagentRunSnapshot[]
  rateLimit: LoopRateLimitInfo | null
  tasks: readonly ChatTaskRecord[]
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

function taskStatus(task: ChatTaskRecord, all: readonly ChatTaskRecord[]): LoopRowStatus {
  if (task.status === "completed") return "done"
  if (task.status === "in_progress") return "running"
  return isBlockedByNeeds(task, all) ? "blocked" : "pending"
}

function taskRow(task: ChatTaskRecord, all: readonly ChatTaskRecord[]): LoopRow {
  return {
    runId: `task:${task.id}`,
    label: task.status === "in_progress" && task.activeForm ? task.activeForm : task.subject,
    status: taskStatus(task, all),
    startedAt: task.claimedAt ?? task.createdAt,
    finishedAt: task.completedAt,
  }
}

export function buildLoopProgress(input: BuildLoopProgressInput): LoopProgressSnapshot {
  const runs = input.runs
    .filter((run) => run.depth === 0 && run.startedAt >= (input.loopArmedAt ?? 0))
    .sort((a, b) => a.startedAt - b.startedAt)

  const tasks = input.tasks
  const rows: LoopRow[] = tasks.map((task) => taskRow(task, tasks))

  if (input.armed) {
    const boundRunIds = new Set(
      tasks.map((task) => task.runId).filter((id): id is string => id !== null),
    )
    const errored = runs.filter(
      (run) => run.status !== "running" && run.status !== "completed" && !boundRunIds.has(run.runId),
    )
    rows.push(...errored.map(runRow))
  }

  return {
    chatId: input.chatId,
    armed: input.armed,
    rows,
    rateLimit: input.rateLimit,
    completed: tasks.filter((task) => task.status === "completed").length,
    total: tasks.length,
  }
}
