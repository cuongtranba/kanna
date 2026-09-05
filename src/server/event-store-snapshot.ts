
import path from "node:path"
import { LOG_PREFIX } from "../shared/branding"
import type { JsonValue } from "../shared/json"
import { log } from "../shared/log"
import type { AgentProvider, TranscriptEntry } from "../shared/types"
import { STORE_VERSION } from "../shared/types"
import type { StorageBackend } from "./storage/backend"
import type { CloudflareTunnelEvent } from "./cloudflare-tunnel/events"
import type { PushEvent } from "./push/events"
import type { ShareEvent } from "./session-share/share-projection"
import { compactCronRunEvents } from "./cron/compact"
import { compactLoopWakeEvents } from "./auto-continue/compact-loop-wakes"
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


export interface LegacyTranscriptStats {
  hasLegacyData: boolean
  sources: Array<"snapshot" | "messages_log">
  chatCount: number
  entryCount: number
}

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
}

export interface LoadSnapshotResult {
  snapshotHasLegacyMessages: boolean
  legacySidebarProjectOrder: string[]
}

interface ParsedReplayEvent {
  event: StoreEvent
  sourceIndex: number
  lineIndex: number
}


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
        state.autoContinueEventsByChatId.set(
          entry.chatId,
          compactLoopWakeEvents(compactCronRunEvents([...entry.events])),
        )
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


export async function writeSidebarOrderFile(
  storage: StorageBackend,
  dataDir: string,
  sidebarProjectOrderPath: string,
  projectIds: string[],
): Promise<void> {
  await storage.mkdir(dataDir)
  await storage.writeText(sidebarProjectOrderPath, `${JSON.stringify(projectIds, null, 2)}\n`)
}

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
      const event: { v?: number; type?: string; projectIds?: JsonValue } = JSON.parse(line)
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

  const fromProjectsLog = await readSidebarOrderFromProjectsLog(storage, projectsLogPath)
  const order = fromProjectsLog.length > 0 ? fromProjectsLog : [...legacySidebarProjectOrder]

  if (order.length > 0) {
    await writeSidebarOrderFile(storage, dataDir, sidebarProjectOrderPath, order)
  }
  return order
}


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


export function applyTunnelEventToMap(
  tunnelEventsByChatId: Map<string, CloudflareTunnelEvent[]>,
  event: CloudflareTunnelEvent,
): void {
  const existing = tunnelEventsByChatId.get(event.chatId) ?? []
  existing.push(event)
  tunnelEventsByChatId.set(event.chatId, existing)
}

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
