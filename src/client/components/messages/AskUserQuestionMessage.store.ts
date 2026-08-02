import type { StateCreator } from "zustand"
import { createScopedStore } from "../../lib/createScopedStore"
import type { AskUserQuestionAnswerMap } from "../../../shared/types"

export interface AskUserQuestionMessageState {
  submittedAnswers: AskUserQuestionAnswerMap | null
  isSubmitted: boolean

  /** Record the answers and flip to submitted — one transition, not two writes. */
  markSubmitted: (answers: AskUserQuestionAnswerMap) => void
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

    markSubmitted: (answers) => set({ submittedAnswers: answers, isSubmitted: true }),
  })
}

export const AskUserQuestionMessageStore = createScopedStore<
  AskUserQuestionMessageInit,
  AskUserQuestionMessageState
>(
  "AskUserQuestionMessage",
  createAskUserQuestionMessageState,
)
