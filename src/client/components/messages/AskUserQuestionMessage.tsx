import { useState } from "react"
import { Check, ChevronLeft, MessageCircleQuestion } from "lucide-react"
import type { ProcessedToolCall, AskUserQuestionItem, AskUserQuestionOption } from "./types"
import type { AskUserQuestionAnswerMap } from "../../../shared/types"
import { Button } from "../ui/button"
import { cn } from "../../lib/utils"

interface Props {
  message: Extract<ProcessedToolCall, { toolKind: "ask_user_question" }>
  onSubmit: (toolUseId: string, questions: AskUserQuestionItem[], answers: AskUserQuestionAnswerMap) => void
  isLatest: boolean
}

// Local components for DRY

function QuestionCard({
  question,
  currentIndex,
  totalQuestions,
  onBack,
  children
}: {
  question: string
  currentIndex: number
  totalQuestions: number
  onBack?: () => void
  children: React.ReactNode
}) {
  const showBackButton = onBack && currentIndex > 0

  return (
    <div className="rounded-2xl border border-border overflow-hidden">
      <div className="relative">
        <h3 className="font-medium text-foreground text-sm p-3 px-4 bg-card border-b border-border text-foreground flex flex-row items-center gap-2">
          {showBackButton ? (
            <button
              onClick={onBack}
              className=" text-muted-foreground hover:opacity-60 transition-all flex items-center"
            >
              <ChevronLeft className="h-4 w-4 -ml-0.5" strokeWidth={3} />
            </button>
          ) : totalQuestions > 1 ? (
            <span className="font-bold text-muted-foreground whitespace-nowrap">{currentIndex + 1} of {totalQuestions}</span>
          ) : null}
          {question}
        </h3>
        {/* Progress bar */}
        {totalQuestions > 1 && (
          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-border">
            <div
              className="h-full bg-muted-foreground/40 transition-all duration-300"
              style={{ width: `${(currentIndex / (totalQuestions)) * 100}%` }}
            />
          </div>
        )}
      </div>
      {children}
    </div>
  )
}

function OptionContent({ label, description }: { label: string; description?: string }) {
  return (
    <>
      <span className="text-foreground text-sm">{label}</span>
      {description && (
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      )}
    </>
  )
}

function Checkbox({
  selected,
  multiSelect,
  onClick
}: {
  selected: boolean
  multiSelect?: boolean
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex-shrink-0 w-5 h-5 border-1 flex items-center justify-center",
        multiSelect ? "rounded" : "rounded-full",
        selected
          ? "border-transparent bg-foreground"
          : "border-muted-foreground/50 bg-background",
        onClick && selected && "cursor-pointer"
      )}
    >
      {selected && <Check strokeWidth={3} className="translate-y-[0.5px] h-3 w-3 text-white dark:text-background" />}
    </button>
  )
}

function OptionRow({
  option,
  selected,
  multiSelect,
  onClick,
  isLast
}: {
  option: AskUserQuestionOption
  selected: boolean
  multiSelect?: boolean
  onClick?: () => void
  isLast?: boolean
}) {
  const baseClasses = "w-full text-left p-3 pt-2.5 pl-4 pr-5 bg-background"
  const borderClass = !isLast ? "border-b border-border" : ""

  if (onClick) {
    return (
      <button
        onClick={onClick}
        className={cn(baseClasses, borderClass, "transition-all cursor-pointer")}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex-1 min-w-0">
            <OptionContent label={option.label} description={option.description} />
          </div>
          <Checkbox selected={selected} multiSelect={multiSelect} />
        </div>
      </button>
    )
  }

  return (
    <div className={cn(baseClasses, borderClass)}>
      <OptionContent label={option.label} description={option.description} />
    </div>
  )
}

function parseAnswersFromResult(
  result: Extract<ProcessedToolCall, { toolKind: "ask_user_question" }>["result"]
): AskUserQuestionAnswerMap | undefined {
  return result?.answers
}

function getQuestionKey(question: AskUserQuestionItem): string {
  return question.id || question.question
}

