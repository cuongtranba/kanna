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

function urgencyFor(kind: PushTransitionKind): "low" | "normal" | "high" {
  if (kind === "failed") return "high"
  if (kind === "completed") return "low"
  return "normal"
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
  private readonly dedupKeyToTs = new Map<string, number>()
  private readonly focusedByDevice = new Map<string, string | null>()

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

  setFocusedChat(deviceId: string, chatId: string | null): void {
    this.focusedByDevice.set(deviceId, chatId)
  }

  clearFocus(deviceId: string): void {
    this.focusedByDevice.delete(deviceId)
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
      if (this.isDuplicate(chat.chatId, kind)) continue
      if (this.mutedProjects.has(chat.projectLocalPath)) continue
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

  private isDuplicate(chatId: string, kind: PushTransitionKind): boolean {
    const key = `${chatId}:${kind}`
    const ts = this.now()
    const last = this.dedupKeyToTs.get(key)
    if (last !== undefined && ts - last <= 2000) return true
    this.dedupKeyToTs.set(key, ts)
    return false
  }

  private async fanOut(payload: PushPayload): Promise<void> {
    const body = JSON.stringify(payload)
    const urgency = urgencyFor(payload.kind)
    for (const sub of this.subscriptions.values()) {
      if (this.focusedByDevice.get(sub.id) === payload.chatId) continue
      await this.sender.send(sub, body, {
        TTL: 60,
        urgency,
        vapidDetails: {
          subject: this.vapid.subject,
          publicKey: this.vapid.publicKey,
          privateKey: this.vapid.privateKey,
        },
      })
    }
  }
}

