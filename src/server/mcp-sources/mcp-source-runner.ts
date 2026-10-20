import { createHash } from "node:crypto"
import { toError } from "../../shared/errors"
import { resolvePath, stringifyValue } from "../../shared/inbound/template"
import { isJsonArray, type JsonObject, type JsonValue } from "../../shared/json"
import { log } from "../../shared/log"
import {
  MCP_SOURCE_DEDUPE_KEYS,
  type McpPollSource,
  type McpSource,
  type McpSourceStatus,
  type McpSubscribeSource,
} from "../../shared/mcp-sources/types"
import type { McpServerConfig } from "../../shared/mcp-types"
import type { InboundDelivery, InboundDeliveryResult } from "../inbound/deliver-inbound"
import { addCounter } from "../observability"

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
  version: string
  status: McpSourceStatus
  abort: AbortController
  done: Promise<void>
  updates: Promise<void>
}

const BACKOFF_BASE_MS = 1000
const BACKOFF_MAX_MS = 60_000
const BACKOFF_JITTER = 0.25
const GRACEFUL_RECONNECT_MS = 30_000
const POLL_BACKOFF_MULTIPLIER_MAX = 5
const NO_SUBSCRIPTIONS_ERROR = "server honored no subscriptions"
const UNAUTHORIZED_PATTERN = /\b401\b|unauthori[sz]ed/i

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex")
}

function isUnauthorized(error: Error): boolean {
  return UNAUTHORIZED_PATTERN.test(error.message)
}

