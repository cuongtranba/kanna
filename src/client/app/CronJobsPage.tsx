import { useMemo } from "react"
import { Link } from "react-router-dom"
import { CalendarClock, ExternalLink } from "lucide-react"
import { useCronJobsStore } from "../stores/cronJobsStore"
import type { CronJobsGlobalRow } from "../../shared/cron/types"
import { getPathBasename } from "../lib/formatters"
import { SHELL_PAGE_SCROLL_CLASS } from "../lib/shellChrome"
import { CronJobRow } from "./CronJobRow"

export function CronJobsPage() {
  const rows = useCronJobsStore((s) => s.rows)

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
                  {group.rows.map((row, index) => (
                    <CronJobRow
                      key={`${row.chatId} ${row.job.jobId}`}
                      job={row.job}
                      chatId={row.chatId}
                      divider={index < group.rows.length - 1}
                      trailing={
                        <Link
                          to={`/chat/${row.chatId}`}
                          className="inline-flex items-center gap-1 text-primary hover:underline"
                        >
                          <ExternalLink className="h-3 w-3" aria-hidden="true" />
                          {row.chatTitle || "Open chat"}
                        </Link>
                      }
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
