import type { AgentProvider, TranscriptEntry } from "../shared/types"
import { resetStoreState, type StoreState } from "./events"
import type { StorageBackend } from "./storage/backend"
import type { TranscriptCache } from "./event-store-messages.adapter"
import type { CloudflareTunnelEvent } from "./cloudflare-tunnel/events"
import { loadShareEvents, loadTunnelEvents, type PeripheralEventsDeps } from "./event-store-peripheral-events.adapter"
import { ALL_LOGS, LOGS_CLEARED_ON_STORAGE_RESET, type StoreLayout } from "./event-logs"
import {
  buildSnapshotFile,
  calcShouldTruncateLogs,
  computeLegacyTranscriptStats,
  loadAndReplayLogs,
  loadSidebarOrder,
  loadSnapshotIntoState,
  migrateLegacyTranscripts as migrateLegacyTranscriptsImpl,
  truncateLogsAfterSnapshot,
  type LegacyTranscriptStats,
} from "./event-store-snapshot"

export type { LegacyTranscriptStats }


export interface BootState {
  storageReset: boolean
  snapshotHasLegacyMessages: boolean
  legacySidebarProjectOrder: string[]
}

export function createBootState(): BootState {
  return { storageReset: false, snapshotHasLegacyMessages: false, legacySidebarProjectOrder: [] }
}

export interface EventStoreInitDeps {
  readonly storage: StorageBackend
  readonly layout: StoreLayout
  readonly state: StoreState
  readonly legacyMessagesByChatId: Map<string, TranscriptEntry[]>
  readonly tunnelEventsByChatId: Map<string, CloudflareTunnelEvent[]>
  readonly transcriptCache: TranscriptCache
  readonly sidebarProjectOrderRef: { value: string[] }
  readonly boot: BootState
  readonly peripheral: PeripheralEventsDeps
  replayChatProvider: Map<string, AgentProvider | null>
  applyEvent: (event: Parameters<typeof import("./event-store-apply").applyStoreEvent>[0]) => void
}


async function ensureFile(deps: EventStoreInitDeps, filePath: string): Promise<void> {
  if (!(await deps.storage.exists(filePath))) {
    await deps.storage.writeText(filePath, "")
  }
}

function resetState(deps: EventStoreInitDeps): void {
  resetStoreState(deps.state)
  deps.tunnelEventsByChatId.clear()
  deps.sidebarProjectOrderRef.value = []
  deps.boot.legacySidebarProjectOrder = []
  deps.transcriptCache.invalidateAll()
}

function clearLegacyTranscriptState(deps: EventStoreInitDeps): void {
  deps.legacyMessagesByChatId.clear()
  deps.boot.snapshotHasLegacyMessages = false
}

async function clearStorage(deps: EventStoreInitDeps): Promise<void> {
  if (deps.boot.storageReset) return
  deps.boot.storageReset = true
  resetState(deps)
  clearLegacyTranscriptState(deps)
  await Promise.all([
    deps.storage.writeText(deps.layout.snapshotPath, ""),
    ...LOGS_CLEARED_ON_STORAGE_RESET.map((name) => deps.storage.writeText(deps.layout.logPath(name), "")),
  ])
}

async function loadSnapshot(deps: EventStoreInitDeps): Promise<void> {
  const result = await loadSnapshotIntoState(
    deps.storage,
    deps.layout.snapshotPath,
    deps.state,
    deps.legacyMessagesByChatId,
    () => clearStorage(deps),
  )
  deps.boot.snapshotHasLegacyMessages = result.snapshotHasLegacyMessages
  deps.boot.legacySidebarProjectOrder = result.legacySidebarProjectOrder
}

async function loadSidebarProjectOrder(deps: EventStoreInitDeps): Promise<void> {
  deps.sidebarProjectOrderRef.value = await loadSidebarOrder(
    deps.storage,
    deps.layout,
    deps.boot.legacySidebarProjectOrder,
  )
}

async function replayLogs(deps: EventStoreInitDeps): Promise<{ replayedProjectDeletion: boolean }> {
  let replayedProjectDeletion = false
  await loadAndReplayLogs(
    deps.storage,
    deps.layout,
    () => deps.boot.storageReset,
    (event) => {
      if ("type" in event && event.type === "project_deleted") replayedProjectDeletion = true
      deps.applyEvent(event)
    },
    () => clearStorage(deps),
    () => { deps.replayChatProvider.clear() },
  )
  return { replayedProjectDeletion }
}

async function shouldSnapshotLogs(deps: EventStoreInitDeps): Promise<boolean> {
  return calcShouldTruncateLogs(deps.storage, deps.layout)
}


export async function initializeEventStore(deps: EventStoreInitDeps): Promise<void> {
  await deps.storage.mkdir(deps.layout.dataDir)
  await deps.storage.mkdir(deps.layout.transcriptsDir)
  for (const name of ALL_LOGS) await ensureFile(deps, deps.layout.logPath(name))
  await loadSnapshot(deps)
  const { replayedProjectDeletion } = await replayLogs(deps)
  await loadTunnelEvents(deps.peripheral)
  await loadShareEvents(deps.peripheral)
  await loadSidebarProjectOrder(deps)
  if (!(await hasLegacyTranscriptData(deps)) && (replayedProjectDeletion || await shouldSnapshotLogs(deps))) {
    await snapshotAndTruncateLogs(deps)
  }
}

export async function getLegacyTranscriptStats(
  deps: EventStoreInitDeps,
): Promise<LegacyTranscriptStats> {
  return computeLegacyTranscriptStats(
    deps.storage,
    deps.layout,
    deps.boot.snapshotHasLegacyMessages,
    deps.legacyMessagesByChatId,
  )
}

export async function hasLegacyTranscriptData(deps: EventStoreInitDeps): Promise<boolean> {
  return (await getLegacyTranscriptStats(deps)).hasLegacyData
}

export async function snapshotAndTruncateLogs(deps: EventStoreInitDeps): Promise<void> {
  const projects = [...deps.state.projectsById.values()]
  const snapshot = buildSnapshotFile(deps.state, projects)
  await truncateLogsAfterSnapshot(deps.storage, deps.layout, JSON.stringify(snapshot, null, 2))
}

export async function migrateLegacyTranscripts(
  deps: EventStoreInitDeps,
  onProgress?: (message: string) => void,
): Promise<boolean> {
  const stats = await getLegacyTranscriptStats(deps)
  return migrateLegacyTranscriptsImpl(
    deps.storage,
    deps.layout,
    stats,
    deps.legacyMessagesByChatId,
    () => { clearLegacyTranscriptState(deps) },
    () => snapshotAndTruncateLogs(deps),
    () => { deps.transcriptCache.invalidateAll() },
    onProgress,
  )
}
