import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { AgentCoordinator } from "../agent"
import { EventStore } from "../event-store"
import { AsyncEventQueue } from "../test-helpers/async-event-queue"
import { waitFor } from "../test-helpers/wait-for"
import type { AutoContinueEvent } from "./events"
import { ClaudeLimitDetector, CodexLimitDetector } from "./limit-detector"
import { ScheduleManager, type Clock } from "./schedule-manager"


class FakeClock implements Clock {
  private currentTime: number
  private readonly timers = new Map<number, { fn: () => void; fireAt: number }>()
  private nextId = 1

  constructor(startAt: number) {
    this.currentTime = startAt
  }

  now(): number {
    return this.currentTime
  }

  setTimeout(fn: () => void, delayMs: number): number {
    const id = this.nextId++
    this.timers.set(id, { fn, fireAt: this.currentTime + delayMs })
    return id
  }

  clearTimeout(id: number): void {
    this.timers.delete(id)
  }

  advance(ms: number): void {
    this.currentTime += ms
    for (const [id, timer] of [...this.timers.entries()]) {
      if (timer.fireAt <= this.currentTime) {
        this.timers.delete(id)
        timer.fn()
      }
    }
  }
}


function makeRateLimitError(resetAt: number): Error & { status: number; headers: Record<string, string> } {
  const err = new Error(
    JSON.stringify({ type: "error", error: { type: "rate_limit_error" } })
  ) as Error & { status: number; headers: Record<string, string> }
  err.status = 429
  err.headers = {
    "anthropic-ratelimit-unified-reset": new Date(resetAt).toISOString(),
    "x-anthropic-timezone": "Asia/Saigon",
  }
  return err
}


describe("auto-continue end-to-end", () => {
  test("rate limit → proposed → accept → timer fires → auto_continue_fired, no 'continue' user_prompt bubble", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kanna-ac-e2e-"))
    let scheduleManager: ScheduleManager | undefined
    try {
      const store = new EventStore(dir)
      await store.initialize()
      const project = await store.openProject("/tmp/e2e-proj")
      const chat = await store.createChat(project.id)
      const chatId = chat.id

      const clockStart = Date.now()
      const clock = new FakeClock(clockStart)
      const resetAtMs = clockStart + 10_000

      let coordinator!: AgentCoordinator
      scheduleManager = new ScheduleManager({
        clock,
        fire: async (cid, sid) => {
          await coordinator.fireAutoContinue(cid, sid)
        },
      })

      const events = new AsyncEventQueue<never>()

      coordinator = new AgentCoordinator({
        store,
        onStateChange: () => {},
        claudeLimitDetector: new ClaudeLimitDetector(),
        codexLimitDetector: new CodexLimitDetector(),
        scheduleManager,
        getAutoResumePreference: () => false,
        startClaudeSession: async () => ({
          provider: "claude" as const,
          stream: events,
          getAccountInfo: async () => null,
          interrupt: async () => {},
          close: () => {},
          closed: Promise.resolve(),
          setModel: async () => {},
          setPermissionMode: async () => {},
          getSupportedCommands: async () => [],
          sendPrompt: async () => {
            events.throw(makeRateLimitError(resetAtMs))
          },
        }),
      })

      await coordinator.send({
        type: "chat.send",
        chatId,
        content: "hello",
        model: "claude-opus-4-5",
        provider: "claude",
        autoResumeOnRateLimit: false,
      })

      await waitFor(() => store.getAutoContinueEvents(chatId).length >= 1)

      const acEventsAfterPropose = store.getAutoContinueEvents(chatId)
      expect(acEventsAfterPropose).toHaveLength(1)
      expect(acEventsAfterPropose[0].kind).toBe("auto_continue_proposed")
      const proposed = acEventsAfterPropose[0] as Extract<AutoContinueEvent, { kind: "auto_continue_proposed" }>
      expect(proposed.tz).toBe("Asia/Saigon")
      const { scheduleId } = proposed

      const scheduledAt = clock.now() + 10_000
      await coordinator.acceptAutoContinue(chatId, scheduleId, scheduledAt)

      const acEventsAfterAccept = store.getAutoContinueEvents(chatId)
      expect(acEventsAfterAccept).toHaveLength(2)
      const accepted = acEventsAfterAccept[1] as Extract<AutoContinueEvent, { kind: "auto_continue_accepted" }>
      expect(accepted.kind).toBe("auto_continue_accepted")
      expect(accepted.scheduleId).toBe(scheduleId)
      expect(accepted.source).toBe("user")
      expect(accepted.scheduledAt).toBe(scheduledAt)

      clock.advance(10_100)

      await waitFor(() =>
        store.getAutoContinueEvents(chatId).some((e) => e.kind === "auto_continue_fired")
      )

      const acEventsAfterFire = store.getAutoContinueEvents(chatId)
      const firedEvent = acEventsAfterFire.find(
        (e) => e.kind === "auto_continue_fired"
      ) as Extract<AutoContinueEvent, { kind: "auto_continue_fired" }> | undefined
      expect(firedEvent).toBeDefined()
      expect(firedEvent!.scheduleId).toBe(scheduleId)

      const messages = store.getMessages(chatId)
      const continuePrompts = messages.filter(
        (m) => m.kind === "user_prompt" && m.content === "continue"
      )
      expect(continuePrompts).toHaveLength(0)
    } finally {
      scheduleManager?.shutdown()
      await rm(dir, { recursive: true, force: true })
    }
  })
})
