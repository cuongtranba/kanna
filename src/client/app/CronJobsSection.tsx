import { CalendarClock } from "lucide-react"
import type { CronJobSnapshot } from "../../shared/cron/types"
import { CronJobRow } from "./CronJobRow"

interface Props {
  jobs: readonly CronJobSnapshot[]
  /** The chat these jobs are armed on — every cron command is addressed to it. */
  chatId: string
}

/**
 * Live list of the chat's armed cron jobs. The transcript's `cron_armed` card
 * records the arming moment; this panel is the live surface.
 *
 * The row itself — including its controls and its socket wiring — is
 * `CronJobRow`, shared with the global `/cron` page so the two surfaces cannot
 * drift.
 */
export function CronJobsSection({ jobs, chatId }: Props) {
  if (jobs.length === 0) return null

  return (
    <div className="w-full">
      <div className="rounded-2xl border border-border overflow-hidden">
        <h3 className="font-medium text-foreground text-sm p-3 px-4 bg-card border-b border-border flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-muted-foreground" />
          Cron jobs
          <span className="ml-auto text-xs font-normal text-muted-foreground tabular-nums">
            {jobs.length} armed
          </span>
        </h3>
        <div>
          {jobs.map((job, index) => (
            <CronJobRow key={job.jobId} job={job} chatId={chatId} divider={index < jobs.length - 1} />
          ))}
        </div>
      </div>
    </div>
  )
}
