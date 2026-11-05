import { MCP_SOURCE_AUTONOMY_DEFAULTS } from "../../shared/inbox/autonomy"
import { describe, expect, test } from "vite-plus/test"
import type { JsonObject, JsonValue } from "../../shared/json"
import type { McpPollSource, McpSubscribeSource } from "../../shared/mcp-sources/types"
import type { McpServerConfig } from "../../shared/mcp-types"
import type { InboundDelivery, InboundDeliveryResult } from "../inbound/deliver-inbound"
import {
  McpSourceRunner,
  McpSourceUnavailableError,
  type McpSourceClock,
  type McpSourceConnection,
  type McpSourceCursors,
  type McpSourceCloseReason,
  type McpSourceListening,
} from "./mcp-source-runner"

const SERVER: McpServerConfig = {
  id: "srv",
  name: "zalo",
  enabled: true,
  transport: "http",
  url: "http://127.0.0.1:3847/mcp",
  headers: {},
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  lastTest: { status: "untested" },
}

const HANDLER = { mode: "spawn" as const, projectId: "p1", template: "New message", replyHint: "", pushEnabled: true }

const POLL: McpPollSource = {
  id: "poll",
  name: "Zalo",
  mode: "poll",
  serverId: "srv",
  enabled: true,
  threadKeyPath: "threadId",
  senderPath: "senderName",
  textPath: "",
  handler: HANDLER,
  reply: null,
  tool: "zalo_get_messages",
  args: { limit: 50 },
  cursorArg: "since",
  cursorPath: "cursor",
  itemsPath: "messages",
  itemKeyPath: "messageId",
  intervalMs: 10_000,
  autonomy: MCP_SOURCE_AUTONOMY_DEFAULTS,
  createdAt: 1,
  updatedAt: 1,
}

const SUBSCRIBE: McpSubscribeSource = {
  id: "sub",
  name: "Feed",
  mode: "subscribe",
  serverId: "srv",
  enabled: true,
  threadKeyPath: "",
  senderPath: "",
  textPath: "",
  handler: HANDLER,
  reply: null,
  resourceUris: ["feed://inbox"],
  itemsPath: "",
  itemKeyPath: null,
  resyncIntervalMs: null,
  autonomy: MCP_SOURCE_AUTONOMY_DEFAULTS,
  createdAt: 1,
  updatedAt: 1,
}

const SUBSCRIBE_ITEMS: McpSubscribeSource = {
  ...SUBSCRIBE,
  threadKeyPath: "threadId",
  senderPath: "senderName",
  itemsPath: "messages",
  itemKeyPath: "id",
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let turn = 0; turn < 500; turn += 1) {
    if (predicate()) return
    await new Promise<void>((done) => setTimeout(done, 0))
  }
  throw new Error("condition was never met")
}

function settle(): Promise<void> {
  return new Promise<void>((done) => setTimeout(done, 5))
}

function createClock() {
  const sleeps: { ms: number; release: () => void }[] = []
  const time = { now: 1_000_000 }
  const clock: McpSourceClock = {
    now: () => time.now,
    random: () => 0,
    sleep: (ms, signal) =>
      new Promise<void>((done) => {
        if (signal.aborted) return done()
        const entry = { ms, release: done }
        sleeps.push(entry)
        signal.addEventListener("abort", () => { done() }, { once: true })
      }),
  }
  return { clock, sleeps, time }
}

function createCursorStore(initial: McpSourceCursors = {}) {
  const store = { saved: initial, load: async () => store.saved, save: async (all: McpSourceCursors) => { store.saved = all } }
  return store
}

