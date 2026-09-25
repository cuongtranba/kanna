import type { HydratedTranscriptMessage, AskUserQuestionItem } from "../../../shared/types"
import type { ToolRequestDecision } from "../../../shared/permission-policy"
import { isJsonArray, isJsonObject, type JsonObject } from "../../../shared/json"
import { Button } from "../ui/button"
import { AskUserQuestionInteractive } from "./AskUserQuestionInteractive"
import { encodeAskUserQuestionResult } from "../../lib/askUserQuestionJson"
import { useCallback } from "react"
import { pendingActionKey, runPendingAction, usePendingAction } from "../../stores/pendingActionsStore"

export type PendingToolRequestHydrated = Extract<HydratedTranscriptMessage, { kind: "pending_tool_request" }>

type AnswerToolRequest = (toolRequestId: string, decision: ToolRequestDecision) => Promise<void>

interface Props {
  entry: PendingToolRequestHydrated
  onAnswer: AnswerToolRequest
}

interface ToolRequestResponder {
  answering: boolean
  denying: boolean
  answer: (decision: ToolRequestDecision) => void
  deny: () => void
}

const USER_CANCELED: ToolRequestDecision = { kind: "deny", reason: "user_canceled" }

function useToolRequestResponder(toolRequestId: string, onAnswer: AnswerToolRequest): ToolRequestResponder {
  const answerKey = pendingActionKey("toolRequest.answer", toolRequestId)
  const denyKey = pendingActionKey("toolRequest.deny", toolRequestId)
  const answering = usePendingAction(answerKey)
  const denying = usePendingAction(denyKey)
  const busy = answering || denying
  const answer = useCallback((decision: ToolRequestDecision) => {
    if (busy) return
    runPendingAction(answerKey, () => onAnswer(toolRequestId, decision))
  }, [busy, answerKey, onAnswer, toolRequestId])
  const deny = useCallback(() => {
    if (busy) return
    runPendingAction(denyKey, () => onAnswer(toolRequestId, USER_CANCELED))
  }, [busy, denyKey, onAnswer, toolRequestId])
  return { answering, denying, answer, deny }
}

function ExitPlanModePending({ plan, responder }: { plan: string; responder: ToolRequestResponder }) {
  return (
    <div className="rounded-2xl border border-border overflow-hidden">
      <div className="font-medium text-sm p-3 px-4 bg-muted border-b border-border flex items-center justify-between">
        <span>Plan</span>
        <span className="text-xs text-muted-foreground">Reconnected — awaiting your response</span>
      </div>
      <div className="bg-background px-4 py-3">
        <p className="text-sm whitespace-pre-wrap">{plan}</p>
      </div>
      <div className="flex justify-end gap-2 px-4 py-3 bg-background border-t border-border">
        <Button
          size="sm"
          variant="outline"
          className="rounded-full"
          pending={responder.denying}
          disabled={responder.answering}
          onClick={responder.deny}
        >
          Edit
        </Button>
        <Button
          size="sm"
          className="rounded-full"
          pending={responder.answering}
          disabled={responder.denying}
          onClick={() => responder.answer({ kind: "answer", payload: { confirmed: true } })}
        >
          Confirm
        </Button>
      </div>
    </div>
  )
}


function GenericPending({
  toolName,
  args,
  responder,
}: {
  toolName: string
  args: JsonObject
  responder: ToolRequestResponder
}) {
  const previewKey = (["command", "path", "url", "pattern", "query"] as const).find(
    (k) => typeof args[k] === "string" && String(args[k]).length > 0,
  )
  const previewValue = previewKey !== undefined ? args[previewKey] : undefined
  const preview = typeof previewValue === "string" ? previewValue : JSON.stringify(args)
  return (
    <div className="rounded-2xl border border-border bg-background px-4 py-3 text-sm">
      <div className="flex items-baseline gap-2">
        <span className="text-muted-foreground shrink-0">Pending tool:</span>
        <span className="font-mono text-foreground">{toolName}</span>
      </div>
      {preview ? (
        <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-all font-mono text-xs text-muted-foreground">
          {preview}
        </pre>
      ) : null}
      <div className="mt-3 flex items-center justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          pending={responder.denying}
          disabled={responder.answering}
          onClick={responder.deny}
        >
          Deny
        </Button>
        <Button
          variant="default"
          size="sm"
          pending={responder.answering}
          disabled={responder.denying}
          onClick={() => responder.answer({ kind: "allow" })}
        >
          Allow
        </Button>
      </div>
    </div>
  )
}


export function PendingToolRequestMessage({ entry, onAnswer }: Props) {
  const { toolRequestId, toolName, arguments: args } = entry
  const responder = useToolRequestResponder(toolRequestId, onAnswer)

  if (toolName === "mcp__kanna__ask_user_question") {
    const rawQuestions: JsonObject[] = isJsonArray(args.questions) ? args.questions.filter(isJsonObject) : []
    const questions: AskUserQuestionItem[] = rawQuestions.map((q) => {
      let question: string
      if (typeof q.question === "string") {
        question = q.question
      } else if (typeof q.text === "string") {
        question = q.text
      } else {
        question = ""
      }
      return {
        id: typeof q.id === "string" ? q.id : undefined,
        question,
        header: typeof q.header === "string" ? q.header : undefined,
        options: isJsonArray(q.options)
          ? q.options.filter(isJsonObject).flatMap((o) => (
            typeof o.label === "string"
              ? [{ label: o.label, description: typeof o.description === "string" ? o.description : undefined }]
              : []
          ))
          : undefined,
        multiSelect: typeof q.multiSelect === "boolean" ? q.multiSelect : false,
      }
    })
    return (
      <AskUserQuestionInteractive
        questions={questions}
        onSubmit={(finalAnswers) =>
          responder.answer({
            kind: "answer",
            payload: encodeAskUserQuestionResult(questions, finalAnswers),
          })
        }
        onCancel={responder.deny}
        submitPending={responder.answering}
        cancelPending={responder.denying}
      />
    )
  }

  if (toolName === "mcp__kanna__exit_plan_mode") {
    const plan = typeof args.plan === "string" ? args.plan : ""
    return (
      <ExitPlanModePending plan={plan} responder={responder} />
    )
  }

  return (
    <GenericPending toolName={toolName} args={args} responder={responder} />
  )
}
