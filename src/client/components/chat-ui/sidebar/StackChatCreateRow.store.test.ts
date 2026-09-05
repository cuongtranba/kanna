import { beforeEach, describe, expect, test } from "bun:test"
import { createStore, type StoreApi } from "zustand"
import {
  createStackChatCreateRowState,
  type StackChatCreateRowState,
} from "./StackChatCreateRow.store"

describe("StackChatCreateRow.store", () => {
  let store: StoreApi<StackChatCreateRowState>

  beforeEach(() => {
    store = createStore<StackChatCreateRowState>(
      createStackChatCreateRowState({
        initialPrimaryProjectId: "proj-a",
        initialSelectedWorktrees: new Map([["proj-a", "/wt/a-main"]]),
      }),
    )
  })

  test("seeds from init", () => {
    expect(store.getState().primaryProjectId).toBe("proj-a")
    expect(store.getState().selectedWorktrees.get("proj-a")).toBe("/wt/a-main")
    expect(store.getState().isSubmitting).toBe(false)
    expect(store.getState().errorMessage).toBeNull()
  })

  test("selectWorktree replaces one project's entry and leaves the others alone", () => {
    store.getState().selectWorktree("proj-b", "/wt/b-feature")
    store.getState().selectWorktree("proj-a", "/wt/a-feature")

    expect(store.getState().selectedWorktrees.get("proj-a")).toBe("/wt/a-feature")
    expect(store.getState().selectedWorktrees.get("proj-b")).toBe("/wt/b-feature")
    expect(store.getState().selectedWorktrees.size).toBe(2)
  })

  test("selectWorktree produces a new Map so selectors see the change", () => {
    const before = store.getState().selectedWorktrees
    store.getState().selectWorktree("proj-a", "/wt/a-feature")
    expect(store.getState().selectedWorktrees).not.toBe(before)
    expect(before.get("proj-a")).toBe("/wt/a-main")
  })

  test("selecting the already-selected worktree is a no-op", () => {
    const initial = store.getState()
    initial.selectWorktree("proj-a", "/wt/a-main")
    expect(store.getState()).toBe(initial)
  })
})
