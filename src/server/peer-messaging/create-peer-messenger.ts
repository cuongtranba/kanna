import { randomUUID } from "node:crypto"
import type { KannaStatus } from "../../shared/core-types"
import type { PeerInboundMode } from "../../shared/peer-messaging/inbound"
import type { QueuedChatMessage } from "../../shared/types"
import type { ChatRecord } from "../events"
import type { SendMessageOptions } from "../claude-turn-starter-types"
import { PeerMessenger, type PeerChatInfo } from "./peer-messenger"

export interface PeerStoreView {
  readonly state: { readonly chatsById: ReadonlyMap<string, ChatRecord> }
  getChat(chatId: string): ChatRecord | null | undefined
  getProject(projectId: string): { title: string } | null | undefined
  getQueuedMessages(chatId: string): readonly QueuedChatMessage[]
}

export interface PeerAgentView {
  getActiveStatuses(): ReadonlyMap<string, KannaStatus>
  enqueueMessage(chatId: string, content: string, attachments: [], options: SendMessageOptions): Promise<unknown>
  maybeStartNextQueuedMessage(chatId: string): Promise<unknown>
}

export interface PeerMessengerSources {
  store: PeerStoreView
  agent: () => PeerAgentView
  globalInbound: () => PeerInboundMode
  now?: () => number
  newId?: () => string
}

export function createPeerMessenger(sources: PeerMessengerSources): PeerMessenger {
  const { store, agent } = sources
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
    globalInbound: sources.globalInbound,
    enqueue: async (chatId, content, origin) => {
      await agent().enqueueMessage(chatId, content, [], { origin })
    },
    startNextQueued: async (chatId) => {
      await agent().maybeStartNextQueuedMessage(chatId)
    },
    now: sources.now ?? Date.now,
    newId: sources.newId ?? randomUUID,
  })
}
