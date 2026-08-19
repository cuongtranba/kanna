import { useCallback, useMemo } from "react"
import { Link } from "react-router-dom"
import { CalendarClock, ExternalLink, Pause, Play, X } from "lucide-react"
import { useCronJobsStore } from "../stores/cronJobsStore"
import { useKannaSocketInstance } from "./KannaSocketProvider"
import type { CronJobsGlobalRow } from "../../shared/cron/types"
import { humanizeSchedule } from "../../shared/cron/humanize"
import { CronPausedPill, CronRunStatusPill } from "../components/messages/CronRunMessage"
import { formatCompactDuration, formatLiveDuration } from "../lib/formatDuration"
import { getPathBasename } from "../lib/formatters"
import { useNow } from "../hooks/useNow"
import { SHELL_PAGE_SCROLL_CLASS } from "../lib/shellChrome"
import { cn } from "../lib/utils"
import { HoverHint } from "../components/ui/truncated-text"

/**
 * Global cron management page (/cron): every armed job across every project
 * and chat, grouped by project, with the same pause/resume/remove controls
 * as the per-chat footer panel and a link into each job's chat.
 *
 * Display model: schedule lifecycle (paused/active) takes precedence over run
 * execution status. A paused job shows the Paused pill as its primary indicator;
 * any last-run status is rendered as a clearly-labeled secondary so it cannot
 * override the schedule state.
 */
export function CronJobsPage() {
  const rows = useCronJobsStore((s) => s.rows)
  const socket = useKannaSocketInstance()
  const now = useNow(1_000)

  const command = useCallback(
    (type: "cron.pause" | "cron.resume" | "cron.remove", row: CronJobsGlobalRow) => {
      void socket.command({ type, chatId: row.chatId, jobId: row.job.jobId }).catch(() => {})
    },
    [socket],
  )

  const groups = useMemo(() => {
    const byProject = new Map<string, { projectPath: string; rows: CronJobsGlobalRow[] }>()
    for (const row of rows) {
      const group = byProject.get(row.projectId) ?? { projectPath: row.projectPath, rows: [] }
      group.rows.push(row)
      byProject.set(row.projectId, group)
    }
    return [...byProject.values()]
  }, [rows])

  return (
    <div className={SHELL_PAGE_SCROLL_CLASS}>
      <div className="mx-auto w-full max-w-[900px] px-4 py-8">
        <h1 className="flex items-center gap-2.5 text-lg font-semibold text-foreground">
          <CalendarClock className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
          Cron jobs
          <span className="text-sm font-normal text-muted-foreground tabular-nums">{rows.length} armed</span>
        </h1>
        {rows.length === 0 ? (
          <p className="mt-6 text-sm text-muted-foreground">
            No cron jobs armed anywhere. Arm one from any chat with{" "}
            <code className="font-mono text-xs">/cron &lt;instruction&gt; inline|spawn &lt;schedule&gt;</code>.
          </p>
        ) : (
          <div className="mt-6 space-y-6">
            {groups.map((group) => (
              <div key={group.projectPath} className="rounded-2xl border border-border overflow-hidden">
                <h2 className="border-b border-border bg-card p-3 px-4 text-sm font-medium text-foreground">
                  {getPathBasename(group.projectPath)}
                  <span className="ml-2 font-mono text-xs font-normal text-muted-foreground">{group.projectPath}</span>
                </h2>
                <div>
                  {group.rows.map((row, index) => {
                    const job = row.job
                    const isLast = index === group.rows.length - 1
                    const elapsedMs = now - job.armedAt
                    const activeRun = job.lastRun?.status === "running" ? job.lastRun : null
                    return (
                      <div
                        key={`${row.chatId} ${job.jobId}`}
                        className={cn(
                          "flex items-center gap-3 bg-background px-4 py-2.5",
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
                            {activeRun ? (
                              <span className="tabular-nums">running for {formatLiveDuration(now - activeRun.firedAt)}</span>
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
                            <Link
                              to={`/chat/${row.chatId}`}
                              className="inline-flex items-center gap-1 text-primary hover:underline"
                            >
                              <ExternalLink className="h-3 w-3" aria-hidden="true" />
                              {row.chatTitle || "Open chat"}
                            </Link>
                          </div>
                        </div>
                        <span className="flex shrink-0 items-center gap-1">
                          {job.paused ? (
                            <button
                              type="button"
                              aria-label={`Resume cron job ${job.jobId}`}
                              className="rounded-md p-1.5 text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                              onClick={() => command("cron.resume", row)}
                            >
                              <Play className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                          ) : (
                            <button
                              type="button"
                              aria-label={`Pause cron job ${job.jobId}`}
                              className="rounded-md p-1.5 text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                              onClick={() => command("cron.pause", row)}
                            >
                              <Pause className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                          )}
                          <button
                            type="button"
                            aria-label={`Remove cron job ${job.jobId}`}
                            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted/40 hover:text-destructive"
                            onClick={() => command("cron.remove", row)}
                          >
                            <X className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
