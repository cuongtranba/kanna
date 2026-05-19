import { Bot, X } from "lucide-react"
import type {
  AskUserQuestionAnswerMap,
  AskUserQuestionItem,
  NormalizedToolCall,
  SubagentRunSnapshot,
} from "../../../shared/types"
import { processTranscriptMessages } from "../../lib/parseTranscript"
import { cn } from "../../lib/utils"
import { SubagentEntryRow } from "./SubagentEntryRow"
import { SubagentErrorCard } from "./SubagentErrorCard"
import { SubagentPendingToolCard } from "./SubagentPendingToolCard"

function toolActivityLabel(tool: NormalizedToolCall): string {
  switch (tool.toolKind) {
    case "bash":
      return "running bash..."
    case "read_file":
      return "reading file..."
    case "write_file":
      return "writing file..."
    case "edit_file":
      return "editing file..."
    case "delete_file":
      return "deleting file..."
    case "glob":
      return "globbing..."
    case "grep":
      return "grepping..."
    case "web_search":
      return "searching web..."
    case "todo_write":
      return "updating todos..."
    case "skill":
      return "running skill..."
    case "subagent_task":
      return "delegating..."
    case "ask_user_question":
      return "asking..."
    case "exit_plan_mode":
      return "presenting plan..."
    case "offer_download":
      return "preparing download..."
    case "image_generation":
      return "generating image..."
    case "mcp_generic":
      return `calling ${tool.input.tool}...`
    case "unknown_tool":
      return `running ${tool.toolName}...`
    default:
      return "running..."
  }
}

function deriveSubagentActivity(run: SubagentRunSnapshot): string {
  if (run.pendingTool) return "waiting for input..."
  const entries = run.entries
  const resolved = new Set<string>()
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]
    if (e.kind === "tool_result") {
      resolved.add(e.toolId)
    } else if (e.kind === "tool_call" && !resolved.has(e.tool.toolId)) {
      return toolActivityLabel(e.tool)
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
  const activityLabel = run.status === "running" ? deriveSubagentActivity(run) : ""

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
          <span
            data-testid={`subagent-activity:${run.runId}`}
            className="ml-auto inline-block animate-pulse"
          >
            {activityLabel}
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
