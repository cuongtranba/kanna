import { appendFile, mkdir, rename, rm, writeFile } from "node:fs/promises"
import { existsSync, readFileSync as readFileSyncImmediate } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import { getDataDir, LOG_PREFIX } from "../shared/branding"
import type { AgentProvider, ChatHistoryPage, ChatHistorySnapshot, QueuedChatMessage, SlashCommand, StackBinding, SubagentRunSnapshot, TranscriptEntry } from "../shared/types"
import { STORE_VERSION } from "../shared/types"
import type { AutoContinueEvent } from "./auto-continue/events"
import {
  type ChatEvent,
  type ChatRecord,
  type ChatTimingState,
  type ProjectEvent,
  type QueuedMessageEvent,
  type SnapshotFile,
  type StackEvent,
  type StackRecord,
  type StoreEvent,
  type StoreState,
  type SubagentRunEvent,
  type TurnEvent,
  cloneTranscriptEntries,
  createEmptyState,
} from "./events"
import { resolveLocalPath } from "./paths"
import type { CloudflareTunnelEvent } from "./cloudflare-tunnel/events"
import type { PushEvent, PushEventStore } from "./push/events"
import { ACTIVE_SESSION_IDLE_GAP_MS } from "./read-models"
import { capTranscriptEntry } from "./subagent-entry-cap"

const COMPACTION_THRESHOLD_BYTES = 2 * 1024 * 1024
const STALE_EMPTY_CHAT_MAX_AGE_MS = 30 * 60 * 1000
const SIDEBAR_PROJECT_ORDER_FILE = "sidebar-order.json"

function normalizeSidebarProjectOrder(value: unknown) {
  if (!Array.isArray(value)) {
    return []
  }

  const seen = new Set<string>()
  const projectIds: string[] = []
  for (const entry of value) {
    if (typeof entry !== "string") continue
    const projectId = entry.trim()
    if (!projectId || seen.has(projectId)) continue
    seen.add(projectId)
    projectIds.push(projectId)
  }

  return projectIds
}

function isSendToStartingProfilingEnabled() {
  return process.env.KANNA_PROFILE_SEND_TO_STARTING === "1"
}

function logSendToStartingProfile(stage: string, details?: Record<string, unknown>) {
  if (!isSendToStartingProfilingEnabled()) {
    return
  }

  console.log("[kanna/send->starting][server]", JSON.stringify({
    stage,
    ...details,
  }))
}

interface LegacyTranscriptStats {
  hasLegacyData: boolean
  sources: Array<"snapshot" | "messages_log">
  chatCount: number
  entryCount: number
}

interface TranscriptPageResult {
  entries: TranscriptEntry[]
  hasOlder: boolean
  olderCursor: string | null
}

interface ParsedReplayEvent {
  event: StoreEvent
  sourceIndex: number
  lineIndex: number
}

function getReplayEventPriority(event: StoreEvent): number {
  const discriminator = "type" in event ? event.type : event.kind
  switch (discriminator) {
    case "project_opened":
    case "project_removed":
    case "sidebar_project_order_set":
    case "project_star_set":
      return 0
    case "chat_created":
      return 1
    case "chat_renamed":
    case "chat_provider_set":
    case "chat_plan_mode_set":
      return 2
    case "message_appended":
      return 3
    case "queued_message_enqueued":
    case "queued_message_removed":
      return 4
    case "turn_started":
      return 5
    case "session_token_set":
    case "session_commands_loaded":
      return 6
    case "pending_fork_session_token_set":
      return 6
    case "turn_cancelled":
      return 7
    case "turn_finished":
    case "turn_failed":
      return 8
    case "chat_read_state_set":
    case "chat_source_hash_set":
      return 9
    case "chat_deleted":
    case "chat_archived":
    case "chat_unarchived":
      return 10
    case "auto_continue_proposed":
    case "auto_continue_accepted":
    case "auto_continue_rescheduled":
    case "auto_continue_cancelled":
    case "auto_continue_fired":
      return 11
    case "stack_added":
    case "stack_removed":
    case "stack_renamed":
    case "stack_project_added":
    case "stack_project_removed":
      return 0
    case "subagent_run_started":
    case "subagent_message_delta":
    case "subagent_entry_appended":
    case "subagent_run_completed":
    case "subagent_run_failed":
    case "subagent_run_cancelled":
    case "subagent_tool_pending":
    case "subagent_tool_resolved":
      return 5
    default: {
      const _exhaustive: never = discriminator
      throw new Error(`Unhandled replay event type: ${String(_exhaustive)}`)
    }
  }
}

function encodeHistoryCursor(index: number) {
  return `idx:${index}`
}

function decodeCursor(cursor: string) {
  if (cursor.startsWith("idx:")) {
    const value = Number.parseInt(cursor.slice("idx:".length), 10)
    if (!Number.isInteger(value) || value < 0) {
      throw new Error("Invalid history cursor")
    }
    return value
  }

  throw new Error("Invalid history cursor")
}

function slashCommandsEqual(a: SlashCommand[], b: SlashCommand[]) {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    const ai = a[i]
    const bi = b[i]
    if (ai.name !== bi.name || ai.description !== bi.description || ai.argumentHint !== bi.argumentHint) {
      return false
    }
  }
  return true
}

function getHistorySnapshot(page: TranscriptPageResult, recentLimit: number): ChatHistorySnapshot {
  return {
    hasOlder: page.hasOlder,
    olderCursor: page.olderCursor,
    recentLimit,
  }
}

function getForkedChatTitle(title: string) {
  const trimmed = title.trim()
  if (!trimmed) return "Fork: New Chat"
  return trimmed.startsWith("Fork: ") ? trimmed : `Fork: ${trimmed}`
}

export class EventStore implements PushEventStore {
  readonly dataDir: string
  readonly state: StoreState = createEmptyState()
  private writeChain = Promise.resolve()
  private storageReset = false
  private readonly snapshotPath: string
  private readonly projectsLogPath: string
  private readonly chatsLogPath: string
  private readonly messagesLogPath: string
  private readonly queuedMessagesLogPath: string
  private readonly turnsLogPath: string
  private readonly schedulesLogPath: string
  private readonly tunnelLogPath: string
  private readonly pushLogPath: string
  private readonly stacksLogPath: string
  private readonly transcriptsDir: string
  private readonly sidebarProjectOrderPath: string
  private legacyMessagesByChatId = new Map<string, TranscriptEntry[]>()
  private legacySidebarProjectOrder: string[] = []
  private sidebarProjectOrder: string[] = []
  private snapshotHasLegacyMessages = false
  private cachedTranscript: { chatId: string; entries: TranscriptEntry[] } | null = null
  private readonly tunnelEventsByChatId = new Map<string, CloudflareTunnelEvent[]>()
  private replayChatProvider = new Map<string, AgentProvider | null>()

  constructor(dataDir = getDataDir(homedir())) {
    this.dataDir = dataDir
    this.snapshotPath = path.join(this.dataDir, "snapshot.json")
    this.projectsLogPath = path.join(this.dataDir, "projects.jsonl")
    this.chatsLogPath = path.join(this.dataDir, "chats.jsonl")
    this.messagesLogPath = path.join(this.dataDir, "messages.jsonl")
    this.queuedMessagesLogPath = path.join(this.dataDir, "queued-messages.jsonl")
    this.turnsLogPath = path.join(this.dataDir, "turns.jsonl")
    this.schedulesLogPath = path.join(this.dataDir, "schedules.jsonl")
    this.tunnelLogPath = path.join(this.dataDir, "tunnels.jsonl")
    this.pushLogPath = path.join(this.dataDir, "push.jsonl")
    this.stacksLogPath = path.join(this.dataDir, "stacks.jsonl")
    this.transcriptsDir = path.join(this.dataDir, "transcripts")
    this.sidebarProjectOrderPath = path.join(this.dataDir, SIDEBAR_PROJECT_ORDER_FILE)
  }

