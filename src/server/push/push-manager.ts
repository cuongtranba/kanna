import webpush from "web-push"
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
  private readonly lastSeenWriteByDevice = new Map<string, number>()

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

  async addSubscription(args: {
    subscription: WebPushSubscriptionShape
    label: string
    userAgent: string
  }): Promise<{ id: string }> {
    const ts = this.now()
    for (const existing of this.subscriptions.values()) {
      if (existing.endpoint === args.subscription.endpoint) {
        const updated: PushSubscriptionRecord = {
          id: existing.id,
          endpoint: existing.endpoint,
          keys: args.subscription.keys,
          label: args.label,
          userAgent: args.userAgent,
          createdAt: existing.createdAt,
          lastSeenAt: ts,
        }
        const event: PushEvent = { kind: "subscription_added", ts, id: existing.id, record: updated }
        this.applyEvent(event)
        await this.store.appendPushEvent(event)
        return { id: existing.id }
      }
    }
    const id = crypto.randomUUID()
    const record: PushSubscriptionRecord = {
      id,
      endpoint: args.subscription.endpoint,
      keys: args.subscription.keys,
      label: args.label,
      userAgent: args.userAgent,
      createdAt: ts,
      lastSeenAt: ts,
    }
    const event: PushEvent = { kind: "subscription_added", ts, id, record }
    this.applyEvent(event)
    await this.store.appendPushEvent(event)
    return { id }
  }

  async removeSubscription(
    id: string,
    reason: "user_revoked" | "expired" | "replaced",
  ): Promise<void> {
    if (!this.subscriptions.has(id)) return
    const event: PushEvent = { kind: "subscription_removed", ts: this.now(), id, reason }
    this.applyEvent(event)
    await this.store.appendPushEvent(event)
  }

  async setProjectMute(localPath: string, muted: boolean): Promise<void> {
    const event: PushEvent = {
      kind: "project_mute_set",
      ts: this.now(),
      localPath,
      muted,
    }
    this.applyEvent(event)
    await this.store.appendPushEvent(event)
  }

  async recordDeviceSeen(id: string): Promise<void> {
    const sub = this.subscriptions.get(id)
    if (!sub) return
    const ts = this.now()
    const SEEN_WRITE_INTERVAL_MS = 60 * 60 * 1000
    const lastWrite = this.lastSeenWriteByDevice.get(id)
    if (lastWrite !== undefined && ts - lastWrite < SEEN_WRITE_INTERVAL_MS) return
    const event: PushEvent = { kind: "subscription_seen", ts, id }
    this.lastSeenWriteByDevice.set(id, ts)
    this.applyEvent(event)
    await this.store.appendPushEvent(event)
  }

  async sendTest(id: string): Promise<void> {
    const sub = this.subscriptions.get(id)
    if (!sub) return
    const payload: PushPayload = {
      v: 1,
      kind: "completed",
      projectLocalPath: "kanna",
      projectTitle: "Kanna",
      chatId: "test",
      chatTitle: "Test notification",
      chatUrl: "/",
      ts: this.now(),
    }
    await this.deliver(sub, payload)
  }

  listDevices(): PushSubscriptionRecord[] {
    return [...this.subscriptions.values()]
  }

  getPreferences(): { globalEnabled: boolean; mutedProjectPaths: string[] } {
    return {
      globalEnabled: true,
      mutedProjectPaths: [...this.mutedProjects],
    }
  }

  getConfigSnapshot(currentDeviceId: string | null): {
    vapidPublicKey: string
    preferences: { globalEnabled: boolean; mutedProjectPaths: string[] }
    devices: Array<{
      id: string
      label: string
      userAgent: string
      createdAt: number
      lastSeenAt: number
      isCurrentDevice: boolean
    }>
  } {
    return {
      vapidPublicKey: this.vapid.publicKey,
      preferences: this.getPreferences(),
      devices: this.listDevices().map((sub) => ({
        id: sub.id,
        label: sub.label,
        userAgent: sub.userAgent,
        createdAt: sub.createdAt,
        lastSeenAt: sub.lastSeenAt,
        isCurrentDevice: currentDeviceId === sub.id,
      })),
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
    // snapshot: deliver() may call removeSubscription() during iteration
    for (const sub of [...this.subscriptions.values()]) {
      if (this.focusedByDevice.get(sub.id) === payload.chatId) continue
      await this.deliver(sub, payload)
    }
  }

  private async deliver(sub: PushSubscriptionRecord, payload: PushPayload): Promise<void> {
    const body = JSON.stringify(payload)
    try {
      await this.sender.send(sub, body, {
        TTL: 60,
        urgency: urgencyFor(payload.kind),
        vapidDetails: {
          subject: this.vapid.subject,
          publicKey: this.vapid.publicKey,
          privateKey: this.vapid.privateKey,
        },
      })
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode
      if (status === 410 || status === 404 || status === 403) {
        await this.removeSubscription(sub.id, "expired")
      } else {
        console.warn("[kanna/push] delivery failed", { id: sub.id, status, error })
      }
    }
  }
}

export const realWebPushSender: WebPushSender = {
  async send(sub, payload, opts) {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: sub.keys },
      payload,
      {
        TTL: opts.TTL,
        urgency: opts.urgency,
        vapidDetails: opts.vapidDetails,
      },
    )
  },
}

