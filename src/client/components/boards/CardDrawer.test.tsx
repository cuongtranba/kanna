import { describe, expect, test, beforeEach } from "bun:test"
import { act } from "react"
import { createRoot } from "react-dom/client"
import "../../lib/testing/setupHappyDom"
import { CardDrawer, type CardDrawerSocket } from "./CardDrawer"
import { useCardDrawerStore } from "./CardDrawer.store"
import { usePaneLayoutStore } from "../../stores/paneLayoutStore"
import { collectPanes, createDefaultLayout } from "../../lib/paneTree"
import type { CardDetailView, StartWorkResult, StartWorkStatus } from "../../../shared/boards/start-work"
import type { WorktreeCleanupView } from "../../../shared/boards/worktree-cleanup"
import type { AnyValue } from "../../../shared/errors"

function detailWith(status: StartWorkStatus, blockedReason: string | null = null): CardDetailView {
  return {
    card: {
      id: "card-1",
      boardId: "board-1",
      columnId: "col-1",
      projectId: "proj-1",
      title: "Fix: login redirect loop",
      rank: "a0",
      content: {},
      updatedBy: { kind: "user" },
      createdAt: 0,
      updatedAt: 0,
      archivedAt: null,
    },
    links: [],
    comments: [],
    externalRef: "412",
    startWork: { status, branch: "card/412-fix-login-redirect-loop", blockedReason },
    cleanup: null,
  }
}

interface Harness {
  container: HTMLDivElement
  commands: AnyValue[]
  unmount: () => void
}

async function mount(
  detail: CardDetailView,
  onStartWork: () => Promise<StartWorkResult>,
): Promise<Harness> {
  const commands: AnyValue[] = []
  const socket: CardDrawerSocket = {
    command: <TResult,>(command: AnyValue) => {
      commands.push(command)
      const type = (command as { type: string }).type
      if (type === "board.card.detail") return Promise.resolve(detail as TResult)
      if (type === "board.card.startWork") return onStartWork() as Promise<TResult>
      return Promise.resolve(undefined as TResult)
    },
  }

  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(<CardDrawer cardId="card-1" socket={socket} onClose={() => undefined} />)
  })
  return {
    container,
    commands,
    unmount: () => {
      act(() => root.unmount())
      container.remove()
    },
  }
}

function startWorkButton(container: HTMLElement): HTMLButtonElement {
  const button = [...container.querySelectorAll("button")].find((candidate) =>
    /Start work|Resume|Open chat|Starting/u.test(candidate.textContent ?? ""),
  )
  if (!button) throw new Error(`no start-work button in: ${container.textContent ?? ""}`)
  return button
}

const RESULT: StartWorkResult = {
  cardId: "card-1",
  chatId: "chat-77",
  branch: "card/412-fix-login-redirect-loop",
  worktreePath: "/wt/card-412",
  movedToColumnId: "col-2",
  reused: false,
}

beforeEach(() => {
  useCardDrawerStore.getState().reset()
})

