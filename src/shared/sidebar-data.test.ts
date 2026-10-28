import { describe, expect, test } from "vite-plus/test"
import { EMPTY_CHAT_ACTIVITY, type SidebarChatRow, type SidebarData, type SidebarProjectGroup } from "./types"
import { allChatRows, allProjectGroups } from "./sidebar-data"

function row(chatId: string): SidebarChatRow {
  return {
    _id: chatId,
    _creationTime: 0,
    chatId,
    title: chatId,
    status: "idle",
    unread: false,
    localPath: "/tmp/p",
    provider: null,
    activity: EMPTY_CHAT_ACTIVITY,
  }
}

function group(groupKey: string, chats: string[], previewChats: string[], olderChats: string[]): SidebarProjectGroup {
  return {
    groupKey,
    localPath: `/tmp/${groupKey}`,
    chats: chats.map(row),
    previewChats: previewChats.map(row),
    olderChats: olderChats.map(row),
    defaultCollapsed: false,
  }
}

const DATA: SidebarData = {
  starredProjectGroups: [group("starred", ["s1"], ["s2"], ["s3"])],
  projectGroups: [group("plain", ["p1"], [], ["p2"])],
  stacks: [],
}

describe("sidebar data views", () => {
  test("starred groups come before the remaining groups", () => {
    expect(allProjectGroups(DATA).map((g) => g.groupKey)).toEqual(["starred", "plain"])
  })

  test("every chat row of every group is listed, in chats, preview, older order", () => {
    expect(allChatRows(DATA).map((r) => r.chatId)).toEqual(["s1", "s2", "s3", "p1", "p2"])
  })
})
