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

describe("PushManager subscriptions", () => {
  let store: FakeStore
  let sender: FakeSender
  let manager: PushManager
  let nowMs = 1000

  beforeEach(() => {
    store = new FakeStore()
    sender = new FakeSender()
    nowMs = 1000
    manager = new PushManager({ store, sender, vapid: VAPID, now: () => nowMs })
  })

  test("addSubscription persists and assigns id", async () => {
    await manager.initialize()
    const result = await manager.addSubscription({
      subscription: { endpoint: "https://push.example/x", keys: { p256dh: "p", auth: "a" } },
      label: "iPhone",
      userAgent: "Mozilla/5.0",
    })
    expect(result.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(store.events).toHaveLength(1)
    expect(store.events[0].kind).toBe("subscription_added")
    expect(manager.listDevices().map(d => d.id)).toContain(result.id)
  })

  test("removeSubscription writes user_revoked event", async () => {
    await manager.initialize()
    const { id } = await manager.addSubscription({
      subscription: { endpoint: "https://push.example/x", keys: { p256dh: "p", auth: "a" } },
      label: "iPhone",
      userAgent: "ua",
    })
    await manager.removeSubscription(id, "user_revoked")
    expect(manager.listDevices()).toEqual([])
    expect(store.events.some(e => e.kind === "subscription_removed" && e.reason === "user_revoked")).toBe(true)
  })

  test("410 response purges the subscription as expired", async () => {
    await manager.initialize()
    const { id } = await manager.addSubscription({
      subscription: { endpoint: "https://push.example/x", keys: { p256dh: "p", auth: "a" } },
      label: "iPhone",
      userAgent: "ua",
    })
    sender.errorByEndpoint.set("https://push.example/x", { statusCode: 410 })

    nowMs = 2000
    await manager.observeStatuses([chat({ status: "running" })])
    nowMs = 3000
    await manager.observeStatuses([chat({ status: "waiting_for_user" })])

    expect(manager.listDevices()).toEqual([])
    const removed = store.events.find(e => e.kind === "subscription_removed")
    expect(removed && "reason" in removed && removed.reason).toBe("expired")
    void id
  })

  test("5xx response leaves the subscription intact", async () => {
    await manager.initialize()
    const { id } = await manager.addSubscription({
      subscription: { endpoint: "https://push.example/x", keys: { p256dh: "p", auth: "a" } },
      label: "iPhone",
      userAgent: "ua",
    })
    sender.errorByEndpoint.set("https://push.example/x", { statusCode: 503 })

    nowMs = 2000
    await manager.observeStatuses([chat({ status: "running" })])
    nowMs = 3000
    await manager.observeStatuses([chat({ status: "waiting_for_user" })])

    expect(manager.listDevices().map(d => d.id)).toContain(id)
    expect(store.events.find(e => e.kind === "subscription_removed")).toBeUndefined()
  })

  test("setProjectMute persists and filters", async () => {
    await manager.initialize()
    await manager.addSubscription({
      subscription: { endpoint: "https://push.example/x", keys: { p256dh: "p", auth: "a" } },
      label: "iPhone", userAgent: "ua",
    })
    await manager.setProjectMute("/tmp/p", true)
    expect(manager.getPreferences().mutedProjectPaths).toContain("/tmp/p")
    expect(store.events.some(e => e.kind === "project_mute_set" && e.muted)).toBe(true)
  })

  test("sendTest fires only to the requested device", async () => {
    await manager.initialize()
    const a = await manager.addSubscription({
      subscription: { endpoint: "https://push.example/a", keys: { p256dh: "p", auth: "a" } },
      label: "A", userAgent: "ua",
    })
    await manager.addSubscription({
      subscription: { endpoint: "https://push.example/b", keys: { p256dh: "p", auth: "a" } },
      label: "B", userAgent: "ua",
    })
    await manager.sendTest(a.id)
    expect(sender.sent).toHaveLength(1)
    expect(sender.sent[0].endpoint).toBe("https://push.example/a")
    const payload = JSON.parse(sender.sent[0].payload) as PushPayload
    expect(payload.kind).toBe("completed")
    expect(payload.chatTitle).toBe("Test notification")
  })

  test("recordDeviceSeen debounces to <= 1 event/hour", async () => {
    await manager.initialize()
    const { id } = await manager.addSubscription({
      subscription: { endpoint: "https://push.example/x", keys: { p256dh: "p", auth: "a" } },
      label: "X", userAgent: "ua",
    })
    nowMs = 5_000
    await manager.recordDeviceSeen(id)
    nowMs = 5_000 + 30 * 60 * 1000  // 30m later
    await manager.recordDeviceSeen(id)
    nowMs = 5_000 + 60 * 60 * 1000 + 1  // 1h+1ms after first
    await manager.recordDeviceSeen(id)

    const seenEvents = store.events.filter(e => e.kind === "subscription_seen")
    expect(seenEvents).toHaveLength(2)  // first + after 1h
  })

  test("addSubscription called twice with same endpoint returns same id and persists update", async () => {
    await manager.initialize()
    nowMs = 1000
    const first = await manager.addSubscription({
      subscription: { endpoint: "https://push.example/x", keys: { p256dh: "p1", auth: "a1" } },
      label: "iPhone",
      userAgent: "ua-1",
    })
    nowMs = 5000
    const second = await manager.addSubscription({
      subscription: { endpoint: "https://push.example/x", keys: { p256dh: "p2", auth: "a2" } },
      label: "iPhone (renamed)",
      userAgent: "ua-2",
    })
    expect(second.id).toBe(first.id)

    // Replay events to verify durability
    const replay = new PushManager({ store, sender, vapid: VAPID, now: () => nowMs })
    await replay.initialize()
    const devices = replay.listDevices()
    expect(devices).toHaveLength(1)
    expect(devices[0].id).toBe(first.id)
    expect(devices[0].label).toBe("iPhone (renamed)")
    expect(devices[0].userAgent).toBe("ua-2")
    expect(devices[0].lastSeenAt).toBe(5000)
    expect(devices[0].createdAt).toBe(1000)
    expect(devices[0].keys.p256dh).toBe("p2")
  })

  test("removeSubscription with unknown id is a no-op", async () => {
    await manager.initialize()
    await manager.removeSubscription("nonexistent-id", "user_revoked")
    expect(store.events).toEqual([])
  })

  test("recordDeviceSeen with unknown id is a no-op", async () => {
    await manager.initialize()
    await manager.recordDeviceSeen("nonexistent-id")
    expect(store.events).toEqual([])
  })

  test("sendTest with unknown id is a no-op", async () => {
    await manager.initialize()
    await manager.sendTest("nonexistent-id")
    expect(sender.sent).toEqual([])
  })

  test("getConfigSnapshot exposes vapid public key, prefs, and devices", async () => {
    await manager.initialize()
    const { id } = await manager.addSubscription({
      subscription: { endpoint: "https://push.example/x", keys: { p256dh: "p", auth: "a" } },
      label: "iPhone", userAgent: "ua",
    })
    await manager.setProjectMute("/tmp/muted", true)

    const snap = manager.getConfigSnapshot(id)
    expect(snap.vapidPublicKey).toBe("pub")
    expect(snap.preferences.mutedProjectPaths).toContain("/tmp/muted")
    expect(snap.devices).toHaveLength(1)
    expect(snap.devices[0].isCurrentDevice).toBe(true)
    // Sensitive material must NOT leak into device summaries:
    expect(snap.devices[0]).not.toHaveProperty("endpoint")
    expect(snap.devices[0]).not.toHaveProperty("keys")
  })
})
