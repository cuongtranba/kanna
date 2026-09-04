import { beforeEach, describe, expect, test } from "bun:test"
import { act } from "react"
import { createRoot } from "react-dom/client"
import "../../lib/testing/setupHappyDom"
import { BoardSyncPanel, type BoardSyncPanelSocket } from "./BoardSyncPanel"
import { useBoardSyncPanelStore } from "./BoardSyncPanel.store"
import type { BoardSyncStatus } from "../../../shared/boards/sync-types"
import type { SyncBinding, SyncConflict } from "../../../shared/boards/types"
import type { ClientCommand } from "../../../shared/protocol"

const BINDING: SyncBinding = {
  id: "bind-1",
  boardId: "board-1",
  providerId: "github-issues",
  projectId: null,
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
    suggestedRepos: [{ projectId: "p1", projectName: "kanna", repo: { owner: "cuongtranba", repo: "kanna" }, boundTo: null }],
    routing: { open: { id: "c1", title: "Todo" }, closed: { id: "c3", title: "Done" } },
    ...overrides,
  }
}

interface Harness {
  container: HTMLDivElement
  commands: ClientCommand[]
  unmount: () => void
}

async function mount(value: BoardSyncStatus): Promise<Harness> {
  const commands: ClientCommand[] = []
  const socket: BoardSyncPanelSocket = {
    command: <TResult,>(command: ClientCommand) => {
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

/**
 * The button beside the typed field — NOT a suggestion row's Connect. Both say
 * "Connect", and matching on the label alone silently clicked the first row.
 */
function saveButton(container: HTMLElement): HTMLButtonElement {
  const button = repoInput(container).parentElement?.querySelector("button")
  if (!button) throw new Error(`no save button in: ${container.textContent ?? ""}`)
  return button
}

/** A suggestion row's own connect/move button, by the project it offers. */
function suggestionButton(container: HTMLElement, projectName: string): HTMLButtonElement {
  const row = [...container.querySelectorAll("li")].find((candidate) =>
    candidate.textContent?.includes(projectName),
  )
  const button = [...(row?.querySelectorAll("button") ?? [])].find((candidate) =>
    /Connect|Move here|Confirm move/u.test(candidate.textContent ?? ""),
  )
  if (!button) throw new Error(`no suggestion button for ${projectName} in: ${container.textContent ?? ""}`)
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
  /**
   * Each project the workspace already holds gets its OWN row. The typed field
   * stays empty — it is for a repo the rows do not offer, and prefilling it
   * with one listed directly above is a second way to do the same thing.
   */
  test("every project in the workspace is offered as its own row", async () => {
    const harness = await mount(status())
    expect(harness.container.textContent).toContain("cuongtranba/kanna")
    expect(suggestionButton(harness.container, "kanna").textContent).toBe("Connect")
    expect(repoInput(harness.container).value).toBe("")
    harness.unmount()
  })

  /**
   * A board holds N bindings, so the field ADDS one — it is not an edit of
   * "the" binding. An existing binding is listed and disconnected on its own.
   */
  test("a bound board lists what it is connected to and still offers the unbound repos", async () => {
    const harness = await mount(status({ bindings: [BINDING] }))
    expect(harness.container.textContent).toContain("acme/widgets")
    expect(suggestionButton(harness.container, "kanna").textContent).toBe("Connect")
    harness.unmount()
  })

  test("a repo already bound is not offered again", async () => {
    const harness = await mount(
      status({
        bindings: [BINDING],
        suggestedRepos: [
          { projectId: "p1", projectName: "widgets", repo: { owner: "acme", repo: "widgets" }, boundTo: null },
        ],
      }),
    )
    expect(() => suggestionButton(harness.container, "widgets")).toThrow()
    harness.unmount()
  })

  /** A project with no `origin` cannot be connected, and says why. */
  test("a project with no remote is listed without a connect button", async () => {
    const harness = await mount(
      status({ suggestedRepos: [{ projectId: "p1", projectName: "scratch", repo: null, boundTo: null }] }),
    )
    expect(harness.container.textContent).toContain("No remote configured")
    expect(() => suggestionButton(harness.container, "scratch")).toThrow()
    harness.unmount()
  })

  test("connecting a suggestion binds it with its project, so Start work finds the checkout", async () => {
    const harness = await mount(status())
    await act(async () => {
      suggestionButton(harness.container, "kanna").click()
    })
    expect(harness.commands).toContainEqual({
      type: "board.sync.bind",
      boardId: "board-1",
      owner: "cuongtranba",
      repo: "kanna",
      direction: "pull",
      allowAgentPush: false,
      projectId: "p1",
      detachFromBoardId: null,
    })
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
    expect(suggestionButton(harness.container, "kanna").disabled).toBe(false)
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
      projectId: null,
    })
    harness.unmount()
  })

  /**
   * A typed repo the workspace already holds still carries its project — the
   * user reached the same repo by a different route, not a different repo.
   */
  test("a typed repo that matches a project carries that project", async () => {
    const harness = await mount(status())
    type(repoInput(harness.container), "cuongtranba/kanna")
    await act(async () => {
      saveButton(harness.container).click()
    })
    expect(harness.commands).toContainEqual({
      type: "board.sync.bind",
      boardId: "board-1",
      owner: "cuongtranba",
      repo: "kanna",
      direction: "pull",
      allowAgentPush: false,
      projectId: "p1",
    })
    harness.unmount()
  })

  test("the typed field cannot be submitted empty", async () => {
    const harness = await mount(status())
    expect(saveButton(harness.container).disabled).toBe(true)
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

  /**
   * A repo belongs to one board. Moving it is not additive — the other board
   * loses its issue feed — so the first click states the cost and the second
   * accepts it. One gesture with no undo is the shape this exists to avoid.
   */
  test("moving a repo off another board takes two clicks, and only the second sends", async () => {
    const harness = await mount(
      status({
        suggestedRepos: [
          {
            projectId: "p1",
            projectName: "kanna",
            repo: { owner: "cuongtranba", repo: "kanna" },
            boundTo: { boardId: "board-9", boardTitle: "Old board", cardCount: 12 },
          },
        ],
      }),
    )
    expect(harness.container.textContent).toContain('Already connected to board "Old board"')
    expect(suggestionButton(harness.container, "kanna").textContent).toBe("Move here")

    await act(async () => {
      suggestionButton(harness.container, "kanna").click()
    })
    expect(harness.commands.some((c) => (c as { type: string }).type === "board.sync.bind")).toBe(false)
    expect(harness.container.textContent).toContain("will detach it from")
    expect(harness.container.textContent).toContain("12 cards stay on that board")

    await act(async () => {
      suggestionButton(harness.container, "kanna").click()
    })
    expect(harness.commands).toContainEqual({
      type: "board.sync.bind",
      boardId: "board-1",
      owner: "cuongtranba",
      repo: "kanna",
      direction: "pull",
      allowAgentPush: false,
      projectId: "p1",
      detachFromBoardId: "board-9",
    })
    harness.unmount()
  })

  test("cancelling the move sends nothing and restores the offer", async () => {
    const harness = await mount(
      status({
        suggestedRepos: [
          {
            projectId: "p1",
            projectName: "kanna",
            repo: { owner: "cuongtranba", repo: "kanna" },
            boundTo: { boardId: "board-9", boardTitle: "Old board", cardCount: 1 },
          },
        ],
      }),
    )
    await act(async () => {
      suggestionButton(harness.container, "kanna").click()
    })
    const cancel = [...harness.container.querySelectorAll("button")].find((b) => b.textContent === "Cancel")
    await act(async () => {
      cancel?.click()
    })
    expect(harness.commands.some((c) => (c as { type: string }).type === "board.sync.bind")).toBe(false)
    expect(suggestionButton(harness.container, "kanna").textContent).toBe("Move here")
    harness.unmount()
  })

  /** A Stack's whole point is N repos; connecting them one at a time is the bug. */
  test("a Stack connects every unbound project at once", async () => {
    const harness = await mount(
      status({
        suggestedRepos: [
          { projectId: "p1", projectName: "api", repo: { owner: "acme", repo: "api" }, boundTo: null },
          { projectId: "p2", projectName: "web", repo: { owner: "acme", repo: "web" }, boundTo: null },
        ],
      }),
    )
    const connectAll = [...harness.container.querySelectorAll("button")].find((b) =>
      b.textContent?.startsWith("Connect all"),
    )
    expect(connectAll?.textContent).toBe("Connect all 2")
    await act(async () => {
      connectAll?.click()
    })
    const bound = harness.commands.filter((c) => (c as { type: string }).type === "board.sync.bind")
    expect(bound.map((c) => (c as { repo: string }).repo).sort()).toEqual(["api", "web"])
    harness.unmount()
  })

  /**
   * A repo already on another board is excluded from the bulk action: a move
   * costs another board its feed, and that decision is never made in bulk.
   */
  test("Connect all skips a repo that belongs to another board", async () => {
    const harness = await mount(
      status({
        suggestedRepos: [
          { projectId: "p1", projectName: "api", repo: { owner: "acme", repo: "api" }, boundTo: null },
          { projectId: "p2", projectName: "web", repo: { owner: "acme", repo: "web" }, boundTo: null },
          {
            projectId: "p3",
            projectName: "docs",
            repo: { owner: "acme", repo: "docs" },
            boundTo: { boardId: "board-9", boardTitle: "Old board", cardCount: 3 },
          },
        ],
      }),
    )
    const connectAll = [...harness.container.querySelectorAll("button")].find((b) =>
      b.textContent?.startsWith("Connect all"),
    )
    expect(connectAll?.textContent).toBe("Connect all 2")
    await act(async () => {
      connectAll?.click()
    })
    const bound = harness.commands.filter((c) => (c as { type: string }).type === "board.sync.bind")
    expect(bound.map((c) => (c as { repo: string }).repo).sort()).toEqual(["api", "web"])
    harness.unmount()
  })

  /**
   * Direction is board POLICY, so a row with no override follows it as it
   * changes. Freezing a copy at load makes the control silently partial.
   */
  test("a row follows the board's direction until it overrides it", async () => {
    const harness = await mount(status())
    const push = [...harness.container.querySelectorAll("button")].filter((b) => b.textContent === "Push")
    await act(async () => {
      push[0]?.click() // the policy control, rendered above the rows
    })
    await act(async () => {
      suggestionButton(harness.container, "kanna").click()
    })
    expect(harness.commands).toContainEqual({
      type: "board.sync.bind",
      boardId: "board-1",
      owner: "cuongtranba",
      repo: "kanna",
      direction: "push",
      allowAgentPush: false,
      projectId: "p1",
      detachFromBoardId: null,
    })
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