function createHarness(options: { bearer?: string; deliverOk?: () => boolean } = {}) {
  const deliveries: InboundDelivery[] = []
  const { clock, sleeps, time } = createClock()
  const cursors = createCursorStore()
  const opened: { bearer: string | undefined; connection: FakeConnection }[] = []
  const connections: (() => FakeConnection)[] = []
  const runner = new McpSourceRunner(
    {
      async open(_server, bearer) {
        const connection = (connections.shift() ?? (() => new FakeConnection()))()
        opened.push({ bearer, connection })
        return connection
      },
    },
    cursors,
    async () => options.bearer,
    async (delivery): Promise<InboundDeliveryResult> => {
      if (options.deliverOk && !options.deliverOk()) return { ok: false, detail: "target project not found" }
      deliveries.push(delivery)
      return { ok: true, threadId: "t1", chatId: "c1" }
    },
    clock,
  )
  return { runner, deliveries, sleeps, time, cursors, opened, connections }
}

class FakeConnection implements McpSourceConnection {
  closed = false
  listenCalls: string[][] = []
  toolCalls: JsonObject[] = []
  reads = 0
  honored: string[] | null = null
  notify: (uri: string) => void = () => {}
  endListening: (reason: McpSourceCloseReason) => void = () => {}
  resource: JsonValue = { text: "hello" }
  readResults: (JsonValue | Error)[] = []
  readGate: Promise<void> | null = null
  lostOnReadError = false
  toolResults: (JsonValue | Error)[] = []
  inFlight = 0
  maxInFlight = 0
  gate: Promise<void> | null = null

  async listen(uris: string[], onUpdated: (uri: string) => void): Promise<McpSourceListening> {
    this.listenCalls.push(uris)
    this.notify = onUpdated
    const closed = deferred<McpSourceCloseReason>()
    this.endListening = closed.resolve
    return { honoredUris: this.honored ?? uris, closed: closed.promise, close: async () => { closed.resolve("local") } }
  }

  async readResource(): Promise<JsonValue> {
    this.reads += 1
    if (this.readGate) await this.readGate
    const next = this.readResults.shift()
    if (next instanceof Error) {
      if (this.lostOnReadError) this.endListening("remote")
      throw next
    }
    return next ?? this.resource
  }

  async callTool(_name: string, args: JsonObject): Promise<JsonValue> {
    this.toolCalls.push(args)
    this.inFlight += 1
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight)
    if (this.gate) await this.gate
    this.inFlight -= 1
    const next = this.toolResults.shift()
    if (next instanceof Error) throw next
    return next ?? { messages: [], cursor: null }
  }

  async close(): Promise<void> {
    this.closed = true
  }
}

function message(id: string, threadId = "t-1"): JsonObject {
  return { messageId: id, threadId, threadType: 0, senderName: "An", text: `text ${id}` }
}

function inbox(...ids: string[]): JsonObject {
  return { messages: ids.map((id) => ({ id, threadId: "t-1", senderName: "An" })) }
}