  async initialize() {
    await mkdir(this.dataDir, { recursive: true })
    await mkdir(this.transcriptsDir, { recursive: true })
    await this.ensureFile(this.projectsLogPath)
    await this.ensureFile(this.chatsLogPath)
    await this.ensureFile(this.messagesLogPath)
    await this.ensureFile(this.queuedMessagesLogPath)
    await this.ensureFile(this.turnsLogPath)
    await this.ensureFile(this.schedulesLogPath)
    await this.ensureFile(this.tunnelLogPath)
    await this.ensureFile(this.pushLogPath)
    await this.ensureFile(this.stacksLogPath)
    await this.loadSnapshot()
    await this.replayLogs()
    await this.loadTunnelEvents()
    await this.loadSidebarProjectOrder()
    if (!(await this.hasLegacyTranscriptData()) && await this.shouldCompact()) {
      await this.compact()
    }
  }

  private async ensureFile(filePath: string) {
    const file = Bun.file(filePath)
    if (!(await file.exists())) {
      await Bun.write(filePath, "")
    }
  }

  private async clearStorage() {
    if (this.storageReset) return
    this.storageReset = true
    this.resetState()
    this.clearLegacyTranscriptState()
    await Promise.all([
      Bun.write(this.snapshotPath, ""),
      Bun.write(this.projectsLogPath, ""),
      Bun.write(this.chatsLogPath, ""),
      Bun.write(this.messagesLogPath, ""),
      Bun.write(this.queuedMessagesLogPath, ""),
      Bun.write(this.turnsLogPath, ""),
      Bun.write(this.schedulesLogPath, ""),
      Bun.write(this.tunnelLogPath, ""),
      Bun.write(this.stacksLogPath, ""),
    ])
  }

  private async loadSnapshot() {
    const file = Bun.file(this.snapshotPath)
    if (!(await file.exists())) return

    try {
      const text = await file.text()
      if (!text.trim()) return
      const parsed = JSON.parse(text) as SnapshotFile
      if (parsed.v !== STORE_VERSION) {
        console.warn(`${LOG_PREFIX} Resetting local chat history for store version ${STORE_VERSION}`)
        await this.clearStorage()
        return
      }
      for (const project of parsed.projects) {
        this.state.projectsById.set(project.id, { ...project })
        this.state.projectIdsByPath.set(project.localPath, project.id)
      }
      for (const chat of parsed.chats) {
        const legacy = chat as unknown as {
          sessionToken?: string | null
          pendingForkSessionToken?: string | null | { provider: AgentProvider; token: string }
          sessionTokensByProvider?: Partial<Record<AgentProvider, string | null>>
        }
        const sessionTokensByProvider: Partial<Record<AgentProvider, string | null>> =
          legacy.sessionTokensByProvider
            ? { ...legacy.sessionTokensByProvider }
            : {}
        if (
          typeof legacy.sessionToken === "string"
          && chat.provider
          && sessionTokensByProvider[chat.provider] == null
        ) {
          sessionTokensByProvider[chat.provider] = legacy.sessionToken
        }
        let pendingForkSessionToken: ChatRecord["pendingForkSessionToken"] = null
        const rawPending = legacy.pendingForkSessionToken
        if (rawPending && typeof rawPending === "object" && "token" in rawPending) {
          pendingForkSessionToken = rawPending as { provider: AgentProvider; token: string }
        } else if (typeof rawPending === "string" && chat.provider) {
          pendingForkSessionToken = { provider: chat.provider, token: rawPending }
        }
        const {
          sessionToken: _legacySessionToken,
          pendingForkSessionToken: _legacyPendingForkSessionToken,
          sessionTokensByProvider: _legacyByProvider,
          ...rest
        } = legacy
        void _legacySessionToken
        void _legacyPendingForkSessionToken
        void _legacyByProvider
        this.state.chatsById.set(chat.id, {
          ...(rest as unknown as ChatRecord),
          unread: chat.unread ?? false,
          sessionTokensByProvider,
          pendingForkSessionToken,
        })
      }
      this.legacySidebarProjectOrder = normalizeSidebarProjectOrder(parsed.sidebarProjectOrder)
      if (parsed.queuedMessages?.length) {
        for (const queuedSet of parsed.queuedMessages) {
          this.state.queuedMessagesByChatId.set(queuedSet.chatId, queuedSet.entries.map((entry) => ({
            ...entry,
            attachments: [...entry.attachments],
          })))
        }
      }
      if (parsed.messages?.length) {
        this.snapshotHasLegacyMessages = true
        for (const messageSet of parsed.messages) {
          this.legacyMessagesByChatId.set(messageSet.chatId, cloneTranscriptEntries(messageSet.entries))
        }
      }
      if (parsed.autoContinueEvents?.length) {
        for (const entry of parsed.autoContinueEvents) {
          this.state.autoContinueEventsByChatId.set(entry.chatId, [...entry.events])
        }
      }
      if (parsed.stacks?.length) {
        for (const stack of parsed.stacks) {
          this.state.stacksById.set(stack.id, { ...stack, projectIds: [...stack.projectIds] })
        }
      }
    } catch (error) {
      console.warn(`${LOG_PREFIX} Failed to load snapshot, resetting local history:`, error)
      await this.clearStorage()
    }
  }

  private resetState() {
    this.state.projectsById.clear()
    this.state.projectIdsByPath.clear()
    this.state.chatsById.clear()
    this.state.queuedMessagesByChatId.clear()
    this.state.sidebarProjectOrder = []
    this.state.autoContinueEventsByChatId.clear()
    this.state.stacksById.clear()
    this.tunnelEventsByChatId.clear()
    this.sidebarProjectOrder = []
    this.legacySidebarProjectOrder = []
    this.cachedTranscript = null
  }

  private clearLegacyTranscriptState() {
    this.legacyMessagesByChatId.clear()
    this.snapshotHasLegacyMessages = false
  }

  private async loadSidebarProjectOrder() {
    const file = Bun.file(this.sidebarProjectOrderPath)
    if (await file.exists()) {
      try {
        const text = await file.text()
        if (!text.trim()) {
          this.sidebarProjectOrder = []
          return
        }
        this.sidebarProjectOrder = normalizeSidebarProjectOrder(JSON.parse(text))
      } catch (error) {
        console.warn(`${LOG_PREFIX} Failed to load ${SIDEBAR_PROJECT_ORDER_FILE}, ignoring saved order:`, error)
        this.sidebarProjectOrder = []
      }
      return
    }

    const legacySidebarProjectOrder = await this.loadLegacySidebarProjectOrder()
    this.sidebarProjectOrder = legacySidebarProjectOrder
    if (legacySidebarProjectOrder.length > 0) {
      await this.writeSidebarProjectOrderFile(legacySidebarProjectOrder)
    }
  }

  private async loadLegacySidebarProjectOrder() {
    const fromProjectsLog = await this.readLegacySidebarProjectOrderFromProjectsLog()
    if (fromProjectsLog.length > 0) {
      return fromProjectsLog
    }
    return [...this.legacySidebarProjectOrder]
  }

