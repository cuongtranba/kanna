import type {
  AskUserQuestionAnswerMap,
  AskUserQuestionItem,
  HydratedAskUserQuestionToolCall,
  HydratedExitPlanModeToolCall,
  SubagentPendingTool,
} from "../../../shared/types"
import { useCallback } from "react"
import { isRecord } from "../../../shared/errors"
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

  if (pendingTool.toolKind === "ask_user_question") {
    const questionsRaw = pendingTool.input.questions
    const questions: AskUserQuestionItem[] = Array.isArray(questionsRaw)
      ? questionsRaw.filter((q): q is AskUserQuestionItem => isRecord(q))
      : []
    const message: HydratedAskUserQuestionToolCall = {
      id: pendingTool.toolUseId,
      kind: "tool",
      toolKind: "ask_user_question",
      toolName: "AskUserQuestion",
      toolId: pendingTool.toolUseId,
      input: { questions },
      timestamp: new Date(pendingTool.requestedAt).toISOString(),
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

  if (pendingTool.toolKind === "exit_plan_mode") {
    const rawInput = pendingTool.input
    const message: HydratedExitPlanModeToolCall = {
      id: pendingTool.toolUseId,
      kind: "tool",
      toolKind: "exit_plan_mode",
      toolName: "ExitPlanMode",
      toolId: pendingTool.toolUseId,
      input: {
        plan: typeof rawInput.plan === "string" ? rawInput.plan : undefined,
        summary: typeof rawInput.summary === "string" ? rawInput.summary : undefined,
      },
      timestamp: new Date(pendingTool.requestedAt).toISOString(),
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
