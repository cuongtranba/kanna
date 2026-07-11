import type { HydratedTranscriptMessage, AskUserQuestionItem } from "../../../shared/types"
import type { ToolRequestDecision } from "../../../shared/permission-policy"
import { Button } from "../ui/button"
import { AskUserQuestionInteractive } from "./AskUserQuestionInteractive"

export type PendingToolRequestHydrated = Extract<HydratedTranscriptMessage, { kind: "pending_tool_request" }>

interface Props {
  entry: PendingToolRequestHydrated
  onAnswer: (toolRequestId: string, decision: ToolRequestDecision) => void
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
        options: Array.isArray(q.options) ? q.options as AskUserQuestionItem["options"] : undefined,
        multiSelect: typeof q.multiSelect === "boolean" ? q.multiSelect : false,
      }
    })
    return (
      <AskUserQuestionInteractive
        questions={questions}
        onSubmit={(finalAnswers) =>
          onAnswer(toolRequestId, {
            kind: "answer",
            payload: { questions, answers: finalAnswers },
          })
        }
        onCancel={() =>
          onAnswer(toolRequestId, { kind: "deny", reason: "user_canceled" })
        }
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
