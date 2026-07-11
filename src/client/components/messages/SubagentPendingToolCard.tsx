import type {
  AskUserQuestionAnswerMap,
  AskUserQuestionItem,
  HydratedAskUserQuestionToolCall,
  HydratedExitPlanModeToolCall,
  SubagentPendingTool,
} from "../../../shared/types"
import { isRecord } from "../../../shared/errors"
import { AskUserQuestionMessage } from "./AskUserQuestionMessage"
import { ExitPlanModeMessage } from "./ExitPlanModeMessage"

interface Props {
  pendingTool: SubagentPendingTool
  onAskUserQuestionSubmit: (
    toolUseId: string,
    questions: AskUserQuestionItem[],
    answers: AskUserQuestionAnswerMap,
  ) => void
  onExitPlanModeSubmit: (
    toolUseId: string,
    response: { confirmed: boolean; clearContext?: boolean; message?: string },
  ) => void
}

export function SubagentPendingToolCard({
  pendingTool,
  onAskUserQuestionSubmit,
  onExitPlanModeSubmit,
}: Props) {
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
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
          awaiting your response
        </div>
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
      <div data-testid={`subagent-pending-tool:${pendingTool.toolUseId}`}>
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
          awaiting your response
        </div>
        <ExitPlanModeMessage
          message={message}
          onConfirm={(toolUseId, confirmed, clearContext, msg) =>
            onExitPlanModeSubmit(toolUseId, { confirmed, clearContext, message: msg })
          }
          isLatest={true}
        />
      </div>
    )
  }

  return null
}