function textAt(item: JsonValue, path: string): string {
  return path.length > 0 ? stringifyValue(resolvePath(item, path)).trim() : ""
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

export class McpSourceRunner {
  private readonly entries = new Map<string, Entry>()
  private readonly listeners = new Set<() => void>()
  private cursors: McpSourceCursors = {}
  private cursorsLoaded = false
  private saving: Promise<void> = Promise.resolve()
  private reconciling: Promise<void> = Promise.resolve()

  constructor(
    private readonly connector: McpSourceConnector,
    private readonly cursorStore: McpSourceCursorStorePort,
    private readonly bearer: McpSourceBearer,
    private readonly deliver: McpSourceDeliver,
    private readonly clock: McpSourceClock,
  ) {}

  reconcile(sources: readonly McpSource[], servers: readonly McpServerConfig[]): Promise<void> {
    this.reconciling = this.reconciling.then(() => this.apply(sources, servers))
    return this.reconciling
  }

  async stop(): Promise<void> {
    await this.reconciling
    const entries = [...this.entries.values()]
    this.entries.clear()
    await Promise.all(entries.map((entry) => this.halt(entry)))
    await this.saving
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
    this.saving = this.saving
      .then(() => this.cursorStore.save(snapshot))
      .catch((error: Error) => {
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
      version,
      status: blocked ?? initialStatus(source, "connecting", null),
      abort,
      done: Promise.resolve(),
      updates: Promise.resolve(),
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
    addCounter("kanna.mcp_source.errors", 1, { mode: entry.source.mode })
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

  private async ingest(
    entry: Entry,
    server: McpServerConfig,
    item: JsonValue,
    key: string,
    fallbackThreadKey: string,
  ): Promise<void> {
    const { source } = entry
    const state = this.cursorState(source.id)
    if (state.recentKeys.includes(key)) return
    const at = this.clock.now()
    const result = await this.deliver({
      source: { kind: "mcp", sourceId: source.id, sourceName: source.name, serverId: server.id, serverName: server.name },
      sourceName: source.name,
      handler: source.handler,
      deliveryId: key,
      body: item,
      threadKey: textAt(item, source.threadKeyPath) || fallbackThreadKey,
      sender: textAt(item, source.senderPath) || source.name,
      at,
    })
    if (!result.ok) throw new Error(result.detail)
    this.cursors = {
      ...this.cursors,
      [source.id]: { ...state, recentKeys: [...state.recentKeys, key].slice(-MCP_SOURCE_DEDUPE_KEYS) },
    }
    this.persist()
    addCounter("kanna.mcp_source.items", 1, { mode: source.mode })
    this.patch(entry, { lastItemAt: at, itemCount: entry.status.itemCount + 1, lastError: null })
  }

  private async handleUpdated(
    entry: Entry,
    server: McpServerConfig,
    connection: McpSourceConnection,
    uri: string,
  ): Promise<void> {
    try {
      const contents = await connection.readResource(uri)
      await this.ingest(entry, server, { uri, contents }, sha256(uri + JSON.stringify(contents)), uri)
    } catch (error) {
      this.fail(entry, toError(error))
    }
  }

  private async runSubscribe(entry: Entry, source: McpSubscribeSource, server: McpServerConfig): Promise<void> {
    const { signal } = entry.abort
    let attempt = 0
    let authRetried = false
    while (!signal.aborted) {
      this.patch(entry, { state: "connecting" })
      let connection: McpSourceConnection | null = null
      let listening: McpSourceListening | null = null
      let waitMs: number
      try {
        const opened = await this.open(server)
        connection = opened
        listening = await opened.listen(source.resourceUris, (uri) => {
          entry.updates = entry.updates.then(() => this.handleUpdated(entry, server, opened, uri))
        })
        if (signal.aborted) break
        if (listening.honoredUris.length === 0) throw new Error(NO_SUBSCRIPTIONS_ERROR)
        attempt = 0
        authRetried = false
        this.patch(entry, { state: "listening", honoredUris: listening.honoredUris, lastError: null })
        const reason = await Promise.race([listening.closed, aborted(signal)])
        if (signal.aborted) break
        if (reason === "local") {
          this.patch(entry, { state: "error", lastError: "subscription was closed locally" })
          break
        }
        waitMs = reason === "graceful" ? GRACEFUL_RECONNECT_MS : this.backoffMs(1)
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
        await closeQuietly(listening)
        await closeQuietly(connection)
      }
      await entry.updates
      await this.clock.sleep(waitMs, signal)
    }
    await entry.updates
  }

  private async pollOnce(entry: Entry, source: McpPollSource, server: McpServerConfig, connection: McpSourceConnection): Promise<void> {
    const { cursor } = this.cursorState(source.id)
    const args = cursor === null ? source.args : { ...source.args, [source.cursorArg]: cursor }
    const result = await connection.callTool(source.tool, args)
    const items = resolvePath(result, source.itemsPath)
    if (items === undefined || !isJsonArray(items)) {
      throw new Error(`"${source.itemsPath}" did not resolve to an array in the ${source.tool} result`)
    }
    for (const item of items) {
      const key = (source.itemKeyPath ? textAt(item, source.itemKeyPath) : "") || sha256(JSON.stringify(item))
      await this.ingest(entry, server, item, key, key)
    }
    const next = resolvePath(result, source.cursorPath)
    if (next === undefined) return
    this.cursors = { ...this.cursors, [source.id]: { ...this.cursorState(source.id), cursor: next } }
    this.persist()
    this.patch(entry, { cursor: next })
  }

  private async runPoll(entry: Entry, source: McpPollSource, server: McpServerConfig): Promise<void> {
    const { signal } = entry.abort
    let connection: McpSourceConnection | null = null
    let failures = 0
    let authRetried = false
    try {
      while (!signal.aborted) {
        let delay = source.intervalMs
        this.patch(entry, { state: "polling" })
        try {
          connection ??= await this.open(server)
          if (signal.aborted) break
          await this.pollOnce(entry, source, server, connection)
          failures = 0
          authRetried = false
          this.patch(entry, { state: "polling", lastError: null })
        } catch (error) {
          const failure = toError(error)
          await closeQuietly(connection)
          connection = null
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
      await closeQuietly(connection)
    }
  }
}
