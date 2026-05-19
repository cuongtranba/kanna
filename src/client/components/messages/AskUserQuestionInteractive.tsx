import { Check, ChevronLeft } from "lucide-react"
import type { AskUserQuestionAnswerMap, AskUserQuestionItem, AskUserQuestionOption } from "../../../shared/types"
import { cn } from "../../lib/utils"

// ─── QuestionCard, OptionContent, Checkbox, OptionRow — copied verbatim from
// AskUserQuestionMessage.tsx lines 17–138 ────────────────────────────────────

function _QuestionCard({
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

function _OptionRow({
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

export interface AskUserQuestionInteractiveProps {
  questions: AskUserQuestionItem[]
  onSubmit: (answers: AskUserQuestionAnswerMap) => void
  onCancel?: () => void
}

export function AskUserQuestionInteractive(
  { questions }: AskUserQuestionInteractiveProps,
): React.ReactElement | null {
  if (questions.length === 0) return null
  // ... slide UI rebuilt in Task 3 ...
  const first = questions[0]!
  return (
    <div className="w-full">
      <h3 className="text-sm">{first.question}</h3>
      <ul>
        {(first.options ?? []).map((opt) => (
          <li key={opt.label}>{opt.label}</li>
        ))}
      </ul>
    </div>
  )
}
