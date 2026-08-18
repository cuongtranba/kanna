import { describe, expect, test } from "bun:test"
import { buildBoardChatFacts } from "./boardChatFacts"
import { EMPTY_CHAT_ACTIVITY } from "../../../shared/types"
import type { SidebarChatRow, SidebarData, SidebarProjectGroup } from "../../../shared/types"

/**
 * The board reads chat liveness from the same sidebar snapshot the sidebar
 * draws, so a chat cannot be "Running" on the left and silent on the card.
 */

function row(partial: Partial<SidebarChatRow> & { chatId: string }): SidebarChatRow {
  return {
    _id: partial.chatId,
    _creationTime: 0,
    title: partial.chatId,
    status: "idle",
    unread: false,
    localPath: "/repo",
    provider: null,
    activity: EMPTY_CHAT_ACTIVITY,
    ...partial,
  }
}

function group(partial: Partial<SidebarProjectGroup>): SidebarProjectGroup {
  return {
    groupKey: "g",
    localPath: "/repo",
    chats: [],
    previewChats: [],
    olderChats: [],
    defaultCollapsed: false,
    ...partial,
  }
}

function sidebar(partial: Partial<SidebarData>): SidebarData {
  return { starredProjectGroups: [], projectGroups: [], stacks: [], ...partial }
}

describe("buildBoardChatFacts", () => {
  test("carries the status, the unread flag and the moment the state was entered", () => {
    const facts = buildBoardChatFacts(
      sidebar({
        projectGroups: [
          group({
            chats: [
              row({ chatId: "chat-1", title: "Fix login", status: "running", stateEnteredAt: 90 }),
            ],
          }),
        ],
      }),
    )

    expect(facts["chat-1"]).toEqual({
      title: "Fix login",
      status: "running",
      unread: false,
      stateEnteredAt: 90,
      activity: EMPTY_CHAT_ACTIVITY,
    })
  })

  /**
   * Every bucket, every group. A card links a chat by id and neither knows nor
   * cares which project group, or which fold of it, the chat is currently
   * filed under — missing one bucket makes a live chat read as deleted.
   */
  test("reads every bucket of every group, starred and not", () => {
    const facts = buildBoardChatFacts(
      sidebar({
        starredProjectGroups: [group({ chats: [row({ chatId: "starred" })] })],
        projectGroups: [
          group({
            chats: [row({ chatId: "recent" })],
            previewChats: [row({ chatId: "preview" })],
            olderChats: [row({ chatId: "older" })],
          }),
          group({ groupKey: "g2", chats: [row({ chatId: "other-project" })] }),
        ],
      }),
    )

    expect(Object.keys(facts).sort()).toEqual([
      "older",
      "other-project",
      "preview",
      "recent",
      "starred",
    ])
  })

  test("a chat with no live state carries none", () => {
    const facts = buildBoardChatFacts(
      sidebar({ projectGroups: [group({ chats: [row({ chatId: "chat-1", unread: true })] })] }),
    )

    expect(facts["chat-1"]?.stateEnteredAt).toBeUndefined()
    expect(facts["chat-1"]?.unread).toBe(true)
  })

  /**
   * The absence of a key is what tells a card its chat is gone — the reaper
   * deletes chats nobody wrote to, so the board must not invent a placeholder.
   */
  test("an empty sidebar knows about no chats at all", () => {
    expect(buildBoardChatFacts(sidebar({}))).toEqual({})
  })
})
