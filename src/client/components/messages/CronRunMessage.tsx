import { CalendarClock, ExternalLink } from "lucide-react"
import { Link } from "react-router-dom"
import type { CronJobSnapshot, CronRunStatus } from "../../../shared/cron/types"
import { formatStartedClock } from "../../lib/formatters"
import { cronRunLabel, cronRunTone } from "../../lib/statusLabel"
import { StateMarkLabel } from "../ui/state-mark"
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

/**
 * The run's status as a mark and its word.
 *
 * This was a pill: a rounded border, a tinted fill, AND a coloured dot inside
 * it — three devices saying one thing, two of them carrying it in hue alone.
 * The mark's shape is the signal now, so it survives greyscale, and the tinted
 * surface it no longer needs is one fewer entry riding the contrast catalog.
 */
export function CronRunStatusPill({ status }: { status: CronRunStatus }) {
  return <StateMarkLabel tone={cronRunTone(status)} label={cronRunLabel(status)} />
}

/** Schedule-lifecycle indicator — distinct from run execution status. */
export function CronPausedPill() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-xs font-medium text-muted-foreground">
      <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground" />
      Paused
    </span>
  )
}
