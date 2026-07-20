/**
 * Tests for the extracted auto-continue command handlers.
 *
 * Each test builds a minimal `AutoContinueCommandDeps` fake and asserts the
 * correct behaviour of the function under test. No real IO or OS calls.
 */

import { describe, test, expect } from "bun:test"
import { AUTO_CONTINUE_EVENT_VERSION } from "./auto-continue/events"
import type { AutoContinueEvent } from "./auto-continue/events"
import {
  resolveAutoResumeFor,
  emitAutoContinueEvent,
  getChatSchedule,
  requireFuture,
  fireAutoContinue,
  acceptAutoContinue,
  rescheduleAutoContinue,
  cancelAutoContinue,
  type AutoContinueCommandDeps,
} from "./claude-autocontinue-commands"
import type { QueuedChatMessage, TranscriptEntry } from "../shared/types"

// ---------------------------------------------------------------------------
// Minimal fake builder
// ---------------------------------------------------------------------------

function makeQueuedMessage(): QueuedChatMessage {
  return {
    id: "q-1",
    content: "continue",
    attachments: [],
    createdAt: Date.now(),
    autoContinue: { scheduleId: "sched-1" },
  }
}

type StoredEvent = AutoContinueEvent

interface FakeStore {
  events: StoredEvent[]
  messages: { chatId: string; entry: TranscriptEntry }[]
  chatExists: boolean
  appendAutoContinueEvent(event: AutoContinueEvent): Promise<void>
  getAutoContinueEvents(chatId: string): AutoContinueEvent[]
  getChat(chatId: string): { id: string } | null | undefined
  appendMessage(chatId: string, entry: TranscriptEntry): Promise<void>
}

function makeStore(overrides: Partial<FakeStore> = {}): FakeStore {
  const store: FakeStore = {
    events: [],
    messages: [],
    chatExists: true,
    async appendAutoContinueEvent(event) {
      store.events.push(event)
    },
    getAutoContinueEvents() {
      return store.events
    },
    getChat(chatId) {
      return store.chatExists ? { id: chatId } : null
    },
    async appendMessage(chatId, entry) {
      store.messages.push({ chatId, entry })
    },
    ...overrides,
  }
  return store
}

