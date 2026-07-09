import { useId, useState } from "react"
import { ChevronRight } from "lucide-react"
import { cn } from "../lib/utils"
import { formatCompactDuration } from "../lib/formatDuration"
import type { TeamTaskSummary } from "../../shared/types"
import {
  workflowStatusDotClass,
  workflowStatusTextClass,
  type WorkflowStatusTone,
} from "./WorkflowsSection"

// ── Status helpers ────────────────────────────────────────────────────────────

function teamStatusTone(status: TeamTaskSummary["status"]): WorkflowStatusTone {
  switch (status) {
    case "running": return "active"
    case "completed": return "muted"
    case "failed": return "destructive"
  }
}

function teamStatusLabel(status: TeamTaskSummary["status"]): string {
  switch (status) {
    case "running": return "Running"
    case "completed": return "Completed"
    case "failed": return "Failed"
  }
}

// ── Summary ───────────────────────────────────────────────────────────────────

interface TeamsSummary {
  running: number
  done: number
  failed: number
  /** Header dot tone: running wins, then failures, else muted. */
  tone: WorkflowStatusTone
  /** Sentence-case "1 running · 17 done · 2 failed" (non-zero parts only). */
  text: string
}

function summarizeTeamTasks(tasks: TeamTaskSummary[]): TeamsSummary {
  let running = 0
  let done = 0
  let failed = 0
  for (const task of tasks) {
    if (task.status === "running") running += 1
    else if (task.status === "completed") done += 1
    else if (task.status === "failed") failed += 1
  }
  const parts: string[] = []
  if (running > 0) parts.push(`${running} running`)
  if (done > 0) parts.push(`${done} done`)
  if (failed > 0) parts.push(`${failed} failed`)
  const tone: WorkflowStatusTone =
    running > 0 ? "active" : failed > 0 ? "destructive" : "muted"
  return { running, done, failed, tone, text: parts.join(" · ") }
}

// ── TeamStatusPill ────────────────────────────────────────────────────────────

function TeamStatusPill({ status }: { status: TeamTaskSummary["status"] }) {
  const tone = teamStatusTone(status)
  return (
    <span className="inline-flex items-center gap-1 rounded border border-border bg-card px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide">
      <span
        aria-hidden
        className={cn("inline-block size-1.5 rounded-full", workflowStatusDotClass(tone))}
      />
      <span className={workflowStatusTextClass(tone)}>{teamStatusLabel(status)}</span>
    </span>
  )
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface TeamsSectionProps {
  tasks: TeamTaskSummary[]
  driverPreference: "sdk" | "pty"
}

// ── TeamsSection ──────────────────────────────────────────────────────────────

export function TeamsSection({ tasks, driverPreference }: TeamsSectionProps) {
  const listId = useId()
  const running = tasks.some((task) => task.status === "running")

  // Collapse policy: auto-expand while a task runs, collapse when idle. A user
  // click overrides the auto state until `running` next transitions, at which
  // point auto takes over again (a freshly-started team re-surfaces even after
  // a manual collapse). The override reset uses React's documented "adjust
  // state during render on prop change" pattern (store-previous-value in state,
  // reset synchronously), never an effect, so no render loop (React #185) arises.
  const [override, setOverride] = useState<boolean | null>(null)
  const [prevRunning, setPrevRunning] = useState(running)
  if (prevRunning !== running) {
    setPrevRunning(running)
    if (override !== null) setOverride(null)
  }
  const open = override ?? running

  if (tasks.length === 0) {
    return <TeamsEmptyState driverPreference={driverPreference} />
  }

  const summary = summarizeTeamTasks(tasks)

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        data-testid="teams-toggle"
        onClick={() => setOverride(!open)}
        aria-expanded={open}
        aria-controls={listId}
        className="flex w-full items-center justify-between gap-2 rounded-md px-1 py-1 text-left transition-colors hover:bg-muted"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Teams
          </span>
          <span
            aria-hidden
            className={cn(
              "inline-block size-1.5 shrink-0 rounded-full",
              workflowStatusDotClass(summary.tone),
            )}
          />
          <span
            className={cn("truncate text-xs tabular-nums", workflowStatusTextClass(summary.tone))}
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            {summary.text}
          </span>
        </span>
        <ChevronRight
          aria-hidden
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-90",
          )}
        />
      </button>
      {open ? (
        <ul id={listId} className="flex flex-col gap-0.5">
          {tasks.map((task) => (
            <TeamTaskRow key={task.taskId} task={task} />
          ))}
        </ul>
      ) : null}
    </div>
  )
}

// ── Empty state ───────────────────────────────────────────────────────────────

function TeamsEmptyState({ driverPreference }: { driverPreference: "sdk" | "pty" }) {
  if (driverPreference === "pty") {
    return (
      <p
        className="text-xs text-muted-foreground"
        data-testid="teams-empty-pty"
      >
        Switch to the SDK driver (Settings → Claude driver) to see team tasks live.
      </p>
    )
  }

  return (
    <p
      className="text-xs text-muted-foreground"
      data-testid="teams-empty-sdk"
    >
      Ask Claude to &ldquo;use parallel agents&rdquo; to fan work out.
    </p>
  )
}

// ── TeamTaskRow ───────────────────────────────────────────────────────────────

function TeamTaskRow({ task }: { task: TeamTaskSummary }) {
  const label = task.name ?? task.description
  const secondary = task.name != null ? task.description : undefined
  const live = task.status === "running"
  // For running tasks use lastActivityAt as a static elapsed bound (no ticking timer, v1).
  const durationMs = (task.endedAt ?? task.lastActivityAt) - task.startedAt

  return (
    <li
      data-testid={`team-task-row:${task.taskId}`}
      className="flex flex-col gap-0.5 rounded-md px-2 py-1.5"
    >
      <span className="flex w-full items-center justify-between gap-2">
        <span className={cn("truncate text-sm text-foreground", live && "font-medium")}>
          {label}
        </span>
        <TeamStatusPill status={task.status} />
      </span>
      {secondary ? (
        <span className="truncate text-xs text-muted-foreground">{secondary}</span>
      ) : null}
      <span className="flex w-full items-center gap-3 text-xs text-muted-foreground">
        {task.model ? (
          <span className="shrink-0 rounded border border-border bg-card px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            {task.model}
          </span>
        ) : null}
        <span className="tabular-nums">
          {formatCompactDuration(durationMs)}
        </span>
      </span>
    </li>
  )
}
