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
  PEER_WAIT_DEFAULT_SECONDS,
  PEER_WAIT_MAX_SECONDS,
} from "../../shared/peer-messaging/limits"
import { resolvePeerInbound, type PeerInboundMode } from "../../shared/peer-messaging/inbound"
import { renderPeerPrompt } from "../../shared/peer-messaging/render-prompt"
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
  enqueue(chatId: string, content: string, origin: PeerChatOrigin): Promise<string>
  startNextQueued(chatId: string): Promise<void>
  injectMidTurn(chatId: string, queuedMessageId: string): Promise<boolean>
  deliverToRun?(chatId: string, runId: string, content: string, origin: PeerChatOrigin): Promise<boolean>
  after(delayMs: number, run: () => void): () => void
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
  | { ok: true; status: "delivered" | "injected" | "queued" | "subscribed"; messageId: string | null; subscribed: boolean }
  | { ok: false; reason: PeerRefusal; detail: string }

export interface PeerSendRequest {
  fromChatId: string
  to: string
  message?: string
  notifyWhenIdle?: boolean
  fromRunId?: string
  fromSubagentName?: string
  runId?: string
  replyTo?: string
}

export interface PeerWaitRequest {
  chatId: string
  runId?: string
  from?: string
  timeoutSeconds?: number
}

export type PeerWaitResult =
  | { status: "message"; message: string; messageId: string; fromChatId: string }
  | { status: "pending"; note: string }
  | { status: "timeout" }

interface MessageWaiter {
  from: string | undefined
  settle(result: PeerWaitResult): void
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

type OriginExtras = Pick<PeerChatOrigin, "fromRunId" | "fromSubagentName" | "inReplyTo">

function originOf(sender: PeerChatInfo, messageId: string, extras: OriginExtras = {}): PeerChatOrigin {
  return {
    kind: "peer_chat",
    fromChatId: sender.chatId,
    fromTitle: sender.title,
    fromProjectId: sender.projectId,
    fromProjectTitle: sender.projectTitle,
    messageId,
    ...extras,
  }
}

function originExtrasOf(request: PeerSendRequest): OriginExtras {
  return {
    ...(request.fromRunId !== undefined ? { fromRunId: request.fromRunId } : {}),
    ...(request.fromSubagentName !== undefined ? { fromSubagentName: request.fromSubagentName } : {}),
    ...(request.replyTo !== undefined ? { inReplyTo: request.replyTo } : {}),
  }
}

function waiterKey(chatId: string, runId: string | undefined): string {
  return `${chatId}::${runId ?? ""}`
}

function waitSeconds(requested: number | undefined): number {
  if (requested === undefined || !Number.isFinite(requested)) return PEER_WAIT_DEFAULT_SECONDS
  return Math.min(PEER_WAIT_MAX_SECONDS, Math.max(1, requested))
}

export class PeerMessenger {
  private readonly limiter: RateLimiter
  private readonly recentByPair = new Map<string, { digest: string; at: number }[]>()
  private readonly subscriptions = new Map<string, IdleSubscription[]>()
  private readonly waiters = new Map<string, MessageWaiter>()

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
    const origin = originOf(sender, messageId, originExtrasOf(request))
    const status = await this.deliver(target.chatId, request.runId, message, origin)
    if (notify) this.subscribe(target.chatId, sender.chatId)
    return { ok: true, status, messageId, subscribed: notify }
  }

  waitForMessage(request: PeerWaitRequest): Promise<PeerWaitResult> {
    const pending = request.runId === undefined ? this.pendingPeerMessages(request.chatId, request.from) : []
    if (pending.length > 0) return this.pendingResult(request.chatId, pending)
    const key = waiterKey(request.chatId, request.runId)
    this.waiters.get(key)?.settle({ status: "timeout" })
    return new Promise<PeerWaitResult>((resolve) => {
      const cancelTimer = this.ports.after(waitSeconds(request.timeoutSeconds) * 1000, () => waiter.settle({ status: "timeout" }))
      const waiter: MessageWaiter = {
        from: request.from,
        settle: (result) => {
          cancelTimer()
          if (this.waiters.get(key) === waiter) this.waiters.delete(key)
          resolve(result)
        },
      }
      this.waiters.set(key, waiter)
    })
  }

  async deliverToChat(chatId: string, message: string, origin: PeerChatOrigin): Promise<void> {
    await this.deliver(chatId, undefined, message, origin)
  }

  cancelWaits(chatId: string, runId?: string): void {
    this.waiters.get(waiterKey(chatId, runId))?.settle({ status: "timeout" })
  }

  async onChatSettled(chatId: string): Promise<void> {
    this.cancelWaits(chatId)
    try {
      await this.fireIfSettled(chatId)
    } catch (error) {
      log.warn("[kanna/peer] idle notice failed", String(error))
    }
  }

  private async deliver(
    chatId: string,
    runId: string | undefined,
    message: string,
    origin: PeerChatOrigin,
  ): Promise<"delivered" | "injected" | "queued"> {
    if (this.handToWaiter(chatId, runId, message, origin)) return "delivered"
    if (runId !== undefined && await this.ports.deliverToRun?.(chatId, runId, message, origin) === true) return "injected"
    const queuedId = await this.ports.enqueue(chatId, message, origin)
    await this.ports.startNextQueued(chatId)
    if (!this.ports.queuedMessages(chatId).some((queued) => queued.id === queuedId)) return "delivered"
    return await this.ports.injectMidTurn(chatId, queuedId) ? "injected" : "queued"
  }

  private handToWaiter(chatId: string, runId: string | undefined, message: string, origin: PeerChatOrigin): boolean {
    const waiter = this.waiters.get(waiterKey(chatId, runId))
    if (!waiter || (waiter.from !== undefined && waiter.from !== origin.fromChatId)) return false
    if (runId === undefined && !this.ports.activeStatuses().has(chatId)) {
      waiter.settle({ status: "timeout" })
      return false
    }
    waiter.settle({ status: "message", message: renderPeerPrompt(message, origin), messageId: origin.messageId, fromChatId: origin.fromChatId })
    return true
  }

  private pendingPeerMessages(chatId: string, from: string | undefined): readonly QueuedChatMessage[] {
    return this.ports.queuedMessages(chatId).filter(
      (queued) => queued.origin?.kind === "peer_chat" && (from === undefined || queued.origin.fromChatId === from),
    )
  }

  private async pendingResult(chatId: string, pending: readonly QueuedChatMessage[]): Promise<PeerWaitResult> {
    let injected = false
    for (const queued of pending) injected = await this.ports.injectMidTurn(chatId, queued.id) || injected
    const when = injected ? "as soon as this tool returns" : "when your current turn ends"
    return { status: "pending", note: `A message from another chat is already pending. It reaches you ${when}, so there is nothing to wait for.` }
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
    const queuedPeers = this.ports.queuedMessages(target.chatId).filter((queued) => queued.origin?.kind === "peer_chat")
    if (queuedPeers.length >= PEER_QUEUE_LIMIT) {
      return refuse("queue_full", "That chat already has too many unread messages from other chats.")
    }
    const decision = this.limiter.take(pair)
    if (!decision.allowed) {
      return refuse("rate_limited", `Too many messages to that chat. Retry in ${String(decision.retryAfterSeconds)} seconds.`)
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
