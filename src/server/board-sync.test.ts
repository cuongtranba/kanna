import { beforeEach, describe, expect, test } from "bun:test"
import { createBoardSync, type BoardSync } from "./board-sync"
import { createBoardRegistry, type BoardRegistry } from "./board-registry"
import { createBoardStore } from "./board-store.adapter"
import type { BoardStore } from "./board-store"
import type { BoardSyncProvider, PullInput, PushInput, PushOutcome, RemoteItem } from "../shared/boards/sync-types"
import type { BoardTemplateDefinition, ProviderId } from "../shared/boards/types"

const T0 = 1_700_000_000_000
const MINUTE = 60_000

const DEFINITION: BoardTemplateDefinition = {
  columns: [
    { title: "Open", semantic: "start", colorToken: null, wipLimit: null },
    { title: "Doing", semantic: "active", colorToken: null, wipLimit: null },
    { title: "Closed", semantic: "done", colorToken: null, wipLimit: null },
  ],
  cardFields: [],
  mappingDefaults: [],
}

function issue(overrides: Partial<RemoteItem> = {}): RemoteItem {
  return {
    externalId: "412",
    url: "https://github.com/o/r/issues/412",
    title: "Fix: login redirect loop",
    body: "Steps",
    state: "open",
    labels: ["auth"],
    assignee: null,
    updatedAt: T0,
    ...overrides,
  }
}

/** A provider that serves a scripted page and records what was pushed. */
function fakeProvider() {
  let page: RemoteItem[] = []
  let outcome: PushOutcome = { ok: true, externalId: "412", url: "u", remoteUpdatedAt: T0 + 10 * MINUTE }
  const pushes: PushInput["changes"][number][] = []
  const provider: BoardSyncProvider = {
    id: "github-issues",
    capabilities: { push: true },
    discoverSources: () => Promise.resolve([]),
    pull: (input: PullInput) =>
      Promise.resolve({
        items: page,
        cursor: page.length > 0 ? new Date(Math.max(...page.map((i) => i.updatedAt))).toISOString() : input.cursor,
        rateLimit: { remaining: 4999, resetAt: T0 },
      }),
    push: (input: PushInput) => {
      pushes.push(...input.changes)
      return Promise.resolve(input.changes.map(() => outcome))
    },
  }
  return {
    provider,
    serve: (items: RemoteItem[]) => {
      page = items
    },
    failWith: (next: PushOutcome) => {
      outcome = next
    },
    pushes,
  }
}

let store: BoardStore
let registry: BoardRegistry
let sync: BoardSync
let fake: ReturnType<typeof fakeProvider>
let clock: number
let boardId: string

function setup(allowAgentPush = false) {
  clock = T0
  let counter = 0
  store = createBoardStore({
    filePath: ":memory:",
    now: () => clock,
    newId: () => `id-${(counter += 1).toString().padStart(4, "0")}`,
  })
  registry = createBoardRegistry({ store })
  fake = fakeProvider()
  const board = registry.createBoard({
    owner: { kind: "project", id: "p1" },
    title: "Issues",
    definition: DEFINITION,
  })
  boardId = board.id
  store.upsertBinding({
    boardId,
    providerId: "github-issues",
    sourceRef: { provider: "github-issues", owner: "o", repo: "r" },
    direction: "both",
    allowAgentPush,
  })
  const providers = new Map<ProviderId, BoardSyncProvider>([["github-issues", fake.provider]])
  sync = createBoardSync({
    registry,
    store,
    providers,
    readToken: () => Promise.resolve({ token: "t", reason: "ok", detail: null }),
    now: () => clock,
  })
}

function columns() {
  return store.listColumns(boardId)
}

function cardsIn(title: string) {
  const column = columns().find((candidate) => candidate.title === title)
  if (!column) return []
  return store.listCardPage({ columnId: column.id, limit: 50 }).cards
}

beforeEach(() => setup())

