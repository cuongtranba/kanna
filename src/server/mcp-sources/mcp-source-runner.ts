import { toError } from "../../shared/errors"
import type { JsonObject, JsonValue } from "../../shared/json"
import { log } from "../../shared/log"
import { createSerialQueue } from "../serial-lane"
import {
  MCP_SOURCE_DEDUPE_KEYS,
  type McpPollSource,
  type McpSource,
  type McpSourceStatus,
  type McpSubscribeSource,
} from "../../shared/mcp-sources/types"
import type { McpServerConfig } from "../../shared/mcp-types"
import type { InboundDelivery, InboundDeliveryResult } from "../inbound/deliver-inbound"
import { addCounter, MCP_SOURCE_ERRORS, MCP_SOURCE_ITEMS } from "../observability"
import { fetcherFor, textAt, type McpSourceFetcher } from "./mcp-source-fetch"

export class McpToolRejectedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "McpToolRejectedError"
  }
}

export class McpSourceUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "McpSourceUnavailableError"
  }
}

export type McpSourceCloseReason = "local" | "graceful" | "remote"

export interface McpSourceListening {
  honoredUris: string[]
  closed: Promise<McpSourceCloseReason>
  close(): Promise<void>
}

export interface McpSourceConnection {
  listen(uris: string[], onUpdated: (uri: string) => void): Promise<McpSourceListening>
  readResource(uri: string): Promise<JsonValue>
  callTool(name: string, args: JsonObject): Promise<JsonValue>
  close(): Promise<void>
}

export interface McpSourceConnector {
  open(server: McpServerConfig, bearer: string | undefined): Promise<McpSourceConnection>
}

export interface McpSourceCursorState {
  cursor: JsonValue | null
  recentKeys: string[]
}

export type McpSourceCursors = Record<string, McpSourceCursorState>

export interface McpSourceCursorStorePort {
  load(): Promise<McpSourceCursors>
  save(all: McpSourceCursors): Promise<void>
}

export interface McpSourceClock {
  now(): number
  random(): number
  sleep(ms: number, signal: AbortSignal): Promise<void>
}

export type McpSourceBearer = (server: McpServerConfig) => Promise<string | undefined>

export type McpSourceDeliver = (delivery: InboundDelivery) => Promise<InboundDeliveryResult>

interface Entry {
  source: McpSource
  server: McpServerConfig | null
  version: string
  connection: McpSourceConnection | null
  status: McpSourceStatus
  abort: AbortController
  done: Promise<void>
}

const BACKOFF_BASE_MS = 1000
const BACKOFF_MAX_MS = 60_000
const BACKOFF_JITTER = 0.25
const GRACEFUL_RECONNECT_MS = 30_000
const POLL_BACKOFF_MULTIPLIER_MAX = 5
const STABLE_SESSION_MS = 60_000
const NO_SUBSCRIPTIONS_ERROR = "server does not support resource subscriptions (no URI was honored)"
const UNAUTHORIZED_PATTERN = /\b401\b|unauthori[sz]ed/i

function isUnauthorized(error: Error): boolean {
  return UNAUTHORIZED_PATTERN.test(error.message)
}

function initialStatus(source: McpSource, state: McpSourceStatus["state"], lastError: string | null): McpSourceStatus {
  return { id: source.id, state, lastError, lastItemAt: null, itemCount: 0 }
}

function aborted(signal: AbortSignal): Promise<"local"> {
  return new Promise((resolve) => {
    if (signal.aborted) resolve("local")
    else signal.addEventListener("abort", () => { resolve("local") }, { once: true })
  })
}

function blockedStatus(source: McpSource, server: McpServerConfig | null): McpSourceStatus | null {
  if (!source.enabled) return initialStatus(source, "disabled", null)
  if (server === null) return initialStatus(source, "error", "MCP server not found")
  if (!server.enabled) return initialStatus(source, "error", "MCP server is disabled")
  return null
}

async function closeQuietly(target: { close(): Promise<void> } | null): Promise<void> {
  if (target === null) return
  try {
    await target.close()
  } catch (error) {
    log.warn("[kanna/mcp-source] close failed:", toError(error).message)
  }
}

class DrainLane {
  private inFlight: Promise<void> | null = null
  private readonly pending = new Set<string>()

