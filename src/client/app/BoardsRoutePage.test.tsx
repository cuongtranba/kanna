import { beforeEach, describe, expect, test } from "bun:test"
import { act } from "react"
import { createRoot } from "react-dom/client"
import "../lib/testing/setupHappyDom"
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom"
import { BoardsRoutePage } from "./BoardsRoutePage"
import { usePaneLayoutStore } from "../stores/paneLayoutStore"
import { useBoardsStore } from "../stores/boardsStore"
import { collectPanes, createDefaultLayout } from "../lib/paneTree"
import type { KannaState } from "./useKannaState"
import type { SidebarChatRow, SidebarProjectGroup } from "../../shared/types"
import type { AnyValue } from "../../shared/errors"

/**
 * A board is a pane tab, and the pane workspace only exists on the chat route.
 * These pin both halves of that: with a chat, open it; without one, start one.
 * Opening a tab into a route that cannot show it is the bug this replaced —
 * it looked exactly like nothing happening.
 */

const BOARD = {
  id: "board-1",
  title: "Sprint",
  description: null,
  columnCount: 2,
  cardCount: 0,
  updatedAt: 0,
}

function chatRow(chatId: string): SidebarChatRow {
  return { chatId, title: "Chat", updatedAt: 0 } as unknown as SidebarChatRow
}

function group(chats: SidebarChatRow[]): SidebarProjectGroup {
  return {
    groupKey: "proj-1",
    localPath: "/repo/kanna",
    chats,
    previewChats: [],
  } as unknown as SidebarProjectGroup
}

interface Harness {
  container: HTMLDivElement
  openedChats: string[]
  createdFor: string[]
  unmount: () => void
}

async function mount(chats: SidebarChatRow[]): Promise<Harness> {
  const openedChats: string[] = []
  const createdFor: string[] = []

  const state = {
    socket: {
      subscribe: <TSnapshot,>(_topic: AnyValue, onSnapshot: (snapshot: TSnapshot) => void) => {
        onSnapshot({ ownerKind: "project", ownerId: "proj-1", boards: [BOARD] } as TSnapshot)
        return () => undefined
      },
      command: (command: AnyValue) =>
        Promise.resolve((command as { type: string }).type === "board.templates.list" ? [] : undefined),
    },
    sidebarData: { starredProjectGroups: [], projectGroups: [group(chats)] },
    chatNavigator: { openChat: (chatId: string) => openedChats.push(chatId) },
    handleCreateChat: (projectId: string) => {
      createdFor.push(projectId)
      return Promise.resolve()
    },
  } as unknown as KannaState

  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/boards/proj-1"]}>
        <Routes>
          <Route path="/" element={<Outlet context={state} />}>
            <Route path="boards/:projectId" element={<BoardsRoutePage />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )
  })
  return {
    container,
    openedChats,
    createdFor,
    unmount: () => {
      act(() => root.unmount())
      container.remove()
    },
  }
}

function boardRow(container: HTMLElement): HTMLElement {
  const found = [...container.querySelectorAll("button")].find((node) =>
    (node.textContent ?? "").includes("Sprint"),
  )
  if (!found) throw new Error(`no board row in: ${container.textContent ?? ""}`)
  return found
}

function openBoardTargets(): AnyValue[] {
  const layout = usePaneLayoutStore.getState().getLayout()
  return collectPanes(layout.root).flatMap((pane) => pane.tabs.map((tab) => tab.target))
}

beforeEach(() => {
  usePaneLayoutStore.setState({ layout: createDefaultLayout(), nodeSequence: 0 })
  useBoardsStore.setState({ boardsByOwner: {}, viewByBoard: {}, pageSizeByBoard: {} })
})

describe("BoardsRoutePage", () => {
  test("opens the board beside the project's existing chat", async () => {
    const harness = await mount([chatRow("chat-1")])
    await act(async () => {
      boardRow(harness.container).click()
    })

    expect(openBoardTargets()).toContainEqual({ kind: "board", boardId: "board-1" })
    expect(harness.openedChats).toEqual(["chat-1"])
    expect(harness.createdFor).toEqual([])
    harness.unmount()
  })

  /** Without this the tab opened into a route that could not render it. */
  test("starts a chat when the project has none, so the tab has somewhere to be", async () => {
    const harness = await mount([])
    await act(async () => {
      boardRow(harness.container).click()
    })

    expect(openBoardTargets()).toContainEqual({ kind: "board", boardId: "board-1" })
    expect(harness.createdFor).toEqual(["proj-1"])
    harness.unmount()
  })

  test("says a chat will be started before the click, not after", async () => {
    const withChat = await mount([chatRow("chat-1")])
    expect(withChat.container.textContent).not.toContain("also starts a chat")
    withChat.unmount()

    const without = await mount([])
    expect(without.container.textContent).toContain("also starts a chat")
    without.unmount()
  })
})
