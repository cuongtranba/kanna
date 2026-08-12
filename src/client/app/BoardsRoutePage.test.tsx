import { beforeEach, describe, expect, test } from "bun:test"
import { act } from "react"
import { createRoot } from "react-dom/client"
import "../lib/testing/setupHappyDom"
import { MemoryRouter, Outlet, Route, Routes, useLocation } from "react-router-dom"
import { BoardsRoutePage } from "./BoardsRoutePage"
import { usePaneLayoutStore } from "../stores/paneLayoutStore"
import { useBoardsStore } from "../stores/boardsStore"
import { collectPanes, createDefaultLayout } from "../lib/paneTree"
import type { KannaState } from "./useKannaState"
import type { SidebarChatRow, SidebarProjectGroup } from "../../shared/types"
import type { AnyValue } from "../../shared/errors"

/**
 * Looking at a board is not a conversation, so it must not start one.
 *
 * The board itself now opens as a pane tab, which is what makes board↔chat a
 * tab click rather than a round trip through the sidebar. This route is only
 * the LIST, and these pin that it stays inert: it hands the board to its own
 * address and creates nothing on the way. The previous version created a chat
 * on every open, and that is exactly the kind of thing that reads as normal
 * until someone notices the stray conversations.
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
  path: () => string
  unmount: () => void
}

async function mount(chats: SidebarChatRow[], entry = "/boards/proj-1"): Promise<Harness> {
  const openedChats: string[] = []
  const createdFor: string[] = []
  let path = entry

  const state = {
    socket: {
      subscribe: <TSnapshot,>(topic: AnyValue, onSnapshot: (snapshot: TSnapshot) => void) => {
        const type = (topic as { type: string }).type
        if (type === "boards") {
          onSnapshot({ ownerKind: "project", ownerId: "proj-1", boards: [BOARD] } as TSnapshot)
        }
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
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/" element={<Outlet context={state} />}>
            <Route path="boards/:projectId" element={<BoardsRoutePage />} />
          </Route>
        </Routes>
        <PathSpy onPath={(next) => { path = next }} />
      </MemoryRouter>,
    )
  })
  return {
    container,
    openedChats,
    createdFor,
    path: () => path,
    unmount: () => {
      act(() => root.unmount())
      container.remove()
    },
  }
}

function PathSpy({ onPath }: { onPath: (path: string) => void }) {
  onPath(useLocation().pathname)
  return null
}

function byText(container: HTMLElement, text: string): HTMLElement {
  const found = [...container.querySelectorAll("button")].find((node) =>
    (node.textContent ?? "").includes(text),
  )
  if (!found) throw new Error(`no "${text}" button in: ${container.textContent ?? ""}`)
  return found
}

function openTabTargets(): AnyValue[] {
  const layout = usePaneLayoutStore.getState().getLayout()
  return collectPanes(layout.root).flatMap((pane) => pane.tabs.map((tab) => tab.target))
}

beforeEach(() => {
  usePaneLayoutStore.setState({ layout: createDefaultLayout(), nodeSequence: 0 })
  useBoardsStore.setState({ boardsByOwner: {}, viewByBoard: {}, pageSizeByBoard: {} })
})

describe("BoardsRoutePage", () => {
  test("lists the project's boards", async () => {
    const harness = await mount([chatRow("chat-1")])
    expect(harness.container.textContent).toContain("Sprint")
    harness.unmount()
  })

  /**
   * The whole point: the list hands the board to its own address and does
   * nothing else. The workspace at that address is what opens the tab, so a
   * project with no chat is no longer a reason to invent one.
   */
  test("opening a board navigates to its address and creates nothing", async () => {
    const harness = await mount([])
    await act(async () => {
      byText(harness.container, "Sprint").click()
    })

    expect(harness.path()).toBe("/boards/proj-1/board-1")
    expect(harness.createdFor).toEqual([])
    expect(harness.openedChats).toEqual([])
    expect(openTabTargets()).toEqual([])
    harness.unmount()
  })
})
