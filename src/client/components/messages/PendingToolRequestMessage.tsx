import { useState } from "react"
import type { HydratedTranscriptMessage, AskUserQuestionItem, AskUserQuestionAnswerMap } from "../../../shared/types"
import type { ToolRequestDecision } from "../../../shared/permission-policy"
import { Button } from "../ui/button"

export type PendingToolRequestHydrated = Extract<HydratedTranscriptMessage, { kind: "pending_tool_request" }>

interface Props {
  entry: PendingToolRequestHydrated
  onAnswer: (toolRequestId: string, decision: ToolRequestDecision) => void
}

// ── ask_user_question ────────────────────────────────────────────────────────

function AskUserQuestionPending({
  toolRequestId,
  questions,
  onAnswer,
}: {
  toolRequestId: string
  questions: AskUserQuestionItem[]
  onAnswer: (toolRequestId: string, decision: ToolRequestDecision) => void
}) {
  const [answers, setAnswers] = useState<AskUserQuestionAnswerMap>({})

  function getKey(q: AskUserQuestionItem): string {
    return q.id ?? q.question
  }

  function handleOptionClick(question: AskUserQuestionItem, label: string) {
    const key = getKey(question)
    if (question.multiSelect) {
      setAnswers((prev) => {
        const current = prev[key] ?? []
        const next = current.includes(label) ? current.filter((s) => s !== label) : [...current, label]
        return { ...prev, [key]: next }
      })
    } else {
      setAnswers((prev) => ({ ...prev, [key]: [label] }))
    }
  }

  function handleSubmit() {
    const finalAnswers: AskUserQuestionAnswerMap = {}
    for (const q of questions) {
      const key = getKey(q)
      finalAnswers[key] = answers[key] ?? []
    }
    onAnswer(toolRequestId, { kind: "answer", payload: { questions, answers: finalAnswers } })
  }

  const allAnswered = questions.every((q) => {
    const key = getKey(q)
    return (answers[key]?.length ?? 0) > 0
  })

  return (
    <div className="rounded-2xl border border-border overflow-hidden">
      <div className="font-medium text-sm p-3 px-4 bg-muted border-b border-border flex items-center justify-between">
        <span>Question{questions.length !== 1 ? "s" : ""}</span>
        <span className="text-xs text-muted-foreground">Reconnected — awaiting your response</span>
      </div>
      {questions.map((question, qi) => {
        const key = getKey(question)
        const selectedLabels = answers[key] ?? []
        const isLast = qi === questions.length - 1
        return (
          <div
            key={key}
            className={`bg-background px-4 py-3 ${!isLast ? "border-b border-border" : ""}`}
          >
            <p className="text-sm font-medium mb-2">{question.question}</p>
            {question.options && question.options.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {question.options.map((opt) => (
                  <button
                    key={opt.label}
                    onClick={() => handleOptionClick(question, opt.label)}
                    className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                      selectedLabels.includes(opt.label)
                        ? "border-foreground bg-foreground text-background"
                        : "border-border bg-background text-foreground hover:bg-muted"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            ) : (
              <input
                type="text"
                className="w-full rounded-md border border-border bg-muted px-3 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="Type your answer..."
                value={answers[key]?.[0] ?? ""}
                onChange={(e) => {
                  const val = e.target.value
                  setAnswers((prev) => ({ ...prev, [key]: val ? [val] : [] }))
                }}
              />
            )}
          </div>
        )
      })}
      <div className="flex justify-end gap-2 px-4 py-3 bg-background border-t border-border">
        <Button
          size="sm"
          variant="outline"
          className="rounded-full"
          onClick={() => onAnswer(toolRequestId, { kind: "deny", reason: "user_canceled" })}
        >
          Cancel
        </Button>
        <Button
          size="sm"
          className="rounded-full"
          disabled={!allAnswered}
          onClick={handleSubmit}
        >
          Submit
        </Button>
      </div>
    </div>
  )
}

// ── exit_plan_mode ───────────────────────────────────────────────────────────

function ExitPlanModePending({
  toolRequestId,
  plan,
  onAnswer,
}: {
  toolRequestId: string
  plan: string
  onAnswer: (toolRequestId: string, decision: ToolRequestDecision) => void
}) {
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
          onClick={() => onAnswer(toolRequestId, { kind: "deny", reason: "user_canceled" })}
        >
          Edit
        </Button>
        <Button
          size="sm"
          className="rounded-full"
          onClick={() => onAnswer(toolRequestId, { kind: "answer", payload: { confirmed: true } })}
        >
          Confirm
        </Button>
      </div>
    </div>
  )
}

// ── generic fallback ─────────────────────────────────────────────────────────

function GenericPending({
  toolRequestId,
  toolName,
  onAnswer,
}: {
  toolRequestId: string
  toolName: string
  onAnswer: (toolRequestId: string, decision: ToolRequestDecision) => void
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-border bg-background px-4 py-3 text-sm">
      <span className="text-muted-foreground flex-1">
        Pending tool: <span className="font-mono text-foreground">{toolName}</span>
      </span>
      <button
        className="text-xs text-muted-foreground underline hover:text-foreground transition-colors"
        onClick={() => onAnswer(toolRequestId, { kind: "deny", reason: "user_canceled" })}
      >
        Cancel
      </button>
    </div>
  )
}

// ── public component ─────────────────────────────────────────────────────────

export function PendingToolRequestMessage({ entry, onAnswer }: Props) {
  const { toolRequestId, toolName, arguments: args } = entry

  if (toolName === "mcp__kanna__ask_user_question") {
    const questions = (args.questions as AskUserQuestionItem[] | undefined) ?? []
    return (
      <AskUserQuestionPending
        toolRequestId={toolRequestId}
        questions={questions}
        onAnswer={onAnswer}
      />
    )
  }

  if (toolName === "mcp__kanna__exit_plan_mode") {
    const plan = typeof args.plan === "string" ? args.plan : ""
    return (
      <ExitPlanModePending
        toolRequestId={toolRequestId}
        plan={plan}
        onAnswer={onAnswer}
      />
    )
  }

  return (
    <GenericPending
      toolRequestId={toolRequestId}
      toolName={toolName}
      onAnswer={onAnswer}
    />
  )
}