  constructor(private readonly run: (uris: string[]) => Promise<void>) {}

  push(uris: Iterable<string>): void {
    for (const uri of uris) this.pending.add(uri)
    if (this.inFlight === null && this.pending.size > 0) this.inFlight = this.pump()
  }

  idle(): Promise<void> {
    return this.inFlight ?? Promise.resolve()
  }

  private async pump(): Promise<void> {
    try {
      while (this.pending.size > 0) {
        const batch = [...this.pending]
        this.pending.clear()
        await this.run(batch)
      }
    } finally {
      this.inFlight = null
    }
  }
}

export class McpSourceRunner {
  private readonly entries = new Map<string, Entry>()
  private readonly listeners = new Set<() => void>()
  private cursors: McpSourceCursors = {}
  private cursorsLoaded = false
  private readonly saving = createSerialQueue()
  private readonly reconciling = createSerialQueue()

  constructor(
    private readonly connector: McpSourceConnector,
    private readonly cursorStore: McpSourceCursorStorePort,
    private readonly bearer: McpSourceBearer,
    private readonly deliver: McpSourceDeliver,
    private readonly clock: McpSourceClock,
  ) {}

  reconcile(sources: readonly McpSource[], servers: readonly McpServerConfig[]): Promise<void> {
    return this.reconciling.run(() => this.apply(sources, servers))
  }

  async stop(): Promise<void> {
    await this.reconciling.run(async () => {})
    const entries = [...this.entries.values()]
    this.entries.clear()
    await Promise.all(entries.map((entry) => this.halt(entry)))
    await this.saving.run(async () => {})
  }

  rememberKey(sourceId: string, key: string): void {
    if (this.entries.has(sourceId)) this.recordKey(sourceId, key)
  }

  async callTool(sourceId: string, name: string, args: JsonObject): Promise<JsonValue> {
    const entry = this.entries.get(sourceId)
    if (entry === undefined) throw new McpSourceUnavailableError("MCP source not found")
    if (entry.connection !== null) return entry.connection.callTool(name, args)
    const blocked = blockedStatus(entry.source, entry.server)
    if (blocked !== null || entry.server === null) {
      throw new McpSourceUnavailableError(blocked?.lastError ?? "MCP source is disabled")
    }
    let connection: McpSourceConnection
    try {
      connection = await this.open(entry.server)
    } catch (error) {
      throw new McpSourceUnavailableError(toError(error).message)
    }
    try {
      return await connection.callTool(name, args)
    } finally {
      await closeQuietly(connection)
    }
  }

  statuses(): McpSourceStatus[] {
    return [...this.entries.values()].map((entry) => entry.status)
  }

  onStatus(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }

  private async apply(sources: readonly McpSource[], servers: readonly McpServerConfig[]): Promise<void> {
    await this.loadCursors()
    const wanted = new Set(sources.map((source) => source.id))
    let cursorsChanged = false
    for (const [id, entry] of [...this.entries]) {
      if (wanted.has(id)) continue
      this.entries.delete(id)
      await this.halt(entry)
      if (Object.hasOwn(this.cursors, id)) {
        const { [id]: _removed, ...rest } = this.cursors
        this.cursors = rest
        cursorsChanged = true
      }
    }
    for (const source of sources) {
      const server = servers.find((candidate) => candidate.id === source.serverId) ?? null
      const version = `${source.updatedAt}|${server?.updatedAt ?? ""}|${server?.enabled ?? ""}`
      const existing = this.entries.get(source.id)
      if (existing?.version === version) continue
      if (existing) await this.halt(existing)
      this.entries.set(source.id, this.start(source, server, version))
    }
    if (cursorsChanged) this.persist()
    this.emit()
  }

  private async loadCursors(): Promise<void> {
    if (this.cursorsLoaded) return
    this.cursorsLoaded = true
    try {
      this.cursors = await this.cursorStore.load()
    } catch (error) {
      log.warn("[kanna/mcp-source] cursor load failed:", toError(error).message)
    }
  }

  private persist(): void {
    const snapshot = this.cursors
    this.saving.run(() => this.cursorStore.save(snapshot)).catch((error: Error) => {
      log.warn("[kanna/mcp-source] cursor save failed:", error.message)
    })
  }

