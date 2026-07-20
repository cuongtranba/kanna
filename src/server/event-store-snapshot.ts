/**
 * Snapshot persistence, log-replay, sidebar-order, and event-log-load helpers
 * for EventStore.
 *
 * Extracted from event-store.ts to reduce file size. All IO is performed
 * through the injected StorageBackend abstraction; the sealed side-effect
 * lives in FsStorageBackend.adapter.ts, not here.
 */

import path from "node:path"
import { LOG_PREFIX } from "../shared/branding"
import type { AnyValue } from "../shared/errors"
import { log } from "../shared/log"
import type { AgentProvider, TranscriptEntry } from "../shared/types"
import { STORE_VERSION } from "../shared/types"
import type { StorageBackend } from "./storage/backend"
import type { CloudflareTunnelEvent } from "./cloudflare-tunnel/events"
import type { PushEvent } from "./push/events"
import type { ShareEvent } from "./session-share/share-projection"
import {
  type ChatRecord,
  type ProjectRecord,
  type SnapshotFile,
  type StoreEvent,
  type StoreState,
  cloneTranscriptEntries,
} from "./events"
import {
  getReplayEventPriority,
  normalizeSidebarProjectOrder,
} from "./event-store-helpers"

// ─── Types ─────────────────────────────────────────────────────────────────

export interface LegacyTranscriptStats {
  hasLegacyData: boolean
  sources: Array<"snapshot" | "messages_log">
  chatCount: number
  entryCount: number
}

/** Paths for the log files involved in snapshot/replay. */
export interface SnapshotLogPaths {
  snapshotPath: string
  projectsLogPath: string
  chatsLogPath: string
  messagesLogPath: string
  queuedMessagesLogPath: string
  turnsLogPath: string
  schedulesLogPath: string
  stacksLogPath: string
  toolRequestsLogPath: string
  orchLogPath: string
}

/** Returned by {@link loadSnapshotIntoState}. */
export interface LoadSnapshotResult {
  snapshotHasLegacyMessages: boolean
  legacySidebarProjectOrder: string[]
}

// Internal only — used by loadAndReplayLogs.
interface ParsedReplayEvent {
  event: StoreEvent
  sourceIndex: number
  lineIndex: number
}

// ─── Snapshot loading ──────────────────────────────────────────────────────

/**
 * Read `snapshotPath` and populate the in-memory state maps from its content.
 * Calls `clearStorage` when the snapshot version does not match STORE_VERSION
 * or when parsing fails (fail-closed reset).
 *
 * @returns scalar fields that cannot be set through the mutated Maps.
 */
