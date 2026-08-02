import { beforeEach, describe, expect, test } from "bun:test"
import { createStore, type StoreApi } from "zustand"
import {
  createAskUserQuestionMessageState,
  type AskUserQuestionMessageState,
} from "./AskUserQuestionMessage.store"
import type { AskUserQuestionAnswerMap } from "../../../shared/types"

const ANSWERS: AskUserQuestionAnswerMap = { "q-1": ["yes"] }

function makeStore(init: { savedAnswers: AskUserQuestionAnswerMap | null; isComplete: boolean }) {
  return createStore<AskUserQuestionMessageState>(createAskUserQuestionMessageState(init))
}

describe("AskUserQuestionMessage.store", () => {
  let store: StoreApi<AskUserQuestionMessageState>

  beforeEach(() => {
    store = makeStore({ savedAnswers: null, isComplete: false })
  })

  test("seeds from init: a pending question starts unsubmitted with no answers", () => {
    expect(store.getState().submittedAnswers).toBeNull()
    expect(store.getState().isSubmitted).toBe(false)
  })

  test("seeds from init: an already-complete question starts submitted with its saved answers", () => {
    const seeded = makeStore({ savedAnswers: ANSWERS, isComplete: true })
    expect(seeded.getState().submittedAnswers).toEqual(ANSWERS)
    expect(seeded.getState().isSubmitted).toBe(true)
  })

  test("markSubmitted records the answers and flips isSubmitted in one transition", () => {
    store.getState().markSubmitted(ANSWERS)

    expect(store.getState().submittedAnswers).toEqual(ANSWERS)
    expect(store.getState().isSubmitted).toBe(true)
  })

  test("markSubmitted is idempotent for the same answers", () => {
    store.getState().markSubmitted(ANSWERS)
    const afterFirst = store.getState()
    afterFirst.markSubmitted(ANSWERS)

    expect(store.getState().submittedAnswers).toEqual(ANSWERS)
    expect(store.getState().isSubmitted).toBe(true)
  })
})
