import { describe, expect, test, beforeEach } from "bun:test"
import { act } from "react"
import { createRoot } from "react-dom/client"
import "../../lib/testing/setupHappyDom"
import { CardDrawer, type CardDrawerSocket } from "./CardDrawer"
import { useCardDrawerStore } from "./CardDrawer.store"
import { usePaneLayoutStore } from "../../stores/paneLayoutStore"
import { collectPanes, createDefaultLayout } from "../../lib/paneTree"
import { EMPTY_CHAT_ACTIVITY } from "../../../shared/types"
import type { BoardChatFacts } from "../../lib/boards/boardChatFacts"
import type { CardContent, CardLink, FieldDef } from "../../../shared/boards/types"
import type { CardDetailView, StartWorkResult, StartWorkStatus } from "../../../shared/boards/start-work"
import type { WorktreeCleanupView } from "../../../shared/boards/worktree-cleanup"
import type { ClientCommand } from "../../../shared/protocol"
import { isJsonObject } from "../../../shared/json"

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
    blockers: [],
    externalRef: "412",
    startWork: { status, branch: "card/412-fix-login-redirect-loop", blockedReason },
    cleanup: null,
  }
}

interface Harness {
  container: HTMLDivElement
  commands: ClientCommand[]
  unmount: () => void
}

async function mount(
  detail: CardDetailView,
  onStartWork: () => Promise<StartWorkResult>,
  chatFacts?: Record<string, BoardChatFacts>,
  cardFields?: readonly FieldDef[],
): Promise<Harness> {
  const commands: ClientCommand[] = []
  const socket: CardDrawerSocket = {
    command: <TResult,>(command: ClientCommand) => {
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
    root.render(
      <CardDrawer
        cardId="card-1"
        socket={socket}
        chatFacts={chatFacts}
        cardFields={cardFields}
        onClose={() => undefined}
      />,
    )
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

  test("renders no button when the server sent no status", async () => {
    const detail = { ...detailWith({ kind: "idle" }), startWork: null }
    const harness = await mount(detail, () => Promise.resolve(RESULT))
    expect(() => startWorkButton(harness.container)).toThrow()
    harness.unmount()
  })
})

function link(targetId: string, kind: CardLink["kind"], createdAt: number): CardLink {
  return { cardId: "card-1", kind, targetId, createdAt }
}

function linkedDetail(links: CardLink[]): CardDetailView {
  return { ...detailWith({ kind: "idle" }), links }
}

function chatButton(container: HTMLElement, text: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll("button")].find((candidate) =>
    (candidate.textContent ?? "").includes(text),
  )
}

describe("CardDrawer issue identity", () => {
  test("identity renders from externalRef with a GitHub link", async () => {
    const detail: CardDetailView = {
      ...detailWith({ kind: "idle" }),
      externalRef: "412",
      card: {
        ...detailWith({ kind: "idle" }).card,
        content: { externalUrl: { kind: "url", value: "https://github.com/cuongtranba/kanna/issues/412" } },
      },
    }
    const harness = await mount(detail, () => Promise.resolve(RESULT))
    expect(harness.container.textContent).toContain("#412")
    const identityLink = harness.container.querySelector<HTMLAnchorElement>('header a[aria-label="Open on GitHub"]')
    expect(identityLink?.getAttribute("href")).toBe("https://github.com/cuongtranba/kanna/issues/412")
    harness.unmount()
  })

  test("a card from nowhere renders no identity row", async () => {
    const detail: CardDetailView = { ...detailWith({ kind: "idle" }), externalRef: null }
    const harness = await mount(detail, () => Promise.resolve(RESULT))
    expect(harness.container.querySelector('header a[aria-label="Open on GitHub"]')).toBeNull()
    harness.unmount()
  })
})