export async function loadSnapshotIntoState(
  storage: StorageBackend,
  snapshotPath: string,
  state: StoreState,
  legacyMessagesByChatId: Map<string, TranscriptEntry[]>,
  clearStorage: () => Promise<void>,
): Promise<LoadSnapshotResult> {
  const empty: LoadSnapshotResult = { snapshotHasLegacyMessages: false, legacySidebarProjectOrder: [] }

  if (!(await storage.exists(snapshotPath))) return empty

  try {
    const text = await storage.readText(snapshotPath)
    if (!text.trim()) return empty

    const parsed: SnapshotFile = JSON.parse(text)
    if (parsed.v !== STORE_VERSION) {
      log.warn(`${LOG_PREFIX} Resetting local chat history for store version ${STORE_VERSION}`)
      await clearStorage()
      return empty
    }

    for (const project of parsed.projects) {
      state.projectsById.set(project.id, { ...project })
      state.projectIdsByPath.set(project.localPath, project.id)
    }

    for (const chat of parsed.chats) {
      // Access legacy fields from old snapshot data via Reflect.get (avoids `as` casts).
      const legacySessionToken: string | null | undefined = Reflect.get(chat, "sessionToken")
      const legacyPendingFork: string | null | { provider: AgentProvider; token: string } | undefined =
        Reflect.get(chat, "pendingForkSessionToken")
      const legacyTokensByProvider: Partial<Record<AgentProvider, string | null>> | undefined =
        Reflect.get(chat, "sessionTokensByProvider")

      const sessionTokensByProvider: Partial<Record<AgentProvider, string | null>> =
        legacyTokensByProvider ? { ...legacyTokensByProvider } : {}
      if (
        typeof legacySessionToken === "string"
        && chat.provider
        && sessionTokensByProvider[chat.provider] == null
      ) {
        sessionTokensByProvider[chat.provider] = legacySessionToken
      }

      let pendingForkSessionToken: ChatRecord["pendingForkSessionToken"] = null
      if (legacyPendingFork && typeof legacyPendingFork === "object" && "token" in legacyPendingFork) {
        pendingForkSessionToken = legacyPendingFork
      } else if (typeof legacyPendingFork === "string" && chat.provider) {
        pendingForkSessionToken = { provider: chat.provider, token: legacyPendingFork }
      }

      state.chatsById.set(chat.id, {
        ...chat,
        unread: chat.unread ?? false,
        sessionTokensByProvider,
        pendingForkSessionToken,
      })
      // Mirror the chat_created handler: every live chat needs a subagent-run
      // map, or subagent_run_started events after a reboot are silently
      // dropped from the read model (the runs never reach the UI).
      if (!chat.deletedAt) {
        state.subagentRunsByChatId.set(chat.id, new Map())
      }
    }

    const legacySidebarProjectOrder = normalizeSidebarProjectOrder(
      parsed.sidebarProjectOrder,
    )

    if (parsed.queuedMessages?.length) {
      for (const queuedSet of parsed.queuedMessages) {
        state.queuedMessagesByChatId.set(
          queuedSet.chatId,
          queuedSet.entries.map((entry) => ({
            ...entry,
            attachments: [...entry.attachments],
          })),
        )
      }
    }

    let snapshotHasLegacyMessages = false
    if (parsed.messages?.length) {
      snapshotHasLegacyMessages = true
      for (const messageSet of parsed.messages) {
        legacyMessagesByChatId.set(
          messageSet.chatId,
          cloneTranscriptEntries(messageSet.entries),
        )
      }
    }

    if (parsed.autoContinueEvents?.length) {
      for (const entry of parsed.autoContinueEvents) {
        state.autoContinueEventsByChatId.set(entry.chatId, [...entry.events])
      }
    }

    if (parsed.stacks?.length) {
      for (const stack of parsed.stacks) {
        state.stacksById.set(stack.id, { ...stack, projectIds: [...stack.projectIds] })
      }
    }

    return { snapshotHasLegacyMessages, legacySidebarProjectOrder }
  } catch (error) {
    log.warn(`${LOG_PREFIX} Failed to load snapshot, resetting local history:`, String(error))
    await clearStorage()
    return empty
  }
}

// ─── Snapshot persistence ──────────────────────────────────────────────────

/**
 * Build a `SnapshotFile` from the current in-memory state (pure — no IO).
 */
export function buildSnapshotFile(
  state: StoreState,
  projects: ProjectRecord[],
): SnapshotFile {
  return {
    v: STORE_VERSION,
    generatedAt: Date.now(),
    projects: projects.map((project) => ({ ...project })),
    chats: [...state.chatsById.values()]
      .filter((chat) => !chat.deletedAt)
      .map((chat) => ({ ...chat })),
    queuedMessages: [...state.queuedMessagesByChatId.entries()].map(([chatId, entries]) => ({
      chatId,
      entries: entries.map((entry) => ({
        ...entry,
        attachments: [...entry.attachments],
      })),
    })),
    autoContinueEvents: [...state.autoContinueEventsByChatId.entries()].map(
      ([chatId, events]) => ({ chatId, events: [...events] }),
    ),
    stacks: [...state.stacksById.values()]
      .filter((stack) => !stack.deletedAt)
      .map((stack) => ({ ...stack, projectIds: [...stack.projectIds] })),
  }
}

