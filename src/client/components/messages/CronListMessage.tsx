import { CalendarClock } from "lucide-react"
import type { CronJobSnapshot } from "../../../shared/cron/types"
import { humanizeSchedule } from "../../../shared/cron/humanize"
import { CronRunStatusPill } from "./CronRunMessage"
import type { ProcessedCronListMessage } from "./types"

interface Props {
  message: ProcessedCronListMessage
  /** Live jobs from ChatSnapshot — the card always shows the CURRENT list. */
  cronJobs?: readonly CronJobSnapshot[]
}

/**
 * `/cron list` (and bare `/cron` help) card. Renders the chat's LIVE job
 * list from the snapshot — the entry marks where the user asked, not a
 * frozen copy of the answer.
 */
export function CronListMessage({ message, cronJobs }: Props) {
  const jobs = cronJobs ?? []
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <div className="flex items-center gap-2">
        <CalendarClock className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="text-sm font-medium text-foreground">Cron jobs</span>
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">{jobs.length} armed</span>
      </div>
      {jobs.length === 0 ? (
        <p className="mt-1.5 text-sm text-muted-foreground">No cron jobs armed in this chat.</p>
      ) : (
        <div className="mt-2 space-y-2">
          {jobs.map((job) => (
            <div key={job.jobId} className="flex items-baseline gap-3 text-sm">
              <span className="shrink-0 font-mono text-xs text-muted-foreground">{job.jobId}</span>
              <span className="min-w-0 flex-1 truncate text-foreground/90">{job.instruction}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {humanizeSchedule(job.schedule, job.scheduleText)} · {job.mode}
                {job.paused ? " · paused" : ""}
              </span>
              {job.lastRun ? <CronRunStatusPill status={job.lastRun.status} /> : null}
            </div>
          ))}
        </div>
      )}
      {message.help ? (
        <div className="mt-3 border-t border-border pt-2 font-mono text-xs text-muted-foreground">
          <div>/cron &lt;instruction&gt; inline|spawn &lt;schedule&gt;</div>
          <div>/cron list · /cron remove &lt;id&gt; · /cron pause &lt;id&gt; · /cron resume &lt;id&gt;</div>
          <div>schedules: `0 9 * * 1-5` · @hourly @daily @weekly @monthly · every 5m / every 2h</div>
          <div className="mt-1">
            inline runs in this chat with context cleared each cycle; spawn creates a new chat per run.
            Next-fire times use server-local time.
          </div>
        </div>
      ) : null}
    </div>
  )
}