export function AskUserQuestionMessage({ message, onSubmit, isLatest }: Props) {
  const questions = message.input.questions
  const isComplete = !!message.result
  const savedAnswers = parseAnswersFromResult(message.result)
  const isDiscarded = message.result?.discarded === true

  const [currentIndex, setCurrentIndex] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [customInputs, setCustomInputs] = useState<Record<string, string>>({})
  const [submittedAnswers, setSubmittedAnswers] = useState<AskUserQuestionAnswerMap | null>(savedAnswers ?? null)
  const [isSubmitted, setIsSubmitted] = useState(isComplete)

  const getEffectiveAnswers = (questionKey: string, question?: AskUserQuestionItem) => {
    const custom = customInputs[questionKey]?.trim()
    const selectedAnswer = answers[questionKey] || ""
    const q = question || questions.find((candidate) => getQuestionKey(candidate) === questionKey)

    if (q?.multiSelect) {
      return [selectedAnswer, custom]
        .filter(Boolean)
        .flatMap((value) => value.split(", ").filter(Boolean))
    }

    const value = custom || selectedAnswer
    return value ? [value] : []
  }

  const getSelectedOptions = (question: AskUserQuestionItem) => {
    const answer = answers[getQuestionKey(question)] || ""
    return question.multiSelect
      ? answer.split(", ").filter(Boolean)
      : [answer]
  }

  const handleOptionSelect = (question: AskUserQuestionItem, label: string) => {
    const key = getQuestionKey(question)

    if (question.multiSelect) {
      const current = answers[key] ? answers[key].split(", ").filter(Boolean) : []
      const newSelection = current.includes(label)
        ? current.filter((o) => o !== label)
        : [...current, label]
      setAnswers({ ...answers, [key]: newSelection.join(", ") })
    } else {
      setAnswers({ ...answers, [key]: label })
      setCustomInputs({ ...customInputs, [key]: "" })
      // Auto-advance to next question for single select
      if (currentIndex < questions.length - 1) {
        setTimeout(() => setCurrentIndex(currentIndex + 1), 150)
      }
    }
  }

  const handleCustomInputChange = (question: AskUserQuestionItem, value: string) => {
    const key = getQuestionKey(question)
    setCustomInputs({ ...customInputs, [key]: value })
    if (value && !question.multiSelect) {
      setAnswers({ ...answers, [key]: "" })
    }
  }

  const clearCustomInput = (question: AskUserQuestionItem) => {
    const key = getQuestionKey(question)
    if (question.multiSelect && customInputs[key]) {
      setCustomInputs({ ...customInputs, [key]: "" })
    }
  }

  const allQuestionsAnswered = questions.every((question) => getEffectiveAnswers(getQuestionKey(question), question).length > 0)
  const currentQuestion = questions[currentIndex]
  const isLastQuestion = currentIndex === questions.length - 1
  const currentHasAnswer = currentQuestion
    && getEffectiveAnswers(getQuestionKey(currentQuestion), currentQuestion).length > 0

  const handleNext = () => {
    if (currentIndex < questions.length - 1) {
      setCurrentIndex(currentIndex + 1)
    }
  }

  const handleBack = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1)
    }
  }

  const handleSubmit = () => {
    if (!allQuestionsAnswered) return

    const finalAnswers: AskUserQuestionAnswerMap = {}
    for (const q of questions) {
      const key = getQuestionKey(q)
      finalAnswers[key] = getEffectiveAnswers(key, q)
    }
    setSubmittedAnswers(finalAnswers)
    setIsSubmitted(true)
    onSubmit(message.toolId, questions, finalAnswers)
  }

  const handleCustomInputEnter = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return
    if (!currentQuestion || !currentHasAnswer) return

    event.preventDefault()

    if (isLastQuestion) {
      handleSubmit()
      return
    }

    handleNext()
  }

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

            return (
              <div
                key={getQuestionKey(question)}
                className={cn(
                  "w-full p-3 pt-2.5 pl-4 pr-5 bg-background flex items-center justify-between gap-3",
                  !isLast && "border-b border-border"
                )}
              >
                <div className="text-sm text-pretty">{question.question}</div>
                {answerValue.length > 0 && <div className="text-sm font-medium text-right max-w-[50%] text-pretty">{answerValue.join(", ")}</div>}
                {answerValue.length === 0 && (
                  <div className="text-sm font-medium text-right italic">
                    {isDiscarded ? "Discarded" : "No Response"}
                  </div>
                )}
              </div>
            )
          })}
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

  // Active state - show one question at a time
  if (!currentQuestion) return null

  const selectedOptions = getSelectedOptions(currentQuestion)
  const customInput = customInputs[getQuestionKey(currentQuestion)] || ""

  return (
    <div className="w-full space-y-3">
      <QuestionCard
        question={currentQuestion.question}
        currentIndex={currentIndex}
        totalQuestions={questions.length}
        onBack={currentIndex > 0 ? handleBack : undefined}
      >
        {currentQuestion.options?.map((option) => (
          <OptionRow
            key={option.label}
            option={option}
            selected={selectedOptions.includes(option.label)}
            multiSelect={currentQuestion.multiSelect}
            onClick={() => handleOptionSelect(currentQuestion, option.label)}
          />
        ))}

        {/* Custom input */}
        <div className="transition-all bg-background">
          <div className="flex pr-5 items-center justify-between gap-3">
            <input
              type="text"
              value={customInput}
              onChange={(e) => handleCustomInputChange(currentQuestion, e.target.value)}
              onKeyDown={handleCustomInputEnter}
              placeholder="Other..."
              className="flex-1 px-3 !py-1 pl-4 min-h-[55px] min-w-0 text-sm bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-md text-foreground placeholder:text-muted-foreground"
            />
            <Checkbox
              selected={!!customInput}
              multiSelect={currentQuestion.multiSelect}
              onClick={currentQuestion.multiSelect && customInput ? () => clearCustomInput(currentQuestion) : undefined}
            />
          </div>
        </div>
      </QuestionCard>

      <div className="flex justify-end gap-2 mx-2">
        {!isLastQuestion && currentHasAnswer && (currentQuestion.multiSelect || !!customInput) && (
          <Button size="sm" onClick={handleNext}>
            Next
          </Button>
        )}
        {isLastQuestion && (
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={!allQuestionsAnswered}
            className={cn(!allQuestionsAnswered && "opacity-50 cursor-not-allowed", "rounded-full")}
          >
            Submit
          </Button>
        )}
      </div>
    </div>
  )
}
