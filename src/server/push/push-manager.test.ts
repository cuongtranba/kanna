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

  test("uses high urgency for failed and low urgency for completed", async () => {
    await registerSub(manager, store, "d1", "https://push.example/x")
    await manager.observeStatuses([chat({ status: "running" })])
    await manager.observeStatuses([chat({ status: "failed" })])
    expect(sender.sent[0].urgency).toBe("high")
    expect(sender.sent[0].ttl).toBe(60)

    sender.sent = []
    await manager.observeStatuses([chat({ status: "running" })])
    await manager.observeStatuses([chat({ status: "idle" })])
    expect(sender.sent[0].urgency).toBe("low")
  })

  test("dedups same (chatId, kind) within 2s", async () => {
    let nowMs = 1000
    manager = new PushManager({ store, sender, vapid: VAPID, now: () => nowMs })
    await registerSub(manager, store, "d1", "https://push.example/x")

    await manager.observeStatuses([chat({ status: "running" })])
    nowMs = 2000
    await manager.observeStatuses([chat({ status: "waiting_for_user" })])
    nowMs = 3500  // 1.5s later
    await manager.observeStatuses([chat({ status: "running" })])
    nowMs = 4000  // .5s later
    await manager.observeStatuses([chat({ status: "waiting_for_user" })])

    expect(sender.sent).toHaveLength(1)
  })

  test("does not dedup after 2s window", async () => {
    let nowMs = 1000
    manager = new PushManager({ store, sender, vapid: VAPID, now: () => nowMs })
    await registerSub(manager, store, "d1", "https://push.example/x")

    await manager.observeStatuses([chat({ status: "running" })])
    nowMs = 2000
    await manager.observeStatuses([chat({ status: "waiting_for_user" })])
    nowMs = 5000
    await manager.observeStatuses([chat({ status: "running" })])
    nowMs = 6000
    await manager.observeStatuses([chat({ status: "waiting_for_user" })])

    expect(sender.sent).toHaveLength(2)
  })

  test("skips muted projects", async () => {
    store.events.push({
      kind: "project_mute_set",
      ts: 1,
      localPath: "/tmp/p",
      muted: true,
    })
    await registerSub(manager, store, "d1", "https://push.example/x")

    await manager.observeStatuses([chat({ status: "running" })])
    await manager.observeStatuses([chat({ status: "waiting_for_user" })])
    expect(sender.sent).toEqual([])
  })

  test("skips devices focused on the firing chat", async () => {
    await registerSub(manager, store, "d1", "https://push.example/x")
    await registerSub(manager, store, "d2", "https://push.example/y")
    manager.setFocusedChat("d1", "c1")

    await manager.observeStatuses([chat({ status: "running" })])
    await manager.observeStatuses([chat({ status: "waiting_for_user" })])

    expect(sender.sent).toHaveLength(1)
    expect(sender.sent[0].endpoint).toBe("https://push.example/y")
  })

  test("clears focus on disconnect", async () => {
    await registerSub(manager, store, "d1", "https://push.example/x")
    manager.setFocusedChat("d1", "c1")
    manager.clearFocus("d1")

    await manager.observeStatuses([chat({ status: "running" })])
    await manager.observeStatuses([chat({ status: "waiting_for_user" })])
    expect(sender.sent).toHaveLength(1)
  })
})
