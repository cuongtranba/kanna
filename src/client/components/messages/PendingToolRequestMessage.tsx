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
  args,
  onAnswer,
}: {
  toolRequestId: string
  toolName: string
  args: Record<string, unknown>
  onAnswer: (toolRequestId: string, decision: ToolRequestDecision) => void
}) {
  // Short, single-line preview of the most descriptive arg so the user can
  // tell what they're approving without expanding raw JSON. Falls back to
  // the JSON itself for tools we don't have a curated key for.
  const previewKey = (["command", "path", "url", "pattern", "query"] as const).find(
    (k) => typeof args[k] === "string" && (args[k] as string).length > 0,
  )
  const preview = previewKey
    ? (args[previewKey] as string)
    : JSON.stringify(args)
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
          onClick={() => onAnswer(toolRequestId, { kind: "deny", reason: "user_canceled" })}
        >
          Deny
        </Button>
        <Button
          variant="default"
          size="sm"
          onClick={() => onAnswer(toolRequestId, { kind: "allow" })}
        >
          Allow
        </Button>
      </div>
    </div>
  )
}

// ── public component ─────────────────────────────────────────────────────────

export function PendingToolRequestMessage({ entry, onAnswer }: Props) {
  const { toolRequestId, toolName, arguments: args } = entry

  if (toolName === "mcp__kanna__ask_user_question") {
    // MCP shim args use `text` field per its zod schema; AskUserQuestionItem
    // uses `question` (matches the SDK native AskUserQuestion shape). Map
    // here so getKey()/answer keys use the question body, not "undefined".
    const rawQuestions = Array.isArray(args.questions) ? args.questions as Record<string, unknown>[] : []
    const questions: AskUserQuestionItem[] = rawQuestions.map((q) => ({
      id: typeof q.id === "string" ? q.id : undefined,
      question: typeof q.question === "string"
        ? q.question
        : typeof q.text === "string" ? q.text : "",
      header: typeof q.header === "string" ? q.header : undefined,
      options: Array.isArray(q.options) ? q.options as AskUserQuestionItem["options"] : undefined,
      multiSelect: typeof q.multiSelect === "boolean" ? q.multiSelect : false,
    }))
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
      args={args}
      onAnswer={onAnswer}
    />
  )
}
