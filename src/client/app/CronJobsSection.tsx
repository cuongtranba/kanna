import { CalendarClock } from "lucide-react"
import type { CronJobSnapshot } from "../../shared/cron/types"
import { CronJobRow } from "./CronJobRow"

interface Props {
  jobs: readonly CronJobSnapshot[]
  chatId: string
}

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
