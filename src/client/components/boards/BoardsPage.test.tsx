import { beforeEach, describe, expect, test } from "bun:test"
import { act } from "react"
import { createRoot } from "react-dom/client"
import "../../lib/testing/setupHappyDom"
import { BoardsPage, type BoardsPageSocket } from "./BoardsPage"
import { useBoardsStore } from "../../stores/boardsStore"
import { useBoardsPageStore } from "./BoardsPage.store"
import type { AnyValue } from "../../../shared/errors"

/**
 * `BoardsPage` is the same component for a project owner and a Stack owner —
 * `ownerKind` decides everything it reads and writes. These pin that a Stack
 * owner never leaks a "project" assumption: the subscription topic, the
 * `board.create` command, and the store key it reads from must all carry the
 * owner it was actually given.
 */

async function mount(props: {
  ownerKind: "project" | "stack"
  ownerId: string
  ownerName: string
  onSubscribe?: (topic: AnyValue) => void
}): Promise<{ container: HTMLDivElement; commands: AnyValue[]; unmount: () => void }> {
  const commands: AnyValue[] = []
  const socket: BoardsPageSocket = {
    subscribe: <TSnapshot,>(topic: AnyValue, onSnapshot: (snapshot: TSnapshot) => void) => {
      props.onSubscribe?.(topic)
      onSnapshot({ ownerKind: props.ownerKind, ownerId: props.ownerId, boards: [] } as TSnapshot)
      return () => undefined
    },
    command: <TResult,>(command: AnyValue) => {
      commands.push(command)
      const type = (command as { type: string }).type
      return Promise.resolve((type === "board.templates.list" ? [] : undefined) as TResult)
    },
  }
  // Deliberately NOT attached to `document.body` — see BoardPane.rename.test.tsx.
  const container = document.createElement("div")
  const root = createRoot(container)
  await act(async () => {
    root.render(
      <BoardsPage
        ownerKind={props.ownerKind}
        ownerId={props.ownerId}
        ownerName={props.ownerName}
        socket={socket}
        onOpenBoard={() => undefined}
      />,
    )
  })
  return {
    container,
    commands,
    unmount: () => {
      act(() => root.unmount())
    },
  }
}

function emptyBoardButton(container: HTMLElement): HTMLButtonElement {
  const button = [...container.querySelectorAll("button")].find(
    (node) => (node.textContent ?? "").includes("Empty board"),
  )
  if (!button) throw new Error(`no "Empty board" button in: ${container.textContent ?? ""}`)
  return button
}

beforeEach(() => {
  useBoardsStore.setState({ boardsByOwner: {}, viewByBoard: {}, pageSizeByBoard: {} })
  useBoardsPageStore.setState({
    picking: false,
    renamingId: null,
    error: null,
    templates: [],
    openMenuId: null,
  })
})

describe("BoardsPage owner routing", () => {
  test("subscribes to the boards topic scoped to a Stack owner, not \"project\"", async () => {
    let subscribedTopic: AnyValue | null = null
    const harness = await mount({
      ownerKind: "stack",
      ownerId: "stack-1",
      ownerName: "My Stack",
      onSubscribe: (topic) => {
        subscribedTopic = topic
      },
    })
    expect(subscribedTopic).toEqual({ type: "boards", ownerKind: "stack", ownerId: "stack-1" })
    harness.unmount()
  })

  test("creating an empty board from a Stack page sends ownerKind: \"stack\"", async () => {
    const harness = await mount({ ownerKind: "stack", ownerId: "stack-1", ownerName: "My Stack" })

    await act(async () => {
      emptyBoardButton(harness.container).click()
    })

    const created = harness.commands.find((c) => (c as { type: string }).type === "board.create")
    expect(created).toEqual({
      type: "board.create",
      ownerKind: "stack",
      ownerId: "stack-1",
      title: "Untitled board",
      templateId: null,
    })
    harness.unmount()
  })

  test("a Stack board's owner name renders in the header, not a project name", async () => {
    const harness = await mount({ ownerKind: "stack", ownerId: "stack-1", ownerName: "My Stack" })
    expect(harness.container.textContent).toContain("My Stack")
    harness.unmount()
  })

  test("a project owner still subscribes and creates under ownerKind: \"project\"", async () => {
    let subscribedTopic: AnyValue | null = null
    const harness = await mount({
      ownerKind: "project",
      ownerId: "proj-1",
      ownerName: "Project A",
      onSubscribe: (topic) => {
        subscribedTopic = topic
      },
    })
    expect(subscribedTopic).toEqual({ type: "boards", ownerKind: "project", ownerId: "proj-1" })

    await act(async () => {
      emptyBoardButton(harness.container).click()
    })
    const created = harness.commands.find((c) => (c as { type: string }).type === "board.create")
    expect(created).toEqual({
      type: "board.create",
      ownerKind: "project",
      ownerId: "proj-1",
      title: "Untitled board",
      templateId: null,
    })
    harness.unmount()
  })
})