describe("McpSourceRunner subscribe", () => {
  test("an updated resource is read once and delivered with the thread key from the configured path", async () => {
    const h = createHarness()
    const connection = new FakeConnection()
    h.connections.push(() => connection)
    await h.runner.reconcile([{ ...SUBSCRIBE, threadKeyPath: "uri" }], [SERVER])
    await waitFor(() => h.runner.statuses()[0]?.state === "listening")

    connection.notify("feed://inbox")
    await waitFor(() => h.deliveries.length === 1)

    expect(connection.listenCalls).toEqual([["feed://inbox"]])
    expect(h.deliveries[0]).toMatchObject({
      source: { kind: "mcp", sourceId: "sub", serverName: "zalo" },
      threadKey: "feed://inbox",
      sender: "Feed",
      body: { uri: "feed://inbox", contents: { text: "hello" } },
    })
    await h.runner.stop()
  })

  test("the same content updated twice is delivered once", async () => {
    const h = createHarness()
    const connection = new FakeConnection()
    h.connections.push(() => connection)
    await h.runner.reconcile([SUBSCRIBE], [SERVER])
    await waitFor(() => h.runner.statuses()[0]?.state === "listening")

    await waitFor(() => h.deliveries.length === 1)
    connection.notify("feed://inbox")
    connection.notify("feed://inbox")
    await waitFor(() => connection.reads === 2)
    await settle()

    expect(h.deliveries).toHaveLength(1)
    expect(h.runner.statuses()[0]?.itemCount).toBe(1)
    await h.runner.stop()
  })

  test("a remote close re-listens after a backoff", async () => {
    const h = createHarness()
    const first = new FakeConnection()
    const second = new FakeConnection()
    h.connections.push(() => first, () => second)
    await h.runner.reconcile([SUBSCRIBE], [SERVER])
    await waitFor(() => h.runner.statuses()[0]?.state === "listening")

    first.endListening("remote")
    await waitFor(() => h.runner.statuses()[0]?.state === "backoff")
    expect(h.sleeps[0]?.ms).toBe(1000)
    h.sleeps[0]!.release()
    await waitFor(() => second.listenCalls.length === 1)

    expect(h.opened).toHaveLength(2)
    expect(first.closed).toBe(true)
    await h.runner.stop()
  })

  test("a graceful close reconnects after 30 seconds", async () => {
    const h = createHarness()
    const connection = new FakeConnection()
    h.connections.push(() => connection)
    await h.runner.reconcile([SUBSCRIBE], [SERVER])
    await waitFor(() => h.runner.statuses()[0]?.state === "listening")

    connection.endListening("graceful")
    await waitFor(() => h.sleeps.length === 1)

    expect(h.sleeps[0]?.ms).toBe(30_000)
    await h.runner.stop()
  })

  test("a server that honors no subscriptions is reported as an error", async () => {
    const h = createHarness()
    const connection = new FakeConnection()
    connection.honored = []
    h.connections.push(() => connection)
    await h.runner.reconcile([SUBSCRIBE], [SERVER])
    await waitFor(() => h.runner.statuses()[0]?.state === "error")

    expect(h.runner.statuses()[0]?.lastError).toBe("server does not support resource subscriptions (no URI was honored)")
    await h.runner.stop()
  })

  test("the bearer is resolved for every connection", async () => {
    const h = createHarness({ bearer: "tok" })
    await h.runner.reconcile([SUBSCRIBE], [SERVER])
    await waitFor(() => h.opened.length === 1)

    expect(h.opened[0]?.bearer).toBe("tok")
    await h.runner.stop()
  })
})

