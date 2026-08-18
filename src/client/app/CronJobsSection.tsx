import { CalendarClock, Pause, Play, X } from "lucide-react"
import type { CronJobSnapshot } from "../../shared/cron/types"
import { humanizeSchedule } from "../../shared/cron/humanize"
import { CronPausedPill, CronRunStatusPill } from "../components/messages/CronRunMessage"
import { formatCompactDuration, formatLiveDuration } from "../lib/formatDuration"
import { useNow } from "../hooks/useNow"
import { cn } from "../lib/utils"
import { HoverHint } from "../components/ui/truncated-text"

interface Props {
  jobs: readonly CronJobSnapshot[]
  onPause: (jobId: string) => void
  onResume: (jobId: string) => void
  onRemove: (jobId: string) => void
}

/**
 * Live list of the chat's armed cron jobs: schedule (humanized), run mode,
 * next-fire countdown, last run status, and pause/resume/remove controls.
 * The transcript's cron_armed card records the arming moment; this panel is
 * the live surface.
 *
 * Display model: schedule lifecycle (paused/active) takes precedence over run
 * execution status. A paused job shows the Paused pill as its primary indicator;
 * any last-run status is rendered as a clearly-labeled secondary so it cannot
 * override the schedule state.
 */
export function CronJobsSection({ jobs, onPause, onResume, onRemove }: Props) {
  const now = useNow(1_000)
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
          {jobs.map((job, index) => {
            const isLast = index === jobs.length - 1
            const elapsedMs = now - job.armedAt
            return (
              <div
                key={job.jobId}
                className={cn(
                  "flex items-center gap-3 px-4 py-2.5 bg-background",
                  !isLast && "border-b border-border",
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm text-foreground">{job.instruction}</span>
                    {job.paused ? <CronPausedPill /> : null}
                    {!job.paused && job.lastRun ? <CronRunStatusPill status={job.lastRun.status} /> : null}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                    <span className="font-mono">{job.jobId}</span>
                    <span>{humanizeSchedule(job.schedule, job.scheduleText)}</span>
                    <span>· {job.mode}</span>
                    {job.model ? <span className="font-mono">{job.model}</span> : null}
                    <HoverHint label={new Date(job.armedAt).toLocaleString()} side="top">
                      <span className="tabular-nums">created {formatCompactDuration(elapsedMs)} ago</span>
                    </HoverHint>
                    {!job.paused ? (
                      <span className="tabular-nums">running for {formatCompactDuration(elapsedMs)}</span>
                    ) : null}
                    {job.paused && job.lastRun ? (
                      <span className="tabular-nums">
                        Last run: <CronRunStatusPill status={job.lastRun.status} />
                      </span>
                    ) : null}
                    {!job.paused && job.nextFireAt !== null ? (
                      <span className="tabular-nums">
                        next in {formatLiveDuration(Math.max(0, job.nextFireAt - now))}
                      </span>
                    ) : null}
                  </div>
                </div>
                <span className="flex shrink-0 items-center gap-1">
                  {job.paused ? (
                    <button
                      type="button"
                      aria-label={`Resume cron job ${job.jobId}`}
                      className="rounded-md p-1.5 text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                      onClick={() => onResume(job.jobId)}
                    >
                      <Play className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      aria-label={`Pause cron job ${job.jobId}`}
                      className="rounded-md p-1.5 text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                      onClick={() => onPause(job.jobId)}
                    >
                      <Pause className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label={`Remove cron job ${job.jobId}`}
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-muted/40 hover:text-destructive"
                    onClick={() => onRemove(job.jobId)}
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
