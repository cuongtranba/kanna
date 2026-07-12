import { createScopedStore } from "../../lib/createScopedStore"
import type { AskUserQuestionAnswerMap } from "../../../shared/types"

interface AskUserQuestionMessageState {
  submittedAnswers: AskUserQuestionAnswerMap | null
  isSubmitted: boolean
  setSubmittedAnswers: (submittedAnswers: AskUserQuestionAnswerMap | null) => void
  setIsSubmitted: (isSubmitted: boolean) => void
}

interface AskUserQuestionMessageInit {
  savedAnswers: AskUserQuestionAnswerMap | null
  isComplete: boolean
}

export const AskUserQuestionMessageStore = createScopedStore<
  AskUserQuestionMessageInit,
  AskUserQuestionMessageState
>(
  "AskUserQuestionMessage",
  ({ savedAnswers, isComplete }) =>
    (set) => ({
      submittedAnswers: savedAnswers ?? null,
      isSubmitted: isComplete,
      setSubmittedAnswers: (submittedAnswers) => set({ submittedAnswers }),
      setIsSubmitted: (isSubmitted) => set({ isSubmitted }),
    }),
)