describe("McpSourceRunner subscribe items", () => {
  test("the catch-up read delivers each item once and a push that repeats old items delivers only the new one", async () => {
    const h = createHarness()
    const connection = new FakeConnection()
    connection.readResults = [inbox("a", "b"), inbox("a", "b", "c")]
    h.connections.push(() => connection)
    await h.runner.reconcile([SUBSCRIBE_ITEMS], [SERVER])
    await waitFor(() => h.deliveries.length === 2)

    connection.notify("feed://inbox")
    await waitFor(() => h.deliveries.length === 3)

    expect(h.deliveries.map((d) => d.deliveryId)).toEqual(["a", "b", "c"])
    expect(h.deliveries[0]).toMatchObject({ threadKey: "t-1", sender: "An", body: { id: "a" } })
    await h.runner.stop()
  })

  test("a text path delivers the item text beside the untouched body and no text without one", async () => {
    const h = createHarness()
    const connection = new FakeConnection()
    connection.readResults = [{ messages: [{ id: "a", threadId: "t-1", text: "Hello there" }] }]
    h.connections.push(() => connection)
    await h.runner.reconcile([{ ...SUBSCRIBE_ITEMS, textPath: "text" }], [SERVER])
    await waitFor(() => h.deliveries.length === 1)
    expect(h.deliveries[0]).toMatchObject({ text: "Hello there", body: { id: "a", threadId: "t-1", text: "Hello there" } })
    await h.runner.stop()

    const plain = createHarness()
    const plainConnection = new FakeConnection()
    plainConnection.readResults = [inbox("a")]
    plain.connections.push(() => plainConnection)
    await plain.runner.reconcile([SUBSCRIBE_ITEMS], [SERVER])
    await waitFor(() => plain.deliveries.length === 1)
    expect(plain.deliveries[0]).not.toHaveProperty("text")
    await plain.runner.stop()
  })

  test("pushes that arrive during an in-flight read are coalesced into one follow-up read", async () => {
    const h = createHarness()
    const connection = new FakeConnection()
    const gate = deferred<void>()
    connection.readGate = gate.promise
    connection.readResults = [inbox("a"), inbox("a", "b")]
    h.connections.push(() => connection)
    await h.runner.reconcile([SUBSCRIBE_ITEMS], [SERVER])
    await waitFor(() => connection.reads === 1)

    connection.notify("feed://inbox")
    connection.notify("feed://inbox")
    connection.notify("feed://inbox")
    await settle()
    expect(connection.reads).toBe(1)

    gate.resolve()
    await waitFor(() => h.deliveries.length === 2)
    await settle()

    expect(connection.reads).toBe(2)
    expect(h.deliveries.map((d) => d.deliveryId)).toEqual(["a", "b"])
    await h.runner.stop()
  })

  test("a resync re-reads the resources and delivers what a missed notification left behind", async () => {
    const h = createHarness()
    const connection = new FakeConnection()
    connection.readResults = [inbox("a"), inbox("a", "b")]
    h.connections.push(() => connection)
    await h.runner.reconcile([{ ...SUBSCRIBE_ITEMS, resyncIntervalMs: 300_000 }], [SERVER])
    await waitFor(() => h.sleeps.length === 1)

    expect(h.sleeps[0]?.ms).toBe(300_000)
    h.sleeps[0]!.release()
    await waitFor(() => h.deliveries.length === 2)

    expect(h.deliveries.map((d) => d.deliveryId)).toEqual(["a", "b"])
    await h.runner.stop()
  })

  test("a connection lost while reading reconnects, re-subscribes and catches up", async () => {
    const h = createHarness()
    const first = new FakeConnection()
    first.lostOnReadError = true
    first.readResults = [new Error("fetch failed")]
    const second = new FakeConnection()
    second.readResults = [inbox("a")]
    h.connections.push(() => first, () => second)
    await h.runner.reconcile([SUBSCRIBE_ITEMS], [SERVER])
    await waitFor(() => h.sleeps.length === 1)

    expect(h.runner.statuses()[0]).toMatchObject({ state: "backoff" })
    h.sleeps[0]!.release()
    await waitFor(() => h.deliveries.length === 1)

    expect(second.listenCalls).toEqual([["feed://inbox"]])
    expect(first.closed).toBe(true)
    expect(h.runner.statuses()[0]).toMatchObject({ state: "listening", lastError: null })
    await h.runner.stop()
  })

  test("a read the server answers with an error is reported but keeps the connection", async () => {
    const h = createHarness()
    const connection = new FakeConnection()
    connection.readResults = [new Error("resource not found"), inbox("a")]
    h.connections.push(() => connection)
    await h.runner.reconcile([SUBSCRIBE_ITEMS], [SERVER])
    await waitFor(() => h.runner.statuses()[0]?.lastError === "resource not found")

    expect(h.runner.statuses()[0]?.state).toBe("listening")
    connection.notify("feed://inbox")
    await waitFor(() => h.deliveries.length === 1)

    expect(h.opened).toHaveLength(1)
    expect(h.sleeps).toHaveLength(0)
    expect(h.runner.statuses()[0]?.lastError).toBeNull()
    await h.runner.stop()
  })

  test("repeated remote drops back off exponentially and a stable session resets the delay", async () => {
    const h = createHarness()
    const sessions = [new FakeConnection(), new FakeConnection(), new FakeConnection(), new FakeConnection()]
    h.connections.push(...sessions.map((session) => () => session))
    await h.runner.reconcile([SUBSCRIBE], [SERVER])

    for (const [index, expected] of [1000, 2000, 4000].entries()) {
      await waitFor(() => sessions[index]!.listenCalls.length === 1)
      sessions[index]!.endListening("remote")
      await waitFor(() => h.sleeps.length === index + 1)
      expect(h.sleeps[index]?.ms).toBe(expected)
      h.sleeps[index]!.release()
    }

    await waitFor(() => sessions[3]!.listenCalls.length === 1)
    h.time.now += 61_000
    sessions[3]!.endListening("remote")
    await waitFor(() => h.sleeps.length === 4)

    expect(h.sleeps[3]?.ms).toBe(1000)
    await h.runner.stop()
  })
})

