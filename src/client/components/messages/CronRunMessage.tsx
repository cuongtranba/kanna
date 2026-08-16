import { CalendarClock, ExternalLink } from "lucide-react"
import { Link } from "react-router-dom"
import type { CronJobSnapshot, CronRunStatus } from "../../../shared/cron/types"
import { formatStartedClock } from "../../lib/formatters"
import { cn } from "../../lib/utils"
import type { ProcessedCronRunMessage } from "./types"

interface Props {
  message: ProcessedCronRunMessage
  /** Live jobs from ChatSnapshot — the run's status is joined by runId. */
  cronJobs?: readonly CronJobSnapshot[]
}

/**
 * Spawn-mode run card in the arming (monitoring) chat: when the run fired,
 * what it does, a link to the spawned chat, and a LIVE status pill joined
 * from the snapshot by runId — the entry itself is immutable (the
 * WorkflowMessage pattern).
 */
export function CronRunMessage({ message, cronJobs }: Props) {
  const job = cronJobs?.find((candidate) => candidate.jobId === message.jobId)
  const run = job?.recentRuns.find((candidate) => candidate.runId === message.runId)
  const status: CronRunStatus = run?.status ?? "running"

  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <div className="flex items-center gap-2">
        <CalendarClock className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="text-sm font-medium text-foreground">Cron run</span>
        <span className="font-mono text-xs text-muted-foreground">{message.jobId}</span>
        <span className="ml-auto flex items-center gap-3">
          <span className="text-xs text-muted-foreground tabular-nums">
            {formatStartedClock(message.firedAt)}
          </span>
          <CronRunStatusPill status={status} />
        </span>
      </div>
      <p className="mt-1.5 text-sm text-foreground/90">{message.instruction}</p>
      {message.spawnedChatId ? (
        <Link
          to={`/chat/${message.spawnedChatId}`}
          className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
        >
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          Open run chat
        </Link>
      ) : null}
    </div>
  )
}

const STATUS_LABEL: Record<CronRunStatus, string> = {
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  skipped: "Skipped",
}

/** Status always pairs color with a label — color alone never communicates. */
export function CronRunStatusPill({ status }: { status: CronRunStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium",
        status === "running" && "border-warning/40 text-warning-foreground bg-warning/10",
        status === "completed" && "border-success/40 text-success bg-success/10",
        status === "failed" && "border-destructive/40 text-destructive bg-destructive/10",
        status === "skipped" && "border-border text-muted-foreground bg-muted/40",
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          status === "running" && "bg-warning",
          status === "completed" && "bg-success",
          status === "failed" && "bg-destructive",
          status === "skipped" && "bg-muted-foreground",
        )}
      />
      {STATUS_LABEL[status]}
    </span>
  )
}
