import { UserRound, ArrowUp } from "lucide-react"
import { cn } from "../../lib/utils"
import { formatCompactDuration } from "../../lib/formatDuration"
import { formatContextWindowTokens } from "../../lib/contextWindow"
import type { SubagentTaskResult, SubagentToolStats } from "../../../shared/types"

interface Props {
  subagentType?: string
  result?: SubagentTaskResult
  isError?: boolean
}

type StatusTone = "muted" | "active" | "destructive"

function toneFor(status: string | undefined, isError: boolean | undefined): StatusTone {
  if (isError || status === "failed" || status === "error") return "destructive"
  if (status === "in_progress" || status === "running") return "active"
  return "muted"
}

function dotClass(tone: StatusTone): string {
  switch (tone) {
    case "active": return "bg-emerald-500 dark:bg-emerald-400"
    case "destructive": return "bg-destructive"
    case "muted":
    default: return "bg-muted-foreground"
  }
}

function textClass(tone: StatusTone): string {
  switch (tone) {
    case "active": return "text-emerald-500 dark:text-emerald-400"
    case "destructive": return "text-destructive"
    case "muted":
    default: return "text-muted-foreground"
  }
}

// Compact "1 read · 3 edits" summary of the subagent's tool usage; only
// non-zero categories are shown, omitted entirely when nothing ran.
function summarizeToolStats(stats: SubagentToolStats | undefined): string {
  if (!stats) return ""
  const parts: string[] = []
  const push = (n: number | undefined, singular: string, plural: string) => {
    if (n && n > 0) parts.push(`${n} ${n === 1 ? singular : plural}`)
  }
  push(stats.readCount, "read", "reads")
  push(stats.editFileCount, "edit", "edits")
  push(stats.bashCount, "cmd", "cmds")
  push(stats.searchCount, "search", "searches")
  push(stats.otherToolCount, "tool", "tools")
  return parts.join(" · ")
}

export function SubagentTaskMessage({ subagentType, result, isError }: Props) {
  const name = subagentType || "Agent"
  const tone = toneFor(result?.status, isError)
  const toolSummary = summarizeToolStats(result?.toolStats)

  return (
    <div className="flex items-center gap-2 min-w-0">
      <UserRound className="size-4 text-muted-icon shrink-0" />
      <div className="flex flex-1 items-center gap-2 min-w-0 overflow-hidden">
        <span className="font-medium text-foreground/80 text-sm truncate">{name}</span>
        {result?.status && (
          <span className="inline-flex items-center gap-1 rounded border border-border bg-card px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide">
            <span aria-hidden className={cn("inline-block size-1.5 rounded-full", dotClass(tone))} />
            <span className={textClass(tone)}>{result.status}</span>
          </span>
        )}
        {result?.totalTokens != null && result.totalTokens > 0 && (
          <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground tabular-nums">
            <ArrowUp className="size-3" aria-hidden />
            {formatContextWindowTokens(result.totalTokens)} tokens
          </span>
        )}
        {result?.totalDurationMs != null && result.totalDurationMs > 0 && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {formatCompactDuration(result.totalDurationMs)}
          </span>
        )}
        {toolSummary && (
          <span className="text-xs text-muted-foreground tabular-nums truncate">{toolSummary}</span>
        )}
      </div>
    </div>
  )
}
