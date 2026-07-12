import { useCallback } from "react"
import { UserRound, ArrowUp, ChevronRight, Loader2 } from "lucide-react"
import { cn } from "../../lib/utils"
import { formatCompactDuration } from "../../lib/formatDuration"
import { formatContextWindowTokens } from "../../lib/contextWindow"
import { processTranscriptMessages } from "../../lib/parseTranscript"
import type { AnyValue } from "../../../shared/errors"
import type { SubagentTaskResult, SubagentToolStats } from "../../../shared/types"
import { SubagentEntryRow } from "./SubagentEntryRow"
import { useSubagentTranscriptFetch } from "./subagent-fetch-context"
import { SubagentTaskMessageStore } from "./SubagentTaskMessage.store"

interface Props {
  subagentType?: string
  result?: SubagentTaskResult
  isError?: boolean
  localPath?: string | null
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

function SubagentTaskMessageInner({ subagentType, result, isError, localPath }: Props) {
  const name = subagentType || "Agent"
  const tone = toneFor(result?.status, isError)
  const toolSummary = summarizeToolStats(result?.toolStats)

  const fetchTranscript = useSubagentTranscriptFetch()
  const agentId = result?.agentId
  const canExpand = Boolean(fetchTranscript && agentId)

  const expanded = SubagentTaskMessageStore.useScopedStore((s) => s.expanded)
  const loading = SubagentTaskMessageStore.useScopedStore((s) => s.loading)
  const loaded = SubagentTaskMessageStore.useScopedStore((s) => s.loaded)
  const children = SubagentTaskMessageStore.useScopedStore((s) => s.children)
  const error = SubagentTaskMessageStore.useScopedStore((s) => s.error)
  const setExpanded = SubagentTaskMessageStore.useScopedStore((s) => s.setExpanded)
  const setLoading = SubagentTaskMessageStore.useScopedStore((s) => s.setLoading)
  const setLoaded = SubagentTaskMessageStore.useScopedStore((s) => s.setLoaded)
  const setChildren = SubagentTaskMessageStore.useScopedStore((s) => s.setChildren)
  const setError = SubagentTaskMessageStore.useScopedStore((s) => s.setError)

  const onToggle = useCallback(() => {
    if (!fetchTranscript || !agentId) return
    const next = !expanded
    setExpanded(next)
    if (next && !loaded && !loading) {
      setLoading(true)
      setError(null)
      fetchTranscript(agentId)
        .then((entries) => {
          setChildren(processTranscriptMessages(entries))
          setLoaded(true)
        })
        .catch((err: AnyValue) => setError(err instanceof Error ? err.message : "Failed to load subagent transcript"))
        .finally(() => setLoading(false))
    }
  }, [fetchTranscript, agentId, expanded, loaded, loading, setExpanded, setLoading, setError, setChildren, setLoaded])

  const header = (
    <div className="flex items-center gap-2 min-w-0">
      {canExpand ? (
        <ChevronRight className={cn("size-4 text-muted-icon shrink-0 transition-transform", expanded && "rotate-90")} aria-hidden />
      ) : (
        <UserRound className="size-4 text-muted-icon shrink-0" />
      )}
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
        {loading && <Loader2 className="size-3 animate-spin text-muted-foreground" aria-label="Loading" />}
      </div>
    </div>
  )

  if (!canExpand) return header

  return (
    <div className="min-w-0">
      <button type="button" onClick={onToggle} aria-expanded={expanded} className="w-full text-left cursor-pointer">
        {header}
      </button>
      {expanded && (
        <div className="mt-2 ml-2 border-l-2 border-muted-foreground/20 pl-3 space-y-2">
          {error && <div className="text-xs text-destructive">{error}</div>}
          {!error && loaded && children.length === 0 && (
            <div className="text-xs text-muted-foreground">No subagent activity recorded.</div>
          )}
          {children.map((message) => (
            <SubagentEntryRow key={message.id} message={message} localPath={localPath ?? ""} />
          ))}
        </div>
      )}
    </div>
  )
}

export function SubagentTaskMessage({ subagentType, result, isError, localPath }: Props) {
  return (
    <SubagentTaskMessageStore.Provider init={undefined}>
      <SubagentTaskMessageInner subagentType={subagentType} result={result} isError={isError} localPath={localPath} />
    </SubagentTaskMessageStore.Provider>
  )
}
