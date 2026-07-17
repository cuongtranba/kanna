/**
 * EventStore initialization helpers extracted from event-store.ts.
 *
 * Contains initialize, ensureFile, clearStorage, loadSnapshot, resetState,
 * clearLegacyTranscriptState, loadSidebarProjectOrder, replayLogs, and
 * shouldSnapshotLogs — all setup/teardown logic that runs on boot.
 *
 * This file does direct disk IO and must be suffixed .ts (not .adapter.ts)
 * because the side-effect seal only applies to files in src/server/** production
 * code that are NOT in an exempt glob. However, since this file performs IO and
 * is NOT an adapter, callers (EventStore) must be careful to only call these
 * from the class constructor / initialize flow.
 *
 * Must NOT import from event-store.ts (no circular deps).
 */
import type { AgentProvider, TranscriptEntry } from "../shared/types"
import type { StoreState } from "./events"
import type { StorageBackend } from "./storage/backend"
import type { CachedTranscriptRef } from "./event-store-messages.adapter"
import type { CloudflareTunnelEvent } from "./cloudflare-tunnel/events"
import {
  calcShouldTruncateLogs,
  loadAndReplayLogs,
  loadSidebarOrder,
  loadSnapshotIntoState,
  type SnapshotLogPaths,
} from "./event-store-snapshot"

// ─── Deps interface ────────────────────────────────────────────────────────

export interface EventStoreInitDeps {
  readonly storage: StorageBackend
  readonly dataDir: string
  readonly snapshotPath: string
  readonly projectsLogPath: string
  readonly chatsLogPath: string
  readonly messagesLogPath: string
  readonly queuedMessagesLogPath: string
  readonly turnsLogPath: string
  readonly schedulesLogPath: string
  readonly tunnelLogPath: string
  readonly sharesLogPath: string
  readonly pushLogPath: string
  readonly stacksLogPath: string
  readonly toolRequestsLogPath: string
  readonly orchLogPath: string
  readonly transcriptsDir: string
  readonly sidebarProjectOrderPath: string
  readonly state: StoreState
  readonly legacyMessagesByChatId: Map<string, TranscriptEntry[]>
  readonly tunnelEventsByChatId: Map<string, CloudflareTunnelEvent[]>
  readonly cachedTranscriptRef: CachedTranscriptRef
  readonly sidebarProjectOrderRef: { value: string[] }
  /** Gets the current legacySidebarProjectOrder array reference. */
  getLegacySidebarProjectOrder: () => string[]
  /** Sets legacySidebarProjectOrder. */
  setLegacySidebarProjectOrder: (v: string[]) => void
  /** Sets snapshotHasLegacyMessages. */
  setSnapshotHasLegacyMessages: (v: boolean) => void
  /** Gets the current storageReset flag. */
  getStorageReset: () => boolean
  /** Sets the storageReset flag. */
  setStorageReset: (v: boolean) => void
  /** The replayChatProvider map for log replay. */
  replayChatProvider: Map<string, AgentProvider | null>
  /** Applies a store event (routes to applyStoreEvent). */
  applyEvent: (event: Parameters<typeof import("./event-store-apply").applyStoreEvent>[0]) => void
}

// ─── Internal helpers ──────────────────────────────────────────────────────

function getLogPaths(deps: EventStoreInitDeps): SnapshotLogPaths {
  return {
    snapshotPath: deps.snapshotPath,
    projectsLogPath: deps.projectsLogPath,
    chatsLogPath: deps.chatsLogPath,
    messagesLogPath: deps.messagesLogPath,
    queuedMessagesLogPath: deps.queuedMessagesLogPath,
    turnsLogPath: deps.turnsLogPath,
    schedulesLogPath: deps.schedulesLogPath,
    stacksLogPath: deps.stacksLogPath,
    toolRequestsLogPath: deps.toolRequestsLogPath,
    orchLogPath: deps.orchLogPath,
  }
}

async function ensureFile(deps: EventStoreInitDeps, filePath: string): Promise<void> {
  if (!(await deps.storage.exists(filePath))) {
    await deps.storage.writeText(filePath, "")
  }
}

function resetState(deps: EventStoreInitDeps): void {
  deps.state.projectsById.clear()
  deps.state.projectIdsByPath.clear()
  deps.state.chatsById.clear()
  deps.state.queuedMessagesByChatId.clear()
  deps.state.sidebarProjectOrder = []
  deps.state.autoContinueEventsByChatId.clear()
  deps.state.stacksById.clear()
  deps.tunnelEventsByChatId.clear()
  deps.sidebarProjectOrderRef.value = []
  deps.setLegacySidebarProjectOrder([])
  deps.cachedTranscriptRef.value = null
}

