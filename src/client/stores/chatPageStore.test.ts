import { beforeEach, describe, expect, test } from "bun:test"
import { useChatPageStore } from "./chatPageStore"
import type { OpenLocalLinkTarget } from "../components/messages/shared"

const TARGET = { path: "/repo/src/index.ts" } as unknown as OpenLocalLinkTarget

describe("chatPageStore — local link context menu", () => {
  beforeEach(() => {
    useChatPageStore.setState({ localLinkMenuTarget: null })
  })

  test("setLocalLinkMenuOpen(false) clears the menu target", () => {
    useChatPageStore.getState().setLocalLinkMenuTarget(TARGET)
    expect(useChatPageStore.getState().localLinkMenuTarget).toBe(TARGET)

    useChatPageStore.getState().setLocalLinkMenuOpen(false)

    expect(useChatPageStore.getState().localLinkMenuTarget).toBeNull()
  })

  test("setLocalLinkMenuOpen(true) leaves the target alone", () => {
    useChatPageStore.getState().setLocalLinkMenuTarget(TARGET)

    useChatPageStore.getState().setLocalLinkMenuOpen(true)

    expect(useChatPageStore.getState().localLinkMenuTarget).toBe(TARGET)
  })

  test("closing an already-closed menu is a no-op", () => {
    const before = useChatPageStore.getState()
    before.setLocalLinkMenuOpen(false)
    expect(useChatPageStore.getState().localLinkMenuTarget).toBeNull()
  })
})
