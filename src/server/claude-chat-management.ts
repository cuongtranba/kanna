/**
 * Standalone chat management functions for AgentCoordinator.
 *
 * Extracted from agent.ts so the chat lifecycle and steering logic lives in
 * its own testable module. The coordinator delegates to these functions by
 * passing an object literal that satisfies `ChatManagementDeps`.
 *
 * Side-effect seal: this module contains NO direct IO (no node:fs, no HTTP
 * calls, no Bun primitives). Every effectful operation is injected through
 * the deps interface.
 */

import type { AgentProvider, QueuedChatMessage } from "../shared/types"
import type { ClientCommand } from "../shared/protocol"
import type { ClaudeSessionState } from "./claude-session-state"
import type { GenerateChatTitleResult } from "./generate-title"
import { logClaudeSteer } from "./claude-steer-log"

// ---------------------------------------------------------------------------
// Structural sub-interfaces — only the slices each function calls.
// ---------------------------------------------------------------------------

/** Subset of the activeTurns map used by chat management. */
interface ActiveTurnsMap {
  has(chatId: string): boolean
  get(chatId: string): { proactiveCompactInjection?: boolean } | undefined
}

/** Subset of the drainingStreams map used by chat management. */
interface DrainingStreamsMap {
  get(chatId: string): { turn: { close(): void } } | undefined
  has(chatId: string): boolean
  delete(chatId: string): boolean
}

/** Subset of the claudeSessions map used by chat management. */
interface ClaudeSessionsMap {
  get(chatId: string): ClaudeSessionState | undefined
}

/** Subset of the autoResumeByChat map used by chat management. */
interface AutoResumeMap {
  delete(chatId: string): boolean
}

/** Subset of EventStore used by the chat management functions. */
interface ChatManagementStore {
  getQueuedMessage(chatId: string, queuedMessageId: string): QueuedChatMessage | null
  removeQueuedMessage(chatId: string, queuedMessageId: string): Promise<void>
  requireChat(chatId: string): {
    title: string
    provider: AgentProvider | null
    sessionTokensByProvider: Partial<Record<AgentProvider, string | null>>
    pendingForkSessionToken?: { provider: AgentProvider; token: string } | null
  }
  forkChat(chatId: string): Promise<{ id: string }>
  renameChat(chatId: string, title: string): Promise<void>
}

/** Minimal analytics interface used by chat management. */
interface AnalyticsSubset {
  track(eventName: string, properties?: Record<string, unknown>): void
}

// ---------------------------------------------------------------------------
// Dependency bundle injected by AgentCoordinator
// ---------------------------------------------------------------------------

export interface ChatManagementDeps {
  /** Active turn map — read-only for management functions. */
  activeTurns: ActiveTurnsMap
  /** Draining streams map — management functions read and mutate it. */
  drainingStreams: DrainingStreamsMap
  /** Active Claude session map — used by closeChat to find the session. */
  claudeSessions: ClaudeSessionsMap
  /** Per-chat auto-resume flags — cleared on closeChat. */
  autoResumeByChat: AutoResumeMap
  /** Subset of EventStore needed by management functions. */
  store: ChatManagementStore
  /** Analytics reporter for tracking events. */
  analytics: AnalyticsSubset
  /** Cancel the active turn for a chat. */
  cancel(chatId: string, options?: { hideInterrupted?: boolean; skipQueueDrain?: boolean }): Promise<void>
  /** Close the Claude session for a chat, freeing its process slot. */
  closeClaudeSession(chatId: string, session: ClaudeSessionState, opts?: { keepReservation?: boolean }): void
  /** Notify listeners that the observable state for chatId has changed. */
  emitStateChange(chatId: string): void
  /** Generate a title for a chat message (AI-assisted). */
  generateTitle(messageContent: string, cwd: string): Promise<GenerateChatTitleResult>
  /** Report a non-fatal background error (e.g. title generation failure). Nullable for optional injection. */
  reportBackgroundError: ((message: string) => void) | null
  /** Dequeue a queued message and start processing it. */
  dequeueAndStartQueuedMessage(
    chatId: string,
    queuedMessage: QueuedChatMessage,
    options?: { steered?: boolean },
  ): Promise<void>
}

// ---------------------------------------------------------------------------
// Extracted functions
// ---------------------------------------------------------------------------

/**
 * Stop a draining stream for `chatId` if one is active.
 * Closes the stream's turn, removes the entry, and notifies state listeners.
 */
export async function stopDraining(deps: ChatManagementDeps, chatId: string): Promise<void> {
  const draining = deps.drainingStreams.get(chatId)
  if (!draining) return
  draining.turn.close()
  deps.drainingStreams.delete(chatId)
  deps.emitStateChange(chatId)
}