describe("pull", () => {
  test("a first pull imports issues as cards in the open column", async () => {
    fake.serve([issue(), issue({ externalId: "413", title: "Second" })])
    const summary = await sync.pull(boardId)

    expect(summary.created).toBe(2)
    expect(cardsIn("Open").map((card) => card.title)).toEqual(["Fix: login redirect loop", "Second"])
    expect(summary.rateLimitRemaining).toBe(4999)
  })

  test("imported content carries body, labels and the source link", async () => {
    fake.serve([issue({ labels: ["auth", "bug"], assignee: "octocat" })])
    await sync.pull(boardId)

    const card = cardsIn("Open")[0]
    expect(card?.content.description).toEqual({ kind: "longtext", value: "Steps" })
    expect(card?.content.labels).toEqual({ kind: "label", values: ["auth", "bug"] })
    expect(card?.content.assignee).toEqual({ kind: "text", value: "octocat" })
    expect(card?.content.externalUrl).toEqual({ kind: "url", value: "https://github.com/o/r/issues/412" })
  })

  test("a closed issue lands in the column marked done", async () => {
    fake.serve([issue({ state: "closed" })])
    await sync.pull(boardId)
    expect(cardsIn("Closed")).toHaveLength(1)
    expect(cardsIn("Open")).toHaveLength(0)
  })

  test("pulling the same page twice creates nothing and changes nothing", async () => {
    fake.serve([issue()])
    await sync.pull(boardId)
    const second = await sync.pull(boardId)
    expect(second).toMatchObject({ created: 0, updated: 0, unchanged: 1, conflicts: 0, queued: 0 })
    expect(cardsIn("Open")).toHaveLength(1)
  })

  test("a remote edit updates the card", async () => {
    fake.serve([issue()])
    await sync.pull(boardId)
    clock = T0 + MINUTE
    fake.serve([issue({ title: "Renamed remotely", updatedAt: T0 + MINUTE })])
    const summary = await sync.pull(boardId)

    expect(summary.updated).toBe(1)
    expect(cardsIn("Open")[0]?.title).toBe("Renamed remotely")
  })

  test("a remote close moves the card to the done column", async () => {
    fake.serve([issue()])
    await sync.pull(boardId)
    clock = T0 + MINUTE
    fake.serve([issue({ state: "closed", updatedAt: T0 + MINUTE })])
    await sync.pull(boardId)

    expect(cardsIn("Closed")).toHaveLength(1)
    expect(cardsIn("Open")).toHaveLength(0)
  })

  test("a local edit is queued for push, not overwritten", async () => {
    fake.serve([issue()])
    await sync.pull(boardId)
    const card = cardsIn("Open")[0]!

    clock = T0 + 2 * MINUTE
    registry.updateCard(card.id, { title: "Ours" }, { kind: "user" })

    const summary = await sync.pull(boardId)
    expect(summary.queued).toBe(1)
    expect(cardsIn("Open")[0]?.title).toBe("Ours")

    const binding = store.getBinding(boardId)!
    expect(store.dueOutbox(binding.id, clock, 10)).toHaveLength(1)
  })

  test("an agent's edit is HELD when the binding forbids agent pushes", async () => {
    // An agent moving a card must not silently close a real issue.
    fake.serve([issue()])
    await sync.pull(boardId)
    const card = cardsIn("Open")[0]!

    clock = T0 + 2 * MINUTE
    registry.updateCard(card.id, { title: "Agent wrote this" }, { kind: "agent", chatId: "chat-1" })
    await sync.pull(boardId)

    const binding = store.getBinding(boardId)!
    // Held entries stay in the table — visible — but the drain never sees them.
    expect(store.dueOutbox(binding.id, clock, 10)).toHaveLength(0)
    expect((await sync.drain(boardId)).pushed).toBe(0)
  })

  test("an agent's edit IS queued once the binding opts in", async () => {
    setup(true)
    fake.serve([issue()])
    await sync.pull(boardId)
    const card = cardsIn("Open")[0]!

    clock = T0 + 2 * MINUTE
    registry.updateCard(card.id, { title: "Agent wrote this" }, { kind: "agent", chatId: "chat-1" })
    await sync.pull(boardId)

    const binding = store.getBinding(boardId)!
    expect(store.dueOutbox(binding.id, clock, 10)).toHaveLength(1)
  })

  test("both sides edited: the newer wins and the loss is recorded", async () => {
    fake.serve([issue()])
    await sync.pull(boardId)
    const card = cardsIn("Open")[0]!

    clock = T0 + 3 * MINUTE
    registry.updateCard(card.id, { title: "Ours" }, { kind: "user" })

    clock = T0 + 4 * MINUTE
    fake.serve([issue({ title: "Theirs", updatedAt: T0 + 2 * MINUTE })])
    const summary = await sync.pull(boardId)

    expect(summary.conflicts).toBe(1)
    // Local edit was newer, so it stands — and is queued rather than lost.
    expect(cardsIn("Open")[0]?.title).toBe("Ours")
    expect(store.listConflicts(boardId, 10)[0]).toMatchObject({ field: "title", resolvedAs: "local" })
  })

  test("the cursor is stored so the next pull resumes", async () => {
    fake.serve([issue({ updatedAt: T0 + 5 * MINUTE })])
    const summary = await sync.pull(boardId)
    expect(store.getBinding(boardId)?.cursor).toBe(summary.cursor)
    expect(store.getBinding(boardId)?.lastPulledAt).toBe(clock)
  })

  test("an unbound board refuses rather than pretending to sync", async () => {
    const other = registry.createBoard({ owner: { kind: "project", id: "p1" }, title: "Unbound" })
    await expect(sync.pull(other.id)).rejects.toThrow(/not connected/)
  })
})

