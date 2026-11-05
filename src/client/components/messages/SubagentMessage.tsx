import { useCallback } from "react"
import { Bot, X } from "lucide-react"
import { onRejected } from "../../../shared/errors"
import type {
  AskUserQuestionAnswerMap,
  AskUserQuestionItem,
  SubagentRunSummary,
} from "../../../shared/types"
import { CHAT_SELECTION_ZONE_ATTRIBUTE } from "../../app/chatFocusPolicy"
import { toolActivity } from "../../lib/toolPresentation"
import { processTranscriptMessages } from "../../lib/parseTranscript"
import { mergeTranscriptEntries } from "../../lib/mergeTranscriptEntries"
import { cn } from "../../lib/utils"
import { SubagentEntryRow } from "./SubagentEntryRow"
import { SubagentErrorCard } from "./SubagentErrorCard"
import { SubagentPendingToolCard } from "./SubagentPendingToolCard"
import { Spinner } from "../ui/spinner"
import { Button } from "../ui/button"
import { withScopedStore } from "../../lib/createScopedStore"
import { SubagentMessageStore } from "./SubagentMessage.store"
import { useSubagentRunEntries } from "./subagent-run-entries-context"
import { pendingActionKey, runPendingAction, usePendingAction } from "../../stores/pendingActionsStore"

function deriveSubagentActivity(run: SubagentRunSummary, localPath: string): string {
  if (run.pendingTool) return "waiting for input..."
  const entries = run.recentEntries
  const resolved = new Set<string>()
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]
    if (e.kind === "tool_result") {
      resolved.add(e.toolId)
    } else if (e.kind === "tool_call" && !resolved.has(e.tool.toolId)) {
      return toolActivity(e.tool, localPath)
    }
  }
  const last = entries[entries.length - 1]
  if (last?.kind === "assistant_text") return "streaming..."
  return "running..."
}

interface SubagentMessageProps {
  run: SubagentRunSummary
  indentDepth: number
  localPath: string
  onOpenSettings?: () => void
  onRetry?: () => void
  onSubagentAskUserQuestionSubmit?: (
    runId: string,
    toolUseId: string,
    questions: AskUserQuestionItem[],
    answers: AskUserQuestionAnswerMap,
  ) => Promise<void>
  onSubagentExitPlanModeSubmit?: (
    runId: string,
    toolUseId: string,
    response: { confirmed: boolean; clearContext?: boolean; message?: string },
  ) => Promise<void>
  onCancelSubagentRun?: (chatId: string, runId: string) => Promise<void>
  suppressPendingTool?: boolean
}

function SubagentCancelButton({
  run,
  onCancel,
}: {
  run: SubagentRunSummary
  onCancel: (chatId: string, runId: string) => Promise<void>
}) {
  const pendingKey = pendingActionKey("chat.cancelSubagentRun", run.runId)
  const pending = usePendingAction(pendingKey)
  return (
    <button
      type="button"
      data-testid={`subagent-cancel:${run.runId}`}
      aria-label="Cancel subagent"
      aria-busy={pending || undefined}
      disabled={pending}
      onClick={() => runPendingAction(pendingKey, () => onCancel(run.chatId, run.runId))}
      className="text-muted-foreground hover:text-foreground disabled:pointer-events-none"
    >
      {pending ? <Spinner /> : <X className="h-3.5 w-3.5" />}
    </button>
  )
}

function SubagentLogToggle({ run }: { run: SubagentRunSummary }) {
  const getEntries = useSubagentRunEntries()
  const expanded = SubagentMessageStore.useScopedStore((s) => s.expanded)
  const error = SubagentMessageStore.useScopedStore((s) => s.error)
  const openLog = SubagentMessageStore.useScopedStore((s) => s.openLog)
  const closeLog = SubagentMessageStore.useScopedStore((s) => s.closeLog)
  const hasOlder = SubagentMessageStore.useScopedStore((s) => s.hasOlder)
  const olderCursor = SubagentMessageStore.useScopedStore((s) => s.olderCursor)
  const receiveNewest = SubagentMessageStore.useScopedStore((s) => s.receiveNewest)
  const receiveOlder = SubagentMessageStore.useScopedStore((s) => s.receiveOlder)
  const failLoad = SubagentMessageStore.useScopedStore((s) => s.failLoad)
  const pendingKey = pendingActionKey("subagentRun.getEntries", run.runId)
  const olderPendingKey = pendingActionKey("subagentRun.getEntries", run.runId, "older")
  const pending = usePendingAction(pendingKey)
  const olderPending = usePendingAction(olderPendingKey)

  const onToggle = useCallback(() => {
    if (!getEntries) return
    if (expanded) {
      closeLog()
      return
    }
    openLog()
    runPendingAction(pendingKey, () =>
      getEntries(run.chatId, run.runId).then(receiveNewest, onRejected((cause) => failLoad(cause.message))),
    )
  }, [getEntries, expanded, closeLog, openLog, pendingKey, run.chatId, run.runId, receiveNewest, failLoad])

  const onLoadOlder = useCallback(() => {
    if (!getEntries || olderCursor === null) return
    runPendingAction(olderPendingKey, () =>
      getEntries(run.chatId, run.runId, olderCursor).then(
        (page) => receiveOlder(olderCursor, page),
        onRejected((cause) => failLoad(cause.message)),
      ),
    )
  }, [getEntries, olderCursor, olderPendingKey, run.chatId, run.runId, receiveOlder, failLoad])

  if (!getEntries) return null
  if (!expanded && run.entryCount <= run.recentEntries.length) return null

  return (
    <div className="space-y-1">
      <Button
        variant="ghost"
        size="none"
        className="px-1.5 py-0.5 text-xs"
        data-testid={`subagent-log-toggle:${run.runId}`}
        aria-expanded={expanded}
        pending={pending}
        onClick={onToggle}
      >
        {expanded ? "Hide full log" : `Show full log (${run.entryCount} entries)`}
      </Button>
      {expanded && hasOlder && (
        <Button
          variant="ghost"
          size="none"
          className="px-1.5 py-0.5 text-xs"
          data-testid={`subagent-log-older:${run.runId}`}
          pending={olderPending}
          onClick={onLoadOlder}
        >
          Load earlier entries
        </Button>
      )}
      {error && (
        <div data-testid={`subagent-log-error:${run.runId}`} className="text-xs text-destructive-text">
          {error}
        </div>
      )}
    </div>
  )
}