function clearLegacyTranscriptState(deps: EventStoreInitDeps): void {
  deps.legacyMessagesByChatId.clear()
  deps.setSnapshotHasLegacyMessages(false)
}

export async function clearStorage(deps: EventStoreInitDeps): Promise<void> {
  if (deps.getStorageReset()) return
  deps.setStorageReset(true)
  resetState(deps)
  clearLegacyTranscriptState(deps)
  await Promise.all([
    deps.storage.writeText(deps.snapshotPath, ""),
    deps.storage.writeText(deps.projectsLogPath, ""),
    deps.storage.writeText(deps.chatsLogPath, ""),
    deps.storage.writeText(deps.messagesLogPath, ""),
    deps.storage.writeText(deps.queuedMessagesLogPath, ""),
    deps.storage.writeText(deps.turnsLogPath, ""),
    deps.storage.writeText(deps.schedulesLogPath, ""),
    deps.storage.writeText(deps.tunnelLogPath, ""),
    deps.storage.writeText(deps.sharesLogPath, ""),
    deps.storage.writeText(deps.stacksLogPath, ""),
    deps.storage.writeText(deps.toolRequestsLogPath, ""),
    deps.storage.writeText(deps.orchLogPath, ""),
  ])
}

async function loadSnapshot(deps: EventStoreInitDeps): Promise<void> {
  const result = await loadSnapshotIntoState(
    deps.storage,
    deps.snapshotPath,
    deps.state,
    deps.legacyMessagesByChatId,
    () => clearStorage(deps),
  )
  deps.setSnapshotHasLegacyMessages(result.snapshotHasLegacyMessages)
  deps.setLegacySidebarProjectOrder(result.legacySidebarProjectOrder)
}

async function loadSidebarProjectOrder(deps: EventStoreInitDeps): Promise<void> {
  deps.sidebarProjectOrderRef.value = await loadSidebarOrder(
    deps.storage,
    deps.sidebarProjectOrderPath,
    deps.projectsLogPath,
    deps.dataDir,
    deps.getLegacySidebarProjectOrder(),
  )
}

async function replayLogs(deps: EventStoreInitDeps): Promise<void> {
  await loadAndReplayLogs(
    deps.storage,
    getLogPaths(deps),
    () => deps.getStorageReset(),
    (event) => { deps.applyEvent(event) },
    () => clearStorage(deps),
    () => { deps.replayChatProvider.clear() },
  )
}

export async function shouldSnapshotLogs(deps: EventStoreInitDeps): Promise<boolean> {
  return calcShouldTruncateLogs(deps.storage, getLogPaths(deps))
}

// ─── Public API ────────────────────────────────────────────────────────────

export async function initializeEventStore(
  deps: EventStoreInitDeps,
  callbacks: {
    loadTunnelEvents: () => Promise<void>
    loadShareEvents: () => Promise<void>
    hasLegacyTranscriptData: () => Promise<boolean>
    snapshotAndTruncateLogs: () => Promise<void>
  },
): Promise<void> {
  await deps.storage.mkdir(deps.dataDir)
  await deps.storage.mkdir(deps.transcriptsDir)
  await ensureFile(deps, deps.projectsLogPath)
  await ensureFile(deps, deps.chatsLogPath)
  await ensureFile(deps, deps.messagesLogPath)
  await ensureFile(deps, deps.queuedMessagesLogPath)
  await ensureFile(deps, deps.turnsLogPath)
  await ensureFile(deps, deps.schedulesLogPath)
  await ensureFile(deps, deps.tunnelLogPath)
  await ensureFile(deps, deps.sharesLogPath)
  await ensureFile(deps, deps.pushLogPath)
  await ensureFile(deps, deps.stacksLogPath)
  await ensureFile(deps, deps.toolRequestsLogPath)
  await ensureFile(deps, deps.orchLogPath)
  await loadSnapshot(deps)
  await replayLogs(deps)
  await callbacks.loadTunnelEvents()
  await callbacks.loadShareEvents()
  await loadSidebarProjectOrder(deps)
  if (!(await callbacks.hasLegacyTranscriptData()) && await shouldSnapshotLogs(deps)) {
    await callbacks.snapshotAndTruncateLogs()
  }
}

export function resetEventStoreState(deps: EventStoreInitDeps): void {
  resetState(deps)
}

export function clearEventStoreLegacyTranscriptState(deps: EventStoreInitDeps): void {
  clearLegacyTranscriptState(deps)
}