/**
 * Write `snapshotJson` to disk and truncate all compactable log files to empty.
 * (tunnels.jsonl, push.jsonl, tool-requests.jsonl are intentionally excluded;
 * see comments in the original EventStore implementation.)
 */
export async function truncateLogsAfterSnapshot(
  storage: StorageBackend,
  paths: SnapshotLogPaths,
  snapshotJson: string,
): Promise<void> {
  await storage.writeText(paths.snapshotPath, snapshotJson)
  await Promise.all([
    storage.writeText(paths.projectsLogPath, ""),
    storage.writeText(paths.chatsLogPath, ""),
    storage.writeText(paths.messagesLogPath, ""),
    storage.writeText(paths.queuedMessagesLogPath, ""),
    storage.writeText(paths.turnsLogPath, ""),
    storage.writeText(paths.schedulesLogPath, ""),
    storage.writeText(paths.stacksLogPath, ""),
    storage.writeText(paths.toolRequestsLogPath, ""),
  ])
}

const SNAPSHOT_THRESHOLD_BYTES = 2 * 1024 * 1024

/**
 * Returns true when the combined size of compactable log files exceeds
 * {@link SNAPSHOT_THRESHOLD_BYTES} (2 MiB).
 */
export async function calcShouldTruncateLogs(
  storage: StorageBackend,
  paths: SnapshotLogPaths,
): Promise<boolean> {
  const sizes = await Promise.all([
    storage.size(paths.projectsLogPath),
    storage.size(paths.chatsLogPath),
    storage.size(paths.messagesLogPath),
    storage.size(paths.queuedMessagesLogPath),
    storage.size(paths.turnsLogPath),
    storage.size(paths.schedulesLogPath),
    storage.size(paths.stacksLogPath),
    storage.size(paths.toolRequestsLogPath),
  ])
  return sizes.reduce((total, size) => total + size, 0) >= SNAPSHOT_THRESHOLD_BYTES
}

// ─── Log replay ────────────────────────────────────────────────────────────

/**
 * Load a single JSONL log file and return the parsed events, skipping
 * `sidebar_project_order_set` events (handled separately). On a corrupt
 * trailing line, returns whatever was parsed so far. On an incompatible
 * store version or a corrupt mid-file line, calls `clearStorage` and returns
 * an empty array.
 */
export async function loadReplayEventsFromFile(
  storage: StorageBackend,
  filePath: string,
  sourceIndex: number,
  clearStorage: () => Promise<void>,
): Promise<ParsedReplayEvent[]> {
  if (!(await storage.exists(filePath))) return []

  const text = await storage.readText(filePath)
  if (!text.trim()) return []

  const parsedEvents: ParsedReplayEvent[] = []
  const lines = text.split("\n")
  let lastNonEmpty = -1
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index].trim()) {
      lastNonEmpty = index
      break
    }
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim()
    if (!line) continue
    try {
      const event: StoreEvent & { v?: number; type?: string } = JSON.parse(line)
      if (event.v !== STORE_VERSION) {
        log.warn(`${LOG_PREFIX} Resetting local history from incompatible event log`)
        await clearStorage()
        return []
      }
      if (event.type === "sidebar_project_order_set") {
        continue
      }
      parsedEvents.push({ event, sourceIndex, lineIndex: index })
    } catch (error) {
      if (index === lastNonEmpty) {
        log.warn(`${LOG_PREFIX} Ignoring corrupt trailing line in ${path.basename(filePath)}`)
        return parsedEvents
      }
      log.warn(
        `${LOG_PREFIX} Failed to replay ${path.basename(filePath)}, resetting local history:`,
        String(error),
      )
      await clearStorage()
      return []
    }
  }

  return parsedEvents
}

