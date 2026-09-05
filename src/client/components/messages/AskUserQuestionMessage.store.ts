import type { StateCreator } from "zustand"
import { createScopedStore } from "../../lib/createScopedStore"
import type { AskUserQuestionAnswerMap } from "../../../shared/types"

export interface AskUserQuestionMessageState {
  submittedAnswers: AskUserQuestionAnswerMap | null
  isSubmitted: boolean
  submitError: string | null

  markSubmitted: (answers: AskUserQuestionAnswerMap) => void

  markSubmitFailed: (error: string | null) => void
}

export interface AskUserQuestionMessageInit {
  savedAnswers: AskUserQuestionAnswerMap | null
  isComplete: boolean
}

export function createAskUserQuestionMessageState(
  { savedAnswers, isComplete }: AskUserQuestionMessageInit,
): StateCreator<AskUserQuestionMessageState> {
  return (set) => ({
    submittedAnswers: savedAnswers ?? null,
    isSubmitted: isComplete,
    submitError: null,

    markSubmitted: (answers) => set({ submittedAnswers: answers, isSubmitted: true, submitError: null }),

    markSubmitFailed: (error) => set((state) => (
      state.isSubmitted || state.submitError !== error
        ? { isSubmitted: false, submitError: error }
        : state
    )),
  })
}

export const AskUserQuestionMessageStore = createScopedStore<
  AskUserQuestionMessageInit,
  AskUserQuestionMessageState
>(
  "AskUserQuestionMessage",
  createAskUserQuestionMessageState,
)
