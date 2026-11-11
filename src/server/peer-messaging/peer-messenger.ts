import { createHash } from "node:crypto"
import type { PeerChatOrigin } from "../../shared/command-origin"
import type { AgentProvider, KannaStatus } from "../../shared/core-types"
import {
  PEER_DUPLICATE_WINDOW_MS,
  PEER_MESSAGE_MAX_CHARS,
  PEER_NOTIFY_TTL_MS,
  PEER_QUEUE_LIMIT,
  PEER_RATE_PER_HOUR,
  PEER_RATE_PER_MINUTE,
} from "../../shared/peer-messaging/limits"
import { resolvePeerInbound, type PeerInboundMode } from "../../shared/peer-messaging/inbound"
import type { QueuedChatMessage } from "../../shared/types"
import { log } from "../../shared/log"
import { RateLimiter } from "../rate-limiter"

export type PeerChatStatus = "idle" | "working" | "waiting_for_user"

export interface PeerChatInfo {
  chatId: string
  title: string
  projectId: string
  projectTitle: string
  provider: AgentProvider | null
  peerInbound: PeerInboundMode | null
  archived: boolean
}

export interface PeerChatRow {
  chatId: string
  title: string
  projectTitle: string
  provider: AgentProvider | null
  status: PeerChatStatus
  accepts: boolean
}

export interface PeerMessengerPorts {
  listChats(): readonly PeerChatInfo[]
  getChat(chatId: string): PeerChatInfo | null
  activeStatuses(): ReadonlyMap<string, KannaStatus>
  queuedMessages(chatId: string): readonly QueuedChatMessage[]
  globalInbound(): PeerInboundMode
  enqueue(chatId: string, content: string, origin: PeerChatOrigin): Promise<void>
  startNextQueued(chatId: string): Promise<void>
  now(): number
  newId(): string
}

export type PeerRefusal =
  | "empty"
  | "unknown_chat"
  | "self"
  | "archived"
  | "inbound_refused"
  | "too_large"
  | "duplicate"
  | "rate_limited"
  | "queue_full"

export type PeerSendResult =
  | { ok: true; status: "delivered" | "queued" | "subscribed"; messageId: string | null; subscribed: boolean }
  | { ok: false; reason: PeerRefusal; detail: string }

export interface PeerSendRequest {
  fromChatId: string
  to: string
  message?: string
  notifyWhenIdle?: boolean
}

interface IdleSubscription {
  subscriberChatId: string
  expiresAt: number
}

const RATE_WINDOWS = [
  { limit: PEER_RATE_PER_MINUTE, windowMs: 60_000 },
  { limit: PEER_RATE_PER_HOUR, windowMs: 3_600_000 },
]

function refuse(reason: PeerRefusal, detail: string): PeerSendResult {
  return { ok: false, reason, detail }
}

function digestOf(content: string): string {
  return createHash("sha256").update(content).digest("hex")
}

function originOf(sender: PeerChatInfo, messageId: string): PeerChatOrigin {
  return {
    kind: "peer_chat",
    fromChatId: sender.chatId,
    fromTitle: sender.title,
    fromProjectId: sender.projectId,
    fromProjectTitle: sender.projectTitle,
    messageId,
  }
}

export class PeerMessenger {
  private readonly limiter: RateLimiter
  private readonly recentByPair = new Map<string, { digest: string; at: number }[]>()
  private readonly subscriptions = new Map<string, IdleSubscription[]>()

  constructor(private readonly ports: PeerMessengerPorts) {
    this.limiter = new RateLimiter(RATE_WINDOWS, () => ports.now())
  }

  listPeers(senderChatId: string): PeerChatRow[] {
    const statuses = this.ports.activeStatuses()
    const globalMode = this.ports.globalInbound()
    return this.ports.listChats()
      .filter((chat) => chat.chatId !== senderChatId && !chat.archived)
      .map((chat) => ({
        chatId: chat.chatId,
        title: chat.title,
        projectTitle: chat.projectTitle,
        provider: chat.provider,
        status: statusOf(statuses.get(chat.chatId)),
        accepts: resolvePeerInbound(chat.peerInbound, globalMode) === "accept",
      }))
  }

