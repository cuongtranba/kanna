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

    const binding = store.listBindings(boardId)[0]!
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

    const binding = store.listBindings(boardId)[0]!
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

    const binding = store.listBindings(boardId)[0]!
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
    // The cursor is reported PER BINDING: with N bindings there is no single
    // cursor a summary could carry, and one that named the last binding's
    // would be a number that belongs to nothing.
    expect(summary.bindings).toHaveLength(1)
    expect(store.listBindings(boardId)[0]?.cursor).toBe(summary.bindings[0]?.cursor ?? null)
    expect(store.listBindings(boardId)[0]?.lastPulledAt).toBe(clock)
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

    const binding = store.listBindings(boardId)[0]!
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

    const binding = store.listBindings(boardId)[0]!
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

    const binding = store.listBindings(boardId)[0]!
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

describe("multiple bindings", () => {
  function smartFake() {
    const pages = new Map<string, RemoteItem[]>()
    const pushesByOwner = new Map<string, PushInput["changes"][number][]>()
    let blockedOwner: string | null = null
    const provider: BoardSyncProvider = {
      id: "github-issues",
      capabilities: { push: true },
      discoverSources: () => Promise.resolve([]),
      pull: (input: PullInput) => {
        const src = input.source as { owner: string; repo: string }
        if (blockedOwner === src.owner) throw new Error(`rate limited: ${src.owner}`)
        const page = pages.get(`${src.owner}/${src.repo}`) ?? []
        return Promise.resolve({
          items: page,
          cursor: page.length > 0 ? new Date(Math.max(...page.map((i) => i.updatedAt))).toISOString() : input.cursor,
          rateLimit: { remaining: 4999, resetAt: T0 },
        })
      },
      push: (input: PushInput) => {
        const src = input.source as { owner: string; repo: string }
        const bucket = pushesByOwner.get(src.owner) ?? []
        bucket.push(...input.changes)
        pushesByOwner.set(src.owner, bucket)
        const outcome: PushOutcome = { ok: true, externalId: "ext", url: "u", remoteUpdatedAt: T0 + MINUTE }
        return Promise.resolve(input.changes.map(() => outcome))
      },
    }
    return {
      provider,
      serveFor(owner: string, repo: string, items: RemoteItem[]) {
        pages.set(`${owner}/${repo}`, items)
      },
      blockOwner(owner: string) {
        blockedOwner = owner
      },
      pushesFor: (owner: string) => pushesByOwner.get(owner) ?? [],
    }
  }

  let multiStore: BoardStore
  let multiRegistry: BoardRegistry
  let multiSync: BoardSync
  let smart: ReturnType<typeof smartFake>
  let multiBoardId: string

  beforeEach(() => {
    clock = T0
    let counter = 100
    multiStore = createBoardStore({
      filePath: ":memory:",
      now: () => clock,
      newId: () => `id-${(counter += 1).toString().padStart(4, "0")}`,
    })
    multiRegistry = createBoardRegistry({ store: multiStore })
    smart = smartFake()
    const board = multiRegistry.createBoard({
      owner: { kind: "project", id: "p1" },
      title: "Multi",
      definition: DEFINITION,
    })
    multiBoardId = board.id
    multiStore.upsertBinding({
      boardId: multiBoardId,
      providerId: "github-issues",
      sourceRef: { provider: "github-issues", owner: "o1", repo: "r1" },
      direction: "both",
      allowAgentPush: false,
    })
    multiStore.upsertBinding({
      boardId: multiBoardId,
      providerId: "github-issues",
      sourceRef: { provider: "github-issues", owner: "o2", repo: "r2" },
      direction: "both",
      allowAgentPush: false,
    })
    const providers = new Map<ProviderId, BoardSyncProvider>([["github-issues", smart.provider]])
    multiSync = createBoardSync({
      registry: multiRegistry,
      store: multiStore,
      providers,
      readToken: () => Promise.resolve({ token: "t", reason: "ok", detail: null }),
      now: () => clock,
    })
  })

  test("a board with 2 bindings pulls from both, each advancing its own cursor", async () => {
    smart.serveFor("o1", "r1", [issue({ externalId: "101", title: "Repo 1 item" })])
    smart.serveFor("o2", "r2", [issue({ externalId: "201", title: "Repo 2 item", updatedAt: T0 + MINUTE })])

    const summary = await multiSync.pull(multiBoardId)

    expect(summary.created).toBe(2)
    const bindings = multiStore.listBindings(multiBoardId)
    const b1 = bindings.find((b) => b.sourceRef.owner === "o1")!
    const b2 = bindings.find((b) => b.sourceRef.owner === "o2")!
    expect(b1.cursor).not.toBeNull()
    expect(b2.cursor).not.toBeNull()
    expect(b1.cursor).not.toBe(b2.cursor)
  })

  test("a push routes to the binding that owns the card's sync link, not the first one", async () => {
    smart.serveFor("o2", "r2", [issue({ externalId: "201", title: "Repo-2 item" })])
    await multiSync.pull(multiBoardId)

    const bindings = multiStore.listBindings(multiBoardId)
    const b2 = bindings.find((b) => b.sourceRef.owner === "o2")!
    const link = multiStore.getSyncLinkByExternal(b2.id, "201")!
    const card = multiStore.getCard(link.cardId)!

    clock = T0 + 2 * MINUTE
    multiRegistry.updateCard(card.id, { title: "Changed locally" }, { kind: "user" })
    await multiSync.pull(multiBoardId)
    await multiSync.drain(multiBoardId)

    expect(smart.pushesFor("o2")).toHaveLength(1)
    expect(smart.pushesFor("o1")).toHaveLength(0)
  })

  test("a rate-limited binding does not block the other's pull", async () => {
    smart.serveFor("o2", "r2", [issue({ externalId: "201", title: "Repo-2 item" })])
    smart.blockOwner("o1")

    const summary = await multiSync.pull(multiBoardId)

    expect(summary.created).toBe(1)
    const bindings = multiStore.listBindings(multiBoardId)
    const b2 = bindings.find((b) => b.sourceRef.owner === "o2")!
    expect(b2.cursor).not.toBeNull()
  })

  /**
   * Isolating a failing binding must not mean HIDING it. Swallowing the throw
   * makes a board whose token expired, whose repo was renamed, or whose adapter
   * is missing report a clean zero — indistinguishable from "nothing to sync",
   * which is the one answer that stops anyone looking.
   */
  test("a binding that fails is reported on the summary, not silently swallowed", async () => {
    smart.serveFor("o2", "r2", [issue({ externalId: "201", title: "Repo-2 item" })])
    smart.blockOwner("o1")

    const summary = await multiSync.pull(multiBoardId)

    const bindings = multiStore.listBindings(multiBoardId)
    const b1 = bindings.find((b) => b.sourceRef.owner === "o1")!
    const b2 = bindings.find((b) => b.sourceRef.owner === "o2")!

    expect(summary.bindings).toHaveLength(2)
    expect(summary.bindings.find((r) => r.bindingId === b1.id)?.error).toContain("rate limited")
    expect(summary.bindings.find((r) => r.bindingId === b2.id)?.error).toBeNull()
    expect(summary.bindings.find((r) => r.bindingId === b2.id)?.cursor).not.toBeNull()
  })

  test("a binding with no adapter is reported rather than dropped from the run", async () => {
    // A board bound through a provider this server does not carry is a
    // misconfiguration the user has to be told about; dropping the entry makes
    // it look like the binding does not exist.
    multiStore.upsertBinding({
      boardId: multiBoardId,
      providerId: "github-projectv2",
      sourceRef: { provider: "github-projectv2", owner: "o3", projectNumber: 1, projectId: "pv2" },
      direction: "both",
      allowAgentPush: false,
    })

    const summary = await multiSync.pull(multiBoardId)

    const orphan = multiStore
      .listBindings(multiBoardId)
      .find((b) => b.providerId === "github-projectv2")!
    expect(summary.bindings.find((r) => r.bindingId === orphan.id)?.error).toContain("github-projectv2")
  })

  test("held entries are counted on the drain summary rather than reported as zero", async () => {
    smart.serveFor("o2", "r2", [issue({ externalId: "201", title: "Repo-2 item" })])
    await multiSync.pull(multiBoardId)

    const b2 = multiStore.listBindings(multiBoardId).find((b) => b.sourceRef.owner === "o2")!
    const link = multiStore.getSyncLinkByExternal(b2.id, "201")!

    clock = T0 + 2 * MINUTE
    // An agent edit against a binding that forbids agent pushes: held, never drained.
    multiRegistry.updateCard(link.cardId, { title: "Agent wrote this" }, { kind: "agent", chatId: "c1" })
    await multiSync.pull(multiBoardId)

    const summary = await multiSync.drain(multiBoardId)

    expect(summary.pushed).toBe(0)
    // `held` used to be declared and never incremented — dueOutbox filters held
    // rows out, so the drain could not see what it was not doing.
    expect(summary.held).toBe(1)
  })
})
