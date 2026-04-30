import { beforeEach, describe, expect, test } from "bun:test"
import type { PushPayload } from "../../shared/types"
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

async function registerSub(manager: PushManager, store: FakeStore, id: string, endpoint: string) {
  store.events.push({
    kind: "subscription_added",
    ts: 1,
    id,
    record: {
      id,
      endpoint,
      keys: { p256dh: "p", auth: "a" },
      label: "Test",
      userAgent: "Test",
      createdAt: 1,
      lastSeenAt: 1,
    },
  })
  await manager.initialize()
}

describe("PushManager.observeStatuses", () => {
  let store: FakeStore
  let sender: FakeSender
  let manager: PushManager

  beforeEach(() => {
    store = new FakeStore()
    sender = new FakeSender()
    manager = new PushManager({ store, sender, vapid: VAPID, now: () => 1000 })
  })

  test("first call seeds without firing", async () => {
    await manager.initialize()
    await manager.observeStatuses([chat({ status: "running" })])
    expect(sender.sent).toEqual([])
  })

  test("second call fires for waiting_for_user transition", async () => {
    await registerSub(manager, store, "d1", "https://push.example/x")
    await manager.observeStatuses([chat({ status: "running" })])
    await manager.observeStatuses([chat({ status: "waiting_for_user" })])
    expect(sender.sent).toHaveLength(1)
    const payload = JSON.parse(sender.sent[0].payload) as PushPayload
    expect(payload.kind).toBe("waiting_for_user")
    expect(payload.chatId).toBe("c1")
    expect(payload.projectLocalPath).toBe("/tmp/p")
  })

  test("fires for running -> idle (completed)", async () => {
    await registerSub(manager, store, "d1", "https://push.example/x")
    await manager.observeStatuses([chat({ status: "running" })])
    await manager.observeStatuses([chat({ status: "idle" })])
    expect(sender.sent).toHaveLength(1)
    expect(JSON.parse(sender.sent[0].payload).kind).toBe("completed")
  })

  test("fires for any -> failed", async () => {
    await registerSub(manager, store, "d1", "https://push.example/x")
    await manager.observeStatuses([chat({ status: "running" })])
    await manager.observeStatuses([chat({ status: "failed" })])
    expect(sender.sent).toHaveLength(1)
    expect(JSON.parse(sender.sent[0].payload).kind).toBe("failed")
  })

  test("does not fire for idle -> starting -> running", async () => {
    await registerSub(manager, store, "d1", "https://push.example/x")
    await manager.observeStatuses([chat({ status: "idle" })])
    await manager.observeStatuses([chat({ status: "starting" })])
    await manager.observeStatuses([chat({ status: "running" })])
    expect(sender.sent).toEqual([])
  })

  test("truncates long chat title to 80 chars", async () => {
    await registerSub(manager, store, "d1", "https://push.example/x")
    const long = "x".repeat(120)
    await manager.observeStatuses([chat({ status: "running" })])
    await manager.observeStatuses([chat({ status: "waiting_for_user", chatTitle: long })])
    expect(sender.sent).toHaveLength(1)
    const payload = JSON.parse(sender.sent[0].payload) as PushPayload
    expect(payload.chatTitle.length).toBe(80)
  })
})
