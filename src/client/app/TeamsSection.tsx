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

// ── TeamStatusPill ────────────────────────────────────────────────────────────

function TeamStatusPill({ status }: { status: TeamTaskSummary["status"] }) {
  const tone = teamStatusTone(status)
  return (
    <span className="inline-flex items-center gap-1 rounded border border-border bg-card px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide">
      <span
        aria-hidden
        className={cn(
          "inline-block size-1.5 rounded-full",
          workflowStatusDotClass(tone),
          status === "running" && "animate-pulse",
        )}
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
  if (tasks.length === 0) {
    return <TeamsEmptyState driverPreference={driverPreference} />
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Teams</span>
      <ul className="flex flex-col gap-0.5">
        {tasks.map((task) => (
          <TeamTaskRow key={task.taskId} task={task} />
        ))}
      </ul>
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
