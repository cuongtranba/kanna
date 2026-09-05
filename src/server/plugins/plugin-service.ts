import { homedir } from "node:os"
import { join } from "node:path"
import { errorMessage } from "../../shared/errors"
import type { JsonValue } from "../../shared/json"
import type { InstalledPluginConfig } from "../../shared/plugins/settings"
import { createPluginLogRing, type PluginLogEntry } from "../../shared/plugins/log-ring"
import { parseKannaPluginManifest, resolvePluginEntry } from "../../shared/plugins/manifest"
import { getPluginBuildDir } from "../../shared/plugins/paths"
import { buildPluginBundles } from "./plugin-build.adapter"
import {
  allocatePluginSocketPath,
  listenForPluginChild,
  readPluginManifestText,
  spawnPluginChild,
  writePluginServerBundle,
  writePluginClientBundle,
  readPluginClientBundle,
  type PluginHostConnection,
  type SpawnedPluginChild,
} from "./plugin-service-io.adapter"
import type { PluginChildMessage } from "./plugin-rpc-protocol"

const SERVER_BUNDLE_FILENAME = "server.js"
const CLIENT_BUNDLE_FILENAME = "client.js"
const START_TIMEOUT_MS = 30_000
const CALL_TIMEOUT_MS = 30_000
const STOP_GRACE_MS = 5_000

export type PluginRuntimeState = "stopped" | "starting" | "running" | "stopping" | "crashed"

export type PluginCallResult = { readonly ok: true; readonly output: JsonValue } | { readonly ok: false; readonly error: string }

interface PendingCall {
  resolve(result: PluginCallResult): void
}

interface PluginRuntimeRecord {
  readonly id: string
  readonly sourceDir: string
  readonly bundlePath: string
  readonly clientBundlePath: string
  readonly logRing: ReturnType<typeof createPluginLogRing>
  readonly pendingCalls: Map<string, PendingCall>
  enabled: boolean
  state: PluginRuntimeState
  process: SpawnedPluginChild | null
  connection: PluginHostConnection | null
  nextCallId: number
}

export interface PluginSummary {
  readonly id: string
  readonly sourceDir: string
  readonly enabled: boolean
  readonly state: PluginRuntimeState
}

export interface InstalledPluginStore {
  list(): readonly InstalledPluginConfig[]
  upsert(entry: InstalledPluginConfig): Promise<void>
}

export interface PluginService {
  install(args: { readonly sourceDir: string }): Promise<void>
  list(): readonly PluginSummary[]
  clientBundle(id: string): Promise<string | null>
  recordClientError(id: string, text: string): void
  reload(id: string): Promise<void>
  setEnabled(id: string, enabled: boolean): Promise<void>
  restore(): void
  start(id: string): Promise<void>
  status(id: string): { readonly state: PluginRuntimeState } | undefined
  call(id: string, method: string, params: JsonValue): Promise<PluginCallResult>
  stop(id: string): Promise<void>
  logs(id: string): readonly PluginLogEntry[]
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error instanceof Error ? error : new Error(errorMessage(error)))
      },
    )
  })
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function settlePendingCalls(record: PluginRuntimeRecord, result: PluginCallResult): void {
  for (const pending of record.pendingCalls.values()) pending.resolve(result)
  record.pendingCalls.clear()
}