describe("CardDrawer linked chats", () => {
  test("lists each linked chat with its live status", async () => {
    const harness = await mount(
      linkedDetail([link("chat-77", "chat", 2), link("/wt/card-412", "worktree", 1)]),
      () => Promise.resolve(RESULT),
      { "chat-77": { title: "Fix login redirect", status: "running", unread: false, activity: EMPTY_CHAT_ACTIVITY } },
    )

    expect(harness.container.textContent).toContain("Fix login redirect")
    expect(harness.container.textContent).toContain("Running")
    expect(harness.container.textContent).not.toContain("/wt/card-412")
    harness.unmount()
  })

  test("a quiet chat is listed too, and says so rather than nothing", async () => {
    const harness = await mount(
      linkedDetail([link("chat-77", "chat", 2)]),
      () => Promise.resolve(RESULT),
      { "chat-77": { title: "Fix login redirect", status: "idle", unread: false, activity: EMPTY_CHAT_ACTIVITY } },
    )

    expect(harness.container.textContent).toContain("Idle")
    harness.unmount()
  })

  test("clicking a linked chat opens that chat's tab", async () => {
    usePaneLayoutStore.setState({ layout: createDefaultLayout(), nodeSequence: 0 })
    const harness = await mount(
      linkedDetail([link("chat-77", "chat", 2)]),
      () => Promise.resolve(RESULT),
      { "chat-77": { title: "Fix login redirect", status: "idle", unread: false, activity: EMPTY_CHAT_ACTIVITY } },
    )

    await act(async () => {
      chatButton(harness.container, "Fix login redirect")?.click()
    })

    const layout = usePaneLayoutStore.getState().getLayout()
    const targets = collectPanes(layout.root).flatMap((pane) => pane.tabs.map((tab) => tab.target))
    expect(targets).toContainEqual({ kind: "chat", chatId: "chat-77" })
    harness.unmount()
  })

  test("a link whose chat no longer exists is not clickable", async () => {
    const harness = await mount(linkedDetail([link("chat-gone", "chat", 2)]), () =>
      Promise.resolve(RESULT),
    )

    expect(chatButton(harness.container, "chat-gone")).toBeUndefined()
    expect(harness.container.textContent).toContain("no longer exists")
    harness.unmount()
  })

  test("a card with no chat links shows no section", async () => {
    const harness = await mount(linkedDetail([]), () => Promise.resolve(RESULT))
    expect(harness.container.textContent).not.toContain("Linked chat")
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



const SCHEMA: readonly FieldDef[] = [
  { id: "description", label: "Description", kind: "longtext", options: null, required: false },
  { id: "assignee", label: "Assignee", kind: "text", options: null, required: true },
  { id: "estimate", label: "Estimate", kind: "number", options: null, required: false },
  { id: "due", label: "Due", kind: "date", options: null, required: false },
  {
    id: "priority",
    label: "Priority",
    kind: "select",
    required: false,
    options: [
      { id: "high", label: "High", colorToken: "destructive" },
      { id: "low", label: "Low", colorToken: "muted-icon" },
    ],
  },
  {
    id: "areas",
    label: "Areas",
    kind: "multiselect",
    required: false,
    options: [
      { id: "ui", label: "UI", colorToken: null },
      { id: "api", label: "API", colorToken: null },
    ],
  },
  { id: "labels", label: "Labels", kind: "label", options: null, required: false },
  { id: "externalUrl", label: "Source", kind: "url", options: null, required: false },
]

function schemaDetail(content: CardContent): CardDetailView {
  const base = detailWith({ kind: "idle" })
  return { ...base, card: { ...base.card, content } }
}

function mountSchema(content: CardContent, fields: readonly FieldDef[] = SCHEMA): Promise<Harness> {
  return mount(schemaDetail(content), () => Promise.resolve(RESULT), undefined, fields)
}

function fieldButton(container: HTMLElement, label: string): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>(`button[aria-label="Edit ${label}"]`)
  if (!button) throw new Error(`no editable ${label} in: ${container.innerHTML}`)
  return button
}

function fieldInput(container: HTMLElement, label: string): HTMLInputElement | HTMLTextAreaElement {
  const input = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    `dl [aria-label="${label}"]`,
  )
  if (!input) throw new Error(`no ${label} input in: ${container.innerHTML}`)
  return input
}

function typeInto(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement
  const setter = Object.getOwnPropertyDescriptor(prototype.prototype, "value")?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event("input", { bubbles: true }))
}

function blur(input: HTMLInputElement | HTMLTextAreaElement) {
  input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }))
}