describe("McpSourceRunner poll", () => {
  test("items are delivered once, the cursor is persisted and sent on the next poll", async () => {
    const h = createHarness()
    const connection = new FakeConnection()
    connection.toolResults = [
      { messages: [message("m1"), message("m2")], cursor: 7 },
      { messages: [message("m2"), message("m3")], cursor: 9 },
    ]
    h.connections.push(() => connection)
    await h.runner.reconcile([POLL], [SERVER])
    await waitFor(() => h.sleeps.length === 1)

    expect(h.deliveries.map((d) => d.deliveryId)).toEqual(["m1", "m2"])
    expect(h.deliveries[0]).toMatchObject({ threadKey: "t-1", sender: "An", body: { messageId: "m1" } })
    expect(h.cursors.saved.poll?.cursor).toBe(7)
    expect(connection.toolCalls[0]).toEqual({ limit: 50 })

    h.sleeps[0]!.release()
    await waitFor(() => h.sleeps.length === 2)

    expect(connection.toolCalls[1]).toEqual({ limit: 50, since: 7 })
    expect(h.deliveries.map((d) => d.deliveryId)).toEqual(["m1", "m2", "m3"])
    expect(h.cursors.saved.poll).toEqual({ cursor: 9, recentKeys: ["m1", "m2", "m3"] })
    await h.runner.stop()
  })

  test("a persisted cursor survives a restart and polling resumes from it", async () => {
    const h = createHarness()
    h.cursors.saved = { poll: { cursor: 41, recentKeys: ["old"] } }
    const connection = new FakeConnection()
    h.connections.push(() => connection)
    await h.runner.reconcile([POLL], [SERVER])
    await waitFor(() => connection.toolCalls.length === 1)

    expect(connection.toolCalls[0]).toEqual({ limit: 50, since: 41 })
    await h.runner.stop()
  })

  test("polls never overlap even when the tool is slow", async () => {
    const h = createHarness()
    const connection = new FakeConnection()
    const gate = deferred<void>()
    connection.gate = gate.promise
    h.connections.push(() => connection)
    await h.runner.reconcile([POLL], [SERVER])
    await waitFor(() => connection.inFlight === 1)

    expect(h.sleeps).toHaveLength(0)
    gate.resolve()
    await waitFor(() => h.sleeps.length === 1)
    h.sleeps[0]!.release()
    await waitFor(() => h.sleeps.length === 2)

    expect(connection.maxInFlight).toBe(1)
    await h.runner.stop()
  })

  test("errors back off by growing multiples of the interval and recovery resets them", async () => {
    const h = createHarness()
    const connection = new FakeConnection()
    connection.toolResults = [new Error("boom"), new Error("boom"), { messages: [], cursor: null }]
    h.connections.push(() => connection, () => connection, () => connection)
    await h.runner.reconcile([POLL], [SERVER])
    await waitFor(() => h.sleeps.length === 1)
    expect(h.sleeps[0]?.ms).toBe(10_000)
    expect(h.runner.statuses()[0]).toMatchObject({ state: "backoff", lastError: "boom" })

    h.sleeps[0]!.release()
    await waitFor(() => h.sleeps.length === 2)
    expect(h.sleeps[1]?.ms).toBe(20_000)

    h.sleeps[1]!.release()
    await waitFor(() => h.sleeps.length === 3)
    expect(h.sleeps[2]?.ms).toBe(10_000)
    expect(h.runner.statuses()[0]).toMatchObject({ state: "polling", lastError: null })
    await h.runner.stop()
  })

  test("a result whose items path is not an array is an error", async () => {
    const h = createHarness()
    const connection = new FakeConnection()
    connection.toolResults = [{ messages: "nope", cursor: 1 }]
    h.connections.push(() => connection)
    await h.runner.reconcile([POLL], [SERVER])
    await waitFor(() => h.runner.statuses()[0]?.state === "backoff")

    expect(h.runner.statuses()[0]?.lastError).toContain("did not resolve to an array")
    await h.runner.stop()
  })

  test("a 401 reconnects once at once, then backs off if it repeats", async () => {
    const h = createHarness()
    const connection = new FakeConnection()
    connection.toolResults = [new Error("HTTP 401 Unauthorized"), new Error("HTTP 401 Unauthorized")]
    h.connections.push(() => connection, () => connection)
    await h.runner.reconcile([POLL], [SERVER])
    await waitFor(() => h.sleeps.length === 1)

    expect(h.opened).toHaveLength(2)
    expect(h.runner.statuses()[0]?.state).toBe("backoff")
    await h.runner.stop()
  })

  test("a failed delivery leaves the cursor where it was so the item is retried", async () => {
    let accept = false
    const h = createHarness({ deliverOk: () => accept })
    const connection = new FakeConnection()
    connection.toolResults = [
      { messages: [message("m1")], cursor: 5 },
      { messages: [message("m1")], cursor: 5 },
    ]
    h.connections.push(() => connection, () => connection)
    await h.runner.reconcile([POLL], [SERVER])
    await waitFor(() => h.sleeps.length === 1)

    expect(h.deliveries).toHaveLength(0)
    expect(h.cursors.saved.poll).toBeUndefined()

    accept = true
    h.sleeps[0]!.release()
    await waitFor(() => h.sleeps.length === 2)

    expect(h.deliveries.map((d) => d.deliveryId)).toEqual(["m1"])
    expect(h.cursors.saved.poll?.cursor).toBe(5)
    await h.runner.stop()
  })
})