export function createPluginService(
  deps: { readonly homeDir?: string; readonly installed?: InstalledPluginStore } = {},
): PluginService {
  const homeDir = deps.homeDir ?? homedir()
  const installed = deps.installed
  const registry = new Map<string, PluginRuntimeRecord>()

  function requireRecord(id: string): PluginRuntimeRecord {
    const record = registry.get(id)
    if (!record) throw new Error(`plugin "${id}" is not installed`)
    return record
  }

  async function install({ sourceDir }: { readonly sourceDir: string }): Promise<void> {
    const manifestRaw = await readPluginManifestText(sourceDir)
    const parsedManifest = parseKannaPluginManifest(manifestRaw)
    if (!parsedManifest.ok) {
      throw new Error(`plugin manifest at "${sourceDir}" is invalid: ${parsedManifest.message}`)
    }
    const { id, entry } = parsedManifest.manifest
    const built = await buildPluginBundles({ sourceDir, entry: resolvePluginEntry(entry) })
    if (!built.ok) {
      throw new Error(`plugin "${id}" failed to compile: ${built.errors.join("; ")}`)
    }
    const buildDir = getPluginBuildDir(homeDir, id)
    const bundlePath = join(buildDir, SERVER_BUNDLE_FILENAME)
    const clientBundlePath = join(buildDir, CLIENT_BUNDLE_FILENAME)
    await writePluginServerBundle(bundlePath, built.server)
    await writePluginClientBundle(clientBundlePath, built.client)

    const existing = registry.get(id)
    registry.set(id, {
      id,
      sourceDir,
      bundlePath,
      clientBundlePath,
      logRing: existing?.logRing ?? createPluginLogRing(),
      pendingCalls: new Map(),
      enabled: existing?.enabled ?? false,
      state: "stopped",
      process: null,
      connection: null,
      nextCallId: 1,
    })
    await installed?.upsert({ id, sourceDir, enabled: existing?.enabled ?? false })
  }

  function buildPaths(id: string): { bundlePath: string; clientBundlePath: string } {
    const buildDir = getPluginBuildDir(homeDir, id)
    return {
      bundlePath: join(buildDir, SERVER_BUNDLE_FILENAME),
      clientBundlePath: join(buildDir, CLIENT_BUNDLE_FILENAME),
    }
  }

  function restore(): void {
    for (const entry of installed?.list() ?? []) {
      if (registry.has(entry.id)) continue
      registry.set(entry.id, {
        id: entry.id,
        sourceDir: entry.sourceDir,
        ...buildPaths(entry.id),
        logRing: createPluginLogRing(),
        pendingCalls: new Map(),
        enabled: entry.enabled,
        state: "stopped",
        process: null,
        connection: null,
        nextCallId: 1,
      })
    }
  }

  async function setEnabled(id: string, enabled: boolean): Promise<void> {
    const record = requireRecord(id)
    record.enabled = enabled
    await installed?.upsert({ id, sourceDir: record.sourceDir, enabled })
  }

  function handleChildDisconnect(record: PluginRuntimeRecord): void {
    if (record.state === "stopping") return
    record.state = "crashed"
    record.process = null
    record.connection = null
    settlePendingCalls(record, { ok: false, error: `plugin "${record.id}" disconnected` })
  }

  async function start(id: string): Promise<void> {
    const record = requireRecord(id)
    if (!record.enabled) return
    if (record.state === "running" || record.state === "starting") return

    record.state = "starting"
    try {
      const socketPath = allocatePluginSocketPath()
      const listener = listenForPluginChild(
        socketPath,
        (message: PluginChildMessage) => {
          if (message.type !== "result") return
          const pending = record.pendingCalls.get(message.id)
          if (!pending) return
          record.pendingCalls.delete(message.id)
          pending.resolve(message.ok ? { ok: true, output: message.output } : { ok: false, error: message.error })
        },
        () => handleChildDisconnect(record),
      )

      const child = spawnPluginChild({
        bundlePath: record.bundlePath,
        socketPath,
        onLog: (entry) => record.logRing.append({ ...entry, at: Date.now() }),
      })
      record.process = child
      void child.exited.then(() => handleChildDisconnect(record))

      let connection: PluginHostConnection
      try {
        connection = await withTimeout(listener.ready, START_TIMEOUT_MS, `plugin "${id}" did not become ready in time`)
      } finally {
        listener.stop()
      }
      record.connection = connection
      record.state = "running"
    } catch (error) {
      record.state = "crashed"
      record.process?.kill()
      record.process = null
      record.connection = null
      throw error instanceof Error ? error : new Error(errorMessage(error))
    }
  }

  function status(id: string): { readonly state: PluginRuntimeState } | undefined {
    const record = registry.get(id)
    return record ? { state: record.state } : undefined
  }

  async function call(id: string, method: string, params: JsonValue): Promise<PluginCallResult> {
    const record = registry.get(id)
    if (!record || record.state !== "running" || !record.connection) {
      return { ok: false, error: `plugin "${id}" is not running` }
    }
    const connection = record.connection
    const callId = String(record.nextCallId++)
    return new Promise<PluginCallResult>((resolve) => {
      const timer = setTimeout(() => {
        record.pendingCalls.delete(callId)
        resolve({ ok: false, error: `plugin "${id}" RPC call "${method}" timed out` })
      }, CALL_TIMEOUT_MS)
      record.pendingCalls.set(callId, {
        resolve(result) {
          clearTimeout(timer)
          resolve(result)
        },
      })
      connection.send({ type: "call", id: callId, method, params })
    })
  }

  async function stop(id: string): Promise<void> {
    const record = registry.get(id)
    if (!record || record.state === "stopped") return
    record.state = "stopping"
    record.connection?.close()
    record.connection = null
    const child = record.process
    if (child) {
      child.kill()
      await Promise.race([child.exited, delay(STOP_GRACE_MS)])
    }
    record.process = null
    record.state = "stopped"
    settlePendingCalls(record, { ok: false, error: `plugin "${id}" was stopped` })
  }

  function logs(id: string): readonly PluginLogEntry[] {
    return registry.get(id)?.logRing.tail() ?? []
  }

  function list(): readonly PluginSummary[] {
    return [...registry.values()].map((record) => ({
      id: record.id,
      sourceDir: record.sourceDir,
      enabled: record.enabled,
      state: record.state,
    }))
  }

  async function reload(id: string): Promise<void> {
    requireRecord(id)
    await stop(id)
    if (requireRecord(id).enabled) await start(id)
  }

  function recordClientError(id: string, text: string): void {
    registry.get(id)?.logRing.append({ stream: "err", text, at: Date.now() })
  }

  async function clientBundle(id: string): Promise<string | null> {
    const record = registry.get(id)
    return record ? readPluginClientBundle(record.clientBundlePath) : null
  }

  return { install, list, reload, restore, clientBundle, recordClientError, setEnabled, start, status, call, stop, logs }
}
