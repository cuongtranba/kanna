import { Bot } from "lucide-react"
import type { SubagentRunSnapshot } from "../../../shared/types"
import { cn } from "../../lib/utils"
import { SubagentErrorCard } from "./SubagentErrorCard"

interface SubagentMessageProps {
  run: SubagentRunSnapshot
  indentDepth: number
  onOpenSettings?: () => void
  onRetry?: () => void
}

export function SubagentMessage({ run, indentDepth, onOpenSettings, onRetry }: SubagentMessageProps) {
  const isStreaming = run.status === "running" && Boolean(run.finalText)
  return (
    <div
      data-testid={`subagent-message:${run.runId}`}
      className={cn("border-l-2 border-accent pl-3 py-2")}
      style={{ marginLeft: `${indentDepth * 24}px` }}
    >
      <header className="flex items-center gap-2 text-xs text-muted-foreground">
        <Bot className="h-3.5 w-3.5" />
        <span>{run.subagentName}</span>
        <span className="opacity-60">{run.provider}{run.model ? `/${run.model}` : ""}</span>
        {run.status === "running" && (
          <span className="ml-auto inline-block animate-pulse">
            {isStreaming ? "streaming..." : "running..."}
          </span>
        )}
      </header>
      {run.finalText && (
        <div className={cn("mt-1 whitespace-pre-wrap text-sm", isStreaming && "text-foreground/80")}>
          {run.finalText}
          {isStreaming && <span className="ml-0.5 inline-block w-2 animate-pulse">▍</span>}
        </div>
      )}
      {run.status === "failed" && run.error && (
        <div className="mt-2">
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
