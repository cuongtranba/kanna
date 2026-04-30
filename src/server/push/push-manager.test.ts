import { beforeEach, describe, expect, test } from "bun:test"
import type { PushEvent, PushEventStore } from "./events"
import {
  PushManager,
  type WebPushSender,
  type ObservedChat,
  type WebPushSubscriptionShape,
  type WebPushSendOptions,
} from "./push-manager"

class FakeStore implements PushEventStore {
  events: PushEvent[] = []
  async appendPushEvent(event: PushEvent) { this.events.push(event) }
  async loadPushEvents() { return [...this.events] }
}

interface SentPush {
  endpoint: string
  payload: string
  ttl: number
  urgency: "very-low" | "low" | "normal" | "high"
}

class FakeSender implements WebPushSender {
  sent: SentPush[] = []
  errorByEndpoint: Map<string, { statusCode: number }> = new Map()
  async send(sub: WebPushSubscriptionShape, body: string, opts: WebPushSendOptions) {
    const error = this.errorByEndpoint.get(sub.endpoint)
    if (error) throw error
    this.sent.push({ endpoint: sub.endpoint, payload: body, ttl: opts.TTL, urgency: opts.urgency })
  }
}

const VAPID = { publicKey: "pub", privateKey: "prv", subject: "mailto:test@kanna" }

function chat(overrides: Partial<ObservedChat> = {}): ObservedChat {
  return {
    chatId: "c1",
    projectLocalPath: "/tmp/p",
    projectTitle: "P",
    chatTitle: "Hello",
    status: "idle",
    ...overrides,
  }
}

describe("PushManager.observeStatuses", () => {
  let store: FakeStore
  let sender: FakeSender
  let manager: PushManager

  beforeEach(async () => {
    store = new FakeStore()
    sender = new FakeSender()
    manager = new PushManager({ store, sender, vapid: VAPID, now: () => 1000 })
    await manager.initialize()
  })

  test("first call seeds without firing", async () => {
    await manager.observeStatuses([chat({ status: "running" })])
    expect(sender.sent).toEqual([])
  })

  test("second call detects transition but fires nothing when no subscriptions", async () => {
    await manager.observeStatuses([chat({ status: "running" })])
    await manager.observeStatuses([chat({ status: "waiting_for_user" })])
    expect(sender.sent).toEqual([])  // no subscriptions registered yet
  })
})