function SubagentMessageInner({
  run,
  indentDepth,
  localPath,
  onOpenSettings,
  onRetry,
  onSubagentAskUserQuestionSubmit,
  onSubagentExitPlanModeSubmit,
  onCancelSubagentRun,
  suppressPendingTool = false,
}: SubagentMessageProps) {
  const fullEntries = SubagentMessageStore.useScopedStore((s) => s.fullEntries)
  const shownEntries = fullEntries ? mergeTranscriptEntries(fullEntries, run.recentEntries) : run.recentEntries
  const messages = processTranscriptMessages(shownEntries)
  const hasAnyText = messages.some((m) => m.kind === "assistant_text")
  const isStreaming = run.status === "running" && hasAnyText
  const activityLabel = run.status === "running" ? deriveSubagentActivity(run, localPath) : ""

  return (
    <div
      data-testid={`subagent-message:${run.runId}`}
      className={cn("border-l-2 border-accent pl-3 py-2 space-y-2")}
      style={{ marginLeft: `${indentDepth * 24}px` }}
      {...{ [CHAT_SELECTION_ZONE_ATTRIBUTE]: "" }}
    >
      <header className="flex items-center gap-2 text-xs text-muted-foreground">
        <Bot className="h-3.5 w-3.5" />
        <span>{run.subagentName}</span>
        <span className="opacity-60">{run.provider}{run.model ? `/${run.model}` : ""}</span>
        {run.usage?.outputTokens != null && (
          <span className="opacity-60">· {run.usage.inputTokens ?? 0}↑ {run.usage.outputTokens}↓</span>
        )}
        {run.status === "running" && (
          <span
            data-testid={`subagent-activity:${run.runId}`}
            className="ml-auto inline-block animate-pulse"
          >
            {activityLabel}
          </span>
        )}
        {onCancelSubagentRun && run.status === "running" && (
          <SubagentCancelButton run={run} onCancel={onCancelSubagentRun} />
        )}
      </header>
      <SubagentLogToggle run={run} />
      {messages.map((m) => (
        <SubagentEntryRow
          key={m.id}
          message={m}
          localPath={localPath}
          isRunning={run.status === "running"}
        />
      ))}
      {!suppressPendingTool && run.pendingTool && (
        <SubagentPendingToolCard
          pendingTool={run.pendingTool}
          onAskUserQuestionSubmit={async (toolUseId, questions, answers) => {
            await onSubagentAskUserQuestionSubmit?.(run.runId, toolUseId, questions, answers)
          }}
          onExitPlanModeSubmit={async (toolUseId, response) => {
            await onSubagentExitPlanModeSubmit?.(run.runId, toolUseId, response)
          }}
        />
      )}
      {messages.length === 0 && run.finalText && (
        <div className={cn("whitespace-pre-wrap text-sm", isStreaming && "text-foreground/80")}>
          {run.finalText}
          {isStreaming && <span className="ml-0.5 inline-block w-2 animate-pulse">▍</span>}
        </div>
      )}
      {run.status === "failed" && run.error && (
        <div>
          <SubagentErrorCard
            error={run.error}
            runId={run.runId}
            subagentId={run.subagentId}
            onOpenSettings={onOpenSettings}
            onRetry={onRetry}
          />
        </div>
      )}
    </div>
  )
}

export const SubagentMessage = withScopedStore(SubagentMessageStore, SubagentMessageInner)
