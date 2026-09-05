import { beforeEach, describe, expect, test } from "bun:test"
import { act } from "react"
import { createRoot } from "react-dom/client"
import "../../lib/testing/setupHappyDom"
import { BoardPane, type BoardPaneSocket } from "./BoardPane"
import { useBoardSyncStore } from "./BoardPane.store"
import { useBoardsStore } from "../../stores/boardsStore"
import type { BoardSnapshot, ClientCommand, SubscriptionTopic } from "../../../shared/protocol"
import type { BoardViewSnapshot } from "../../../shared/boards/types"


const VIEW: BoardViewSnapshot = {
  board: {
    id: "board-1",
    ownerKind: "project",
    ownerId: "p1",
    title: "Untitled board",
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

async function mount(): Promise<{ container: HTMLDivElement; commands: ClientCommand[]; unmount: () => void }> {
  const commands: ClientCommand[] = []
  const socket: BoardPaneSocket = {
    subscribe: (_topic: SubscriptionTopic, onSnapshot: (snapshot: BoardSnapshot) => void) => {
      onSnapshot({ boardId: "board-1", view: VIEW })
      return () => undefined
    },
    command: <TResult,>(command: ClientCommand) => {
      commands.push(command)
      return Promise.resolve(undefined as TResult)
    },
  }
  const container = document.createElement("div")
  const root = createRoot(container)
  await act(async () => {
    root.render(<BoardPane boardId="board-1" socket={socket} />)
  })
  return {
    container,
    commands,
    unmount: () => {
      act(() => root.unmount())
    },
  }
}

function titleButton(container: HTMLElement): HTMLButtonElement {
  const button = [...container.querySelectorAll("button")].find(
    (node) => node.textContent === "Untitled board",
  )
  if (!button) throw new Error(`no title button in: ${container.textContent ?? ""}`)
  return button
}

function titleInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>("input[aria-label='Board name']")
  if (!input) throw new Error("title is not being edited")
  return input
}

function type(input: HTMLInputElement, value: string) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
    setter?.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

function press(input: HTMLInputElement, key: string) {
  act(() => {
    input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }))
  })
}

function boardUpdates(commands: ClientCommand[]) {
  return commands.filter((c) => (c as { type: string }).type === "board.update")
}

beforeEach(() => {
  useBoardSyncStore.getState().stopRenameBoard()
  useBoardsStore.setState({ boardsByOwner: {}, viewByBoard: {}, pageSizeByBoard: {} })
})

describe("renaming a board from its header", () => {
  test("clicking the title opens an editor seeded with it", async () => {
    const harness = await mount()
    await act(async () => { titleButton(harness.container).click() })
    expect(titleInput(harness.container).value).toBe("Untitled board")
    harness.unmount()
  })

  test("Enter commits the new name", async () => {
    const harness = await mount()
    await act(async () => { titleButton(harness.container).click() })
    type(titleInput(harness.container), "Sprint 12")
    press(titleInput(harness.container), "Enter")

    expect(boardUpdates(harness.commands)).toEqual([
      { type: "board.update", boardId: "board-1", title: "Sprint 12" },
    ])
    harness.unmount()
  })

  test("Escape discards without sending anything", async () => {
    const harness = await mount()
    await act(async () => { titleButton(harness.container).click() })
    type(titleInput(harness.container), "Discard me")
    press(titleInput(harness.container), "Escape")

    expect(boardUpdates(harness.commands)).toEqual([])
    expect(harness.container.textContent).toContain("Untitled board")
    harness.unmount()
  })

  test("an empty or unchanged name sends nothing", async () => {
    const harness = await mount()
    await act(async () => { titleButton(harness.container).click() })
    type(titleInput(harness.container), "   ")
    press(titleInput(harness.container), "Enter")
    expect(boardUpdates(harness.commands)).toEqual([])

    await act(async () => { titleButton(harness.container).click() })
    type(titleInput(harness.container), "Untitled board")
    press(titleInput(harness.container), "Enter")
    expect(boardUpdates(harness.commands)).toEqual([])
    harness.unmount()
  })
})
