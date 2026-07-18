/**
 * Pure read-model functions for project, stack, chat-lifecycle, turn, queued-
 * message, and auto-continue event application.
 *
 * Extracted from event-store.ts to reduce file size. All functions are pure
 * state mutations — no IO, no side effects (side-effect seal: IO lives in
 * *.adapter.ts files).
 */

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
import { ACTIVE_SESSION_IDLE_GAP_MS } from "./read-models"
import { resolveLocalPath } from "./paths"

// ─── Project read-model ────────────────────────────────────────────────────

type ProjectLifecycleState = Pick<StoreState, "projectsById" | "projectIdsByPath" | "sidebarProjectOrder">

/**
 * Apply a single ProjectEvent to the in-memory project maps. Mutates the
 * maps in-place; reassigns `state.sidebarProjectOrder` for the
 * `sidebar_project_order_set` case.
 */
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
  }
}

// ─── Stack read-model ──────────────────────────────────────────────────────

/**
 * Apply a single StackEvent to the in-memory stacks map. Mutates in-place.
 */
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
  }
}

// ─── Chat timing ───────────────────────────────────────────────────────────

/**
 * Update the ChatTimingState for a given chat in response to a status
 * transition. Seeds the entry on first call (chat_created path).
 *
 * @param chatTimingsByChatId - mutable timing map from StoreState
 * @param chatId              - target chat
 * @param eventTs             - event timestamp (ms epoch)
 * @param nextStatus          - status to transition into
 * @param onTurnStart         - true when this event marks turn start
 * @param onTurnFinish        - true when this event marks turn end
 */
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
    // chat_created path: seed initial timing entry
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

  // Detect long idle gap when leaving idle → something else
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

// ─── Chat / Turn / QueuedMessage lifecycle ─────────────────────────────────

type ChatLifecycleState = Pick<
  StoreState,
  "chatsById" | "queuedMessagesByChatId" | "autoContinueEventsByChatId" | "chatTimingsByChatId" | "subagentRunsByChatId"
>

/**
 * Apply a single ChatEvent, TurnEvent, or QueuedMessageEvent to the in-memory
 * chat state. Mutates maps in-place.
 *
 * NOTE: `MessageEvent` (`message_appended`) is intentionally excluded because
 * it also mutates `legacyMessagesByChatId` — a class field not in StoreState.
 * That case remains inline in EventStore.applyEvent().
 *
 * @param state               - chat-related maps from StoreState
 * @param replayChatProvider  - class-level provider-replay map (not in StoreState)
 * @param event               - the event to apply
 */
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
    case "session_commands_loaded": {
      const chat = state.chatsById.get(event.chatId)
      if (!chat) break
      chat.slashCommands = event.commands.map((c) => ({ ...c }))
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

// ─── Auto-continue read-model ──────────────────────────────────────────────

/**
 * Push an AutoContinueEvent onto the per-chat event list. Pure map mutation.
 */
export function applyAutoContinueToState(
  autoContinueEventsByChatId: Map<string, AutoContinueEvent[]>,
  event: AutoContinueEvent,
): void {
  const existing = autoContinueEventsByChatId.get(event.chatId) ?? []
  existing.push(event)
  autoContinueEventsByChatId.set(event.chatId, existing)
}

// ─── Transcript message metadata ───────────────────────────────────────────

/**
 * Update chat metadata fields derived from a newly appended transcript entry.
 * Called for `message_appended` events (which also mutate legacyMessagesByChatId
 * and therefore stay partially inline in EventStore).
 */
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
