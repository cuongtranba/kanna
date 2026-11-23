import { isPeerChatOrigin, type PeerChatOrigin } from "../../shared/command-origin"
import { PEER_MID_TURN_LIMIT } from "../../shared/peer-messaging/limits"
import { renderPeerPrompt } from "../../shared/peer-messaging/render-prompt"
import { timestamped } from "../../shared/transcript-entry"
import type { AgentProvider, QueuedChatMessage, TranscriptEntry } from "../../shared/types"
import type { ActiveTurn, ClaudeSessionState } from "../claude-session-state"
import type { TurnRunConfig } from "../events"
import { isClaudeSdkProvider } from "../provider-catalog"
import { log } from "../../shared/log"

const UNDELIVERED_INJECTION_GRACE_MS = 15_000

export interface MidTurnDeliveryStore {
  getChat(chatId: string): { provider: AgentProvider | null } | null | undefined
  getQueuedMessages(chatId: string): readonly QueuedChatMessage[]
  removeQueuedMessage(chatId: string, queuedMessageId: string): Promise<void>
  appendMessage(chatId: string, entry: TranscriptEntry): Promise<void>
  recordTurnStarted(chatId: string, runConfig: TurnRunConfig): Promise<void>
}

export interface MidTurnDeliveryPorts {
  store: MidTurnDeliveryStore
  activeTurns: Map<string, ActiveTurn>
  claudeSessions: Map<string, ClaudeSessionState>
  steerCodexTurn(chatId: string, text: string, clientUserMessageId: string): Promise<boolean>
  startNextQueued(chatId: string): Promise<void>
  after(delayMs: number, run: () => void): void
  emitStateChange(chatId: string): void
}

export interface MidTurnDelivery {
  injectQueuedMessage(chatId: string, queuedMessageId: string): Promise<boolean>
  onPromptDelivered(session: ClaudeSessionState, promptId: string): Promise<void>
  onTurnResult(session: ClaudeSessionState): void
}

type PeerQueuedMessage = QueuedChatMessage & { origin: PeerChatOrigin }

function canTakeInjection(active: ActiveTurn | undefined): active is ActiveTurn {
  return active !== undefined
    && !active.cancelRequested
    && active.status !== "waiting_for_user"
    && active.compactionTurn === undefined
    && (active.midTurnInjections ?? 0) < PEER_MID_TURN_LIMIT
}

function userPromptOf(queued: PeerQueuedMessage) {
  return timestamped({ kind: "user_prompt", content: queued.content, attachments: [], origin: queued.origin })
}

function adoptedTurn(
  session: ClaudeSessionState,
  provider: AgentProvider,
  userMessageId: string,
): ActiveTurn {
  return {
    chatId: session.chatId,
    provider,
    turn: {
      provider: "claude",
      stream: { async *[Symbol.asyncIterator]() {} },
      getAccountInfo: session.session.getAccountInfo,
      interrupt: session.session.interrupt,
      close: () => {},
    },
    startedAt: Date.now(),
    sessionId: session.id,
    claudePromptSeq: session.beginPrompt(),
    model: session.model,
    effort: session.effort,
    planMode: session.planMode,
    status: "running",
    postToolFollowUp: null,
    hasFinalResult: false,
    cancelRequested: false,
    cancelRecorded: false,
    waitStartedAt: null,
    userMessageId,
  }
}

export function createMidTurnDelivery(ports: MidTurnDeliveryPorts): MidTurnDelivery {
  const { store } = ports

  const peerMessageOf = (chatId: string, queuedMessageId: string): PeerQueuedMessage | null => {
    const queued = store.getQueuedMessages(chatId).find((message) => message.id === queuedMessageId)
    if (!queued || !isPeerChatOrigin(queued.origin)) return null
    return { ...queued, origin: queued.origin }
  }

  const steerCodex = async (active: ActiveTurn, queued: PeerQueuedMessage): Promise<boolean> => {
    const delivered = await ports.steerCodexTurn(
      active.chatId,
      renderPeerPrompt(queued.content, queued.origin),
      queued.id,
    )
    if (!delivered) return false
    active.midTurnInjections = (active.midTurnInjections ?? 0) + 1
    await store.appendMessage(active.chatId, userPromptOf(queued))
    await store.removeQueuedMessage(active.chatId, queued.id)
    ports.emitStateChange(active.chatId)
    return true
  }

  const injectIntoClaude = (active: ActiveTurn, queued: PeerQueuedMessage): boolean => {
    const session = ports.claudeSessions.get(active.chatId)
    if (!session || session.id !== active.sessionId || !session.session.injectPrompt) return false
    if (session.injectedPromptIds.has(queued.id)) return true
    session.injectedPromptIds.add(queued.id)
    if (!session.session.injectPrompt(queued.id, renderPeerPrompt(queued.content, queued.origin))) {
      session.injectedPromptIds.delete(queued.id)
      return false
    }
    active.midTurnInjections = (active.midTurnInjections ?? 0) + 1
    return true
  }

  const adoptCliStartedTurn = async (session: ClaudeSessionState, queued: PeerQueuedMessage): Promise<void> => {
    const entry = userPromptOf(queued)
    const provider = store.getChat(session.chatId)?.provider ?? "claude"
    ports.activeTurns.set(session.chatId, adoptedTurn(session, provider, entry._id))
    session.injectedPromptIds.delete(queued.id)
    await store.appendMessage(session.chatId, entry)
    await store.recordTurnStarted(session.chatId, {
      provider,
      model: session.model,
      ...(session.effort !== undefined ? { effort: session.effort } : {}),
      planMode: session.planMode,
    })
    await store.removeQueuedMessage(session.chatId, queued.id)
  }

  const releaseUndelivered = async (session: ClaudeSessionState, ids: readonly string[]): Promise<void> => {
    if (ports.claudeSessions.get(session.chatId) !== session || ports.activeTurns.has(session.chatId)) return
    const stale = ids.filter((id) => session.injectedPromptIds.delete(id))
    if (stale.length === 0) return
    log.warn("[kanna/peer] injected messages were never delivered; returning them to the queue", { chatId: session.chatId, count: stale.length })
    ports.emitStateChange(session.chatId)
    await ports.startNextQueued(session.chatId)
  }

  return {
    async injectQueuedMessage(chatId, queuedMessageId) {
      const queued = peerMessageOf(chatId, queuedMessageId)
      const active = ports.activeTurns.get(chatId)
      if (!queued || !canTakeInjection(active)) return false
      if (isClaudeSdkProvider(active.provider)) return injectIntoClaude(active, queued)
      if (active.provider === "codex") return steerCodex(active, queued)
      return false
    },

    async onPromptDelivered(session, promptId) {
      if (ports.claudeSessions.get(session.chatId) !== session) return
      if (!session.injectedPromptIds.has(promptId)) return
      const queued = peerMessageOf(session.chatId, promptId)
      if (queued && !ports.activeTurns.has(session.chatId)) {
        await adoptCliStartedTurn(session, queued)
      } else {
        session.injectedPromptIds.delete(promptId)
        if (queued) {
          await store.appendMessage(session.chatId, userPromptOf(queued))
          await store.removeQueuedMessage(session.chatId, promptId)
        }
      }
      ports.emitStateChange(session.chatId)
    },

    onTurnResult(session) {
      if (session.injectedPromptIds.size === 0) return
      const ids = [...session.injectedPromptIds]
      ports.after(UNDELIVERED_INJECTION_GRACE_MS, () => {
        void releaseUndelivered(session, ids).catch((error: Error) => {
          log.warn("[kanna/peer] releasing undelivered injections failed", error.message)
        })
      })
    },
  }
}