  private async readLegacySidebarProjectOrderFromProjectsLog() {
    const file = Bun.file(this.projectsLogPath)
    if (!(await file.exists())) return []

    const text = await file.text()
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
        const event = JSON.parse(line) as {
          v?: number
          type?: string
          projectIds?: unknown
        }
        if (event.v !== STORE_VERSION || event.type !== "sidebar_project_order_set") {
          continue
        }
        projectIds = normalizeSidebarProjectOrder(event.projectIds)
      } catch (error) {
        if (index === lastNonEmpty) {
          console.warn(`${LOG_PREFIX} Ignoring corrupt trailing line in ${path.basename(this.projectsLogPath)} while migrating sidebar order`)
          return projectIds
        }
        console.warn(`${LOG_PREFIX} Failed to migrate sidebar order from ${path.basename(this.projectsLogPath)}:`, error)
        return []
      }
    }

    return projectIds
  }

  private async writeSidebarProjectOrderFile(projectIds: string[]) {
    await mkdir(this.dataDir, { recursive: true })
    await writeFile(this.sidebarProjectOrderPath, `${JSON.stringify(projectIds, null, 2)}\n`, "utf8")
  }

  private async replayLogs() {
    if (this.storageReset) return
    const replayEvents = [
      ...await this.loadReplayEvents(this.projectsLogPath, 0),
      ...await this.loadReplayEvents(this.stacksLogPath, 1),
      ...await this.loadReplayEvents(this.chatsLogPath, 2),
      ...await this.loadReplayEvents(this.messagesLogPath, 3),
      ...await this.loadReplayEvents(this.queuedMessagesLogPath, 4),
      ...await this.loadReplayEvents(this.turnsLogPath, 5),
      ...await this.loadReplayEvents(this.schedulesLogPath, 6),
    ]
    if (this.storageReset) return

    replayEvents
      .sort((left, right) => (
        left.event.timestamp - right.event.timestamp
        || getReplayEventPriority(left.event) - getReplayEventPriority(right.event)
        || left.sourceIndex - right.sourceIndex
        || left.lineIndex - right.lineIndex
      ))
      .forEach(({ event }) => {
        this.applyEvent(event)
      })
    this.replayChatProvider.clear()
  }

  private async loadReplayEvents(filePath: string, sourceIndex: number): Promise<ParsedReplayEvent[]> {
    const file = Bun.file(filePath)
    if (!(await file.exists())) return []
    const text = await file.text()
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
        const event = JSON.parse(line) as Partial<StoreEvent>
        if (event.v !== STORE_VERSION) {
          console.warn(`${LOG_PREFIX} Resetting local history from incompatible event log`)
          await this.clearStorage()
          return []
        }
        if ((event as { type?: unknown }).type === "sidebar_project_order_set") {
          continue
        }
        parsedEvents.push({
          event: event as StoreEvent,
          sourceIndex,
          lineIndex: index,
        })
      } catch (error) {
        if (index === lastNonEmpty) {
          console.warn(`${LOG_PREFIX} Ignoring corrupt trailing line in ${path.basename(filePath)}`)
          return parsedEvents
        }
        console.warn(`${LOG_PREFIX} Failed to replay ${path.basename(filePath)}, resetting local history:`, error)
        await this.clearStorage()
        return []
      }
    }

    return parsedEvents
  }

  private applyEvent(event: StoreEvent) {
    if ("kind" in event) {
      this.applyAutoContinueEvent(event)
      return
    }
    const e = event as Exclude<StoreEvent, AutoContinueEvent>
    switch (e.type) {
      case "project_opened": {
        const localPath = resolveLocalPath(e.localPath)
        const project = {
          id: e.projectId,
          localPath,
          title: e.title,
          createdAt: e.timestamp,
          updatedAt: e.timestamp,
        }
        this.state.projectsById.set(project.id, project)
        this.state.projectIdsByPath.set(localPath, project.id)
        break
      }
      case "project_removed": {
        const project = this.state.projectsById.get(e.projectId)
        if (!project) break
        project.deletedAt = e.timestamp
        project.updatedAt = e.timestamp
        this.state.projectIdsByPath.delete(project.localPath)
        break
      }
      case "sidebar_project_order_set": {
        this.state.sidebarProjectOrder = [...e.projectIds]
        break
      }
      case "project_star_set": {
        const project = this.state.projectsById.get(e.projectId)
        if (!project) break
        if (e.starredAt == null) {
          delete project.starredAt
        } else {
          project.starredAt = e.starredAt
        }
        project.updatedAt = e.timestamp
        break
      }
      case "chat_created": {
        const chat: ChatRecord = {
          id: e.chatId,
          projectId: e.projectId,
          title: e.title,
          createdAt: e.timestamp,
          updatedAt: e.timestamp,
          unread: false,
          provider: null,
          planMode: false,
          sessionTokensByProvider: {},
          sourceHash: null,
          pendingForkSessionToken: null,
          hasMessages: false,
          lastTurnOutcome: null,
        }
        if (e.stackId !== undefined) chat.stackId = e.stackId
        if (e.stackBindings !== undefined) chat.stackBindings = e.stackBindings.map((b) => ({ ...b }))
        this.state.chatsById.set(chat.id, chat)
        this.replayChatProvider.set(e.chatId, null)
        this.state.subagentRunsByChatId.set(e.chatId, new Map())
        this.updateTiming(e.chatId, e.timestamp, "idle")
        break
      }
      case "chat_renamed": {
        const chat = this.state.chatsById.get(e.chatId)
        if (!chat) break
        chat.title = e.title
        chat.updatedAt = e.timestamp
        break
      }
      case "chat_deleted": {
        const chat = this.state.chatsById.get(e.chatId)
        if (!chat) break
        chat.deletedAt = e.timestamp
        chat.updatedAt = e.timestamp
        this.state.queuedMessagesByChatId.delete(e.chatId)
        this.state.autoContinueEventsByChatId.delete(e.chatId)
        this.state.chatTimingsByChatId.delete(e.chatId)
        this.state.subagentRunsByChatId.delete(e.chatId)
        break
      }
      case "chat_archived": {
        const chat = this.state.chatsById.get(e.chatId)
        if (!chat) break
        chat.archivedAt = e.timestamp
        chat.updatedAt = e.timestamp
        break
      }
      case "chat_unarchived": {
        const chat = this.state.chatsById.get(e.chatId)
        if (!chat) break
        delete chat.archivedAt
        chat.updatedAt = e.timestamp
        break
      }
      case "chat_provider_set": {
        const chat = this.state.chatsById.get(e.chatId)
        if (!chat) break
        chat.provider = e.provider
        chat.updatedAt = e.timestamp
        this.replayChatProvider.set(e.chatId, e.provider)
        break
      }
      case "chat_plan_mode_set": {
        const chat = this.state.chatsById.get(e.chatId)
        if (!chat) break
        chat.planMode = e.planMode
        chat.updatedAt = e.timestamp
        break
      }
      case "chat_read_state_set": {
        const chat = this.state.chatsById.get(e.chatId)
        if (!chat) break
        chat.unread = e.unread
        chat.updatedAt = e.timestamp
        break
      }
      case "chat_source_hash_set": {
        const chat = this.state.chatsById.get(e.chatId)
        if (!chat) break
        chat.sourceHash = e.sourceHash
        chat.updatedAt = e.timestamp
        break
      }
      case "message_appended": {
        this.applyMessageMetadata(e.chatId, e.entry)
        const existing = this.legacyMessagesByChatId.get(e.chatId) ?? []
        existing.push({ ...e.entry })
        this.legacyMessagesByChatId.set(e.chatId, existing)
        break
      }
      case "queued_message_enqueued": {
        const existing = this.state.queuedMessagesByChatId.get(e.chatId) ?? []
        existing.push({
          ...e.message,
          attachments: [...e.message.attachments],
        })
        this.state.queuedMessagesByChatId.set(e.chatId, existing)
        const chat = this.state.chatsById.get(e.chatId)
        if (chat) {
          chat.updatedAt = e.timestamp
        }
        break
      }
      case "queued_message_removed": {
        const existing = this.state.queuedMessagesByChatId.get(e.chatId) ?? []
        const next = existing.filter((entry) => entry.id !== e.queuedMessageId)
        if (next.length > 0) {
          this.state.queuedMessagesByChatId.set(e.chatId, next)
        } else {
          this.state.queuedMessagesByChatId.delete(e.chatId)
        }
        const chat = this.state.chatsById.get(e.chatId)
        if (chat) {
          chat.updatedAt = e.timestamp
        }
        break
      }
      case "turn_started": {
        const chat = this.state.chatsById.get(e.chatId)
        if (!chat) break
        chat.updatedAt = e.timestamp
        this.updateTiming(e.chatId, e.timestamp, "running", true, false)
        break
      }
      case "turn_finished": {
        const chat = this.state.chatsById.get(e.chatId)
        if (!chat) break
        chat.updatedAt = e.timestamp
        chat.unread = true
        chat.lastTurnOutcome = "success"
        this.updateTiming(e.chatId, e.timestamp, "idle", false, true)
        break
      }
      case "turn_failed": {
        const chat = this.state.chatsById.get(e.chatId)
        if (!chat) break
        chat.updatedAt = e.timestamp
        chat.unread = true
        chat.lastTurnOutcome = "failed"
        this.updateTiming(e.chatId, e.timestamp, "failed", false, true)
        break
      }
      case "turn_cancelled": {
        const chat = this.state.chatsById.get(e.chatId)
        if (!chat) break
        chat.updatedAt = e.timestamp
        chat.lastTurnOutcome = "cancelled"
        this.updateTiming(e.chatId, e.timestamp, "idle", false, true)
        break
      }
      case "session_token_set": {
        const chat = this.state.chatsById.get(e.chatId)
        if (!chat) break
        const provider = e.provider ?? this.replayChatProvider.get(e.chatId) ?? chat.provider
        if (!provider) break
        chat.sessionTokensByProvider = {
          ...chat.sessionTokensByProvider,
          [provider]: e.sessionToken,
        }
        chat.updatedAt = e.timestamp
        break
      }
      case "session_commands_loaded": {
        const chat = this.state.chatsById.get(e.chatId)
        if (!chat) break
        chat.slashCommands = e.commands.map((c) => ({ ...c }))
        chat.updatedAt = e.timestamp
        break
      }
      case "pending_fork_session_token_set": {
        const chat = this.state.chatsById.get(e.chatId)
        if (!chat) break
        if (e.pendingForkSessionToken == null) {
          chat.pendingForkSessionToken = null
        } else {
          const provider = e.provider ?? this.replayChatProvider.get(e.chatId) ?? chat.provider
          if (!provider) break
          chat.pendingForkSessionToken = { provider, token: e.pendingForkSessionToken }
        }
        chat.updatedAt = e.timestamp
        break
      }
      case "stack_added": {
        const record: StackRecord = {
          id: e.stackId,
          title: e.title,
          projectIds: [...e.projectIds],
          createdAt: e.timestamp,
          updatedAt: e.timestamp,
        }
        this.state.stacksById.set(record.id, record)
        break
      }
      case "stack_removed": {
        const stack = this.state.stacksById.get(e.stackId)
        if (!stack || stack.deletedAt) break
        stack.deletedAt = e.timestamp
        stack.updatedAt = e.timestamp
        break
      }
      case "stack_renamed": {
        const stack = this.state.stacksById.get(e.stackId)
        if (!stack || stack.deletedAt) break
        stack.title = e.title
        stack.updatedAt = e.timestamp
        break
      }
      case "stack_project_added": {
        const stack = this.state.stacksById.get(e.stackId)
        if (!stack || stack.deletedAt) break
        if (stack.projectIds.includes(e.projectId)) break
        stack.projectIds = [...stack.projectIds, e.projectId]
        stack.updatedAt = e.timestamp
        break
      }
      case "stack_project_removed": {
        const stack = this.state.stacksById.get(e.stackId)
        if (!stack || stack.deletedAt) break
        const next = stack.projectIds.filter((id) => id !== e.projectId)
        stack.projectIds = next
        stack.updatedAt = e.timestamp
        break
      }
      case "subagent_run_started": {
        const map = this.state.subagentRunsByChatId.get(e.chatId)
        if (!map) break
        map.set(e.runId, {
          runId: e.runId,
          chatId: e.chatId,
          subagentId: e.subagentId,
          subagentName: e.subagentName,
          provider: e.provider,
          model: e.model,
          status: "running",
          parentUserMessageId: e.parentUserMessageId,
          parentRunId: e.parentRunId,
          depth: e.depth,
          startedAt: e.timestamp,
          finishedAt: null,
          finalText: null,
          error: null,
          usage: null,
          entries: [],
          pendingTool: null,
        })
        break
      }
      case "subagent_message_delta": {
        const map = this.state.subagentRunsByChatId.get(e.chatId)
        const run = map?.get(e.runId)
        if (!run) break
        run.finalText = (run.finalText ?? "") + e.content
        break
      }
      case "subagent_entry_appended": {
        const map = this.state.subagentRunsByChatId.get(e.chatId)
        const run = map?.get(e.runId)
        if (!run) break
        run.entries.push(e.entry)
        // If the entry carries usage (the SDK's terminal "result" message), mirror
        // it onto run.usage so callers can read it without scanning entries.
        if (e.entry.kind === "result") {
          const usage = e.entry.usage
          const cost = e.entry.costUsd
          run.usage = {
            inputTokens: usage?.inputTokens,
            outputTokens: usage?.outputTokens,
            cachedInputTokens: usage?.cachedInputTokens,
            costUsd: cost,
          }
        }
        break
      }
      case "subagent_run_completed": {
        const map = this.state.subagentRunsByChatId.get(e.chatId)
        const run = map?.get(e.runId)
        if (!run) break
        run.status = "completed"
        run.finishedAt = e.timestamp
        run.finalText = e.finalContent
        // Merge: prefer e.usage if present, otherwise keep what subagent_entry_appended
        // already mirrored. Otherwise null. Without this guard a streaming run
        // whose completion event omits usage would silently erase it.
        run.usage = e.usage ?? run.usage ?? null
        break
      }
      case "subagent_run_failed": {
        const map = this.state.subagentRunsByChatId.get(e.chatId)
        const run = map?.get(e.runId)
        if (!run) break
        run.status = "failed"
        run.finishedAt = e.timestamp
        run.error = e.error
        run.pendingTool = null
        break
      }
      case "subagent_run_cancelled": {
        const map = this.state.subagentRunsByChatId.get(e.chatId)
        const run = map?.get(e.runId)
        if (!run) break
        run.status = "cancelled"
        run.finishedAt = e.timestamp
        run.pendingTool = null
        break
      }
      case "subagent_tool_pending": {
        const map = this.state.subagentRunsByChatId.get(e.chatId)
        const run = map?.get(e.runId)
        if (!run) break
        run.pendingTool = {
          toolUseId: e.toolUseId,
          toolKind: e.toolKind,
          input: e.input,
          requestedAt: e.timestamp,
        }
        break
      }
      case "subagent_tool_resolved": {
        const map = this.state.subagentRunsByChatId.get(e.chatId)
        const run = map?.get(e.runId)
        if (!run) break
        run.pendingTool = null
        const syntheticEntry: TranscriptEntry = {
          kind: "tool_result",
          _id: `${e.runId}:${e.toolUseId}:resolved`,
          createdAt: e.timestamp,
          toolId: e.toolUseId,
          content: e.result,
        }
        run.entries.push(syntheticEntry)
        break
      }
    }
  }

  private updateTiming(chatId: string, eventTs: number, nextStatus: ChatTimingState["status"], onTurnStart?: boolean, onTurnFinish?: boolean) {
    const prev = this.state.chatTimingsByChatId.get(chatId)
    if (!prev) {
      // chat_created path: seed
      this.state.chatTimingsByChatId.set(chatId, {
        status: nextStatus,
        stateEnteredAt: eventTs,
        activeSessionStartedAt: eventTs,
        lastTurnStartedAt: null,
        lastTurnDurationMs: null,
        cumulativeMs: { idle: 0, starting: 0, running: 0, failed: 0 },
      })
      return
    }

    const segmentMs = Math.max(0, eventTs - prev.stateEnteredAt)
    let activeSessionStartedAt = prev.activeSessionStartedAt
    let cumulativeMs = { ...prev.cumulativeMs }

    // Detect long idle gap when leaving idle -> something
    if (prev.status === "idle" && nextStatus !== "idle" && segmentMs > ACTIVE_SESSION_IDLE_GAP_MS) {
      activeSessionStartedAt = eventTs
      cumulativeMs = { idle: 0, starting: 0, running: 0, failed: 0 }
    } else {
      cumulativeMs[prev.status] += segmentMs
    }

    let lastTurnStartedAt = prev.lastTurnStartedAt
    let lastTurnDurationMs = prev.lastTurnDurationMs
    if (onTurnStart) lastTurnStartedAt = eventTs
    if (onTurnFinish && lastTurnStartedAt != null) lastTurnDurationMs = Math.max(0, eventTs - lastTurnStartedAt)

    this.state.chatTimingsByChatId.set(chatId, {
      status: nextStatus,
      stateEnteredAt: eventTs,
      activeSessionStartedAt,
      lastTurnStartedAt,
      lastTurnDurationMs,
      cumulativeMs,
    })
  }

  private applyAutoContinueEvent(event: AutoContinueEvent) {
    const existing = this.state.autoContinueEventsByChatId.get(event.chatId) ?? []
    existing.push(event)
    this.state.autoContinueEventsByChatId.set(event.chatId, existing)
  }

  private applyMessageMetadata(chatId: string, entry: TranscriptEntry) {
    const chat = this.state.chatsById.get(chatId)
    if (!chat) return
    chat.hasMessages = true
    if (entry.kind === "user_prompt") {
      chat.lastMessageAt = entry.createdAt
    }
    chat.updatedAt = Math.max(chat.updatedAt, entry.createdAt)
  }

  private append<TEvent extends StoreEvent>(filePath: string, event: TEvent) {
    const payload = `${JSON.stringify(event)}\n`
    this.writeChain = this.writeChain.then(async () => {
      await appendFile(filePath, payload, "utf8")
      this.applyEvent(event)
    })
    return this.writeChain
  }

  private transcriptPath(chatId: string) {
    return path.join(this.transcriptsDir, `${chatId}.jsonl`)
  }

  private loadTranscriptFromDisk(chatId: string) {
    const transcriptPath = this.transcriptPath(chatId)
    if (!existsSync(transcriptPath)) {
      return []
    }

    const text = readFileSyncImmediate(transcriptPath, "utf8")
    if (!text.trim()) return []

    const entries: TranscriptEntry[] = []
    for (const rawLine of text.split("\n")) {
      const line = rawLine.trim()
      if (!line) continue
      entries.push(JSON.parse(line) as TranscriptEntry)
    }
    return entries
  }

  async openProject(localPath: string, title?: string) {
    const normalized = resolveLocalPath(localPath)
    const existingId = this.state.projectIdsByPath.get(normalized)
    if (existingId) {
      const existing = this.state.projectsById.get(existingId)
      if (existing && !existing.deletedAt) {
        return existing
      }
    }

    const hiddenProject = [...this.state.projectsById.values()]
      .find((project) => project.localPath === normalized && project.deletedAt)
    const projectId = hiddenProject?.id ?? crypto.randomUUID()
    const event: ProjectEvent = {
      v: STORE_VERSION,
      type: "project_opened",
      timestamp: Date.now(),
      projectId,
      localPath: normalized,
      title: title?.trim() || path.basename(normalized) || normalized,
    }
    await this.append(this.projectsLogPath, event)
    return this.state.projectsById.get(projectId)!
  }

  async removeProject(projectId: string) {
    const project = this.getProject(projectId)
    if (!project) {
      throw new Error("Project not found")
    }

    const event: ProjectEvent = {
      v: STORE_VERSION,
      type: "project_removed",
      timestamp: Date.now(),
      projectId,
    }
    await this.append(this.projectsLogPath, event)
  }

  async setProjectStar(projectId: string, starred: boolean) {
    const project = this.getProject(projectId)
    if (!project) {
      throw new Error("Project not found")
    }
    const now = Date.now()
    const event: ProjectEvent = {
      v: STORE_VERSION,
      type: "project_star_set",
      timestamp: now,
      projectId,
      starredAt: starred ? now : null,
    }
    await this.append(this.projectsLogPath, event)
  }

  async createStack(title: string, projectIds: string[]): Promise<StackRecord> {
    const trimmed = title.trim()
    if (trimmed === "") throw new Error("Stack title cannot be empty")
    if (projectIds.length < 2) throw new Error("Stack requires at least 2 projects")
    if (new Set(projectIds).size !== projectIds.length) throw new Error("Stack projectIds contain duplicates")
    for (const projectId of projectIds) {
      const project = this.state.projectsById.get(projectId)
      if (!project || project.deletedAt) throw new Error(`Project not found: ${projectId}`)
    }
    const stackId = crypto.randomUUID()
    const event: StackEvent = {
      v: STORE_VERSION,
      type: "stack_added",
      timestamp: Date.now(),
      stackId,
      title: trimmed,
      projectIds: [...projectIds],
    }
    await this.append(this.stacksLogPath, event)
    return this.state.stacksById.get(stackId)!
  }

  getStack(stackId: string): StackRecord | null {
    const stack = this.state.stacksById.get(stackId)
    return stack && !stack.deletedAt ? stack : null
  }

  listStacks(): StackRecord[] {
    return [...this.state.stacksById.values()].filter((s) => !s.deletedAt)
  }

  async renameStack(stackId: string, title: string): Promise<void> {
    const stack = this.state.stacksById.get(stackId)
    if (!stack || stack.deletedAt) throw new Error("Stack not found")
    const trimmed = title.trim()
    if (trimmed === "") throw new Error("Stack title cannot be empty")
    if (trimmed === stack.title) return
    const event: StackEvent = {
      v: STORE_VERSION,
      type: "stack_renamed",
      timestamp: Date.now(),
      stackId,
      title: trimmed,
    }
    await this.append(this.stacksLogPath, event)
  }

  async removeStack(stackId: string): Promise<void> {
    const stack = this.state.stacksById.get(stackId)
    if (!stack) throw new Error("Stack not found")
    if (stack.deletedAt) return
    const event: StackEvent = {
      v: STORE_VERSION,
      type: "stack_removed",
      timestamp: Date.now(),
      stackId,
    }
    await this.append(this.stacksLogPath, event)
  }

  async addProjectToStack(stackId: string, projectId: string): Promise<void> {
    const stack = this.state.stacksById.get(stackId)
    if (!stack || stack.deletedAt) throw new Error("Stack not found")
    const project = this.state.projectsById.get(projectId)
    if (!project || project.deletedAt) throw new Error("Project not found")
    if (stack.projectIds.includes(projectId)) return
    const event: StackEvent = {
      v: STORE_VERSION,
      type: "stack_project_added",
      timestamp: Date.now(),
      stackId,
      projectId,
    }
    await this.append(this.stacksLogPath, event)
  }

  async removeProjectFromStack(stackId: string, projectId: string): Promise<void> {
    const stack = this.state.stacksById.get(stackId)
    if (!stack || stack.deletedAt) throw new Error("Stack not found")
    if (!stack.projectIds.includes(projectId)) return
    if (stack.projectIds.length <= 2) {
      throw new Error("Stack must keep at least 2 projects. Delete the stack instead.")
    }
    const event: StackEvent = {
      v: STORE_VERSION,
      type: "stack_project_removed",
      timestamp: Date.now(),
      stackId,
      projectId,
    }
    await this.append(this.stacksLogPath, event)
  }

  async setSidebarProjectOrder(projectIds: string[]) {
    const validProjectIds = projectIds.filter((projectId) => {
      const project = this.state.projectsById.get(projectId)
      return Boolean(project && !project.deletedAt)
    })

    const uniqueProjectIds = [...new Set(validProjectIds)]
    const current = this.sidebarProjectOrder
    if (
      uniqueProjectIds.length === current.length
      && uniqueProjectIds.every((projectId, index) => current[index] === projectId)
    ) {
      return
    }

    this.writeChain = this.writeChain.then(async () => {
      await this.writeSidebarProjectOrderFile(uniqueProjectIds)
      this.sidebarProjectOrder = [...uniqueProjectIds]
    })
    return this.writeChain
  }

  async createChat(
    projectId: string,
    options?: { stackId?: string; stackBindings?: StackBinding[] },
  ): Promise<import("./events").ChatRecord> {
    const project = this.state.projectsById.get(projectId)
    if (!project || project.deletedAt) {
      throw new Error("Project not found")
    }

    if (options?.stackId !== undefined || options?.stackBindings !== undefined) {
      if (options.stackId === undefined || options.stackBindings === undefined) {
        throw new Error("stackId and stackBindings must be provided together")
      }
      const stack = this.state.stacksById.get(options.stackId)
      if (!stack || stack.deletedAt) throw new Error("Stack not found")
      if (options.stackBindings.length === 0) throw new Error("stackBindings cannot be empty")
      const primaries = options.stackBindings.filter((b) => b.role === "primary")
      if (primaries.length !== 1) throw new Error("Exactly one primary binding required")
      const seenProjects = new Set<string>()
      for (const binding of options.stackBindings) {
        if (seenProjects.has(binding.projectId)) {
          throw new Error("Duplicate projectId in stackBindings")
        }
        seenProjects.add(binding.projectId)
        if (!stack.projectIds.includes(binding.projectId)) {
          throw new Error(`Binding projectId not a member of stack: ${binding.projectId}`)
        }
        const peerProject = this.state.projectsById.get(binding.projectId)
        if (!peerProject || peerProject.deletedAt) {
          throw new Error(`Project not found: ${binding.projectId}`)
        }
        if (typeof binding.worktreePath !== "string" || binding.worktreePath.trim() === "") {
          throw new Error("worktreePath must be a non-empty string")
        }
      }
      if (primaries[0].projectId !== projectId) {
        throw new Error("Primary binding projectId must match createChat projectId")
      }
    }

    const chatId = crypto.randomUUID()
    const event: ChatEvent = {
      v: STORE_VERSION,
      type: "chat_created",
      timestamp: Date.now(),
      chatId,
      projectId,
      title: "New Chat",
      ...(options?.stackId !== undefined ? { stackId: options.stackId } : {}),
      ...(options?.stackBindings !== undefined ? { stackBindings: options.stackBindings.map((b) => ({ ...b })) } : {}),
    }
    await this.append(this.chatsLogPath, event)
    return this.state.chatsById.get(chatId)!
  }

  async forkChat(sourceChatId: string) {
    const sourceChat = this.requireChat(sourceChatId)
    const sourceProvider = sourceChat.provider
    if (!sourceProvider) {
      throw new Error("Chat cannot be forked")
    }
    const sourceSessionToken =
      sourceChat.sessionTokensByProvider[sourceProvider]
      ?? (sourceChat.pendingForkSessionToken?.provider === sourceProvider
        ? sourceChat.pendingForkSessionToken.token
        : null)
    if (!sourceSessionToken) {
      throw new Error("Chat cannot be forked")
    }

    const chatId = crypto.randomUUID()
    const createdAt = Date.now()
    const createEvent: ChatEvent = {
      v: STORE_VERSION,
      type: "chat_created",
      timestamp: createdAt,
      chatId,
      projectId: sourceChat.projectId,
      title: getForkedChatTitle(sourceChat.title),
      ...(sourceChat.stackId !== undefined ? { stackId: sourceChat.stackId } : {}),
      ...(sourceChat.stackBindings !== undefined
        ? { stackBindings: sourceChat.stackBindings.map((b) => ({ ...b })) }
        : {}),
    }
    await this.append(this.chatsLogPath, createEvent)
    await this.setChatProvider(chatId, sourceProvider)
    await this.setPlanMode(chatId, sourceChat.planMode)
    await this.setPendingForkSessionToken(chatId, { provider: sourceProvider, token: sourceSessionToken })

    const sourceEntries = this.getMessages(sourceChatId)
    if (sourceEntries.length > 0) {
      const transcriptPath = this.transcriptPath(chatId)
      const payload = sourceEntries.map((entry) => JSON.stringify(entry)).join("\n")
      this.writeChain = this.writeChain.then(async () => {
        await mkdir(this.transcriptsDir, { recursive: true })
        await writeFile(transcriptPath, `${payload}\n`, "utf8")
        const chat = this.state.chatsById.get(chatId)
        if (chat) {
          chat.hasMessages = true
          chat.updatedAt = Math.max(chat.updatedAt, createdAt)
        }
        if (this.cachedTranscript?.chatId === chatId) {
          this.cachedTranscript = { chatId, entries: cloneTranscriptEntries(sourceEntries) }
        }
      })
      await this.writeChain
    }

    return this.state.chatsById.get(chatId)!
  }

  async renameChat(chatId: string, title: string) {
    const trimmed = title.trim()
    if (!trimmed) return
    const chat = this.requireChat(chatId)
    if (chat.title === trimmed) return
    const event: ChatEvent = {
      v: STORE_VERSION,
      type: "chat_renamed",
      timestamp: Date.now(),
      chatId,
      title: trimmed,
    }
    await this.append(this.chatsLogPath, event)
  }

  async deleteChat(chatId: string) {
    const chat = this.requireChat(chatId)
    const projectId = chat.projectId
    const event: ChatEvent = {
      v: STORE_VERSION,
      type: "chat_deleted",
      timestamp: Date.now(),
      chatId,
    }
    await this.append(this.chatsLogPath, event)
    this.removeSubagentResultsDir(projectId, chatId)
  }

  private removeSubagentResultsDir(projectId: string, chatId: string) {
    const dir = path.join(
      this.dataDir, "projects", projectId, "chats", chatId, "subagent-results",
    )
    rm(dir, { recursive: true, force: true })
      .catch((err) => console.warn(`${LOG_PREFIX} subagent-results cleanup failed`, { chatId, err }))
  }

  async archiveChat(chatId: string) {
    this.requireChat(chatId)
    const event: ChatEvent = {
      v: STORE_VERSION,
      type: "chat_archived",
      timestamp: Date.now(),
      chatId,
    }
    await this.append(this.chatsLogPath, event)
  }

  async unarchiveChat(chatId: string) {
    this.requireChat(chatId)
    const event: ChatEvent = {
      v: STORE_VERSION,
      type: "chat_unarchived",
      timestamp: Date.now(),
      chatId,
    }
    await this.append(this.chatsLogPath, event)
  }

  async pruneStaleEmptyChats(args?: {
    now?: number
    maxAgeMs?: number
    activeChatIds?: Iterable<string>
    protectedChatIds?: Iterable<string>
  }) {
    const now = args?.now ?? Date.now()
    const maxAgeMs = args?.maxAgeMs ?? STALE_EMPTY_CHAT_MAX_AGE_MS
    const protectedChatIds = new Set([
      ...(args?.activeChatIds ?? []),
      ...(args?.protectedChatIds ?? []),
    ])
    const prunedChatIds: string[] = []

    for (const chat of this.state.chatsById.values()) {
      if (chat.deletedAt || chat.archivedAt || protectedChatIds.has(chat.id)) continue
      if (now - chat.createdAt < maxAgeMs) continue
      if (chat.hasMessages) continue
      if (this.getMessages(chat.id).length > 0) {
        chat.hasMessages = true
        continue
      }

      const event: ChatEvent = {
        v: STORE_VERSION,
        type: "chat_deleted",
        timestamp: now,
        chatId: chat.id,
      }
      await this.append(this.chatsLogPath, event)

      const transcriptPath = this.transcriptPath(chat.id)
      await rm(transcriptPath, { force: true })
      if (this.cachedTranscript?.chatId === chat.id) {
        this.cachedTranscript = null
      }
      this.removeSubagentResultsDir(chat.projectId, chat.id)

      prunedChatIds.push(chat.id)
    }

    return prunedChatIds
  }

  async setChatProvider(chatId: string, provider: AgentProvider) {
    const chat = this.requireChat(chatId)
    if (chat.provider === provider) return
    const event: ChatEvent = {
      v: STORE_VERSION,
      type: "chat_provider_set",
      timestamp: Date.now(),
      chatId,
      provider,
    }
    await this.append(this.chatsLogPath, event)
  }

  async setPlanMode(chatId: string, planMode: boolean) {
    const chat = this.requireChat(chatId)
    if (chat.planMode === planMode) return
    const event: ChatEvent = {
      v: STORE_VERSION,
      type: "chat_plan_mode_set",
      timestamp: Date.now(),
      chatId,
      planMode,
    }
    await this.append(this.chatsLogPath, event)
  }

  async setChatReadState(chatId: string, unread: boolean) {
    const chat = this.requireChat(chatId)
    if (chat.unread === unread) return
    const event: ChatEvent = {
      v: STORE_VERSION,
      type: "chat_read_state_set",
      timestamp: Date.now(),
      chatId,
      unread,
    }
    await this.append(this.chatsLogPath, event)
  }

  async appendMessage(chatId: string, entry: TranscriptEntry) {
    this.requireChat(chatId)
    const payload = `${JSON.stringify(entry)}\n`
    const transcriptPath = this.transcriptPath(chatId)
    const queuedAt = performance.now()
    this.writeChain = this.writeChain.then(async () => {
      const startedAt = performance.now()
      const queueDelayMs = Number((startedAt - queuedAt).toFixed(1))
      await mkdir(this.transcriptsDir, { recursive: true })
      const beforeAppendAt = performance.now()
      await appendFile(transcriptPath, payload, "utf8")
      const afterAppendAt = performance.now()
      this.applyMessageMetadata(chatId, entry)
      if (this.cachedTranscript?.chatId === chatId) {
        this.cachedTranscript.entries.push({ ...entry })
      }
      logSendToStartingProfile("event_store.append_message", {
        chatId,
        entryId: entry._id,
        kind: entry.kind,
        payloadBytes: payload.length,
        queueDelayMs,
        appendMs: Number((afterAppendAt - beforeAppendAt).toFixed(1)),
        totalMs: Number((afterAppendAt - queuedAt).toFixed(1)),
      })
    })
    return this.writeChain
  }

  async enqueueMessage(chatId: string, message: Omit<QueuedChatMessage, "id" | "createdAt"> & Partial<Pick<QueuedChatMessage, "id" | "createdAt">>) {
    this.requireChat(chatId)
    const queuedMessage: QueuedChatMessage = {
      id: message.id ?? crypto.randomUUID(),
      content: message.content,
      attachments: [...(message.attachments ?? [])],
      createdAt: message.createdAt ?? Date.now(),
      provider: message.provider,
      model: message.model,
      modelOptions: message.modelOptions,
      planMode: message.planMode,
      autoContinue: message.autoContinue,
    }
    const event: QueuedMessageEvent = {
      v: STORE_VERSION,
      type: "queued_message_enqueued",
      timestamp: queuedMessage.createdAt,
      chatId,
      message: queuedMessage,
    }
    await this.append(this.queuedMessagesLogPath, event)
    return queuedMessage
  }

  async removeQueuedMessage(chatId: string, queuedMessageId: string) {
    this.requireChat(chatId)
    const existing = this.getQueuedMessages(chatId)
    if (!existing.some((entry) => entry.id === queuedMessageId)) {
      throw new Error("Queued message not found")
    }
    const event: QueuedMessageEvent = {
      v: STORE_VERSION,
      type: "queued_message_removed",
      timestamp: Date.now(),
      chatId,
      queuedMessageId,
    }
    await this.append(this.queuedMessagesLogPath, event)
  }

  async recordTurnStarted(chatId: string) {
    this.requireChat(chatId)
    const event: TurnEvent = {
      v: STORE_VERSION,
      type: "turn_started",
      timestamp: Date.now(),
      chatId,
    }
    await this.append(this.turnsLogPath, event)
  }

  async recordTurnFinished(chatId: string) {
    this.requireChat(chatId)
    const event: TurnEvent = {
      v: STORE_VERSION,
      type: "turn_finished",
      timestamp: Date.now(),
      chatId,
    }
    await this.append(this.turnsLogPath, event)
  }

  async recordTurnFailed(chatId: string, error: string) {
    this.requireChat(chatId)
    const event: TurnEvent = {
      v: STORE_VERSION,
      type: "turn_failed",
      timestamp: Date.now(),
      chatId,
      error,
    }
    await this.append(this.turnsLogPath, event)
  }

  async recordTurnCancelled(chatId: string) {
    this.requireChat(chatId)
    const event: TurnEvent = {
      v: STORE_VERSION,
      type: "turn_cancelled",
      timestamp: Date.now(),
      chatId,
    }
    await this.append(this.turnsLogPath, event)
  }

  async appendSubagentEvent(event: SubagentRunEvent) {
    if (event.type === "subagent_entry_appended" && event.entry.kind === "tool_result") {
      const chat = this.state.chatsById.get(event.chatId)
      if (chat) {
        event = {
          ...event,
          entry: await capTranscriptEntry({
            entry: event.entry,
            chatId: event.chatId,
            runId: event.runId,
            projectId: chat.projectId,
            kannaRoot: this.dataDir,
          }),
        }
      }
    }
    await this.append(this.turnsLogPath, event)
  }

  getSubagentRuns(chatId: string): Record<string, SubagentRunSnapshot> {
    const map = this.state.subagentRunsByChatId.get(chatId)
    if (!map) return {}
    return Object.fromEntries(map.entries())
  }

  *runningSubagentRuns(): Iterable<SubagentRunSnapshot> {
    for (const map of this.state.subagentRunsByChatId.values()) {
      for (const run of map.values()) {
        if (run.status === "running") yield run
      }
    }
  }

  async setSessionTokenForProvider(
    chatId: string,
    provider: AgentProvider,
    sessionToken: string | null,
  ) {
    const chat = this.requireChat(chatId)
    if ((chat.sessionTokensByProvider[provider] ?? null) === sessionToken) return
    const event: TurnEvent = {
      v: STORE_VERSION,
      type: "session_token_set",
      timestamp: Date.now(),
      chatId,
      sessionToken,
      provider,
    }
    await this.append(this.turnsLogPath, event)
  }

  async recordSessionCommandsLoaded(chatId: string, commands: SlashCommand[]) {
    const chat = this.requireChat(chatId)
    const normalized = commands.map((c) => ({
      name: c.name,
      description: c.description,
      argumentHint: c.argumentHint,
    }))
    if (chat.slashCommands && slashCommandsEqual(chat.slashCommands, normalized)) {
      return
    }
    const event: TurnEvent = {
      v: STORE_VERSION,
      type: "session_commands_loaded",
      timestamp: Date.now(),
      chatId,
      commands: normalized,
    }
    await this.append(this.turnsLogPath, event)
  }

  async setPendingForkSessionToken(
    chatId: string,
    value: { provider: AgentProvider; token: string } | null,
  ) {
    const chat = this.requireChat(chatId)
    const current = chat.pendingForkSessionToken ?? null
    const same =
      (current == null && value == null)
      || (current != null && value != null
        && current.provider === value.provider
        && current.token === value.token)
    if (same) return
    const event: TurnEvent = {
      v: STORE_VERSION,
      type: "pending_fork_session_token_set",
      timestamp: Date.now(),
      chatId,
      pendingForkSessionToken: value?.token ?? null,
      provider: value?.provider,
    }
    await this.append(this.turnsLogPath, event)
  }

  async setSourceHash(chatId: string, sourceHash: string | null) {
    const chat = this.requireChat(chatId)
    if (chat.sourceHash === sourceHash) return
    const event: ChatEvent = {
      v: STORE_VERSION,
      type: "chat_source_hash_set",
      timestamp: Date.now(),
      chatId,
      sourceHash,
    }
    await this.append(this.chatsLogPath, event)
  }

  getProject(projectId: string) {
    const project = this.state.projectsById.get(projectId)
    if (!project || project.deletedAt) return null
    return project
  }

  requireChat(chatId: string) {
    const chat = this.state.chatsById.get(chatId)
    if (!chat || chat.deletedAt) {
      throw new Error("Chat not found")
    }
    return chat
  }

  getChat(chatId: string) {
    const chat = this.state.chatsById.get(chatId)
    if (!chat || chat.deletedAt) return null
    return chat
  }

  getSidebarProjectOrder() {
    return [...this.sidebarProjectOrder]
  }

  private getMessagesPageFromEntries(entries: TranscriptEntry[], limit: number, beforeIndex?: number): TranscriptPageResult {
    if (entries.length === 0) {
      return { entries: [], hasOlder: false, olderCursor: null }
    }

    const endIndex = beforeIndex === undefined ? entries.length : Math.max(0, Math.min(beforeIndex, entries.length))
    const startIndex = Math.max(0, endIndex - limit)
    return {
      entries: cloneTranscriptEntries(entries.slice(startIndex, endIndex)),
      hasOlder: startIndex > 0,
      olderCursor: startIndex > 0 ? encodeHistoryCursor(startIndex) : null,
    }
  }

  getMessages(chatId: string) {
    if (this.cachedTranscript?.chatId === chatId) {
      return cloneTranscriptEntries(this.cachedTranscript.entries)
    }

    const legacyEntries = this.legacyMessagesByChatId.get(chatId)
    if (legacyEntries) {
      this.cachedTranscript = { chatId, entries: cloneTranscriptEntries(legacyEntries) }
      return cloneTranscriptEntries(this.cachedTranscript.entries)
    }

    const entries = this.loadTranscriptFromDisk(chatId)
    this.cachedTranscript = { chatId, entries }
    return cloneTranscriptEntries(entries)
  }

  getQueuedMessages(chatId: string) {
    const entries = this.state.queuedMessagesByChatId.get(chatId) ?? []
    return entries.map((entry) => ({
      ...entry,
      attachments: [...entry.attachments],
    }))
  }

  getQueuedMessage(chatId: string, queuedMessageId: string) {
    return this.getQueuedMessages(chatId).find((entry) => entry.id === queuedMessageId) ?? null
  }

  getRecentMessagesPage(chatId: string, limit: number): ChatHistoryPage {
    if (limit <= 0) {
      return { messages: [], hasOlder: false, olderCursor: null }
    }

    const entries = this.getMessages(chatId)
    const page = this.getMessagesPageFromEntries(entries, limit)

    return {
      messages: page.entries,
      hasOlder: page.hasOlder,
      olderCursor: page.olderCursor,
    }
  }

  getMessagesPageBefore(chatId: string, beforeCursor: string, limit: number): ChatHistoryPage {
    if (limit <= 0) {
      return { messages: [], hasOlder: false, olderCursor: null }
    }

    const beforeIndex = decodeCursor(beforeCursor)
    const entries = this.getMessages(chatId)
    const page = this.getMessagesPageFromEntries(entries, limit, beforeIndex)

    return {
      messages: page.entries,
      hasOlder: page.hasOlder,
      olderCursor: page.olderCursor,
    }
  }

  getRecentChatHistory(chatId: string, recentLimit: number) {
    const page = this.getRecentMessagesPage(chatId, recentLimit)
    return {
      messages: page.messages,
      history: getHistorySnapshot({
        entries: page.messages,
        hasOlder: page.hasOlder,
        olderCursor: page.olderCursor,
      }, recentLimit),
    }
  }

  listProjects() {
    return [...this.state.projectsById.values()].filter((project) => !project.deletedAt)
  }

  listChatsByProject(projectId: string) {
    return [...this.state.chatsById.values()]
      .filter((chat) => chat.projectId === projectId && !chat.deletedAt && !chat.archivedAt)
      .sort((a, b) => (b.lastMessageAt ?? b.updatedAt) - (a.lastMessageAt ?? a.updatedAt))
  }

  getChatCount(projectId: string) {
    return this.listChatsByProject(projectId).length
  }

  async getLegacyTranscriptStats(): Promise<LegacyTranscriptStats> {
    const messagesLogSize = Bun.file(this.messagesLogPath).size
    const sources: LegacyTranscriptStats["sources"] = []
    if (this.snapshotHasLegacyMessages) {
      sources.push("snapshot")
    }
    if (messagesLogSize > 0) {
      sources.push("messages_log")
    }

    let entryCount = 0
    for (const entries of this.legacyMessagesByChatId.values()) {
      entryCount += entries.length
    }

    return {
      hasLegacyData: sources.length > 0 || this.legacyMessagesByChatId.size > 0,
      sources,
      chatCount: this.legacyMessagesByChatId.size,
      entryCount,
    }
  }

  async hasLegacyTranscriptData() {
    return (await this.getLegacyTranscriptStats()).hasLegacyData
  }

  private createSnapshot(): SnapshotFile {
    return {
      v: STORE_VERSION,
      generatedAt: Date.now(),
      projects: this.listProjects().map((project) => ({ ...project })),
      chats: [...this.state.chatsById.values()]
        .filter((chat) => !chat.deletedAt)
        .map((chat) => ({ ...chat })),
      queuedMessages: [...this.state.queuedMessagesByChatId.entries()]
        .map(([chatId, entries]) => ({
          chatId,
          entries: entries.map((entry) => ({
            ...entry,
            attachments: [...entry.attachments],
          })),
        })),
      autoContinueEvents: [...this.state.autoContinueEventsByChatId.entries()].map(([chatId, events]) => ({
        chatId,
        events: [...events],
      })),
      stacks: [...this.state.stacksById.values()]
        .filter((stack) => !stack.deletedAt)
        .map((stack) => ({ ...stack, projectIds: [...stack.projectIds] })),
    }
  }

  async compact() {
    const snapshot = this.createSnapshot()
    await Bun.write(this.snapshotPath, JSON.stringify(snapshot, null, 2))
    await Promise.all([
      Bun.write(this.projectsLogPath, ""),
      Bun.write(this.chatsLogPath, ""),
      Bun.write(this.messagesLogPath, ""),
      Bun.write(this.queuedMessagesLogPath, ""),
      Bun.write(this.turnsLogPath, ""),
      Bun.write(this.schedulesLogPath, ""),
      Bun.write(this.stacksLogPath, ""),
      // tunnels.jsonl is NOT compacted into the snapshot — it's left as-is
      // so that active tunnel state survives server restarts.
    ])
  }

  async migrateLegacyTranscripts(onProgress?: (message: string) => void) {
    const stats = await this.getLegacyTranscriptStats()
    if (!stats.hasLegacyData) return false

    const sourceSummary = stats.sources.map((source) => source === "messages_log" ? "messages.jsonl" : "snapshot.json").join(", ")
    onProgress?.(`${LOG_PREFIX} transcript migration detected: ${stats.chatCount} chats, ${stats.entryCount} entries from ${sourceSummary}`)

    const messageSets = [...this.legacyMessagesByChatId.entries()]
    onProgress?.(`${LOG_PREFIX} transcript migration: writing ${messageSets.length} per-chat transcript files`)

    await mkdir(this.transcriptsDir, { recursive: true })
    const logEveryChat = messageSets.length <= 10
    for (let index = 0; index < messageSets.length; index += 1) {
      const [chatId, entries] = messageSets[index]
      const transcriptPath = this.transcriptPath(chatId)
      const tempPath = `${transcriptPath}.tmp`
      const payload = entries.map((entry) => JSON.stringify(entry)).join("\n")
      await writeFile(tempPath, payload ? `${payload}\n` : "", "utf8")
      await rename(tempPath, transcriptPath)
      if (logEveryChat || (index + 1) % 25 === 0 || index === messageSets.length - 1) {
        onProgress?.(`${LOG_PREFIX} transcript migration: ${index + 1}/${messageSets.length} chats`)
      }
    }

    this.clearLegacyTranscriptState()
    await this.compact()
    this.cachedTranscript = null
    onProgress?.(`${LOG_PREFIX} transcript migration complete`)
    return true
  }

  private async shouldCompact() {
    const sizes = await Promise.all([
      Bun.file(this.projectsLogPath).size,
      Bun.file(this.chatsLogPath).size,
      Bun.file(this.messagesLogPath).size,
      Bun.file(this.queuedMessagesLogPath).size,
      Bun.file(this.turnsLogPath).size,
      Bun.file(this.schedulesLogPath).size,
      Bun.file(this.stacksLogPath).size,
    ])
    return sizes.reduce((total, size) => total + size, 0) >= COMPACTION_THRESHOLD_BYTES
  }

  async appendAutoContinueEvent(event: AutoContinueEvent) {
    return this.append(this.schedulesLogPath, event)
  }

  getAutoContinueEvents(chatId: string): AutoContinueEvent[] {
    const list = this.state.autoContinueEventsByChatId.get(chatId)
    return list ? [...list] : []
  }

  listAutoContinueChats(): string[] {
    return [...this.state.autoContinueEventsByChatId.keys()]
  }

  async appendTunnelEvent(event: CloudflareTunnelEvent): Promise<void> {
    const payload = `${JSON.stringify(event)}\n`
    this.writeChain = this.writeChain.then(async () => {
      await appendFile(this.tunnelLogPath, payload, "utf8")
      this.applyTunnelEvent(event)
    })
    await this.writeChain
  }

  getTunnelEvents(chatId: string): CloudflareTunnelEvent[] {
    const list = this.tunnelEventsByChatId.get(chatId)
    return list ? [...list] : []
  }

  listTunnelChats(): string[] {
    return [...this.tunnelEventsByChatId.keys()]
  }

  private applyTunnelEvent(event: CloudflareTunnelEvent): void {
    const existing = this.tunnelEventsByChatId.get(event.chatId) ?? []
    existing.push(event)
    this.tunnelEventsByChatId.set(event.chatId, existing)
  }

  private async loadTunnelEvents(): Promise<void> {
    const file = Bun.file(this.tunnelLogPath)
    if (!(await file.exists())) return
    const text = await file.text()
    if (!text.trim()) return

    for (const rawLine of text.split("\n")) {
      const line = rawLine.trim()
      if (!line) continue
      try {
        const event = JSON.parse(line) as CloudflareTunnelEvent
        this.applyTunnelEvent(event)
      } catch {
        console.warn(`${LOG_PREFIX} Ignoring malformed line in tunnels.jsonl`)
      }
    }
  }

  async appendPushEvent(event: PushEvent): Promise<void> {
    const payload = `${JSON.stringify(event)}\n`
    this.writeChain = this.writeChain.then(async () => {
      await appendFile(this.pushLogPath, payload, "utf8")
    })
    await this.writeChain
  }

  async loadPushEvents(): Promise<PushEvent[]> {
    const file = Bun.file(this.pushLogPath)
    if (!(await file.exists())) return []
    const text = await file.text()
    if (!text.trim()) return []

    const events: PushEvent[] = []
    for (const rawLine of text.split("\n")) {
      const line = rawLine.trim()
      if (!line) continue
      try {
        events.push(JSON.parse(line) as PushEvent)
      } catch {
        console.warn(`${LOG_PREFIX} Ignoring malformed line in push.jsonl`)
      }
    }
    return events
  }
}
