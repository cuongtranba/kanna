import { describe, expect, test } from "vite-plus/test"
import type { SidebarData } from "../../shared/types"
import type { ChatNavigatorPort } from "./chatNavigator"
import { getNewestRemainingChatId, leaveRemovedChats } from "./chatLifecycle"

type SidebarGroup = SidebarData["projectGroups"][number]
type SidebarChat = SidebarGroup["chats"][number]

function makeProjectGroup(groupKey: string, chatIds: string[] = []): SidebarGroup {
  return {
    groupKey,
    localPath: `/projects/${groupKey}`,
    chats: chatIds.map((chatId) => ({ chatId } as unknown as SidebarChat)),
    previewChats: [],
    olderChats: [],
    defaultCollapsed: false,
  }
}

describe("getNewestRemainingChatId", () => {
  test("returns null when activeChatId not found in any group", () => {
    const groups = [makeProjectGroup("p", ["a", "b"])]
    expect(getNewestRemainingChatId(groups, "x")).toBeNull()
  })

  test("returns the next chat in the group when available", () => {
    const groups = [makeProjectGroup("p", ["a", "b", "c"])]
    expect(getNewestRemainingChatId(groups, "a")).toBe("b")
  })

  test("returns the next newest chat from the same project", () => {
    const groups = [makeProjectGroup("p", ["chat-3", "chat-2", "chat-1"])]
    expect(getNewestRemainingChatId(groups, "chat-3")).toBe("chat-2")
  })

  test("returns null when the only chat in the group is removed", () => {
    const groups = [makeProjectGroup("p", ["only"])]
    expect(getNewestRemainingChatId(groups, "only")).toBeNull()
  })

  test("returns a sibling from the correct project group", () => {
    const groups = [makeProjectGroup("p1", ["a"]), makeProjectGroup("p2", ["b", "c"])]
    expect(getNewestRemainingChatId(groups, "b")).toBe("c")
  })

  test("skips every chat removed in the same batch, not only the active one", () => {
    const groups = [makeProjectGroup("p", ["a", "b", "c"])]
    expect(getNewestRemainingChatId(groups, "a", ["a", "b"])).toBe("c")
  })
})

function recordingNavigator() {
  const calls: string[] = []
  const navigator: ChatNavigatorPort = {
    openChat: (chatId) => { calls.push(`open:${chatId}`) },
    closeChat: () => { calls.push("close") },
    goHome: () => { calls.push("home") },
  }
  return { calls, navigator }
}

describe("leaveRemovedChats", () => {
  const groups = [makeProjectGroup("p", ["a", "b", "c"])]

  test("does nothing when the active chat was not removed", () => {
    const { calls, navigator } = recordingNavigator()
    leaveRemovedChats(["b"], "a", groups, navigator)
    expect(calls).toEqual([])
  })

  test("does nothing when no chat is active", () => {
    const { calls, navigator } = recordingNavigator()
    leaveRemovedChats(["a"], null, groups, navigator)
    expect(calls).toEqual([])
  })

  test("opens the newest remaining chat when the active chat was removed", () => {
    const { calls, navigator } = recordingNavigator()
    leaveRemovedChats(["a", "b"], "a", groups, navigator)
    expect(calls).toEqual(["open:c"])
  })

  test("closes the chat view when nothing remains", () => {
    const { calls, navigator } = recordingNavigator()
    leaveRemovedChats(["x"], "x", groups, navigator)
    expect(calls).toEqual(["close"])
  })
})
