
import path from "node:path"
import { LOG_PREFIX } from "../shared/branding"
import type { JsonValue } from "../shared/json"
import { log } from "../shared/log"
import type { AgentProvider, TranscriptEntry } from "../shared/types"
import { STORE_VERSION } from "../shared/types"
import type { StorageBackend } from "./storage/backend"
import { compactChatTaskEvents } from "../shared/chat-tasks/compact"
import { compactAutoContinueEvents } from "./auto-continue/compact"
import {
  type ChatRecord,
  type ProjectRecord,
  type SnapshotFile,
  type StoreEvent,
  type StoreState,
  cloneTranscriptEntries,
} from "./events"
import { getReplayEventPriority } from "./event-routes"
import { REPLAYED_LOGS, replaySourceOf, type StoreLayout } from "./event-logs"
import { normalizeSidebarProjectOrder } from "./event-store-chat-lifecycle"
import { readJsonl, type JsonlCorruption } from "./jsonl-log"


export interface LegacyTranscriptStats {
  hasLegacyData: boolean
  sources: Array<"snapshot" | "messages_log">
  chatCount: number
  entryCount: number
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
      if (!project.deletedAt) state.projectIdsByPath.set(project.localPath, project.id)
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
          compactAutoContinueEvents([...entry.events]),
        )
      }
    }

    if (parsed.chatTasks?.length) {
      for (const entry of parsed.chatTasks) {
        state.chatTasksByChatId.set(entry.chatId, compactChatTaskEvents([...entry.events]))
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
    chatTasks: [...state.chatTasksByChatId.entries()].map(
      ([chatId, events]) => ({ chatId, events: [...events] }),
    ),
    stacks: [...state.stacksById.values()]
      .filter((stack) => !stack.deletedAt)
      .map((stack) => ({ ...stack, projectIds: [...stack.projectIds] })),
  }
}

export async function truncateLogsAfterSnapshot(
  storage: StorageBackend,
  layout: StoreLayout,
  snapshotJson: string,
): Promise<void> {
  await storage.writeText(layout.snapshotPath, snapshotJson)
  await Promise.all(REPLAYED_LOGS.map((name) => storage.writeText(layout.logPath(name), "")))
}

const SNAPSHOT_THRESHOLD_BYTES = 2 * 1024 * 1024

export async function calcShouldTruncateLogs(
  storage: StorageBackend,
  layout: StoreLayout,
): Promise<boolean> {
  const sizes = await Promise.all(REPLAYED_LOGS.map((name) => storage.size(layout.logPath(name))))
  return sizes.reduce((total, size) => total + size, 0) >= SNAPSHOT_THRESHOLD_BYTES
}


function firstMidFileCorruption(corruptions: readonly JsonlCorruption[]): JsonlCorruption | undefined {
  return corruptions.find((corruption) => !corruption.trailing)
}

export async function loadReplayEventsFromFile(
  storage: StorageBackend,
  filePath: string,
  sourceIndex: number,
  clearStorage: () => Promise<void>,
): Promise<ParsedReplayEvent[]> {
  const { records, corruptions } = await readJsonl<StoreEvent & { v?: number; type?: string }>(storage, filePath)

  const midFileCorruption = firstMidFileCorruption(corruptions)
  if (midFileCorruption) {
    log.warn(
      `${LOG_PREFIX} Failed to replay ${path.basename(filePath)}, resetting local history:`,
      midFileCorruption.error,
    )
    await clearStorage()
    return []
  }
  if (corruptions.length > 0) {
    log.warn(`${LOG_PREFIX} Ignoring corrupt trailing line in ${path.basename(filePath)}`)
  }

  const parsedEvents: ParsedReplayEvent[] = []
  for (const { value: event, lineIndex } of records) {
    if (event.v !== STORE_VERSION) {
      log.warn(`${LOG_PREFIX} Resetting local history from incompatible event log`)
      await clearStorage()
      return []
    }
    if (event.type === "sidebar_project_order_set") continue
    parsedEvents.push({ event, sourceIndex, lineIndex })
  }
  return parsedEvents
}

export async function loadAndReplayLogs(
  storage: StorageBackend,
  layout: StoreLayout,
  isStorageReset: () => boolean,
  applyEvent: (event: StoreEvent) => void,
  clearStorage: () => Promise<void>,
  onReplayChatProviderClear: () => void,
): Promise<void> {
  if (isStorageReset()) return

  const replayEvents: ParsedReplayEvent[] = []
  for (const name of REPLAYED_LOGS) {
    replayEvents.push(
      ...await loadReplayEventsFromFile(storage, layout.logPath(name), replaySourceOf(name), clearStorage),
    )
  }

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
  layout: StoreLayout,
  projectIds: string[],
): Promise<void> {
  await storage.mkdir(layout.dataDir)
  await storage.writeText(layout.sidebarOrderPath, `${JSON.stringify(projectIds, null, 2)}\n`)
}

export async function readSidebarOrderFromProjectsLog(
  storage: StorageBackend,
  layout: StoreLayout,
): Promise<string[]> {
  const projectsLog = layout.logPath("projects")
  const { records, corruptions } = await readJsonl<{ v?: number; type?: string; projectIds?: JsonValue }>(
    storage,
    projectsLog,
  )

  const midFileCorruption = firstMidFileCorruption(corruptions)
  if (midFileCorruption) {
    log.warn(
      `${LOG_PREFIX} Failed to migrate sidebar order from ${path.basename(projectsLog)}:`,
      midFileCorruption.error,
    )
    return []
  }
  if (corruptions.length > 0) {
    log.warn(
      `${LOG_PREFIX} Ignoring corrupt trailing line in ${path.basename(projectsLog)} while migrating sidebar order`,
    )
  }

  let projectIds: string[] = []
  for (const { value: event } of records) {
    if (event.v !== STORE_VERSION || event.type !== "sidebar_project_order_set") continue
    projectIds = normalizeSidebarProjectOrder(event.projectIds)
  }
  return projectIds
}

export async function loadSidebarOrder(
  storage: StorageBackend,
  layout: StoreLayout,
  legacySidebarProjectOrder: string[],
): Promise<string[]> {
  if (await storage.exists(layout.sidebarOrderPath)) {
    try {
      const text = await storage.readText(layout.sidebarOrderPath)
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

  const fromProjectsLog = await readSidebarOrderFromProjectsLog(storage, layout)
  const order = fromProjectsLog.length > 0 ? fromProjectsLog : [...legacySidebarProjectOrder]

  if (order.length > 0) {
    await writeSidebarOrderFile(storage, layout, order)
  }
  return order
}


export async function computeLegacyTranscriptStats(
  storage: StorageBackend,
  layout: StoreLayout,
  snapshotHasLegacyMessages: boolean,
  legacyMessagesByChatId: Map<string, TranscriptEntry[]>,
): Promise<LegacyTranscriptStats> {
  const messagesLogSize = await storage.size(layout.logPath("messages"))
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
  layout: StoreLayout,
  legacyStats: LegacyTranscriptStats,
  legacyMessagesByChatId: Map<string, TranscriptEntry[]>,
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

  await storage.mkdir(layout.transcriptsDir)
  const logEveryChat = messageSets.length <= 10
  for (let index = 0; index < messageSets.length; index += 1) {
    const [chatId, entries] = messageSets[index]
    const chatTranscriptPath = layout.transcriptPath(chatId)
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