/**
 * Load all log files, sort events by timestamp, and apply them in order.
 * Short-circuits if `isStorageReset()` returns true before or after loading
 * (a version mismatch in any file triggers `clearStorage` in
 * {@link loadReplayEventsFromFile}).
 */
export async function loadAndReplayLogs(
  storage: StorageBackend,
  paths: SnapshotLogPaths,
  isStorageReset: () => boolean,
  applyEvent: (event: StoreEvent) => void,
  clearStorage: () => Promise<void>,
  onReplayChatProviderClear: () => void,
): Promise<void> {
  if (isStorageReset()) return

  const replayEvents = [
    ...await loadReplayEventsFromFile(storage, paths.projectsLogPath, 0, clearStorage),
    ...await loadReplayEventsFromFile(storage, paths.stacksLogPath, 1, clearStorage),
    ...await loadReplayEventsFromFile(storage, paths.chatsLogPath, 2, clearStorage),
    ...await loadReplayEventsFromFile(storage, paths.messagesLogPath, 3, clearStorage),
    ...await loadReplayEventsFromFile(storage, paths.queuedMessagesLogPath, 4, clearStorage),
    ...await loadReplayEventsFromFile(storage, paths.turnsLogPath, 5, clearStorage),
    ...await loadReplayEventsFromFile(storage, paths.schedulesLogPath, 6, clearStorage),
    ...await loadReplayEventsFromFile(storage, paths.toolRequestsLogPath, 7, clearStorage),
    ...await loadReplayEventsFromFile(storage, paths.orchLogPath, 8, clearStorage),
  ]

  if (isStorageReset()) return

  replayEvents
    .sort(
      (left, right) =>
        left.event.timestamp - right.event.timestamp
        || getReplayEventPriority(left.event) - getReplayEventPriority(right.event)
        || left.sourceIndex - right.sourceIndex
        || left.lineIndex - right.lineIndex,
    )
    .forEach(({ event }) => { applyEvent(event) })

  onReplayChatProviderClear()
}

// ─── Sidebar project order ─────────────────────────────────────────────────

/**
 * Write `projectIds` as JSON to the sidebar order file.
 */
export async function writeSidebarOrderFile(
  storage: StorageBackend,
  dataDir: string,
  sidebarProjectOrderPath: string,
  projectIds: string[],
): Promise<void> {
  await storage.mkdir(dataDir)
  await storage.writeText(sidebarProjectOrderPath, `${JSON.stringify(projectIds, null, 2)}\n`)
}

/**
 * Scan `projectsLogPath` for the latest `sidebar_project_order_set` event and
 * return the project IDs from it. Returns `[]` if the file is absent, empty,
 * or corrupt.
 */
export async function readSidebarOrderFromProjectsLog(
  storage: StorageBackend,
  projectsLogPath: string,
): Promise<string[]> {
  if (!(await storage.exists(projectsLogPath))) return []

  const text = await storage.readText(projectsLogPath)
  if (!text.trim()) return []

  const lines = text.split("\n")
  let lastNonEmpty = -1
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index].trim()) {
      lastNonEmpty = index
      break
    }
  }

  let projectIds: string[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim()
    if (!line) continue
    try {
      const event: { v?: number; type?: string; projectIds?: AnyValue } = JSON.parse(line)
      if (event.v !== STORE_VERSION || event.type !== "sidebar_project_order_set") {
        continue
      }
      projectIds = normalizeSidebarProjectOrder(event.projectIds)
    } catch (error) {
      if (index === lastNonEmpty) {
        log.warn(
          `${LOG_PREFIX} Ignoring corrupt trailing line in ${path.basename(projectsLogPath)} while migrating sidebar order`,
        )
        return projectIds
      }
      log.warn(
        `${LOG_PREFIX} Failed to migrate sidebar order from ${path.basename(projectsLogPath)}:`,
        String(error),
      )
      return []
    }
  }

  return projectIds
}

