import { randomUUID } from "node:crypto"
import type { KannaStatus } from "../../shared/core-types"
import type { PeerInboundMode } from "../../shared/peer-messaging/inbound"
import type { QueuedChatMessage } from "../../shared/types"
import type { ChatRecord } from "../events"
import type { SendMessageOptions } from "../claude-turn-starter-types"
import { CodexAppServerManager } from "../codex-app-server"
import type { SubagentOrchestrator } from "../subagent-orchestrator"
import type { MidTurnDelivery } from "./mid-turn-delivery"
import { PeerMessenger, type PeerChatInfo } from "./peer-messenger"
import { createCodexKannaTools } from "./peer-tools"

export interface PeerStoreView {
  readonly state: { readonly chatsById: ReadonlyMap<string, ChatRecord> }
  getChat(chatId: string): ChatRecord | null | undefined
  getProject(projectId: string): { title: string } | null | undefined
  getQueuedMessages(chatId: string): readonly QueuedChatMessage[]
}

export interface PeerAgentView {
  getActiveStatuses(): ReadonlyMap<string, KannaStatus>
  enqueueMessage(chatId: string, content: string, attachments: [], options: SendMessageOptions): Promise<QueuedChatMessage>
  maybeStartNextQueuedMessage(chatId: string): Promise<boolean>
  readonly midTurnDelivery: Pick<MidTurnDelivery, "injectQueuedMessage">
  getSubagentOrchestrator(): Pick<SubagentOrchestrator, "deliverToRun">
}

export interface PeerMessagingServices {
  peerMessenger: PeerMessenger
  codexManager: CodexAppServerManager
}

export function createPeerMessaging(
  store: PeerStoreView,
  agent: () => PeerAgentView,
  globalInbound: () => PeerInboundMode,
): PeerMessagingServices {
  const peerMessenger = createPeerMessenger(store, agent, globalInbound)
  return { peerMessenger, codexManager: new CodexAppServerManager({ kannaTools: createCodexKannaTools(peerMessenger) }) }
}

function createPeerMessenger(
  store: PeerStoreView,
  agent: () => PeerAgentView,
  globalInbound: () => PeerInboundMode,
): PeerMessenger {
  const infoOf = (chat: ChatRecord): PeerChatInfo => ({
    chatId: chat.id,
    title: chat.title,
    projectId: chat.projectId,
    projectTitle: store.getProject(chat.projectId)?.title ?? "",
    provider: chat.provider,
    peerInbound: chat.peerInbound ?? null,
    archived: chat.archivedAt !== undefined,
  })
  return new PeerMessenger({
    listChats: () => [...store.state.chatsById.values()].filter((chat) => chat.deletedAt === undefined).map(infoOf),
    getChat: (chatId) => {
      const chat = store.getChat(chatId)
      return chat ? infoOf(chat) : null
    },
    activeStatuses: () => agent().getActiveStatuses(),
    queuedMessages: (chatId) => store.getQueuedMessages(chatId),
    globalInbound,
    enqueue: async (chatId, content, origin) => (await agent().enqueueMessage(chatId, content, [], { origin })).id,
    startNextQueued: async (chatId) => {
      await agent().maybeStartNextQueuedMessage(chatId)
    },
    injectMidTurn: (chatId, queuedMessageId) => agent().midTurnDelivery.injectQueuedMessage(chatId, queuedMessageId),
    deliverToRun: (chatId, runId, content, origin) =>
      Promise.resolve(agent().getSubagentOrchestrator().deliverToRun(chatId, runId, content, origin)),
    after: (delayMs, run) => {
      const timer = setTimeout(run, delayMs)
      return () => clearTimeout(timer)
    },
    now: Date.now,
    newId: randomUUID,
  })
}