describe("McpSourceRunner reconcile", () => {
  test("a disabled source reports disabled and never connects", async () => {
    const h = createHarness()
    await h.runner.reconcile([{ ...POLL, enabled: false }], [SERVER])
    await settle()

    expect(h.runner.statuses()).toEqual([{ id: "poll", state: "disabled", lastError: null, lastItemAt: null, itemCount: 0 }])
    expect(h.opened).toHaveLength(0)
  })

  test("a source whose server is missing or disabled reports an error", async () => {
    const h = createHarness()
    await h.runner.reconcile([POLL, { ...SUBSCRIBE, serverId: "off" }], [{ ...SERVER, id: "off", enabled: false }])

    expect(h.runner.statuses().map((s) => [s.id, s.state, s.lastError])).toEqual([
      ["poll", "error", "MCP server not found"],
      ["sub", "error", "MCP server is disabled"],
    ])
  })

  test("removing a source stops it, closes its connection and drops its cursor", async () => {
    const h = createHarness()
    h.cursors.saved = { poll: { cursor: 3, recentKeys: [] } }
    const connection = new FakeConnection()
    h.connections.push(() => connection)
    await h.runner.reconcile([POLL], [SERVER])
    await waitFor(() => h.sleeps.length === 1)

    await h.runner.reconcile([], [SERVER])

    expect(connection.closed).toBe(true)
    expect(h.runner.statuses()).toEqual([])
    expect(h.cursors.saved).toEqual({})
  })

  test("an edited source restarts and an unchanged one keeps running", async () => {
    const h = createHarness()
    const first = new FakeConnection()
    const second = new FakeConnection()
    h.connections.push(() => first, () => second)
    await h.runner.reconcile([POLL], [SERVER])
    await waitFor(() => h.sleeps.length === 1)

    await h.runner.reconcile([POLL], [SERVER])
    expect(h.opened).toHaveLength(1)

    await h.runner.reconcile([{ ...POLL, updatedAt: 2, intervalMs: 20_000 }], [SERVER])
    await waitFor(() => second.toolCalls.length === 1)

    expect(first.closed).toBe(true)
    expect(h.opened).toHaveLength(2)
    await h.runner.stop()
  })

  test("status listeners hear about state changes", async () => {
    const h = createHarness()
    let heard = 0
    h.runner.onStatus(() => { heard += 1 })
    await h.runner.reconcile([{ ...POLL, enabled: false }], [SERVER])

    expect(heard).toBeGreaterThan(0)
  })
})

