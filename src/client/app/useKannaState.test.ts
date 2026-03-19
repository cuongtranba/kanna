import { describe, expect, test } from "bun:test"
import { getNewestRemainingChatId, shouldPinTranscriptToBottom } from "./useKannaState"
import type { SidebarData } from "../../shared/types"

function createSidebarData(): SidebarData {
  return {
    projectGroups: [
      {
        groupKey: "project-1",
        localPath: "/tmp/project-1",
        chats: [
          {
            _id: "row-1",
            _creationTime: 3,
            chatId: "chat-3",
            title: "Newest",
            status: "idle",
            localPath: "/tmp/project-1",
            provider: null,
            lastMessageAt: 3,
            hasAutomation: false,
          },
          {
            _id: "row-2",
            _creationTime: 2,
            chatId: "chat-2",
            title: "Older",
            status: "idle",
            localPath: "/tmp/project-1",
            provider: null,
            lastMessageAt: 2,
            hasAutomation: false,
          },
          {
            _id: "row-3",
            _creationTime: 1,
            chatId: "chat-1",
            title: "Oldest",
            status: "idle",
            localPath: "/tmp/project-1",
            provider: null,
            lastMessageAt: 1,
            hasAutomation: false,
          },
        ],
      },
      {
        groupKey: "project-2",
        localPath: "/tmp/project-2",
        chats: [
          {
            _id: "row-4",
            _creationTime: 1,
            chatId: "chat-4",
            title: "Other project",
            status: "idle",
            localPath: "/tmp/project-2",
            provider: null,
            lastMessageAt: 1,
            hasAutomation: false,
          },
        ],
      },
    ],
  }
}

describe("getNewestRemainingChatId", () => {
  test("returns the next newest chat from the same project", () => {
    const sidebarData = createSidebarData()

    expect(getNewestRemainingChatId(sidebarData.projectGroups, "chat-3")).toBe("chat-2")
  })

  test("returns null when no other chats remain in the project", () => {
    const sidebarData = createSidebarData()

    expect(getNewestRemainingChatId(sidebarData.projectGroups, "chat-4")).toBeNull()
  })

  test("returns null when the chat is not found", () => {
    const sidebarData = createSidebarData()

    expect(getNewestRemainingChatId(sidebarData.projectGroups, "missing")).toBeNull()
  })
})

describe("shouldPinTranscriptToBottom", () => {
  test("returns true when the transcript is at the bottom", () => {
    expect(shouldPinTranscriptToBottom(0)).toBe(true)
  })

  test("returns true when the transcript is near the bottom", () => {
    expect(shouldPinTranscriptToBottom(119)).toBe(true)
  })

  test("returns false when the transcript is not near the bottom", () => {
    expect(shouldPinTranscriptToBottom(120)).toBe(false)
  })
})
