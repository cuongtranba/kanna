import { beforeEach, describe, expect, test } from "bun:test"
import { createStore, type StoreApi } from "zustand"
import {
  createExitPlanModeMessageState,
  type ExitPlanModeMessageState,
} from "./ExitPlanModeMessage.store"

describe("ExitPlanModeMessage.store", () => {
  let store: StoreApi<ExitPlanModeMessageState>

  beforeEach(() => {
    store = createStore<ExitPlanModeMessageState>(createExitPlanModeMessageState())
  })

  test("starts collapsed with the edit input closed", () => {
    expect(store.getState().expanded).toBe(false)
    expect(store.getState().showEditInput).toBe(false)
    expect(store.getState().editMessage).toBe("")
  })

  test("cancelEdit closes the input and clears the draft in one transition", () => {
    store.getState().openEdit()
    store.getState().setEditMessage("please use a different approach")
    expect(store.getState().showEditInput).toBe(true)

    store.getState().cancelEdit()

    expect(store.getState().showEditInput).toBe(false)
    expect(store.getState().editMessage).toBe("")
  })

  test("cancelEdit is a no-op when the input is already closed and empty", () => {
    const initial = store.getState()
    initial.cancelEdit()
    expect(store.getState()).toBe(initial)
  })

  test("openEdit shows the input without discarding an existing draft", () => {
    store.getState().setEditMessage("half-written note")
    store.getState().openEdit()

    expect(store.getState().showEditInput).toBe(true)
    expect(store.getState().editMessage).toBe("half-written note")
  })
})