/**
 * Load the authoritative sidebar project order from disk.
 *
 * Resolution order:
 * 1. Dedicated `sidebar-order.json` file.
 * 2. Latest `sidebar_project_order_set` event from `projects.jsonl`.
 * 3. `legacySidebarProjectOrder` from the last loaded snapshot.
 *
 * If the dedicated file does not exist but a legacy order is found, the
 * legacy order is written to the dedicated file as a one-time migration.
 *
 * Returns the resolved project IDs array.
 */
export async function loadSidebarOrder(
  storage: StorageBackend,
  sidebarProjectOrderPath: string,
  projectsLogPath: string,
  dataDir: string,
  legacySidebarProjectOrder: string[],
): Promise<string[]> {
  if (await storage.exists(sidebarProjectOrderPath)) {
    try {
      const text = await storage.readText(sidebarProjectOrderPath)
      if (!text.trim()) return []
      return normalizeSidebarProjectOrder(JSON.parse(text))
    } catch (error) {
      log.warn(
        `${LOG_PREFIX} Failed to load sidebar-order.json, ignoring saved order:`,
        String(error),
      )
      return []
    }
  }

  // No dedicated file yet — migrate from the legacy source.
  const fromProjectsLog = await readSidebarOrderFromProjectsLog(storage, projectsLogPath)
  const order = fromProjectsLog.length > 0 ? fromProjectsLog : [...legacySidebarProjectOrder]

  if (order.length > 0) {
    await writeSidebarOrderFile(storage, dataDir, sidebarProjectOrderPath, order)
  }
  return order
}

// ─── Legacy transcript helpers ─────────────────────────────────────────────

/**
 * Compute legacy-transcript statistics from the current in-memory legacy
 * maps and the storage size of `messages.jsonl`.
 */
export async function computeLegacyTranscriptStats(
  storage: StorageBackend,
  messagesLogPath: string,
  snapshotHasLegacyMessages: boolean,
  legacyMessagesByChatId: Map<string, TranscriptEntry[]>,
): Promise<LegacyTranscriptStats> {
  const messagesLogSize = await storage.size(messagesLogPath)
  const sources: LegacyTranscriptStats["sources"] = []
  if (snapshotHasLegacyMessages) {
    sources.push("snapshot")
  }
  if (messagesLogSize > 0) {
    sources.push("messages_log")
  }

  let entryCount = 0
  for (const entries of legacyMessagesByChatId.values()) {
    entryCount += entries.length
  }

  return {
    hasLegacyData: sources.length > 0 || legacyMessagesByChatId.size > 0,
    sources,
    chatCount: legacyMessagesByChatId.size,
    entryCount,
  }
}

/**
 * Write per-chat transcript files from `legacyMessagesByChatId`, clear
 * the legacy state, snapshot + truncate logs, and invalidate the cache.
 *
 * Returns `false` if no legacy data exists; `true` on success.
 */
export async function migrateLegacyTranscripts(
  storage: StorageBackend,
  transcriptsDir: string,
  legacyStats: LegacyTranscriptStats,
  legacyMessagesByChatId: Map<string, TranscriptEntry[]>,
  transcriptPath: (chatId: string) => string,
  onClearLegacyState: () => void,
  onSnapshotAndTruncate: () => Promise<void>,
  onCacheInvalidate: () => void,
  onProgress?: (message: string) => void,
): Promise<boolean> {
  if (!legacyStats.hasLegacyData) return false

  const sourceSummary = legacyStats.sources
    .map((source) => (source === "messages_log" ? "messages.jsonl" : "snapshot.json"))
    .join(", ")
  onProgress?.(
    `${LOG_PREFIX} transcript migration detected: ${legacyStats.chatCount} chats, ${legacyStats.entryCount} entries from ${sourceSummary}`,
  )

  const messageSets = [...legacyMessagesByChatId.entries()]
  onProgress?.(
    `${LOG_PREFIX} transcript migration: writing ${messageSets.length} per-chat transcript files`,
  )

  await storage.mkdir(transcriptsDir)
  const logEveryChat = messageSets.length <= 10
  for (let index = 0; index < messageSets.length; index += 1) {
    const [chatId, entries] = messageSets[index]
    const chatTranscriptPath = transcriptPath(chatId)
    const tempPath = `${chatTranscriptPath}.tmp`
    const payload = entries.map((entry) => JSON.stringify(entry)).join("\n")
    await storage.writeText(tempPath, payload ? `${payload}\n` : "")
    await storage.rename(tempPath, chatTranscriptPath)
    if (logEveryChat || (index + 1) % 25 === 0 || index === messageSets.length - 1) {
      onProgress?.(`${LOG_PREFIX} transcript migration: ${index + 1}/${messageSets.length} chats`)
    }
  }

  onClearLegacyState()
  await onSnapshotAndTruncate()
  onCacheInvalidate()
  onProgress?.(`${LOG_PREFIX} transcript migration complete`)
  return true
}

