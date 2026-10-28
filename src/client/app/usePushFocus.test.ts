import { describe, expect, test } from "vite-plus/test"
import type { ClientCommand } from "../../shared/protocol"
import { applyPushFocus, resolveFocusedChatId } from "./usePushFocus"

describe("resolveFocusedChatId", () => {
  test("returns the active chat id when the document is visible", () => {
    expect(
      resolveFocusedChatId({ activeChatId: "chat-1", visibilityState: "visible" }),
    ).toBe("chat-1")
  })

  test("returns null when the document is hidden so push notifications resume", () => {
    expect(
      resolveFocusedChatId({ activeChatId: "chat-1", visibilityState: "hidden" }),
    ).toBeNull()
  })

  test("returns null when there is no active chat even if the tab is visible", () => {
    expect(
      resolveFocusedChatId({ activeChatId: null, visibilityState: "visible" }),
    ).toBeNull()
  })
})

describe("applyPushFocus", () => {
  test("forwards the resolved focused chat id to the socket", () => {
    const calls: Array<string | null> = []
    const socket = {
      notify: (command: ClientCommand) => {
        if (command.type === "push.setFocusedChat") calls.push(command.chatId)
      },
    }

    applyPushFocus({ socket, activeChatId: "chat-1", visibilityState: "visible" })
    applyPushFocus({ socket, activeChatId: "chat-1", visibilityState: "hidden" })

    expect(calls).toEqual(["chat-1", null])
  })
})
