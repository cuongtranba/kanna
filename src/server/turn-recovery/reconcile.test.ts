import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { TranscriptEntry } from "../../shared/types"
import { AgentCoordinator } from "../agent"
import { EventStore } from "../event-store"
import { ScheduleManager, type Clock } from "../auto-continue/schedule-manager"
import { deriveChatSchedules } from "../auto-continue/read-model"

class FakeClock implements Clock {
  private t: number
  constructor(startAt: number) { this.t = startAt }
  now() { return this.t }
  setTimeout() { return 1 }
  clearTimeout() {}
}

function mkEntry(kind: "user_prompt", content: string): TranscriptEntry
function mkEntry(kind: "interrupted"): TranscriptEntry
function mkEntry(kind: string, content?: string): TranscriptEntry {
  return { kind, id: crypto.randomUUID(), timestamp: new Date().toISOString(), content: content ?? "", attachments: [] } as TranscriptEntry
}

async function harness() {
  const dir = await mkdtemp(join(tmpdir(), "kanna-recover-"))
  const store = new EventStore(dir)
  await store.initialize()
  let coordinator!: AgentCoordinator
  const scheduleManager = new ScheduleManager({
    clock: new FakeClock(Date.now()),
    fire: async (cid, sid) => { await coordinator.fireAutoContinue(cid, sid) },
  })
  coordinator = new AgentCoordinator({
    store,
    onStateChange: () => {},
    scheduleManager,
    getAutoResumePreference: () => false,
    // reconcile never starts a session; a throwing stub proves that.
    startClaudeSession: async () => { throw new Error("must not spawn during reconcile") },
  })
  return { dir, store, coordinator, cleanup: () => rm(dir, { recursive: true, force: true }) }
}

/** Live interrupted_resume schedules for a chat (source + count). */
function liveResumes(store: EventStore, chatId: string) {
  const events = store.getAutoContinueEvents(chatId)
  const { schedules, liveScheduleId } = deriveChatSchedules(events, chatId)
  const live = liveScheduleId ? schedules[liveScheduleId] : undefined
  return { live, source: live?.source ?? null }
}

describe("turn_cancelled reason round-trips through replay", () => {
  test("shutdown reason persists; default is user; legacy replays as user", async () => {
    const { store, cleanup } = await harness()
    try {
      const project = await store.openProject("/tmp/p")
      const shutdownChat = await store.createChat(project.id)
      const userChat = await store.createChat(project.id)

      await store.recordTurnCancelled(shutdownChat.id, "shutdown")
      await store.recordTurnCancelled(userChat.id) // default "user"

      expect(store.getChat(shutdownChat.id)?.lastTurnCancelReason).toBe("shutdown")
      expect(store.getChat(userChat.id)?.lastTurnCancelReason).toBe("user")
    } finally { await cleanup() }
  })
})

describe("resume attempt counter", () => {
  test("increments on attempt, resets on turn_finished", async () => {
    const { store, cleanup } = await harness()
    try {
      const project = await store.openProject("/tmp/p")
      const chat = await store.createChat(project.id)
      await store.recordTurnResumeAttempted(chat.id)
      await store.recordTurnResumeAttempted(chat.id)
      expect(store.getChat(chat.id)?.resumeAttemptsSinceProgress).toBe(2)
      await store.recordTurnFinished(chat.id)
      expect(store.getChat(chat.id)?.resumeAttemptsSinceProgress).toBe(0)
    } finally { await cleanup() }
  })
})

describe("reconcileInterruptedTurns", () => {
  test("arms an interrupted_resume schedule for a dangling turn", async () => {
    const { store, coordinator, cleanup } = await harness()
    try {
      const project = await store.openProject("/tmp/p")
      const chat = await store.createChat(project.id)
      await store.setChatProvider(chat.id, "claude")
      await store.setSessionTokenForProvider(chat.id, "claude", "tok-1")
      await store.appendMessage(chat.id, mkEntry("user_prompt", "do it"))

      const armed = await coordinator.reconcileInterruptedTurns()
      expect(armed).toBe(1)
      expect(liveResumes(store, chat.id).source).toBe("interrupted_resume")
      expect(store.getChat(chat.id)?.resumeAttemptsSinceProgress).toBe(1)
    } finally { await cleanup() }
  })

  test("does NOT resume an explicit user cancel (wall 3)", async () => {
    const { store, coordinator, cleanup } = await harness()
    try {
      const project = await store.openProject("/tmp/p")
      const chat = await store.createChat(project.id)
      await store.setChatProvider(chat.id, "claude")
      await store.appendMessage(chat.id, mkEntry("user_prompt", "do it"))
      await store.appendMessage(chat.id, mkEntry("interrupted"))
      await store.recordTurnCancelled(chat.id, "user")

      const armed = await coordinator.reconcileInterruptedTurns()
      expect(armed).toBe(0)
      expect(liveResumes(store, chat.id).live).toBeUndefined()
    } finally { await cleanup() }
  })

  test("resumes a graceful shutdown cancel", async () => {
    const { store, coordinator, cleanup } = await harness()
    try {
      const project = await store.openProject("/tmp/p")
      const chat = await store.createChat(project.id)
      await store.setChatProvider(chat.id, "claude")
      await store.appendMessage(chat.id, mkEntry("user_prompt", "do it"))
      await store.appendMessage(chat.id, mkEntry("interrupted"))
      await store.recordTurnCancelled(chat.id, "shutdown")

      const armed = await coordinator.reconcileInterruptedTurns()
      expect(armed).toBe(1)
      expect(liveResumes(store, chat.id).source).toBe("interrupted_resume")
    } finally { await cleanup() }
  })

  test("respects the per-turn resume attempt cap (default 3)", async () => {
    const { store, coordinator, cleanup } = await harness()
    try {
      const project = await store.openProject("/tmp/p")
      const chat = await store.createChat(project.id)
      await store.setChatProvider(chat.id, "claude")
      await store.appendMessage(chat.id, mkEntry("user_prompt", "do it"))
      // Simulate 3 prior resume attempts with no completion in between.
      await store.recordTurnResumeAttempted(chat.id)
      await store.recordTurnResumeAttempted(chat.id)
      await store.recordTurnResumeAttempted(chat.id)

      const armed = await coordinator.reconcileInterruptedTurns()
      expect(armed).toBe(0)
    } finally { await cleanup() }
  })

  test("does not double-arm when a live schedule already exists (rehydrate case)", async () => {
    const { store, coordinator, cleanup } = await harness()
    try {
      const project = await store.openProject("/tmp/p")
      const chat = await store.createChat(project.id)
      await store.setChatProvider(chat.id, "claude")
      await store.appendMessage(chat.id, mkEntry("user_prompt", "do it"))

      const first = await coordinator.reconcileInterruptedTurns()
      expect(first).toBe(1)
      // Second pass (same boot / re-entry) must not arm a duplicate.
      const second = await coordinator.reconcileInterruptedTurns()
      expect(second).toBe(0)
    } finally { await cleanup() }
  })
})
