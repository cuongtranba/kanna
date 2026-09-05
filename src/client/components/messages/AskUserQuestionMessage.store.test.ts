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

  test("markSubmitFailed rolls isSubmitted back and records the error", () => {
    store.getState().markSubmitted(ANSWERS)
    store.getState().markSubmitFailed("No pending tool request")

    expect(store.getState().isSubmitted).toBe(false)
    expect(store.getState().submitError).toBe("No pending tool request")
    expect(store.getState().submittedAnswers).toEqual(ANSWERS)
  })

  test("markSubmitted clears a previous submitError", () => {
    store.getState().markSubmitted(ANSWERS)
    store.getState().markSubmitFailed("boom")
    store.getState().markSubmitted(ANSWERS)

    expect(store.getState().isSubmitted).toBe(true)
    expect(store.getState().submitError).toBeNull()
  })

  test("markSubmitFailed is a no-op when nothing is submitted and the error is unchanged", () => {
    const before = store.getState()
    before.markSubmitFailed(null)

    expect(store.getState()).toBe(before)
  })

  test("seeds submitError as null", () => {
    expect(store.getState().submitError).toBeNull()
  })
})