function makeDeps(overrides: Partial<AutoContinueCommandDeps> = {}): AutoContinueCommandDeps {
  const store = makeStore()
  const autoResumeByChat = new Map<string, boolean>()

  return {
    autoResumeByChat,
    getAutoResumePreference: () => false,
    store,
    scheduleManager: null,
    emitStateChange: () => {},
    enqueueMessage: async () => makeQueuedMessage(),
    maybeStartNextQueuedMessage: async () => false,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// resolveAutoResumeFor
// ---------------------------------------------------------------------------

describe("resolveAutoResumeFor", () => {
  test("returns per-chat override when present", () => {
    const autoResumeByChat = new Map<string, boolean>([["chat-1", true]])
    const deps = makeDeps({ autoResumeByChat, getAutoResumePreference: () => false })
    expect(resolveAutoResumeFor(deps, "chat-1")).toBe(true)
  })

  test("falls back to global preference when no override", () => {
    const deps = makeDeps({ getAutoResumePreference: () => true })
    expect(resolveAutoResumeFor(deps, "chat-missing")).toBe(true)
  })

  test("per-chat false wins over global true", () => {
    const autoResumeByChat = new Map<string, boolean>([["chat-1", false]])
    const deps = makeDeps({ autoResumeByChat, getAutoResumePreference: () => true })
    expect(resolveAutoResumeFor(deps, "chat-1")).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// emitAutoContinueEvent
// ---------------------------------------------------------------------------

describe("emitAutoContinueEvent", () => {
  test("appends event to store", async () => {
    const store = makeStore()
    const deps = makeDeps({ store })
    const event: AutoContinueEvent = {
      v: AUTO_CONTINUE_EVENT_VERSION,
      kind: "auto_continue_fired",
      timestamp: Date.now(),
      chatId: "chat-1",
      scheduleId: "sched-1",
    }
    await emitAutoContinueEvent(deps, event)
    expect(store.events).toHaveLength(1)
    expect(store.events[0]).toEqual(event)
  })

  test("notifies schedule manager", async () => {
    const notified: AutoContinueEvent[] = []
    const deps = makeDeps({
      scheduleManager: { onEvent: (e) => { notified.push(e) } },
    })
    const event: AutoContinueEvent = {
      v: AUTO_CONTINUE_EVENT_VERSION,
      kind: "auto_continue_fired",
      timestamp: Date.now(),
      chatId: "chat-1",
      scheduleId: "sched-1",
    }
    await emitAutoContinueEvent(deps, event)
    expect(notified).toHaveLength(1)
  })

  test("emits state change for chat", async () => {
    const changes: string[] = []
    const deps = makeDeps({ emitStateChange: (id) => { changes.push(id) } })
    const event: AutoContinueEvent = {
      v: AUTO_CONTINUE_EVENT_VERSION,
      kind: "auto_continue_fired",
      timestamp: Date.now(),
      chatId: "chat-42",
      scheduleId: "sched-1",
    }
    await emitAutoContinueEvent(deps, event)
    expect(changes).toContain("chat-42")
  })
})

// ---------------------------------------------------------------------------
// getChatSchedule
// ---------------------------------------------------------------------------

describe("getChatSchedule", () => {
  test("returns undefined when no events", () => {
    const deps = makeDeps()
    expect(getChatSchedule(deps, "chat-1", "sched-1")).toBeUndefined()
  })

  test("returns the schedule when a proposed event exists", async () => {
    const deps = makeDeps()
    const event: AutoContinueEvent = {
      v: AUTO_CONTINUE_EVENT_VERSION,
      kind: "auto_continue_proposed",
      timestamp: Date.now(),
      chatId: "chat-1",
      scheduleId: "sched-1",
      detectedAt: Date.now() - 100,
      resetAt: Date.now() + 3_600_000,
      tz: "UTC",
    }
    await deps.store.appendAutoContinueEvent(event)
    const result = getChatSchedule(deps, "chat-1", "sched-1")
    expect(result?.state).toBe("proposed")
  })
})

// ---------------------------------------------------------------------------
// requireFuture
// ---------------------------------------------------------------------------

describe("requireFuture", () => {
  test("does not throw when scheduledAt is in the future", () => {
    expect(() => requireFuture(Date.now() + 60_000)).not.toThrow()
  })

  test("throws when scheduledAt is now", () => {
    expect(() => requireFuture(Date.now() - 1)).toThrow("scheduledAt must be in the future")
  })

  test("throws when scheduledAt is in the past", () => {
    expect(() => requireFuture(Date.now() - 5_000)).toThrow()
  })
})

// ---------------------------------------------------------------------------
// fireAutoContinue
// ---------------------------------------------------------------------------

describe("fireAutoContinue", () => {
  test("no-ops when chat does not exist", async () => {
    const store = makeStore({ chatExists: false })
    const enqueued: string[] = []
    const deps = makeDeps({
      store,
      enqueueMessage: async (_, content) => { enqueued.push(content); return makeQueuedMessage() },
    })
    await fireAutoContinue(deps, "chat-1", "sched-1")
    expect(enqueued).toHaveLength(0)
    expect(store.events).toHaveLength(0)
  })

  test("appends fired event and enqueues prompt", async () => {
    const store = makeStore()
    const enqueued: string[] = []
    const deps = makeDeps({
      store,
      enqueueMessage: async (_, content) => { enqueued.push(content); return makeQueuedMessage() },
    })
    await fireAutoContinue(deps, "chat-1", "sched-1")
    expect(store.events).toHaveLength(1)
    expect(store.events[0]?.kind).toBe("auto_continue_fired")
    expect(enqueued).toContain("continue") // fallback when no schedule prompt
  })

  test("uses schedule prompt when present", async () => {
    const store = makeStore()
    // Seed a proposed event so getChatSchedule finds it
    await store.appendAutoContinueEvent({
      v: AUTO_CONTINUE_EVENT_VERSION,
      kind: "auto_continue_proposed",
      timestamp: Date.now(),
      chatId: "chat-1",
      scheduleId: "sched-1",
      detectedAt: Date.now() - 100,
      resetAt: Date.now() + 3_600_000,
      tz: "UTC",
    })
    // Accept it so the schedule has the prompt
    await store.appendAutoContinueEvent({
      v: AUTO_CONTINUE_EVENT_VERSION,
      kind: "auto_continue_accepted",
      timestamp: Date.now(),
      chatId: "chat-1",
      scheduleId: "sched-1",
      scheduledAt: Date.now() + 5_000,
      tz: "UTC",
      source: "subagent_background",
      resetAt: Date.now() + 3_600_000,
      detectedAt: Date.now() - 100,
      prompt: "Read PROGRESS.md and decide next step",
    })
    const enqueued: string[] = []
    const deps = makeDeps({
      store,
      enqueueMessage: async (_, content) => { enqueued.push(content); return makeQueuedMessage() },
    })
    await fireAutoContinue(deps, "chat-1", "sched-1")
    expect(enqueued).toContain("Read PROGRESS.md and decide next step")
  })

  test("appends error message when enqueueMessage throws", async () => {
    const store = makeStore()
    const deps = makeDeps({
      store,
      enqueueMessage: async () => { throw new Error("queue full") },
    })
    await fireAutoContinue(deps, "chat-1", "sched-1")
    expect(store.messages).toHaveLength(1)
    const msg = store.messages[0]?.entry
    expect(msg && "result" in msg ? msg.result : "").toContain("Auto-continue failed: queue full")
  })
})

// ---------------------------------------------------------------------------
// acceptAutoContinue
// ---------------------------------------------------------------------------

describe("acceptAutoContinue", () => {
  async function seedProposed(store: FakeStore) {
    await store.appendAutoContinueEvent({
      v: AUTO_CONTINUE_EVENT_VERSION,
      kind: "auto_continue_proposed",
      timestamp: Date.now(),
      chatId: "chat-1",
      scheduleId: "sched-1",
      detectedAt: Date.now() - 100,
      resetAt: Date.now() + 3_600_000,
      tz: "UTC",
    })
  }

  test("throws when schedule not found", async () => {
    const deps = makeDeps()
    await expect(
      acceptAutoContinue(deps, "chat-1", "sched-missing", Date.now() + 60_000),
    ).rejects.toThrow("Schedule not found")
  })

  test("throws when schedule not in proposed state", async () => {
    const store = makeStore()
    await seedProposed(store)
    // Cancel it first
    await store.appendAutoContinueEvent({
      v: AUTO_CONTINUE_EVENT_VERSION,
      kind: "auto_continue_cancelled",
      timestamp: Date.now(),
      chatId: "chat-1",
      scheduleId: "sched-1",
      reason: "user",
    })
    const deps = makeDeps({ store })
    await expect(
      acceptAutoContinue(deps, "chat-1", "sched-1", Date.now() + 60_000),
    ).rejects.toThrow("Schedule not pending")
  })

  test("throws when scheduledAt is in the past", async () => {
    const store = makeStore()
    await seedProposed(store)
    const deps = makeDeps({ store })
    await expect(
      acceptAutoContinue(deps, "chat-1", "sched-1", Date.now() - 1),
    ).rejects.toThrow("scheduledAt must be in the future")
  })

  test("appends accepted event when valid", async () => {
    const store = makeStore()
    await seedProposed(store)
    const deps = makeDeps({ store })
    await acceptAutoContinue(deps, "chat-1", "sched-1", Date.now() + 60_000)
    const accepted = store.events.find((e) => e.kind === "auto_continue_accepted")
    expect(accepted).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// rescheduleAutoContinue
// ---------------------------------------------------------------------------

describe("rescheduleAutoContinue", () => {
  async function seedScheduled(store: FakeStore) {
    await store.appendAutoContinueEvent({
      v: AUTO_CONTINUE_EVENT_VERSION,
      kind: "auto_continue_proposed",
      timestamp: Date.now(),
      chatId: "chat-1",
      scheduleId: "sched-1",
      detectedAt: Date.now() - 200,
      resetAt: Date.now() + 3_600_000,
      tz: "UTC",
    })
    await store.appendAutoContinueEvent({
      v: AUTO_CONTINUE_EVENT_VERSION,
      kind: "auto_continue_accepted",
      timestamp: Date.now(),
      chatId: "chat-1",
      scheduleId: "sched-1",
      scheduledAt: Date.now() + 30_000,
      tz: "UTC",
      source: "user",
      resetAt: Date.now() + 3_600_000,
      detectedAt: Date.now() - 200,
    })
  }

  test("throws when schedule not found", async () => {
    const deps = makeDeps()
    await expect(
      rescheduleAutoContinue(deps, "chat-1", "sched-missing", Date.now() + 60_000),
    ).rejects.toThrow("Schedule not active")
  })

  test("throws when scheduledAt is in the past", async () => {
    const store = makeStore()
    await seedScheduled(store)
    const deps = makeDeps({ store })
    await expect(
      rescheduleAutoContinue(deps, "chat-1", "sched-1", Date.now() - 1),
    ).rejects.toThrow("scheduledAt must be in the future")
  })

  test("appends rescheduled event when valid", async () => {
    const store = makeStore()
    await seedScheduled(store)
    const deps = makeDeps({ store })
    await rescheduleAutoContinue(deps, "chat-1", "sched-1", Date.now() + 60_000)
    const rescheduled = store.events.find((e) => e.kind === "auto_continue_rescheduled")
    expect(rescheduled).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// cancelAutoContinue
// ---------------------------------------------------------------------------

describe("cancelAutoContinue", () => {
  test("no-ops silently when schedule not found", async () => {
    const store = makeStore()
    const deps = makeDeps({ store })
    await expect(
      cancelAutoContinue(deps, "chat-1", "sched-missing", "user"),
    ).resolves.toBeUndefined()
    expect(store.events).toHaveLength(0)
  })

  test("no-ops when schedule already fired", async () => {
    const store = makeStore()
    await store.appendAutoContinueEvent({
      v: AUTO_CONTINUE_EVENT_VERSION,
      kind: "auto_continue_proposed",
      timestamp: Date.now(),
      chatId: "chat-1",
      scheduleId: "sched-1",
      detectedAt: Date.now() - 100,
      resetAt: Date.now() + 3_600_000,
      tz: "UTC",
    })
    await store.appendAutoContinueEvent({
      v: AUTO_CONTINUE_EVENT_VERSION,
      kind: "auto_continue_fired",
      timestamp: Date.now(),
      chatId: "chat-1",
      scheduleId: "sched-1",
    })
    const eventsBefore = store.events.length
    const deps = makeDeps({ store })
    await cancelAutoContinue(deps, "chat-1", "sched-1", "user")
    expect(store.events).toHaveLength(eventsBefore)
  })

  test("appends cancelled event when proposed", async () => {
    const store = makeStore()
    await store.appendAutoContinueEvent({
      v: AUTO_CONTINUE_EVENT_VERSION,
      kind: "auto_continue_proposed",
      timestamp: Date.now(),
      chatId: "chat-1",
      scheduleId: "sched-1",
      detectedAt: Date.now() - 100,
      resetAt: Date.now() + 3_600_000,
      tz: "UTC",
    })
    const deps = makeDeps({ store })
    await cancelAutoContinue(deps, "chat-1", "sched-1", "user")
    const cancelled = store.events.find((e) => e.kind === "auto_continue_cancelled")
    expect(cancelled).toBeDefined()
  })

  test("appends cancelled event when scheduled", async () => {
    const store = makeStore()
    await store.appendAutoContinueEvent({
      v: AUTO_CONTINUE_EVENT_VERSION,
      kind: "auto_continue_proposed",
      timestamp: Date.now(),
      chatId: "chat-1",
      scheduleId: "sched-1",
      detectedAt: Date.now() - 200,
      resetAt: Date.now() + 3_600_000,
      tz: "UTC",
    })
    await store.appendAutoContinueEvent({
      v: AUTO_CONTINUE_EVENT_VERSION,
      kind: "auto_continue_accepted",
      timestamp: Date.now(),
      chatId: "chat-1",
      scheduleId: "sched-1",
      scheduledAt: Date.now() + 30_000,
      tz: "UTC",
      source: "user",
      resetAt: Date.now() + 3_600_000,
      detectedAt: Date.now() - 200,
    })
    const deps = makeDeps({ store })
    await cancelAutoContinue(deps, "chat-1", "sched-1", "chat_deleted")
    const cancelled = store.events.find((e) => e.kind === "auto_continue_cancelled")
    expect(cancelled).toBeDefined()
    if (cancelled && cancelled.kind === "auto_continue_cancelled") {
      expect(cancelled.reason).toBe("chat_deleted")
    }
  })
})
