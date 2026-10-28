import type {
  AskUserQuestionAnswerMap,
  AskUserQuestionItem,
  HydratedAskUserQuestionToolCall,
  HydratedExitPlanModeToolCall,
  SubagentPendingTool,
} from "../../../shared/types"
import { useCallback } from "react"
import { CLAUDE_ASK_USER_QUESTION_TOOL_NAME, CLAUDE_EXIT_PLAN_MODE_TOOL_NAME, normalizeToolCall } from "../../../shared/tools"
import { Spinner } from "../ui/spinner"
import { AskUserQuestionMessage } from "./AskUserQuestionMessage"
import { ExitPlanModeMessage, useExitPlanModeResponding } from "./ExitPlanModeMessage"

interface Props {
  pendingTool: SubagentPendingTool
  onAskUserQuestionSubmit: (
    toolUseId: string,
    questions: AskUserQuestionItem[],
    answers: AskUserQuestionAnswerMap,
  ) => Promise<void>
  onExitPlanModeSubmit: (
    toolUseId: string,
    response: { confirmed: boolean; clearContext?: boolean; message?: string },
  ) => Promise<void>
}

function AwaitingResponseLabel({ pending }: { pending: boolean }) {
  return (
    <div className="text-xs tracking-wide text-muted-foreground mb-1 flex items-center gap-1.5">
      {pending ? <Spinner className="size-3" /> : null}
      {pending ? "sending response…" : "awaiting your response"}
    </div>
  )
}

export function SubagentPendingToolCard({
  pendingTool,
  onAskUserQuestionSubmit,
  onExitPlanModeSubmit,
}: Props) {
  const exitPlanPending = useExitPlanModeResponding(pendingTool.toolUseId)
  const handleExitPlanConfirm = useCallback(
    (toolUseId: string, confirmed: boolean, clearContext?: boolean, message?: string) =>
      onExitPlanModeSubmit(toolUseId, { confirmed, clearContext, message }),
    [onExitPlanModeSubmit],
  )

  const call = normalizeToolCall({
    toolName: pendingTool.toolKind === "ask_user_question"
      ? CLAUDE_ASK_USER_QUESTION_TOOL_NAME
      : CLAUDE_EXIT_PLAN_MODE_TOOL_NAME,
    toolId: pendingTool.toolUseId,
    input: pendingTool.input,
  })
  const timestamp = new Date(pendingTool.requestedAt).toISOString()

  if (call.toolKind === "ask_user_question") {
    const message: HydratedAskUserQuestionToolCall = {
      id: pendingTool.toolUseId,
      kind: "tool",
      toolKind: call.toolKind,
      toolName: call.toolName,
      toolId: call.toolId,
      input: call.input,
      timestamp,
    }
    return (
      <div data-testid={`subagent-pending-tool:${pendingTool.toolUseId}`}>
        <AwaitingResponseLabel pending={false} />
        <AskUserQuestionMessage
          message={message}
          onSubmit={onAskUserQuestionSubmit}
          isLatest={true}
        />
      </div>
    )
  }

  if (call.toolKind === "exit_plan_mode") {
    const message: HydratedExitPlanModeToolCall = {
      id: pendingTool.toolUseId,
      kind: "tool",
      toolKind: call.toolKind,
      toolName: call.toolName,
      toolId: call.toolId,
      input: call.input,
      timestamp,
    }
    return (
      <div
        data-testid={`subagent-pending-tool:${pendingTool.toolUseId}`}
        aria-busy={exitPlanPending || undefined}
        className={exitPlanPending ? "pointer-events-none opacity-60" : undefined}
      >
        <AwaitingResponseLabel pending={exitPlanPending} />
        <ExitPlanModeMessage
          message={message}
          onConfirm={handleExitPlanConfirm}
          isLatest={true}
        />
      </div>
    )
  }

  return null
}
