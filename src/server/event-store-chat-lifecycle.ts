
import type { AgentProvider, SubagentRunSnapshot, TranscriptEntry } from "../shared/types"
import type {
  ChatEvent,
  ChatRecord,
  ChatTimingState,
  ProjectEvent,
  ProjectRecord,
  QueuedMessageEvent,
  StackEvent,
  StackRecord,
  StoreState,
  TurnEvent,
} from "./events"
import type { AutoContinueEvent } from "./auto-continue/events"
import { compactCronRunEvents } from "./cron/compact"
import { compactLoopWakeEvents } from "./auto-continue/compact-loop-wakes"
import { ACTIVE_SESSION_IDLE_GAP_MS } from "./read-models"
import { resolveLocalPath } from "./paths"


type ProjectLifecycleState = Pick<StoreState, "projectsById" | "projectIdsByPath" | "sidebarProjectOrder">

export function applyProjectEvent(state: ProjectLifecycleState, event: ProjectEvent): void {
  switch (event.type) {
    case "project_opened": {
      const localPath = resolveLocalPath(event.localPath)
      const project: ProjectRecord = {
        id: event.projectId,
        localPath,
        title: event.title,
        createdAt: event.timestamp,
        updatedAt: event.timestamp,
      }
      state.projectsById.set(project.id, project)
      state.projectIdsByPath.set(localPath, project.id)
      break
    }
    case "project_removed": {
      const project = state.projectsById.get(event.projectId)
      if (!project) break
      project.deletedAt = event.timestamp
      project.updatedAt = event.timestamp
      state.projectIdsByPath.delete(project.localPath)
      break
    }
    case "sidebar_project_order_set": {
      state.sidebarProjectOrder = [...event.projectIds]
      break
    }
    case "project_star_set": {
      const project = state.projectsById.get(event.projectId)
      if (!project) break
      if (event.starredAt == null) {
        delete project.starredAt
      } else {
        project.starredAt = event.starredAt
      }
      project.updatedAt = event.timestamp
      break
    }
    case "project_instructions_set": {
      const project = state.projectsById.get(event.projectId)
      if (!project) break
      if (event.instructions === "") {
        delete project.instructions
      } else {
        project.instructions = event.instructions
      }
      project.updatedAt = event.timestamp
      break
    }
  }
}


export function applyStackEvent(stacksById: Map<string, StackRecord>, event: StackEvent): void {
  switch (event.type) {
    case "stack_added": {
      const record: StackRecord = {
        id: event.stackId,
        title: event.title,
        projectIds: [...event.projectIds],
        createdAt: event.timestamp,
        updatedAt: event.timestamp,
      }
      stacksById.set(record.id, record)
      break
    }
    case "stack_removed": {
      const stack = stacksById.get(event.stackId)
      if (!stack || stack.deletedAt) break
      stack.deletedAt = event.timestamp
      stack.updatedAt = event.timestamp
      break
    }
    case "stack_renamed": {
      const stack = stacksById.get(event.stackId)
      if (!stack || stack.deletedAt) break
      stack.title = event.title
      stack.updatedAt = event.timestamp
      break
    }
    case "stack_project_added": {
      const stack = stacksById.get(event.stackId)
      if (!stack || stack.deletedAt) break
      if (stack.projectIds.includes(event.projectId)) break
      stack.projectIds = [...stack.projectIds, event.projectId]
      stack.updatedAt = event.timestamp
      break
    }
    case "stack_project_removed": {
      const stack = stacksById.get(event.stackId)
      if (!stack || stack.deletedAt) break
      stack.projectIds = stack.projectIds.filter((id) => id !== event.projectId)
      stack.updatedAt = event.timestamp
      break
    }
    case "stack_instructions_set": {
      const stack = stacksById.get(event.stackId)
      if (!stack || stack.deletedAt) break
      if (event.instructions === "") {
        delete stack.instructions
      } else {
        stack.instructions = event.instructions
      }
      stack.updatedAt = event.timestamp
      break
    }
  }
}


