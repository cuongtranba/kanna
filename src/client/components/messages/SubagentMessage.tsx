import { Bot, X } from "lucide-react"
import type {
  AskUserQuestionAnswerMap,
  AskUserQuestionItem,
  SubagentRunSnapshot,
} from "../../../shared/types"
import { CHAT_SELECTION_ZONE_ATTRIBUTE } from "../../app/chatFocusPolicy"
import { toolActivity } from "../../lib/toolPresentation"
import { processTranscriptMessages } from "../../lib/parseTranscript"
import { cn } from "../../lib/utils"
import { SubagentEntryRow } from "./SubagentEntryRow"
import { SubagentErrorCard } from "./SubagentErrorCard"
import { SubagentPendingToolCard } from "./SubagentPendingToolCard"
import { Spinner } from "../ui/spinner"
import { pendingActionKey, runPendingAction, usePendingAction } from "../../stores/pendingActionsStore"

function deriveSubagentActivity(run: SubagentRunSnapshot, localPath: string): string {
  if (run.pendingTool) return "waiting for input..."
  const entries = run.entries
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
  run: SubagentRunSnapshot
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
  run: SubagentRunSnapshot
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

export function SubagentMessage({
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
  const messages = processTranscriptMessages(run.entries)
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