describe("McpSourceRunner callTool", () => {
  test("a reply tool call rides the live subscribe connection without opening another", async () => {
    const h = createHarness()
    const live = new FakeConnection()
    live.toolResults = [{ id: "sent-1" }]
    h.connections.push(() => live)
    await h.runner.reconcile([SUBSCRIBE], [SERVER])
    await waitFor(() => h.runner.statuses()[0]?.state === "listening")

    const result = await h.runner.callTool("sub", "send", { text: "hi" })

    expect([result, live.toolCalls, h.opened.length, live.closed]).toEqual([{ id: "sent-1" }, [{ text: "hi" }], 1, false])
    await h.runner.stop()
  })

  test("without a live connection a reply tool call opens a one-shot connection and closes it afterwards", async () => {
    const h = createHarness({ bearer: "tok" })
    const session = new FakeConnection()
    session.honored = []
    const oneShot = new FakeConnection()
    oneShot.toolResults = [{ id: "sent-2" }]
    h.connections.push(() => session, () => oneShot)
    await h.runner.reconcile([SUBSCRIBE], [SERVER])
    await waitFor(() => h.runner.statuses()[0]?.state === "error")

    const result = await h.runner.callTool("sub", "send", { text: "hi" })

    expect(result).toEqual({ id: "sent-2" })
    expect(h.opened[1]).toMatchObject({ bearer: "tok", connection: oneShot })
    expect([oneShot.toolCalls, oneShot.closed]).toEqual([[{ text: "hi" }], true])
    await h.runner.stop()
  })

  test("an unknown or disabled source and a connection that cannot open are unavailable, not a tool failure", async () => {
    const h = createHarness()
    await h.runner.reconcile([{ ...SUBSCRIBE, enabled: false }], [SERVER])
    for (const id of ["ghost", "sub"]) await expect(h.runner.callTool(id, "send", {})).rejects.toBeInstanceOf(McpSourceUnavailableError)
    expect(h.opened).toHaveLength(0)

    const session = new FakeConnection()
    session.honored = []
    h.connections.push(() => session, () => { throw new Error("connection refused") })
    await h.runner.reconcile([{ ...SUBSCRIBE, updatedAt: 2 }], [SERVER])
    await waitFor(() => h.runner.statuses()[0]?.state === "error")
    await expect(h.runner.callTool("sub", "send", {})).rejects.toThrow("connection refused")
    await h.runner.stop()
  })

  test("a remembered key keeps the echo of a sent message from being ingested", async () => {
    const h = createHarness()
    const connection = new FakeConnection()
    h.connections.push(() => connection)
    await h.runner.reconcile([SUBSCRIBE_ITEMS], [SERVER])
    await waitFor(() => h.runner.statuses()[0]?.state === "listening")

    h.runner.rememberKey("sub", "m1")
    connection.resource = inbox("m1", "m2")
    connection.notify("feed://inbox")
    await waitFor(() => h.deliveries.length === 1)
    await h.runner.stop()

    expect(h.deliveries.map((delivery) => delivery.deliveryId)).toEqual(["m2"])
    expect(h.cursors.saved.sub?.recentKeys).toEqual(["m1", "m2"])
  })
})