/**
 * Fully close a chat: stop any draining stream, close the Claude session,
 * clear the auto-resume flag, and notify state listeners.
 */
export async function closeChat(deps: ChatManagementDeps, chatId: string): Promise<void> {
  await stopDraining(deps, chatId)
  const claudeSession = deps.claudeSessions.get(chatId)
  if (claudeSession) {
    deps.closeClaudeSession(chatId, claudeSession)
  }
  deps.autoResumeByChat.delete(chatId)
  deps.emitStateChange(chatId)
}

/**
 * Steer a chat to a previously queued message: cancel the current active turn
 * (if any) and immediately start the queued message.
 */
export async function steer(
  deps: ChatManagementDeps,
  command: Extract<ClientCommand, { type: "message.steer" }>,
): Promise<void> {
  const queuedMessage = deps.store.getQueuedMessage(command.chatId, command.queuedMessageId)
  if (!queuedMessage) {
    throw new Error("Queued message not found")
  }

  logClaudeSteer("steer_requested", {
    chatId: command.chatId,
    queuedMessageId: command.queuedMessageId,
    activeTurn: deps.activeTurns.has(command.chatId),
    queuedMessagePreview: queuedMessage.content.slice(0, 160),
  })

  if (deps.activeTurns.has(command.chatId)) {
    await deps.cancel(command.chatId, { hideInterrupted: true, skipQueueDrain: true })
  }

  logClaudeSteer("steer_after_cancel", {
    chatId: command.chatId,
    stillActive: deps.activeTurns.has(command.chatId),
  })

  if (deps.activeTurns.has(command.chatId)) {
    throw new Error("Chat is still running")
  }

  await deps.dequeueAndStartQueuedMessage(command.chatId, queuedMessage, { steered: true })
}

/**
 * Remove a queued message, refusing if a proactive compact turn is in flight
 * (dropping the message mid-compact would silently lose user intent).
 */
export async function dequeue(
  deps: ChatManagementDeps,
  command: Extract<ClientCommand, { type: "message.dequeue" }>,
): Promise<void> {
  const queuedMessage = deps.store.getQueuedMessage(command.chatId, command.queuedMessageId)
  if (!queuedMessage) {
    throw new Error("Queued message not found")
  }

  // Refuse to drop the queued message while a Kanna-injected `/compact`
  // turn is running. The compact was triggered specifically to make room
  // for this queued message; auto-draining it after compact completes
  // would silently lose user intent and waste the compact spend.
  const active = deps.activeTurns.get(command.chatId)
  if (active?.proactiveCompactInjection) {
    throw new Error("Cannot remove queued message while compact is running")
  }

  await deps.store.removeQueuedMessage(command.chatId, command.queuedMessageId)
}

/**
 * Fork `chatId` into a new child chat, inheriting the parent's session token.
 * Throws if the chat is active, has no provider, or has no session to fork.
 */
export async function forkChat(deps: ChatManagementDeps, chatId: string): Promise<{ chatId: string }> {
  const chat = deps.store.requireChat(chatId)
  if (deps.activeTurns.has(chatId) || deps.drainingStreams.has(chatId)) {
    throw new Error("Chat must be idle before forking")
  }
  if (!chat.provider) {
    throw new Error("Chat must have a provider before forking")
  }
  const currentProviderToken = chat.provider
    ? (chat.sessionTokensByProvider[chat.provider] ?? null)
    : null
  const pendingForkForProvider =
    chat.pendingForkSessionToken?.provider === chat.provider
      ? chat.pendingForkSessionToken.token
      : null
  if (!currentProviderToken && !pendingForkForProvider) {
    throw new Error("Chat has no session to fork")
  }

  const forked = await deps.store.forkChat(chatId)
  deps.analytics.track("chat_created")
  return { chatId: forked.id }
}

/**
 * Generate a title for a chat message in the background, persisting it only
 * if the chat's current title still matches `expectedCurrentTitle`.
 * Errors are reported via `deps.reportBackgroundError` rather than thrown.
 */
export async function generateTitleInBackground(
  deps: ChatManagementDeps,
  chatId: string,
  messageContent: string,
  cwd: string,
  expectedCurrentTitle: string,
): Promise<void> {
  try {
    const result = await deps.generateTitle(messageContent, cwd)
    if (result.failureMessage) {
      deps.reportBackgroundError?.(
        `[title-generation] chat ${chatId} failed provider title generation: ${result.failureMessage}`,
      )
    }
    if (!result.title || result.usedFallback) return

    const chat = deps.store.requireChat(chatId)
    if (chat.title !== expectedCurrentTitle) return

    await deps.store.renameChat(chatId, result.title)
    deps.emitStateChange(chatId)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    deps.reportBackgroundError?.(
      `[title-generation] chat ${chatId} failed background title generation: ${message}`,
    )
  }
}