describe("drain", () => {
  test("pushes a queued change and clears it", async () => {
    fake.serve([issue()])
    await sync.pull(boardId)
    const card = cardsIn("Open")[0]!
    clock = T0 + 2 * MINUTE
    registry.updateCard(card.id, { title: "Ours" }, { kind: "user" })
    await sync.pull(boardId)

    const summary = await sync.drain(boardId)
    expect(summary).toEqual({ pushed: 1, failed: 0, held: 0 })
    expect(fake.pushes[0]).toMatchObject({ externalId: "412", title: "Ours" })

    const binding = store.getBinding(boardId)!
    expect(store.dueOutbox(binding.id, clock, 10)).toHaveLength(0)
  })

  test("after a push the next pull does NOT echo our own change back", async () => {
    // The whole point of stamping the remote timestamp our write produced.
    fake.serve([issue()])
    await sync.pull(boardId)
    const card = cardsIn("Open")[0]!
    clock = T0 + 2 * MINUTE
    registry.updateCard(card.id, { title: "Ours" }, { kind: "user" })
    await sync.pull(boardId)
    await sync.drain(boardId)

    clock = T0 + 20 * MINUTE
    // The remote still serves its OLD title, at a timestamp below the watermark.
    fake.serve([issue({ title: "Theirs", updatedAt: T0 + 9 * MINUTE })])
    const summary = await sync.pull(boardId)

    expect(summary.updated).toBe(0)
    expect(cardsIn("Open")[0]?.title).toBe("Ours")
  })

  test("a retryable failure is deferred with backoff, not dropped", async () => {
    fake.serve([issue()])
    await sync.pull(boardId)
    const card = cardsIn("Open")[0]!
    clock = T0 + 2 * MINUTE
    registry.updateCard(card.id, { title: "Ours" }, { kind: "user" })
    await sync.pull(boardId)

    fake.failWith({ ok: false, retryable: true, message: "500 Server Error" })
    expect(await sync.drain(boardId)).toEqual({ pushed: 0, failed: 1, held: 0 })

    const binding = store.getBinding(boardId)!
    // Not due yet, but still queued.
    expect(store.dueOutbox(binding.id, clock, 10)).toHaveLength(0)
    expect(store.dueOutbox(binding.id, clock + 60 * MINUTE, 10)).toHaveLength(1)
  })

  test("a permanent failure is dropped rather than retried forever", async () => {
    fake.serve([issue()])
    await sync.pull(boardId)
    const card = cardsIn("Open")[0]!
    clock = T0 + 2 * MINUTE
    registry.updateCard(card.id, { title: "Ours" }, { kind: "user" })
    await sync.pull(boardId)

    fake.failWith({ ok: false, retryable: false, message: "422 Unprocessable" })
    expect(await sync.drain(boardId)).toEqual({ pushed: 0, failed: 1, held: 0 })

    const binding = store.getBinding(boardId)!
    expect(store.dueOutbox(binding.id, clock + 60 * MINUTE, 10)).toHaveLength(0)
  })

  test("a pull-only binding never pushes", async () => {
    store.upsertBinding({
      boardId,
      providerId: "github-issues",
      sourceRef: { provider: "github-issues", owner: "o", repo: "r" },
      direction: "pull",
      allowAgentPush: false,
    })
    expect(await sync.drain(boardId)).toEqual({ pushed: 0, failed: 0, held: 0 })
    expect(fake.pushes).toHaveLength(0)
  })
})