// ─── Tunnel event apply + load ─────────────────────────────────────────────

/**
 * Apply a single CloudflareTunnelEvent to the in-memory map (pure, no IO).
 */
export function applyTunnelEventToMap(
  tunnelEventsByChatId: Map<string, CloudflareTunnelEvent[]>,
  event: CloudflareTunnelEvent,
): void {
  const existing = tunnelEventsByChatId.get(event.chatId) ?? []
  existing.push(event)
  tunnelEventsByChatId.set(event.chatId, existing)
}

/**
 * Load `tunnels.jsonl` from disk and populate `tunnelEventsByChatId`.
 * Malformed lines are skipped with a warning.
 */
export async function loadTunnelEventsFromLog(
  storage: StorageBackend,
  tunnelLogPath: string,
  tunnelEventsByChatId: Map<string, CloudflareTunnelEvent[]>,
): Promise<void> {
  if (!(await storage.exists(tunnelLogPath))) return
  const text = await storage.readText(tunnelLogPath)
  if (!text.trim()) return
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim()
    if (!line) continue
    try {
      const event: CloudflareTunnelEvent = JSON.parse(line)
      applyTunnelEventToMap(tunnelEventsByChatId, event)
    } catch {
      log.warn(`${LOG_PREFIX} Ignoring malformed line in tunnels.jsonl`)
    }
  }
}

// ─── Share event load ──────────────────────────────────────────────────────

/**
 * Load `shares.jsonl` from disk and append to `shareEventsAll`.
 * Malformed lines are skipped with a warning.
 */
export async function loadShareEventsFromLog(
  storage: StorageBackend,
  sharesLogPath: string,
  shareEventsAll: ShareEvent[],
): Promise<void> {
  if (!(await storage.exists(sharesLogPath))) return
  const text = await storage.readText(sharesLogPath)
  if (!text.trim()) return
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim()
    if (!line) continue
    try {
      const event: ShareEvent = JSON.parse(line)
      shareEventsAll.push(event)
    } catch {
      log.warn(`${LOG_PREFIX} Ignoring malformed line in shares.jsonl`)
    }
  }
}

// ─── Push event load ───────────────────────────────────────────────────────

/**
 * Load `push.jsonl` from disk and return all parsed PushEvents.
 * Malformed lines are skipped with a warning.
 */
export async function loadPushEventsFromLog(
  storage: StorageBackend,
  pushLogPath: string,
): Promise<PushEvent[]> {
  if (!(await storage.exists(pushLogPath))) return []
  const text = await storage.readText(pushLogPath)
  if (!text.trim()) return []
  const events: PushEvent[] = []
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim()
    if (!line) continue
    try {
      const pushEvent: PushEvent = JSON.parse(line)
      events.push(pushEvent)
    } catch {
      log.warn(`${LOG_PREFIX} Ignoring malformed line in push.jsonl`)
    }
  }
  return events
}