type CardUpdateCommand = Extract<ClientCommand, { type: "board.card.update" }>

function updates(harness: Harness): CardUpdateCommand[] {
  return harness.commands.filter((command): command is CardUpdateCommand => command.type === "board.card.update")
}

const FULL: CardContent = {
  description: { kind: "longtext", value: "The login redirect loops on refresh." },
  assignee: { kind: "text", value: "Ada" },
  estimate: { kind: "number", value: 3 },
  due: { kind: "date", value: Date.UTC(2026, 2, 1) },
  priority: { kind: "select", optionId: "high" },
  areas: { kind: "multiselect", optionIds: ["ui"] },
  labels: { kind: "label", values: ["bug", "auth"] },
  externalUrl: { kind: "url", value: "https://github.com/o/r/issues/412" },
}

describe("CardDrawer card schema", () => {
  test("renders every field the board declares, in the order it declares them", async () => {
    const harness = await mountSchema(FULL)
    const text = harness.container.textContent ?? ""
    for (const field of SCHEMA) expect(text).toContain(field.label)
    expect(text.indexOf("Description")).toBeLessThan(text.indexOf("Assignee"))
    expect(text.indexOf("Assignee")).toBeLessThan(text.indexOf("Priority"))
    harness.unmount()
  })

  test("shows each kind's value, options by their label rather than their id", async () => {
    const harness = await mountSchema(FULL)
    const text = harness.container.textContent ?? ""
    expect(text).toContain("The login redirect loops on refresh.")
    expect(text).toContain("Ada")
    expect(text).toContain("2026-03-01")
    expect(text).toContain("High")
    expect(text).toContain("bug, auth")
    harness.unmount()
  })

  test("a value the schema does not declare is not rendered", async () => {
    const harness = await mountSchema({ ...FULL, retired: { kind: "text", value: "ghost-value" } })
    expect(harness.container.textContent).not.toContain("ghost-value")
    harness.unmount()
  })

  test("a board with no schema renders no fields and still draws", async () => {
    const harness = await mount(schemaDetail(FULL), () => Promise.resolve(RESULT))
    expect(harness.container.textContent).not.toContain("Assignee")
    expect(harness.container.textContent).toContain("Fix: login redirect loop")
    harness.unmount()
  })

  test("an empty required field says so, and saving is never refused", async () => {
    const harness = await mountSchema({})
    expect(harness.container.textContent).toContain("Required")
    await act(async () => {
      fieldButton(harness.container, "Assignee").click()
    })
    await act(async () => {
      const input = fieldInput(harness.container, "Assignee")
      typeInto(input, "Ada")
      blur(input)
    })
    expect(updates(harness)).toHaveLength(1)
    harness.unmount()
  })

  test("a number and a date carry tabular-nums so a value cannot reflow the row", async () => {
    const harness = await mountSchema(FULL)
    expect(fieldButton(harness.container, "Estimate").className).toContain("tabular-nums")
    expect(fieldButton(harness.container, "Due").className).toContain("tabular-nums")
    harness.unmount()
  })

  test("a url still opens in a new tab, with the scheme stripped from what is read", async () => {
    const harness = await mountSchema(FULL)
    const link = harness.container.querySelector<HTMLAnchorElement>('dl a[target="_blank"]')
    expect(link?.getAttribute("href")).toBe("https://github.com/o/r/issues/412")
    expect(link?.textContent).toBe("github.com/o/r/issues/412")
    harness.unmount()
  })

  test("an option's colour is a dot, not a fill", async () => {
    const harness = await mountSchema(FULL)
    const dot = harness.container.querySelector(".bg-destructive")
    expect(dot).not.toBeNull()
    expect(dot?.className).toContain("rounded-full")
    harness.unmount()
  })
})

