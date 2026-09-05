import { CalendarClock, ExternalLink } from "lucide-react"
import { Link } from "react-router-dom"
import type { CronJobSnapshot, CronRunStatus } from "../../../shared/cron/types"
import { formatStartedClock } from "../../lib/formatters"
import { cronRunLabel, cronRunTone } from "../../lib/statusLabel"
import { StateMarkLabel } from "../ui/state-mark"
import type { ProcessedCronRunMessage } from "./types"

interface Props {
  message: ProcessedCronRunMessage
  cronJobs?: readonly CronJobSnapshot[]
}

export function CronRunMessage({ message, cronJobs }: Props) {
  const job = cronJobs?.find((candidate) => candidate.jobId === message.jobId)
  const run = job?.recentRuns.find((candidate) => candidate.runId === message.runId)
  const status: CronRunStatus = run?.status ?? "running"

  return (
    <div className="px-0.5">
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

export function CronRunStatusPill({ status }: { status: CronRunStatus }) {
  return <StateMarkLabel tone={cronRunTone(status)} label={cronRunLabel(status)} />
}

export function CronPausedPill() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-xs font-medium text-muted-foreground">
      <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground" />
      Paused
    </span>
  )
}
