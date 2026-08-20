import { describe, expect, test } from "bun:test"
import { buildTabPresentationContext } from "./tabPresentationContext"
import { describeTab } from "../../components/panes/tabPresentation"
import type { ProjectTerminalLayout } from "../../stores/terminalLayoutStore"
import type { BoardSummary, BoardViewSnapshot } from "../../../shared/boards/types"
import type { SidebarChatRow, SidebarData, SidebarProjectGroup } from "../../../shared/types"

/**
 * The workspace is shared by every project, so a tab must be able to title
 * itself from a project other than the active one. Every miss here reads as a
 * tab labelled with its fallback — which is what shipped for boards.
 */

function chat(chatId: string, title: string, extra: Partial<SidebarChatRow> = {}): SidebarChatRow {
  return { chatId, title, status: "idle", unread: false, ...extra } as SidebarChatRow
}

function group(groupKey: string, rows: Partial<SidebarProjectGroup>): SidebarProjectGroup {
  return {
    groupKey,
    localPath: `/repo/${groupKey}`,
    chats: [],
    previewChats: [],
    olderChats: [],
    defaultCollapsed: false,
    ...rows,
  } as SidebarProjectGroup
}

function sidebar(groups: Partial<SidebarData>): SidebarData {
  return { starredProjectGroups: [], projectGroups: [], stacks: [], ...groups } as SidebarData
}

function terminals(ids: [string, string][]): ProjectTerminalLayout {
  return {
    isVisible: true,
    mainSizes: [68, 32],
    nextTerminalIndex: ids.length,
    terminals: ids.map(([id, title]) => ({ id, title, size: 100 })),
  }
}

function board(id: string, title: string): BoardSummary {
  return { id, title, description: null, columnCount: 0, cardCount: 0, updatedAt: 0 }
}

function boardView(id: string, title: string): BoardViewSnapshot {
  return {
    board: {
      id,
      title,
      ownerKind: "project",
      ownerId: "p",
      description: null,
      templateId: null,
      cardFields: [],
      createdAt: 0,
      updatedAt: 0,
      archivedAt: null,
    },
    columns: [],
    counts: {},
    cards: {},
    cursors: {},
    chatLinksByCard: {},
    newSince: null,
  }
}

describe("buildTabPresentationContext", () => {
  test("titles a board tab from the boards snapshot", () => {
    const context = buildTabPresentationContext({
      terminalProjects: {},
      sidebarData: sidebar({}),
      boardsByOwner: { "project:proj-1": [board("board-1", "Sprint")] },
    })

    expect(describeTab({ kind: "board", boardId: "board-1" }, context).label).toBe("Sprint")
  })

  /**
   * Arriving straight at `/boards/:projectId/:boardId` — a refresh, a bookmark —
   * subscribes to that ONE board, never to the project's list, so
   * `boardsByOwner` is empty and the list alone would leave the tab reading its
   * fallback. The board's own view carries its title, so the tab titles itself
   * from the same snapshot it renders.
   */
  test("titles a board from its own view when the list was never loaded", () => {
    const context = buildTabPresentationContext({
      terminalProjects: {},
      sidebarData: sidebar({}),
      boardsByOwner: {},
      boardViews: { "board-1": boardView("board-1", "Sprint") },
    })

    expect(describeTab({ kind: "board", boardId: "board-1" }, context).label).toBe("Sprint")
  })

  test("a renamed board in the list wins over a stale view", () => {
    const context = buildTabPresentationContext({
      terminalProjects: {},
      sidebarData: sidebar({}),
      boardsByOwner: { "project:p": [board("board-1", "Renamed")] },
      boardViews: { "board-1": boardView("board-1", "Old name") },
    })

    expect(context.boardTitles?.["board-1"]).toBe("Renamed")
  })

  test("finds a board owned by any owner, not just one", () => {
    const context = buildTabPresentationContext({
      terminalProjects: {},
      sidebarData: sidebar({}),
      boardsByOwner: {
        "project:proj-1": [board("board-1", "Sprint")],
        "stack:stack-9": [board("board-2", "Bug triage")],
      },
    })

    expect(context.boardTitles?.["board-2"]).toBe("Bug triage")
  })

  test("an unknown board keeps the fallback rather than inventing a title", () => {
    const context = buildTabPresentationContext({
      terminalProjects: {},
      sidebarData: sidebar({}),
      boardsByOwner: {},
    })

    expect(describeTab({ kind: "board", boardId: "board-gone" }, context).label).toBe("Board")
  })

  test("titles chats from every group and every row bucket", () => {
    const context = buildTabPresentationContext({
      terminalProjects: {},
      sidebarData: sidebar({
        starredProjectGroups: [group("a", { chats: [chat("chat-1", "Starred")] })],
        projectGroups: [
          group("b", {
            previewChats: [chat("chat-2", "Preview")],
            olderChats: [chat("chat-3", "Older")],
          }),
        ],
      }),
      boardsByOwner: {},
    })

    expect(context.chatTitles).toEqual({ "chat-1": "Starred", "chat-2": "Preview", "chat-3": "Older" })
  })

  test("carries the live chat facts a tab draws its dot from", () => {
    const context = buildTabPresentationContext({
      terminalProjects: {},
      sidebarData: sidebar({
        projectGroups: [
          group("b", {
            chats: [chat("chat-1", "Busy", { status: "running", sessionState: "active" })],
          }),
        ],
      }),
      boardsByOwner: {},
    })

    const tab = describeTab({ kind: "chat", chatId: "chat-1" }, context)
    expect(tab.indicator?.tone).toBe("warning")
    expect(tab.pinned).toBe(true)
    expect(tab.sessionBadge?.glyph).toBe("●")
  })

  test("titles terminals from every project, not only the active one", () => {
    const context = buildTabPresentationContext({
      terminalProjects: {
        "proj-1": terminals([["term-1", "shell"]]),
        "proj-2": terminals([["term-2", "logs"]]),
      },
      sidebarData: sidebar({}),
      boardsByOwner: {},
    })

    expect(context.terminalTitles).toEqual({ "term-1": "shell", "term-2": "logs" })
  })
})