  async send(request: PeerSendRequest): Promise<PeerSendResult> {
    const message = request.message ?? ""
    const notify = request.notifyWhenIdle === true
    if (message === "" && !notify) return refuse("empty", "Provide a message, notify_when_idle, or both.")

    const sender = this.ports.getChat(request.fromChatId)
    if (!sender) return refuse("unknown_chat", "The sending chat no longer exists.")
    const target = this.ports.getChat(request.to)
    if (!target) return refuse("unknown_chat", `No chat with id ${request.to}. Call list_peer_chats for current ids.`)
    if (target.chatId === sender.chatId) return refuse("self", "A chat cannot message itself.")
    if (target.archived) return refuse("archived", "That chat is archived.")

    if (message === "") {
      this.subscribe(target.chatId, sender.chatId)
      const immediate = await this.fireIfSettled(target.chatId)
      return { ok: true, status: "subscribed", messageId: null, subscribed: !immediate }
    }

    const refusal = this.checkDelivery(sender, target, message)
    if (refusal) return refusal

    const messageId = this.ports.newId()
    const wasSettled = this.isSettled(target.chatId)
    await this.ports.enqueue(target.chatId, message, originOf(sender, messageId))
    await this.ports.startNextQueued(target.chatId)
    if (notify) this.subscribe(target.chatId, sender.chatId)
    return { ok: true, status: wasSettled ? "delivered" : "queued", messageId, subscribed: notify }
  }

  async onChatSettled(chatId: string): Promise<void> {
    try {
      await this.fireIfSettled(chatId)
    } catch (error) {
      log.warn("[kanna/peer] idle notice failed", String(error))
    }
  }

  private checkDelivery(sender: PeerChatInfo, target: PeerChatInfo, message: string): PeerSendResult | null {
    if (resolvePeerInbound(target.peerInbound, this.ports.globalInbound()) === "refuse") {
      return refuse("inbound_refused", "That chat does not accept messages from other chats.")
    }
    if (message.length > PEER_MESSAGE_MAX_CHARS) {
      return refuse("too_large", `Messages are limited to ${String(PEER_MESSAGE_MAX_CHARS)} characters.`)
    }
    const pair = `${sender.chatId}->${target.chatId}`
    const digest = digestOf(message)
    const recent = this.recentFor(pair)
    if (recent.some((entry) => entry.digest === digest)) {
      return refuse("duplicate", "An identical message was sent to that chat in the last minute, so it was not sent again.")
    }
    const decision = this.limiter.take(pair)
    if (!decision.allowed) {
      return refuse("rate_limited", `Too many messages to that chat. Retry in ${String(decision.retryAfterSeconds)} seconds.`)
    }
    const queuedPeers = this.ports.queuedMessages(target.chatId).filter((queued) => queued.origin?.kind === "peer_chat")
    if (queuedPeers.length >= PEER_QUEUE_LIMIT) {
      return refuse("queue_full", "That chat already has too many unread messages from other chats.")
    }
    recent.push({ digest, at: this.ports.now() })
    return null
  }

  private recentFor(pair: string): { digest: string; at: number }[] {
    const now = this.ports.now()
    const fresh = (this.recentByPair.get(pair) ?? []).filter((entry) => now - entry.at < PEER_DUPLICATE_WINDOW_MS)
    this.recentByPair.set(pair, fresh)
    return fresh
  }

  private isSettled(chatId: string): boolean {
    return !this.ports.activeStatuses().has(chatId) && this.ports.queuedMessages(chatId).length === 0
  }

  private subscribe(watchedChatId: string, subscriberChatId: string): void {
    const now = this.ports.now()
    const live = (this.subscriptions.get(watchedChatId) ?? []).filter(
      (entry) => entry.expiresAt > now && entry.subscriberChatId !== subscriberChatId,
    )
    live.push({ subscriberChatId, expiresAt: now + PEER_NOTIFY_TTL_MS })
    this.subscriptions.set(watchedChatId, live)
  }

  private async fireIfSettled(watchedChatId: string): Promise<boolean> {
    const pending = this.subscriptions.get(watchedChatId)
    if (!pending || !this.isSettled(watchedChatId)) return false
    this.subscriptions.delete(watchedChatId)
    const watched = this.ports.getChat(watchedChatId)
    if (!watched) return false
    const now = this.ports.now()
    let fired = false
    for (const entry of pending) {
      if (entry.expiresAt <= now) continue
      const subscriber = this.ports.getChat(entry.subscriberChatId)
      if (!subscriber || subscriber.archived) continue
      await this.ports.enqueue(
        subscriber.chatId,
        `The chat "${watched.title}" has finished its work and is now idle.`,
        originOf(watched, this.ports.newId()),
      )
      await this.ports.startNextQueued(subscriber.chatId)
      fired = true
    }
    return fired
  }
}

function statusOf(active: KannaStatus | undefined): PeerChatStatus {
  if (active === undefined) return "idle"
  return active === "waiting_for_user" ? "waiting_for_user" : "working"
}
