import { describe, expect, test } from "vite-plus/test"
import { createEmptyState, resetStoreState } from "./events"

describe("resetStoreState", () => {
  test("clears every map and replaces the sidebar order instead of truncating the held array", () => {
    const state = createEmptyState()
    const heldOrder = ["p1", "p2"]
    state.sidebarProjectOrder = heldOrder
    state.chatTasksByChatId.set("c1", [])

    resetStoreState(state)

    expect(state.sidebarProjectOrder).toEqual([])
    expect(state.sidebarProjectOrder).not.toBe(heldOrder)
    expect(heldOrder).toEqual(["p1", "p2"])
    expect(state.chatTasksByChatId.size).toBe(0)
  })
})
