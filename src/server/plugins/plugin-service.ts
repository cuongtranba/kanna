/**
 * Domain state machine for the plugin server runtime: install (compile +
 * write to disk) → enable → start (spawn subprocess, RPC round trip) → stop.
 *
 * Deliberately separate from `plugin-settings.ts` (the persisted
 * `installedPlugins` settings collection): that module is pure CRUD over
 * user-facing config, replayed from `settings.json` on boot. This module is
 * the RUNTIME — in-memory only, one subprocess per running plugin, torn down
 * with the server. Do not route one through the other; see
 * PROGRESS-plugin-system.md's P2b chunk note.
 *
 * All process/socket/filesystem primitives live in
 * `plugin-service-io.adapter.ts` (side-effect seal) — this file is the
 * policy layer that decides what to do with them.
 */
import { homedir } from "node:os"
import { join } from "node:path"
import { errorMessage, type AnyValue } from "../../shared/errors"
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
  type PluginHostConnection,
  type SpawnedPluginChild,
} from "./plugin-service-io.adapter"
import type { PluginChildMessage } from "./plugin-rpc-protocol"

const SERVER_BUNDLE_FILENAME = "server.js"
const START_TIMEOUT_MS = 30_000
const CALL_TIMEOUT_MS = 30_000
const STOP_GRACE_MS = 5_000

export type PluginRuntimeState = "stopped" | "starting" | "running" | "stopping" | "crashed"

export type PluginCallResult = { readonly ok: true; readonly output: AnyValue } | { readonly ok: false; readonly error: string }

interface PendingCall {
  resolve(result: PluginCallResult): void
}

interface PluginRuntimeRecord {
  readonly id: string
  readonly sourceDir: string
  readonly bundlePath: string
  readonly logRing: ReturnType<typeof createPluginLogRing>
  readonly pendingCalls: Map<string, PendingCall>
  enabled: boolean
  state: PluginRuntimeState
  process: SpawnedPluginChild | null
  connection: PluginHostConnection | null
  nextCallId: number
}

export interface PluginService {
  install(args: { readonly sourceDir: string }): Promise<void>
  setEnabled(id: string, enabled: boolean): void
  start(id: string): Promise<void>
  status(id: string): { readonly state: PluginRuntimeState } | undefined
  call(id: string, method: string, params: AnyValue): Promise<PluginCallResult>
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

export function createPluginService(deps: { readonly homeDir?: string } = {}): PluginService {
  const homeDir = deps.homeDir ?? homedir()
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
    const bundlePath = join(getPluginBuildDir(homeDir, id), SERVER_BUNDLE_FILENAME)
    await writePluginServerBundle(bundlePath, built.server)

    const existing = registry.get(id)
    registry.set(id, {
      id,
      sourceDir,
      bundlePath,
      logRing: existing?.logRing ?? createPluginLogRing(),
      pendingCalls: new Map(),
      enabled: existing?.enabled ?? false,
      state: "stopped",
      process: null,
      connection: null,
      nextCallId: 1,
    })
  }

  function setEnabled(id: string, enabled: boolean): void {
    requireRecord(id).enabled = enabled
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
        // Exactly one child connects per start(); once its socket is
        // established (or the wait fails) the listener has nothing left to
        // accept, so free the temp socket path immediately rather than
        // holding it open for the process lifetime.
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

  async function call(id: string, method: string, params: AnyValue): Promise<PluginCallResult> {
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

  return { install, setEnabled, start, status, call, stop, logs }
}