describe("CardDrawer start work", () => {
  test("the label carries the state, and the branch is shown rather than asked", async () => {
    const idle = await mount(detailWith({ kind: "idle" }), () => Promise.resolve(RESULT))
    expect(startWorkButton(idle.container).textContent).toBe("Start work")
    expect(idle.container.textContent).toContain("card/412-fix-login-redirect-loop")
    idle.unmount()

    const resume = await mount(detailWith({ kind: "worktree", worktreePath: "/wt/a" }), () =>
      Promise.resolve(RESULT),
    )
    expect(startWorkButton(resume.container).textContent).toBe("Resume")
    resume.unmount()

    const open = await mount(detailWith({ kind: "chat", chatId: "chat-9", worktreePath: "/wt/a" }), () =>
      Promise.resolve(RESULT),
    )
    expect(startWorkButton(open.container).textContent).toBe("Open chat")
    open.unmount()
  })

  test("opens the card's chat as a tab", async () => {
    usePaneLayoutStore.setState({ layout: createDefaultLayout(), nodeSequence: 0 })
    const harness = await mount(detailWith({ kind: "idle" }), () => Promise.resolve(RESULT))

    await act(async () => {
      startWorkButton(harness.container).click()
    })

    expect(harness.commands).toContainEqual({ type: "board.card.startWork", cardId: "card-1" })
    const layout = usePaneLayoutStore.getState().getLayout()
    const targets = collectPanes(layout.root).flatMap((pane) => pane.tabs.map((tab) => tab.target))
    expect(targets).toContainEqual({ kind: "chat", chatId: "chat-77" })
    harness.unmount()
  })

  /** A board that marks no active column moves nothing, and the drawer says so. */
  test("reports a board with no active column", async () => {
    const harness = await mount(detailWith({ kind: "idle" }), () =>
      Promise.resolve({ ...RESULT, movedToColumnId: null }),
    )
    await act(async () => {
      startWorkButton(harness.container).click()
    })
    expect(harness.container.textContent).toContain("no column marked active")
    harness.unmount()
  })

  test("a card that cannot start says why, and the button does not offer to", async () => {
    const harness = await mount(
      detailWith({ kind: "idle" }, "This card has no project, so there is no checkout to work in."),
      () => Promise.resolve(RESULT),
    )
    expect(startWorkButton(harness.container).disabled).toBe(true)
    expect(harness.container.textContent).toContain("no project")
    harness.unmount()
  })

  test("a failure is reported and the button becomes usable again", async () => {
    const harness = await mount(detailWith({ kind: "idle" }), () =>
      Promise.reject(new Error("fatal: 'card/412' is already checked out")),
    )
    await act(async () => {
      startWorkButton(harness.container).click()
    })
    expect(harness.container.textContent).toContain("already checked out")
    expect(startWorkButton(harness.container).disabled).toBe(false)
    harness.unmount()
  })

  /** An older server has no start-work wiring; the drawer must not paint a dead button. */
  test("renders no button when the server sent no status", async () => {
    const detail = { ...detailWith({ kind: "idle" }), startWork: null }
    const harness = await mount(detail, () => Promise.resolve(RESULT))
    expect(() => startWorkButton(harness.container)).toThrow()
    harness.unmount()
  })
})

function cleanupDetail(cleanup: Partial<WorktreeCleanupView>): CardDetailView {
  return {
    ...detailWith({ kind: "worktree", worktreePath: "/wt/card-412" }),
    cleanup: {
      worktreePath: "/wt/card-412",
      branch: "card/412-fix-login-redirect-loop",
      dirtyFileCount: 0,
      unmergedCommitCount: 2,
      hasConflicts: false,
      ...cleanup,
    },
  }
}

function buttonNamed(container: HTMLElement, label: string): HTMLButtonElement {
  const button = [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent === label,
  )
  if (!button) throw new Error(`no "${label}" button in: ${container.textContent ?? ""}`)
  return button
}

describe("CardDrawer worktree cleanup", () => {
  test("asks, with the numbers in view", async () => {
    const harness = await mount(cleanupDetail({ dirtyFileCount: 3 }), () => Promise.resolve(RESULT))
    expect(harness.container.textContent).toContain("This card is done.")
    expect(harness.container.textContent).toContain("2 commits to merge · 3 uncommitted files")
    harness.unmount()
  })

  test("no question when the card is not done", async () => {
    const harness = await mount(detailWith({ kind: "idle" }), () => Promise.resolve(RESULT))
    expect(harness.container.textContent).not.toContain("This card is done.")
    harness.unmount()
  })

  /** The rule: a column drag must not be able to destroy an agent's work. */
  test("discard is refused, with the reason, while the worktree holds work", async () => {
    const harness = await mount(cleanupDetail({ dirtyFileCount: 1 }), () => Promise.resolve(RESULT))
    expect(buttonNamed(harness.container, "Discard worktree").disabled).toBe(true)
    expect(harness.container.textContent).toContain("still holds")
    harness.unmount()
  })

  test("discard is offered once the worktree holds nothing", async () => {
    const harness = await mount(cleanupDetail({ unmergedCommitCount: 0 }), () => Promise.resolve(RESULT))
    expect(buttonNamed(harness.container, "Discard worktree").disabled).toBe(false)
    harness.unmount()
  })

  test("merge is refused on a conflict, and says so", async () => {
    const harness = await mount(cleanupDetail({ hasConflicts: true }), () => Promise.resolve(RESULT))
    expect(buttonNamed(harness.container, "Merge").disabled).toBe(true)
    expect(harness.container.textContent).toContain("conflicts")
    harness.unmount()
  })

  test("leaving it is always available and is sent as a decision", async () => {
    const harness = await mount(cleanupDetail({ dirtyFileCount: 5 }), () => Promise.resolve(RESULT))
    await act(async () => {
      buttonNamed(harness.container, "Leave it").click()
    })
    expect(harness.commands).toContainEqual({
      type: "board.card.resolveWorktree",
      cardId: "card-1",
      decision: "leave",
    })
    harness.unmount()
  })
})
