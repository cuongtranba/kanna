import type { StateCreator } from "zustand"
import { createScopedStore } from "../../lib/createScopedStore"
import type { AskUserQuestionAnswerMap } from "../../../shared/types"

export interface AskUserQuestionMessageState {
  submittedAnswers: AskUserQuestionAnswerMap | null
  isSubmitted: boolean
  /** Why the last submit failed, or null. Rendered above the interactive card. */
  submitError: string | null

  /** Record the answers and flip to submitted — one transition, not two writes. */
  markSubmitted: (answers: AskUserQuestionAnswerMap) => void

  /**
   * Undo the optimistic `markSubmitted` after the server rejected the answer.
   *
   * `markSubmitted` flips the card to "Answers" before chat.respondTool has
   * been accepted; without this the card looks answered while the turn is
   * still parked, and the user has no way back. `submittedAnswers` is kept so
   * the restored card can be re-submitted with the same picks.
   */
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