  private async halt(entry: Entry): Promise<void> {
    entry.abort.abort()
    await entry.done
  }

  private start(source: McpSource, server: McpServerConfig | null, version: string): Entry {
    const abort = new AbortController()
    const blocked = blockedStatus(source, server)
    const entry: Entry = {
      source,
      server,
      version,
      connection: null,
      status: blocked ?? initialStatus(source, "connecting", null),
      abort,
      done: Promise.resolve(),
    }
    if (blocked !== null || server === null) return entry
    const loop = source.mode === "subscribe"
      ? this.runSubscribe(entry, source, server)
      : this.runPoll(entry, source, server)
    entry.done = loop.catch((error: Error) => {
      this.fail(entry, error)
    })
    return entry
  }

  private patch(entry: Entry, change: Partial<McpSourceStatus>): void {
    entry.status = { ...entry.status, ...change }
    this.emit()
  }

  private fail(entry: Entry, error: Error): void {
    addCounter(MCP_SOURCE_ERRORS, 1, { mode: entry.source.mode })
    log.warn(`[kanna/mcp-source] ${entry.source.name}:`, error.message)
    this.patch(entry, { lastError: error.message })
  }

  private backoffMs(attempt: number): number {
    const base = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempt - 1))
    return Math.round(base * (1 + BACKOFF_JITTER * this.clock.random()))
  }

  private async open(server: McpServerConfig): Promise<McpSourceConnection> {
    return this.connector.open(server, await this.bearer(server))
  }

  private cursorState(sourceId: string): McpSourceCursorState {
    return this.cursors[sourceId] ?? { cursor: null, recentKeys: [] }
  }

  private recordKey(sourceId: string, key: string): void {
    const state = this.cursorState(sourceId)
    if (state.recentKeys.includes(key)) return
    this.cursors = {
      ...this.cursors,
      [sourceId]: { ...state, recentKeys: [...state.recentKeys, key].slice(-MCP_SOURCE_DEDUPE_KEYS) },
    }
    this.persist()
  }

  private async dropConnection(entry: Entry): Promise<void> {
    const { connection } = entry
    entry.connection = null
    await closeQuietly(connection)
  }

  private async ingest(
    entry: Entry,
    server: McpServerConfig,
    item: JsonValue,
    key: string,
    fallbackThreadKey: string,
  ): Promise<void> {
    const { source } = entry
    if (this.cursorState(source.id).recentKeys.includes(key)) return
    const at = this.clock.now()
    const text = textAt(item, source.textPath)
    const result = await this.deliver({
      source: { kind: "mcp", sourceId: source.id, sourceName: source.name, serverId: server.id, serverName: server.name },
      sourceName: source.name,
      handler: source.handler,
      deliveryId: key,
      body: item,
      threadKey: textAt(item, source.threadKeyPath) || fallbackThreadKey,
      sender: textAt(item, source.senderPath) || source.name,
      ...(text.length > 0 ? { text } : {}),
      at,
    })
    if (!result.ok) throw new Error(result.detail)
    this.recordKey(source.id, key)
    addCounter(MCP_SOURCE_ITEMS, 1, { mode: source.mode })
    this.patch(entry, { lastItemAt: at, itemCount: entry.status.itemCount + 1, lastError: null })
  }

  private async drain(
    entry: Entry,
    server: McpServerConfig,
    connection: McpSourceConnection,
    fetcher: McpSourceFetcher,
    uris: readonly string[],
  ): Promise<void> {
    const { source } = entry
    const result = await fetcher.fetch(connection, this.cursorState(source.id).cursor, uris)
    for (const item of result.items) await this.ingest(entry, server, item.body, item.key, item.threadKey)
    if (result.cursor === undefined) return
    this.cursors = { ...this.cursors, [source.id]: { ...this.cursorState(source.id), cursor: result.cursor } }
    this.persist()
    this.patch(entry, { cursor: result.cursor })
  }

  private drainLane(entry: Entry, server: McpServerConfig, connection: McpSourceConnection, fetcher: McpSourceFetcher): DrainLane {
    return new DrainLane(async (uris) => {
      const failures: Error[] = []
      for (const uri of uris) {
        try {
          await this.drain(entry, server, connection, fetcher, [uri])
        } catch (error) {
          failures.push(toError(error))
        }
      }
      const first = failures[0]
      if (first) this.fail(entry, first)
    })
  }

  private async resync(lane: DrainLane, uris: readonly string[], intervalMs: number, signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      await this.clock.sleep(intervalMs, signal)
      if (!signal.aborted) lane.push(uris)
    }
  }

  private async runSubscribe(entry: Entry, source: McpSubscribeSource, server: McpServerConfig): Promise<void> {
    const { signal } = entry.abort
    const fetcher = fetcherFor(source)
    let attempt = 0
    let authRetried = false
    while (!signal.aborted) {
      this.patch(entry, { state: "connecting" })
      const session = new AbortController()
      const sessionSignal = AbortSignal.any([signal, session.signal])
      let connection: McpSourceConnection | null = null
      let listening: McpSourceListening | null = null
      let lane: DrainLane | null = null
      let resyncing: Promise<void> = Promise.resolve()
      let waitMs: number
      try {
        const opened = await this.open(server)
        connection = opened
        const sessionLane = this.drainLane(entry, server, opened, fetcher)
        lane = sessionLane
        listening = await opened.listen(source.resourceUris, (uri) => { sessionLane.push([uri]) })
        if (signal.aborted) break
        if (listening.honoredUris.length === 0) throw new Error(NO_SUBSCRIPTIONS_ERROR)
        authRetried = false
        entry.connection = opened
        const startedAt = this.clock.now()
        this.patch(entry, { state: "listening", honoredUris: listening.honoredUris, lastError: null })
        sessionLane.push(listening.honoredUris)
        if (source.resyncIntervalMs !== null) {
          resyncing = this.resync(sessionLane, listening.honoredUris, source.resyncIntervalMs, sessionSignal)
        }
        const reason = await Promise.race([listening.closed, aborted(signal)])
        if (signal.aborted) break
        if (reason === "local") {
          this.patch(entry, { state: "error", lastError: "subscription was closed locally" })
          break
        }
        if (this.clock.now() - startedAt >= STABLE_SESSION_MS) attempt = 0
        if (reason === "graceful") {
          waitMs = GRACEFUL_RECONNECT_MS
        } else {
          attempt += 1
          waitMs = this.backoffMs(attempt)
        }
        this.patch(entry, { state: "backoff", lastError: reason === "remote" ? "connection dropped" : null })
      } catch (error) {
        const failure = toError(error)
        if (isUnauthorized(failure) && !authRetried) {
          authRetried = true
          continue
        }
        attempt += 1
        waitMs = this.backoffMs(attempt)
        this.fail(entry, failure)
        this.patch(entry, { state: failure.message === NO_SUBSCRIPTIONS_ERROR ? "error" : "backoff" })
      } finally {
        session.abort()
        entry.connection = null
        await closeQuietly(listening)
        await closeQuietly(connection)
        await resyncing
        await lane?.idle()
      }
      await this.clock.sleep(waitMs, signal)
    }
  }

  private async runPoll(entry: Entry, source: McpPollSource, server: McpServerConfig): Promise<void> {
    const { signal } = entry.abort
    const fetcher = fetcherFor(source)
    let failures = 0
    let authRetried = false
    try {
      while (!signal.aborted) {
        let delay = source.intervalMs
        this.patch(entry, { state: "polling" })
        try {
          const connection = entry.connection ?? await this.open(server)
          entry.connection = connection
          if (signal.aborted) break
          await this.drain(entry, server, connection, fetcher, [])
          failures = 0
          authRetried = false
          this.patch(entry, { state: "polling", lastError: null })
        } catch (error) {
          const failure = toError(error)
          await this.dropConnection(entry)
          if (isUnauthorized(failure) && !authRetried) {
            authRetried = true
            continue
          }
          failures = Math.min(failures + 1, POLL_BACKOFF_MULTIPLIER_MAX)
          delay = source.intervalMs * failures
          this.fail(entry, failure)
          this.patch(entry, { state: "backoff" })
        }
        this.patch(entry, { nextAt: this.clock.now() + delay })
        await this.clock.sleep(delay, signal)
      }
    } finally {
      await this.dropConnection(entry)
    }
  }
}
