import { describe, expect, test } from "bun:test"
import { useKannaStateStore } from "./kannaStateStore"

// applyChatOpsEvent, bumpChatResyncNonce, and chatResyncNonce moved to
// chatStateStore. See chatStateStore.test.ts for those tests.

describe("kannaStateStore", () => {
  test("initial state has expected defaults", () => {
    const state = useKannaStateStore.getState()
    expect(state.connectionStatus).toBe("connecting")
    expect(state.sidebarReady).toBe(false)
    expect(state.localProjectsReady).toBe(false)
    expect(state.focusEpoch).toBe(0)
    expect(state.optimisticUserPrompts).toHaveLength(0)
  })

  test("incrementFocusEpoch bumps by 1", () => {
    const before = useKannaStateStore.getState().focusEpoch
    useKannaStateStore.getState().incrementFocusEpoch()
    expect(useKannaStateStore.getState().focusEpoch).toBe(before + 1)
  })
})
