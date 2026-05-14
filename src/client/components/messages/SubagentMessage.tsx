import { Bot, X } from "lucide-react"
import type { AskUserQuestionAnswerMap, AskUserQuestionItem, SubagentRunSnapshot } from "../../../shared/types"
import { processTranscriptMessages } from "../../lib/parseTranscript"
import { cn } from "../../lib/utils"
import { SubagentEntryRow } from "./SubagentEntryRow"
import { SubagentErrorCard } from "./SubagentErrorCard"
import { SubagentPendingToolCard } from "./SubagentPendingToolCard"

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
  ) => void
  onSubagentExitPlanModeSubmit?: (
    runId: string,
    toolUseId: string,
    response: { confirmed: boolean; clearContext?: boolean; message?: string },
  ) => void
  onCancelSubagentRun?: (chatId: string, runId: string) => void
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
}: SubagentMessageProps) {
  const messages = processTranscriptMessages(run.entries)
  const hasAnyText = messages.some((m) => m.kind === "assistant_text")
  const isStreaming = run.status === "running" && hasAnyText

  return (
    <div
      data-testid={`subagent-message:${run.runId}`}
      className={cn("border-l-2 border-accent pl-3 py-2 space-y-2")}
      style={{ marginLeft: `${indentDepth * 24}px` }}
    >
      <header className="flex items-center gap-2 text-xs text-muted-foreground">
        <Bot className="h-3.5 w-3.5" />
        <span>{run.subagentName}</span>
        <span className="opacity-60">{run.provider}{run.model ? `/${run.model}` : ""}</span>
        {run.usage?.outputTokens != null && (
          <span className="opacity-60">· {run.usage.inputTokens ?? 0}↑ {run.usage.outputTokens}↓</span>
        )}
        {run.status === "running" && (
          <span className="ml-auto inline-block animate-pulse">
            {isStreaming ? "streaming..." : "running..."}
          </span>
        )}
        {onCancelSubagentRun && run.status === "running" && (
          <button
            type="button"
            data-testid={`subagent-cancel:${run.runId}`}
            aria-label="Cancel subagent"
            onClick={() => onCancelSubagentRun(run.chatId, run.runId)}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </header>
      {messages.map((m) => (
        <SubagentEntryRow key={m.id} message={m} localPath={localPath} />
      ))}
      {run.pendingTool && (
        <SubagentPendingToolCard
          pendingTool={run.pendingTool}
          onAskUserQuestionSubmit={(toolUseId, questions, answers) =>
            onSubagentAskUserQuestionSubmit?.(run.runId, toolUseId, questions, answers)
          }
          onExitPlanModeSubmit={(toolUseId, response) =>
            onSubagentExitPlanModeSubmit?.(run.runId, toolUseId, response)
          }
        />
      )}
      {/* Backwards compatibility: if entries is empty (e.g. an old replayed run
          that only has finalText), still render finalText so the row is not blank. */}
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