describe("CardDrawer field editing", () => {
  test("commits on blur, and carries the fields the edit did not touch", async () => {
    const harness = await mountSchema(FULL)
    await act(async () => {
      fieldButton(harness.container, "Assignee").click()
    })
    await act(async () => {
      const input = fieldInput(harness.container, "Assignee")
      typeInto(input, "Grace")
      blur(input)
    })

    expect(updates(harness)).toEqual([
      {
        type: "board.card.update",
        cardId: "card-1",
        content: { ...FULL, assignee: { kind: "text", value: "Grace" } },
      },
    ])
    harness.unmount()
  })

  test("Enter commits", async () => {
    const harness = await mountSchema(FULL)
    await act(async () => {
      fieldButton(harness.container, "Assignee").click()
    })
    await act(async () => {
      const input = fieldInput(harness.container, "Assignee")
      typeInto(input, "Grace")
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
    })
    expect(updates(harness)).toHaveLength(1)
    harness.unmount()
  })

  test("Escape reverts and sends nothing", async () => {
    const harness = await mountSchema(FULL)
    await act(async () => {
      fieldButton(harness.container, "Assignee").click()
    })
    await act(async () => {
      const input = fieldInput(harness.container, "Assignee")
      typeInto(input, "Grace")
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
      blur(input)
    })
    expect(updates(harness)).toEqual([])
    expect(harness.container.textContent).toContain("Ada")
    harness.unmount()
  })

  test("emptying a field removes it rather than storing an empty one", async () => {
    const harness = await mountSchema(FULL)
    await act(async () => {
      fieldButton(harness.container, "Assignee").click()
    })
    await act(async () => {
      const input = fieldInput(harness.container, "Assignee")
      typeInto(input, "  ")
      blur(input)
    })
    const [update] = updates(harness)
    if (!update) throw new Error("expected a board.card.update command")
    expect(update.content).not.toHaveProperty("assignee")
    expect(update.content).toHaveProperty("description")
    harness.unmount()
  })

  test("only one field is open at a time", async () => {
    const harness = await mountSchema(FULL)
    await act(async () => {
      fieldButton(harness.container, "Assignee").click()
    })
    await act(async () => {
      fieldButton(harness.container, "Estimate").click()
    })
    expect(harness.container.querySelectorAll("dl input, dl textarea")).toHaveLength(1)
    expect(fieldInput(harness.container, "Estimate")).toBeDefined()
    harness.unmount()
  })

  test("a longtext edits as a textarea, so a body keeps its lines", async () => {
    const harness = await mountSchema(FULL)
    await act(async () => {
      fieldButton(harness.container, "Description").click()
    })
    expect(fieldInput(harness.container, "Description").tagName).toBe("TEXTAREA")
    harness.unmount()
  })

  test("toggling a multiselect chip commits that option", async () => {
    const harness = await mountSchema(FULL)
    const chip = harness.container.querySelector<HTMLButtonElement>('button[aria-label="API"]')
    expect(chip?.getAttribute("aria-pressed")).toBe("false")
    await act(async () => {
      chip?.click()
    })
    const [update] = updates(harness)
    const content = update?.content
    if (content === undefined || !isJsonObject(content)) throw new Error("expected a board.card.update command")
    expect(content.areas).toEqual({ kind: "multiselect", optionIds: ["ui", "api"] })
    harness.unmount()
  })

  test("a rejected write is reported and the value is not left changed", async () => {
    const commands: ClientCommand[] = []
    const socket: CardDrawerSocket = {
      command: <TResult,>(command: ClientCommand) => {
        commands.push(command)
        const type = (command as { type: string }).type
        if (type === "board.card.detail") return Promise.resolve(schemaDetail(FULL) as TResult)
        if (type === "board.card.update") {
          return Promise.reject(new Error("That change does not match this board's card fields."))
        }
        return Promise.resolve(undefined as TResult)
      },
    }
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(
        <CardDrawer cardId="card-1" socket={socket} cardFields={SCHEMA} onClose={() => undefined} />,
      )
    })
    await act(async () => {
      fieldButton(container, "Assignee").click()
    })
    await act(async () => {
      const input = fieldInput(container, "Assignee")
      typeInto(input, "Grace")
      blur(input)
    })
    expect(container.textContent).toContain("does not match this board's card fields")
    expect(container.textContent).toContain("Ada")
    act(() => root.unmount())
    container.remove()
  })
})