export function updateChatTiming(
  chatTimingsByChatId: Map<string, ChatTimingState>,
  chatId: string,
  eventTs: number,
  nextStatus: ChatTimingState["status"],
  onTurnStart?: boolean,
  onTurnFinish?: boolean,
): void {
  const prev = chatTimingsByChatId.get(chatId)
  if (!prev) {
    chatTimingsByChatId.set(chatId, {
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

  chatTimingsByChatId.set(chatId, {
    status: nextStatus,
    stateEnteredAt: eventTs,
    activeSessionStartedAt,
    lastTurnStartedAt,
    lastTurnDurationMs,
    cumulativeMs,
  })
}


type ChatLifecycleState = Pick<
  StoreState,
  "chatsById" | "queuedMessagesByChatId" | "autoContinueEventsByChatId" | "chatTimingsByChatId" | "subagentRunsByChatId"
>

export function applyChatLifecycleEvent(
  state: ChatLifecycleState,
  replayChatProvider: Map<string, AgentProvider | null>,
  event: ChatEvent | TurnEvent | QueuedMessageEvent,
): void {
  switch (event.type) {
    case "chat_created": {
      const chat: ChatRecord = {
        id: event.chatId,
        projectId: event.projectId,
        title: event.title,
        createdAt: event.timestamp,
        updatedAt: event.timestamp,
        unread: false,
        provider: null,
        planMode: false,
        sessionTokensByProvider: {},
        sourceHash: null,
        pendingForkSessionToken: null,
        hasMessages: false,
        lastTurnOutcome: null,
      }
      if (event.stackId !== undefined) chat.stackId = event.stackId
      if (event.stackBindings !== undefined) chat.stackBindings = event.stackBindings.map((b) => ({ ...b }))
      state.chatsById.set(chat.id, chat)
      replayChatProvider.set(event.chatId, null)
      state.subagentRunsByChatId.set(event.chatId, new Map<string, SubagentRunSnapshot>())
      updateChatTiming(state.chatTimingsByChatId, event.chatId, event.timestamp, "idle")
      break
    }
    case "chat_renamed": {
      const chat = state.chatsById.get(event.chatId)
      if (!chat) break
      chat.title = event.title
      chat.updatedAt = event.timestamp
      break
    }
    case "chat_deleted": {
      const chat = state.chatsById.get(event.chatId)
      if (!chat) break
      chat.deletedAt = event.timestamp
      chat.updatedAt = event.timestamp
      state.queuedMessagesByChatId.delete(event.chatId)
      state.autoContinueEventsByChatId.delete(event.chatId)
      state.chatTimingsByChatId.delete(event.chatId)
      state.subagentRunsByChatId.delete(event.chatId)
      break
    }
    case "chat_archived": {
      const chat = state.chatsById.get(event.chatId)
      if (!chat) break
      chat.archivedAt = event.timestamp
      chat.updatedAt = event.timestamp
      break
    }
    case "chat_unarchived": {
      const chat = state.chatsById.get(event.chatId)
      if (!chat) break
      delete chat.archivedAt
      chat.updatedAt = event.timestamp
      break
    }
    case "chat_provider_set": {
      const chat = state.chatsById.get(event.chatId)
      if (!chat) break
      chat.provider = event.provider
      chat.updatedAt = event.timestamp
      replayChatProvider.set(event.chatId, event.provider)
      break
    }
    case "chat_plan_mode_set": {
      const chat = state.chatsById.get(event.chatId)
      if (!chat) break
      chat.planMode = event.planMode
      chat.updatedAt = event.timestamp
      break
    }
    case "chat_read_state_set": {
      const chat = state.chatsById.get(event.chatId)
      if (!chat) break
      chat.unread = event.unread
      chat.updatedAt = event.timestamp
      break
    }
    case "chat_source_hash_set": {
      const chat = state.chatsById.get(event.chatId)
      if (!chat) break
      chat.sourceHash = event.sourceHash
      chat.updatedAt = event.timestamp
      break
    }
    case "chat_policy_override_set": {
      const chat = state.chatsById.get(event.chatId)
      if (!chat) break
      chat.policyOverride = event.policyOverride
      chat.updatedAt = event.timestamp
      break
    }
    case "chat_compact_failures_set": {
      const chat = state.chatsById.get(event.chatId)
      if (!chat) break
      chat.compactFailureCount = event.compactFailureCount
      chat.updatedAt = event.timestamp
      break
    }
    case "queued_message_enqueued": {
      const existing = state.queuedMessagesByChatId.get(event.chatId) ?? []
      existing.push({
        ...event.message,
        attachments: [...event.message.attachments],
      })
      state.queuedMessagesByChatId.set(event.chatId, existing)
      const chat = state.chatsById.get(event.chatId)
      if (chat) {
        chat.updatedAt = event.timestamp
      }
      break
    }
    case "queued_message_removed": {
      const existing = state.queuedMessagesByChatId.get(event.chatId) ?? []
      const next = existing.filter((entry) => entry.id !== event.queuedMessageId)
      if (next.length > 0) {
        state.queuedMessagesByChatId.set(event.chatId, next)
      } else {
        state.queuedMessagesByChatId.delete(event.chatId)
      }
      const chat = state.chatsById.get(event.chatId)
      if (chat) {
        chat.updatedAt = event.timestamp
      }
      break
    }
    case "turn_started": {
      const chat = state.chatsById.get(event.chatId)
      if (!chat) break
      chat.updatedAt = event.timestamp
      updateChatTiming(state.chatTimingsByChatId, event.chatId, event.timestamp, "running", true, false)
      break
    }
    case "turn_finished": {
      const chat = state.chatsById.get(event.chatId)
      if (!chat) break
      chat.updatedAt = event.timestamp
      chat.unread = true
      chat.lastTurnOutcome = "success"
      updateChatTiming(state.chatTimingsByChatId, event.chatId, event.timestamp, "idle", false, true)
      break
    }
    case "turn_failed": {
      const chat = state.chatsById.get(event.chatId)
      if (!chat) break
      chat.updatedAt = event.timestamp
      chat.unread = true
      chat.lastTurnOutcome = "failed"
      updateChatTiming(state.chatTimingsByChatId, event.chatId, event.timestamp, "failed", false, true)
      break
    }
    case "turn_cancelled": {
      const chat = state.chatsById.get(event.chatId)
      if (!chat) break
      chat.updatedAt = event.timestamp
      chat.lastTurnOutcome = "cancelled"
      updateChatTiming(state.chatTimingsByChatId, event.chatId, event.timestamp, "idle", false, true)
      break
    }
    case "session_token_set": {
      const chat = state.chatsById.get(event.chatId)
      if (!chat) break
      const provider = event.provider ?? replayChatProvider.get(event.chatId) ?? chat.provider
      if (!provider) break
      chat.sessionTokensByProvider = {
        ...chat.sessionTokensByProvider,
        [provider]: event.sessionToken,
      }
      chat.updatedAt = event.timestamp
      break
    }
    case "pending_fork_session_token_set": {
      const chat = state.chatsById.get(event.chatId)
      if (!chat) break
      if (event.pendingForkSessionToken == null) {
        chat.pendingForkSessionToken = null
      } else {
        const provider = event.provider ?? replayChatProvider.get(event.chatId) ?? chat.provider
        if (!provider) break
        chat.pendingForkSessionToken = { provider, token: event.pendingForkSessionToken }
      }
      chat.updatedAt = event.timestamp
      break
    }
  }
}


export function applyAutoContinueToState(
  autoContinueEventsByChatId: Map<string, AutoContinueEvent[]>,
  event: AutoContinueEvent,
): void {
  const existing = autoContinueEventsByChatId.get(event.chatId) ?? []
  existing.push(event)
  autoContinueEventsByChatId.set(
    event.chatId,
    compactLoopWakeEvents(compactCronRunEvents(existing)),
  )
}


export function applyChatMessageMetadata(
  chatsById: Map<string, ChatRecord>,
  chatId: string,
  entry: TranscriptEntry,
): void {
  const chat = chatsById.get(chatId)
  if (!chat) return
  chat.hasMessages = true
  if (entry.kind === "user_prompt") {
    chat.lastMessageAt = entry.createdAt
  }
  chat.updatedAt = Math.max(chat.updatedAt, entry.createdAt)
}
