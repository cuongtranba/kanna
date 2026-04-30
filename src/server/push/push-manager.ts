import type {
  KannaStatus,
  PushPayload,
  PushSubscriptionRecord,
  PushTransitionKind,
} from "../../shared/types"
import type { PushEvent, PushEventStore } from "./events"
import type { VapidKeypair } from "./vapid"

// Re-exported for Task 8+ consumers (transition detection, payload building).
export type { PushPayload, PushTransitionKind } from "../../shared/types"

export interface ObservedChat {
  chatId: string
  projectLocalPath: string
  projectTitle: string
  chatTitle: string
  status: KannaStatus
}

export interface WebPushSendOptions {
  TTL: number
  urgency: "very-low" | "low" | "normal" | "high"
  vapidDetails: { subject: string; publicKey: string; privateKey: string }
}

export interface WebPushSubscriptionShape {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

export interface WebPushSender {
  send(
    subscription: WebPushSubscriptionShape,
    payload: string,
    options: WebPushSendOptions,
  ): Promise<void>
}

export interface PushManagerArgs {
  store: PushEventStore
  sender: WebPushSender
  vapid: VapidKeypair
  now?: () => number
}

export class PushManager {
  private readonly store: PushEventStore
  private readonly sender: WebPushSender
  private readonly vapid: VapidKeypair
  private readonly now: () => number
  private readonly subscriptions = new Map<string, PushSubscriptionRecord>()
  private readonly mutedProjects = new Set<string>()
  private readonly lastStatusByChat = new Map<string, KannaStatus>()
  private seeded = false

  constructor(args: PushManagerArgs) {
    this.store = args.store
    this.sender = args.sender
    this.vapid = args.vapid
    this.now = args.now ?? Date.now
  }

  async initialize(): Promise<void> {
    const events = await this.store.loadPushEvents()
    for (const event of events) {
      this.applyEvent(event)
    }
  }

  private applyEvent(event: PushEvent) {
    switch (event.kind) {
      case "subscription_added":
        this.subscriptions.set(event.id, event.record)
        break
      case "subscription_removed":
        this.subscriptions.delete(event.id)
        break
      case "subscription_seen": {
        const existing = this.subscriptions.get(event.id)
        if (existing) existing.lastSeenAt = event.ts
        break
      }
      case "project_mute_set":
        if (event.muted) this.mutedProjects.add(event.localPath)
        else this.mutedProjects.delete(event.localPath)
        break
    }
  }

  async observeStatuses(snapshot: readonly ObservedChat[]): Promise<void> {
    if (!this.seeded) {
      for (const chat of snapshot) {
        this.lastStatusByChat.set(chat.chatId, chat.status)
      }
      this.seeded = true
      return
    }
    for (const chat of snapshot) {
      const prev = this.lastStatusByChat.get(chat.chatId)
      this.lastStatusByChat.set(chat.chatId, chat.status)
      const kind = this.detectTransition(prev, chat.status)
      if (!kind) continue
      const payload = this.buildPayload(chat, kind)
      await this.fanOut(payload)
    }
  }

  private detectTransition(
    prev: KannaStatus | undefined,
    next: KannaStatus,
  ): PushTransitionKind | null {
    if (next === "waiting_for_user" && prev !== "waiting_for_user") return "waiting_for_user"
    if (next === "failed" && prev !== "failed") return "failed"
    if (next === "idle" && prev === "running") return "completed"
    return null
  }

  private buildPayload(chat: ObservedChat, kind: PushTransitionKind): PushPayload {
    return {
      v: 1,
      kind,
      projectLocalPath: chat.projectLocalPath,
      projectTitle: chat.projectTitle,
      chatId: chat.chatId,
      chatTitle: chat.chatTitle.slice(0, 80),
      chatUrl: `/chats/${chat.chatId}`,
      ts: this.now(),
    }
  }

  private async fanOut(payload: PushPayload): Promise<void> {
    const body = JSON.stringify(payload)
    for (const sub of this.subscriptions.values()) {
      await this.sender.send(sub, body, {
        TTL: 60,
        urgency: "normal",
        vapidDetails: {
          subject: this.vapid.subject,
          publicKey: this.vapid.publicKey,
          privateKey: this.vapid.privateKey,
        },
      })
    }
  }
}