describe("CardDrawer Work section", () => {
  test("Work groups agent activity under its chat", async () => {
    const harness = await mount(
      linkedDetail([link("chat-77", "chat", 2)]),
      () => Promise.resolve(RESULT),
      { "chat-77": { title: "Fix login redirect", status: "running", unread: false, activity: { ...EMPTY_CHAT_ACTIVITY, agents: 2 } } },
    )
    expect(harness.container.textContent).toContain("2 agents")
    harness.unmount()
  })

  test("Work section shows workflow name under its chat", async () => {
    const harness = await mount(
      linkedDetail([link("chat-77", "chat", 2)]),
      () => Promise.resolve(RESULT),
      { "chat-77": { title: "Review changes", status: "running", unread: false, activity: { ...EMPTY_CHAT_ACTIVITY, workflow: { name: "deep-research", agentCount: 4 } } } },
    )
    expect(harness.container.textContent).toContain("deep-research")
    harness.unmount()
  })

  test("a chat with no active work shows its status only, not a work row", async () => {
    const harness = await mount(
      linkedDetail([link("chat-77", "chat", 2)]),
      () => Promise.resolve(RESULT),
      { "chat-77": { title: "Fix login redirect", status: "idle", unread: false, activity: EMPTY_CHAT_ACTIVITY } },
    )
    expect(harness.container.textContent).toContain("Idle")
    const workRows = harness.container.querySelectorAll("[data-work-row]")
    expect(workRows).toHaveLength(0)
    harness.unmount()
  })
})

describe("CardDrawer From GitHub fields", () => {
  test("labels and assignee render with no edit affordance when from GitHub", async () => {
    const fromGitHubSchema: readonly FieldDef[] = [
      { id: "labels", label: "Labels", kind: "label", options: null, required: false },
      { id: "assignee", label: "Assignee", kind: "text", options: null, required: false },
    ]
    const detail: CardDetailView = {
      ...detailWith({ kind: "idle" }),
      externalRef: "412",
      card: {
        ...detailWith({ kind: "idle" }).card,
        content: {
          labels: { kind: "label", values: ["bug", "auth"] },
          assignee: { kind: "text", value: "Ada" },
        },
      },
    }
    const harness = await mount(detail, () => Promise.resolve(RESULT), undefined, fromGitHubSchema)
    expect(harness.container.textContent).toContain("bug")
    expect(harness.container.textContent).toContain("Ada")
    const editLabels = harness.container.querySelector('button[aria-label="Edit Labels"]')
    const editAssignee = harness.container.querySelector('button[aria-label="Edit Assignee"]')
    expect(editLabels).toBeNull()
    expect(editAssignee).toBeNull()
    harness.unmount()
  })

  test("labels and assignee remain editable when the card has no GitHub ref", async () => {
    const fromGitHubSchema: readonly FieldDef[] = [
      { id: "labels", label: "Labels", kind: "label", options: null, required: false },
      { id: "assignee", label: "Assignee", kind: "text", options: null, required: false },
    ]
    const detail: CardDetailView = {
      ...detailWith({ kind: "idle" }),
      externalRef: null,
      card: {
        ...detailWith({ kind: "idle" }).card,
        content: {
          labels: { kind: "label", values: ["bug"] },
          assignee: { kind: "text", value: "Ada" },
        },
      },
    }
    const harness = await mount(detail, () => Promise.resolve(RESULT), undefined, fromGitHubSchema)
    expect(harness.container.querySelector('button[aria-label="Edit Assignee"]')).not.toBeNull()
    harness.unmount()
  })
})
