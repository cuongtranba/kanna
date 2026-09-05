import type { JsonObject } from "../shared/json"

import type { AgentProvider, QueuedChatMessage } from "../shared/types"
import type { ClientCommand } from "../shared/protocol"
import type { ClaudeSessionState, CompactionTurnKind } from "./claude-session-state"
import { isProactiveCompactTurn } from "./claude-session-state"
import type { GenerateChatTitleResult } from "./generate-title"
import { logClaudeSteer } from "./claude-steer-log"


interface ActiveTurnsMap {
  has(chatId: string): boolean
  get(chatId: string): { compactionTurn?: CompactionTurnKind } | undefined
}

interface DrainingStreamsMap {
  get(chatId: string): { turn: { close(): void } } | undefined
  has(chatId: string): boolean
  delete(chatId: string): boolean
}

interface ClaudeSessionsMap {
  get(chatId: string): ClaudeSessionState | undefined
}

interface AutoResumeMap {
  delete(chatId: string): boolean
}

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

interface AnalyticsSubset {
  track(eventName: string, properties?: JsonObject): void
}


export interface ChatManagementDeps {
  activeTurns: ActiveTurnsMap
  drainingStreams: DrainingStreamsMap
  claudeSessions: ClaudeSessionsMap
  autoResumeByChat: AutoResumeMap
  store: ChatManagementStore
  analytics: AnalyticsSubset
  cancel(chatId: string, options?: { hideInterrupted?: boolean }): Promise<void>
  closeClaudeSession(chatId: string, session: ClaudeSessionState, opts?: { keepReservation?: boolean }): void
  emitStateChange(chatId: string): void
  generateTitle(messageContent: string, cwd: string): Promise<GenerateChatTitleResult>
  reportBackgroundError: ((message: string) => void) | null
  dequeueAndStartQueuedMessage(
    chatId: string,
    queuedMessage: QueuedChatMessage,
    options?: { steered?: boolean },
  ): Promise<void>
}


export async function stopDraining(deps: ChatManagementDeps, chatId: string): Promise<void> {
  const draining = deps.drainingStreams.get(chatId)
  if (!draining) return
  draining.turn.close()
  deps.drainingStreams.delete(chatId)
  deps.emitStateChange(chatId)
}

export async function closeChat(deps: ChatManagementDeps, chatId: string): Promise<void> {
  await stopDraining(deps, chatId)
  const claudeSession = deps.claudeSessions.get(chatId)
  if (claudeSession) {
    deps.closeClaudeSession(chatId, claudeSession)
  }
  deps.autoResumeByChat.delete(chatId)
  deps.emitStateChange(chatId)
}

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
    await deps.cancel(command.chatId, { hideInterrupted: true })
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

export async function dequeue(
  deps: ChatManagementDeps,
  command: Extract<ClientCommand, { type: "message.dequeue" }>,
): Promise<void> {
  const queuedMessage = deps.store.getQueuedMessage(command.chatId, command.queuedMessageId)
  if (!queuedMessage) {
    throw new Error("Queued message not found")
  }

  const active = deps.activeTurns.get(command.chatId)
  if (isProactiveCompactTurn(active)) {
    throw new Error("Cannot remove queued message while compact is running")
  }

  await deps.store.removeQueuedMessage(command.chatId, command.queuedMessageId)
}

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
