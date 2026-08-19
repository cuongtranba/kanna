import { beforeEach, describe, expect, test } from "bun:test"
import { act } from "react"
import { createRoot } from "react-dom/client"
import "../../lib/testing/setupHappyDom"
import { BoardSyncPanel, type BoardSyncPanelSocket } from "./BoardSyncPanel"
import { useBoardSyncPanelStore } from "./BoardSyncPanel.store"
import type { BoardSyncStatus } from "../../../shared/boards/sync-types"
import type { SyncBinding, SyncConflict } from "../../../shared/boards/types"
import type { AnyValue } from "../../../shared/errors"

const BINDING: SyncBinding = {
  id: "bind-1",
  boardId: "board-1",
  providerId: "github-issues",
  sourceRef: { provider: "github-issues", owner: "acme", repo: "widgets" },
  direction: "both",
  allowAgentPush: true,
  cursor: null,
  lastPulledAt: null,
}

const CONFLICT: SyncConflict = {
  id: "conf-1",
  cardId: "card-9",
  bindingId: "bind-1",
  field: "title",
  localValue: null,
  remoteValue: null,
  resolvedAs: "remote",
  detectedAt: 0,
}

function status(overrides: Partial<BoardSyncStatus> = {}): BoardSyncStatus {
  return {
    bindings: [],
    conflicts: [],
    suggestedRepos: [{ projectId: "p1", projectName: "kanna", repo: { owner: "cuongtranba", repo: "kanna" } }],
    routing: { open: { id: "c1", title: "Todo" }, closed: { id: "c3", title: "Done" } },
    ...overrides,
  }
}

interface Harness {
  container: HTMLDivElement
  commands: AnyValue[]
  unmount: () => void
}

async function mount(value: BoardSyncStatus): Promise<Harness> {
  const commands: AnyValue[] = []
  const socket: BoardSyncPanelSocket = {
    command: <TResult,>(command: AnyValue) => {
      commands.push(command)
      const type = (command as { type: string }).type
      if (type === "board.sync.status") return Promise.resolve(value as TResult)
      return Promise.resolve(undefined as TResult)
    },
  }
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(<BoardSyncPanel boardId="board-1" socket={socket} onClose={() => undefined} />)
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

function repoInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>("#board-sync-repo")
  if (!input) throw new Error("no repo input")
  return input
}

function saveButton(container: HTMLElement): HTMLButtonElement {
  const button = [...container.querySelectorAll("button")].find((candidate) =>
    /Connect|Update|Saving/u.test(candidate.textContent ?? ""),
  )
  if (!button) throw new Error(`no save button in: ${container.textContent ?? ""}`)
  return button
}

function type(input: HTMLInputElement, value: string) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
    setter?.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

beforeEach(() => {
  useBoardSyncPanelStore.getState().reset()
})

describe("BoardSyncPanel", () => {
  test("an unbound board is offered the repo its project is already cloned from", async () => {
    const harness = await mount(status())
    expect(repoInput(harness.container).value).toBe("cuongtranba/kanna")
    expect(harness.container.textContent).toContain("origin remote")
    expect(saveButton(harness.container).textContent).toBe("Connect")
    harness.unmount()
  })

  /**
   * A board holds N bindings, so the field ADDS one — it is not an edit of
   * "the" binding. Seeding it from an existing binding would make Connect look
   * like a no-op and, on a Stack board, hide every project still unconnected.
   */
  test("a bound board lists what it is connected to and offers the next unbound repo", async () => {
    const harness = await mount(status({ bindings: [BINDING] }))
    expect(harness.container.textContent).toContain("acme/widgets")
    expect(repoInput(harness.container).value).toBe("cuongtranba/kanna")
    expect(saveButton(harness.container).textContent).toBe("Connect")
    harness.unmount()
  })

  test("a repo already bound is not offered again", async () => {
    const harness = await mount(
      status({
        bindings: [BINDING],
        suggestedRepos: [
          { projectId: "p1", projectName: "widgets", repo: { owner: "acme", repo: "widgets" } },
        ],
      }),
    )
    expect(repoInput(harness.container).value).toBe("")
    harness.unmount()
  })

  test("each connected repo can be disconnected on its own", async () => {
    const harness = await mount(status({ bindings: [BINDING] }))
    const button = harness.container.querySelector<HTMLButtonElement>('[aria-label="Disconnect bind-1"]')
    expect(button).not.toBeNull()
    harness.unmount()
  })

  test("routing is shown, not offered", async () => {
    const harness = await mount(status())
    expect(harness.container.textContent).toContain("Todo")
    expect(harness.container.textContent).toContain("Done")
    // No control writes it: semantics are the only way to say where cards go.
    expect(harness.container.querySelector("select")).toBeNull()
    harness.unmount()
  })

  /** Unmapped columns warn; a one-way pull still works without them. */
  test("a board marking no columns warns instead of blocking", async () => {
    const harness = await mount(status({ routing: { open: null, closed: null } }))
    expect(harness.container.textContent).toContain("marks no column as start or done")
    expect(saveButton(harness.container).disabled).toBe(false)
    harness.unmount()
  })

  test("binds the typed repo", async () => {
    const harness = await mount(status())
    type(repoInput(harness.container), "https://github.com/acme/widgets")
    await act(async () => {
      saveButton(harness.container).click()
    })
    expect(harness.commands).toContainEqual({
      type: "board.sync.bind",
      boardId: "board-1",
      owner: "acme",
      repo: "widgets",
      direction: "pull",
      allowAgentPush: false,
    })
    harness.unmount()
  })

  test("refuses something that is not a repository, without sending anything", async () => {
    const harness = await mount(status())
    type(repoInput(harness.container), "kanna")
    await act(async () => {
      saveButton(harness.container).click()
    })
    expect(harness.container.textContent).toContain("not a repository")
    expect(harness.commands.some((c) => (c as { type: string }).type === "board.sync.bind")).toBe(false)
    harness.unmount()
  })

  test("shows the conflict log, and says so when it is empty", async () => {
    const empty = await mount(status())
    expect(empty.container.textContent).toContain("Nothing has changed in both places.")
    empty.unmount()

    const withConflict = await mount(status({ conflicts: [CONFLICT] }))
    expect(withConflict.container.textContent).toContain("title changed in both places")
    expect(withConflict.container.textContent).toContain("took theirs")
    withConflict.unmount()
  })
})
