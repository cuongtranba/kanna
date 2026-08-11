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
 * Looking at a board is not a conversation, so it must not start one.
 *
 * A board opens on its own route, full width. Moving it beside a chat is a
 * second, explicit action — and the ONLY one allowed to create a chat. These
 * pin that split, because the previous version created a chat on every open
 * and that is exactly the kind of thing that reads as normal until someone
 * notices the stray conversations.
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
        if (type === "board") {
          onSnapshot({ boardId: "board-1", view: { board: BOARD, columns: [], counts: {}, cards: {}, cursors: {} } } as TSnapshot)
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
            <Route path="boards/:projectId/:boardId" element={<BoardsRoutePage />} />
          </Route>
          <Route path="*" element={<PathSpy onPath={(next) => { path = next }} />} />
        </Routes>
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
  onPath(window.location.pathname)
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
  /** The whole point: no chat, no pane tab, nothing created. */
  test("opening a board creates nothing and opens no tab", async () => {
    const harness = await mount([])
    await act(async () => {
      byText(harness.container, "Sprint").click()
    })

    expect(harness.createdFor).toEqual([])
    expect(harness.openedChats).toEqual([])
    expect(openTabTargets()).toEqual([])
    harness.unmount()
  })

  /**
   * An empty board used to render a full-height message that pushed the board —
   * and the only way to add a column — below the fold. Copy that tells you to
   * do a thing while hiding the control that does it is worse than no copy.
   */
  test("an empty board offers the field its own copy points at", async () => {
    const harness = await mount([chatRow("chat-1")], "/boards/proj-1/board-1")
    expect(harness.container.textContent).toContain("No columns yet")
    const field = harness.container.querySelector<HTMLInputElement>("input[aria-label='Add a column']")
    expect(field).not.toBeNull()
    // And the way out is still there.
    expect(harness.container.querySelector("[aria-label='Back to boards']")).not.toBeNull()
    harness.unmount()
  })

  test("a board renders on its own address", async () => {
    const harness = await mount([chatRow("chat-1")], "/boards/proj-1/board-1")
    expect(harness.container.textContent).toContain("Sprint")
    expect(harness.container.textContent).toContain("Open beside chat")
    harness.unmount()
  })

  test("beside-chat moves it into the pane and opens the project's chat", async () => {
    const harness = await mount([chatRow("chat-1")], "/boards/proj-1/board-1")
    await act(async () => {
      byText(harness.container, "Open beside chat").click()
    })

    expect(openTabTargets()).toContainEqual({ kind: "board", boardId: "board-1" })
    expect(harness.openedChats).toEqual(["chat-1"])
    expect(harness.createdFor).toEqual([])
    harness.unmount()
  })

  /**
   * The one path allowed to create a chat — and the label warns first, because
   * a button that quietly starts a conversation is how the stray chats
   * happened in the first place.
   */
  test("with no chat in the project, beside-chat says it will start one", async () => {
    const harness = await mount([], "/boards/proj-1/board-1")
    expect(harness.container.textContent).toContain("Open beside a new chat")

    await act(async () => {
      byText(harness.container, "Open beside a new chat").click()
    })
    expect(harness.createdFor).toEqual(["proj-1"])
    harness.unmount()
  })
})
