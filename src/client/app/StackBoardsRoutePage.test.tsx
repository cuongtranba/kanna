import { beforeEach, describe, expect, test } from "bun:test"
import { act } from "react"
import { createRoot } from "react-dom/client"
import "../lib/testing/setupHappyDom"
import { MemoryRouter, Outlet, Route, Routes, useLocation } from "react-router-dom"
import { StackBoardsRoutePage } from "./StackBoardsRoutePage"
import { usePaneLayoutStore } from "../stores/paneLayoutStore"
import { useBoardsStore } from "../stores/boardsStore"
import { collectPanes, createDefaultLayout } from "../lib/paneTree"
import type { KannaState } from "./useKannaState"
import type { StackSummary } from "../../shared/types"
import type { AnyValue } from "../../shared/errors"

/**
 * Mirrors `BoardsRoutePage.test.tsx`, one owner kind over: a Stack board has
 * no single project checkout to imply, so the list is keyed off the Stack
 * itself and opening a board hands off to `/boards/stack/:stackId/:boardId`
 * rather than `/boards/:projectId/:boardId`.
 */

const BOARD = {
  id: "board-1",
  title: "Sprint",
  description: null,
  columnCount: 2,
  cardCount: 0,
  updatedAt: 0,
}

const STACK: StackSummary = {
  id: "stack-1",
  title: "Kanna + ccom",
  projectIds: ["proj-1", "proj-2"],
  memberCount: 2,
  createdAt: 0,
  updatedAt: 0,
}

interface Harness {
  container: HTMLDivElement
  path: () => string
  unmount: () => void
}

async function mount(stacks: StackSummary[], entry = "/boards/stack/stack-1"): Promise<Harness> {
  let path = entry

  const state = {
    socket: {
      subscribe: <TSnapshot,>(topic: AnyValue, onSnapshot: (snapshot: TSnapshot) => void) => {
        const type = (topic as { type: string }).type
        if (type === "boards") {
          onSnapshot({ ownerKind: "stack", ownerId: "stack-1", boards: [BOARD] } as TSnapshot)
        }
        return () => undefined
      },
      command: (command: AnyValue) =>
        Promise.resolve((command as { type: string }).type === "board.templates.list" ? [] : undefined),
    },
    sidebarData: { stacks, starredProjectGroups: [], projectGroups: [] },
  } as unknown as KannaState

  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/" element={<Outlet context={state} />}>
            <Route path="boards/stack/:stackId" element={<StackBoardsRoutePage />} />
          </Route>
        </Routes>
        <PathSpy onPath={(next) => { path = next }} />
      </MemoryRouter>,
    )
  })
  return {
    container,
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

describe("StackBoardsRoutePage", () => {
  test("lists the Stack's boards", async () => {
    const harness = await mount([STACK])
    expect(harness.container.textContent).toContain("Sprint")
    harness.unmount()
  })

  test("renders the Stack's own title, not a project's", async () => {
    const harness = await mount([STACK])
    expect(harness.container.textContent).toContain("Kanna + ccom")
    harness.unmount()
  })

  /**
   * Same discipline as the project route: opening a board hands it to its own
   * address and creates no tab or chat on the way there — the workspace at
   * that address is what opens the tab.
   */
  test("opening a board navigates to /boards/stack/:stackId/:boardId and creates nothing", async () => {
    const harness = await mount([STACK])
    await act(async () => {
      byText(harness.container, "Sprint").click()
    })

    expect(harness.path()).toBe("/boards/stack/stack-1/board-1")
    expect(openTabTargets()).toEqual([])
    harness.unmount()
  })
})
