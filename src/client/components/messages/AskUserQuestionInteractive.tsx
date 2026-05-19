import type { AskUserQuestionAnswerMap, AskUserQuestionItem } from "../../../shared/types"

export interface AskUserQuestionInteractiveProps {
  questions: AskUserQuestionItem[]
  onSubmit: (answers: AskUserQuestionAnswerMap) => void
  onCancel?: () => void
}

export function AskUserQuestionInteractive(
  { questions }: AskUserQuestionInteractiveProps,
): React.ReactElement | null {
  if (questions.length === 0) return null
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
