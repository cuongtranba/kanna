import { useCallback } from "react"
import { MessageCircleQuestion } from "lucide-react"
import type { ProcessedToolCall, AskUserQuestionItem } from "./types"
import type { AskUserQuestionAnswerMap } from "../../../shared/types"
import { errorMessage } from "../../../shared/errors"
import { cn } from "../../lib/utils"
import { useTranscriptRenderOptions } from "./render-context"
import { AskUserQuestionInteractive } from "./AskUserQuestionInteractive"
import { AskUserQuestionMessageStore } from "./AskUserQuestionMessage.store"

interface Props {
  message: Extract<ProcessedToolCall, { toolKind: "ask_user_question" }>
  /**
   * Returns a promise on the live chat path (chat.respondTool) so a rejected
   * submit can roll the optimistic card back. Widened — not narrowed to
   * Promise<void> — so existing `() => undefined` callers still type-check.
   */
  onSubmit: (toolUseId: string, questions: AskUserQuestionItem[], answers: AskUserQuestionAnswerMap) => void | Promise<void>
  isLatest: boolean
}

function parseAnswersFromResult(
  result: Extract<ProcessedToolCall, { toolKind: "ask_user_question" }>["result"]
): AskUserQuestionAnswerMap | undefined {
  return result?.answers
}

function getQuestionKey(question: AskUserQuestionItem): string {
  return question.id || question.question
}

function AskUserQuestionMessageInner({ message, onSubmit, isLatest }: Props) {
  const renderOptions = useTranscriptRenderOptions()
  const questions = message.input.questions
  const isComplete = Boolean(message.result)
  const savedAnswers = parseAnswersFromResult(message.result)
  const isDiscarded = message.result?.discarded === true

  const submittedAnswers = AskUserQuestionMessageStore.useScopedStore((s) => s.submittedAnswers)
  const isSubmitted = AskUserQuestionMessageStore.useScopedStore((s) => s.isSubmitted)
  const markSubmitted = AskUserQuestionMessageStore.useScopedStore((s) => s.markSubmitted)
  const markSubmitFailed = AskUserQuestionMessageStore.useScopedStore((s) => s.markSubmitFailed)
  const submitError = AskUserQuestionMessageStore.useScopedStore((s) => s.submitError)

  // Orchestration over a prop + async I/O, so it stays an extracted useCallback
  // rather than moving into the store (rule-zustand-store / no-jsx-inline-state-logic).
  const handleSubmit = useCallback((finalAnswers: AskUserQuestionAnswerMap) => {
    markSubmitted(finalAnswers)
    try {
      const settled = onSubmit(message.toolId, questions, finalAnswers)
      if (settled && typeof settled.then === "function") {
        void settled.catch((error) => { markSubmitFailed(errorMessage(error)) })
      }
    } catch (error) {
      markSubmitFailed(errorMessage(error))
    }
  }, [markSubmitted, markSubmitFailed, onSubmit, message.toolId, questions])

  // Completed state
  if (isSubmitted || isComplete) {
    const displayAnswers = savedAnswers || submittedAnswers || {}

    return (
      <div className="w-full">
        <div className="rounded-2xl border border-border overflow-hidden">
          <div className="font-medium text-sm p-3 px-4 pr-5 bg-muted  border-b border-border flex flex-row items-center justify-between">
            <p>Question{questions.length !== 1 ? "s" : ""}</p>
            <p className="">{isDiscarded ? "Discarded" : "Answers"}</p>
          </div>
          {questions.map((question, index) => {
            const answerValue = displayAnswers[getQuestionKey(question)] || displayAnswers[question.question] || []
            const isLast = index === questions.length - 1
            const selectedDescriptions = question.options
              ? answerValue
                .map((label) => question.options?.find((option) => option.label === label)?.description)
                .filter((value): value is string => Boolean(value))
              : []

            return (
              <div
                key={getQuestionKey(question)}
                className={cn(
                  "w-full p-3 pt-2.5 pl-4 pr-5 bg-background flex items-start justify-between gap-3",
                  !isLast && "border-b border-border"
                )}
              >
                <div className="flex-1 min-w-0">
                  {question.header && (
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground text-pretty">{question.header}</div>
                  )}
                  <div className="text-sm text-pretty">{question.question}</div>
                </div>
                <div className="max-w-[50%] text-right">
                  {answerValue.length > 0 ? (
                    <>
                      <div className="text-sm font-medium text-pretty">{answerValue.join(", ")}</div>
                      {selectedDescriptions.length > 0 && (
                        <div className="text-xs text-muted-foreground mt-0.5 text-pretty">{selectedDescriptions.join(" · ")}</div>
                      )}
                    </>
                  ) : (
                    <div className="text-sm font-medium italic">
                      {isDiscarded ? "Discarded" : "No Response"}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  if (renderOptions.readonly) {
    return (
      <div className="w-full">
        <div className="rounded-2xl border border-border overflow-hidden">
          <div className="font-medium text-sm p-3 px-4 pr-5 bg-muted border-b border-border flex flex-row items-center justify-between gap-3">
            <p>Question{questions.length !== 1 ? "s" : ""}</p>
            <p className="text-muted-foreground">Awaiting response</p>
          </div>
          {questions.map((question, index) => (
            <div
              key={getQuestionKey(question)}
              className={cn(
                "w-full p-3 pt-2.5 pl-4 pr-5 bg-background flex items-start justify-between gap-3",
                index < questions.length - 1 && "border-b border-border",
              )}
            >
              <div className="flex-1 min-w-0">
                {question.header && (
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground text-pretty">{question.header}</div>
                )}
                <div className="text-sm text-pretty">{question.question}</div>
              </div>
              <div className="max-w-[50%] text-right text-xs text-muted-foreground text-pretty">
                {question.options?.map((option) => option.label).join(", ") || "Freeform response"}
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  // Pending state (not latest)
  if (!isLatest) {
    return (
      <div className="w-full py-2">
        <div className="flex items-center gap-2">
          <MessageCircleQuestion className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Questions pending (newer question active)</span>
        </div>
      </div>
    )
  }

  // Active state — delegate to AskUserQuestionInteractive
  return (
    <div className="w-full">
      {submitError ? (
        <div
          className="mb-2 rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive whitespace-pre-wrap"
          data-testid={`ask-user-question-error:${message.toolId}`}
        >
          {submitError}
        </div>
      ) : null}
      <AskUserQuestionInteractive
        questions={questions}
        onSubmit={handleSubmit}
      />
    </div>
  )
}

export function AskUserQuestionMessage({ message, onSubmit, isLatest }: Props) {
  const savedAnswers = parseAnswersFromResult(message.result) ?? null
  const isComplete = Boolean(message.result)
  return (
    <AskUserQuestionMessageStore.Provider init={{ savedAnswers, isComplete }}>
      <AskUserQuestionMessageInner message={message} onSubmit={onSubmit} isLatest={isLatest} />
    </AskUserQuestionMessageStore.Provider>
  )
}
