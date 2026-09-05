import { describe, expect, test } from "bun:test"
import type { Clock } from "../auto-continue/schedule-manager"
import { AUTO_CONTINUE_EVENT_VERSION, type AutoContinueEvent } from "../auto-continue/events"
import { CronScheduler } from "./scheduler"
import { compactCronRunEvents } from "./compact"
import { parseSchedule } from "../../shared/cron/parse-schedule"
import type { CronSchedule } from "../../shared/cron/types"

class FakeClock implements Clock {
  private current = 0
  private scheduled: Array<{ fireAt: number; fn: () => void; id: number }> = []
  private nextId = 1

  now() {
    return this.current
  }

  setTimeout(fn: () => void, delayMs: number): number {
    const id = this.nextId
    this.nextId += 1
    this.scheduled.push({ fireAt: this.current + Math.max(0, delayMs), fn, id })
    return id
  }

  clearTimeout(id: number): void {
    this.scheduled = this.scheduled.filter((entry) => entry.id !== id)
  }

  advance(ms: number) {
    this.current += ms
    for (;;) {
      const due = this.scheduled.filter((entry) => entry.fireAt <= this.current).sort((a, b) => a.fireAt - b.fireAt)
      if (due.length === 0) return
      this.scheduled = this.scheduled.filter((entry) => entry.fireAt > this.current)
      for (const { fn } of due) fn()
    }
  }

  pending() {
    return this.scheduled.length
  }
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

function scheduleOf(text: string): CronSchedule {
  const parsed = parseSchedule(text)
  if (!parsed.ok) throw new Error(parsed.message)
  return parsed.schedule
}

function armedEvent(overrides: Partial<Extract<AutoContinueEvent, { kind: "cron_armed" }>> = {}): AutoContinueEvent {
  return {
    v: AUTO_CONTINUE_EVENT_VERSION,
    kind: "cron_armed",
    chatId: "c1",
    scheduleId: "j1",
    timestamp: 0,
    instruction: "check ci",
    mode: "inline",
    scheduleText: "every 5m",
    schedule: scheduleOf("every 5m"),
    ...overrides,
  }
}

function makeScheduler(clock: FakeClock) {
  const fires: Array<{ chatId: string; jobId: string; at: number }> = []
  const scheduler = new CronScheduler({
    clock,
    fire: async (chatId, jobId) => {
      fires.push({ chatId, jobId, at: clock.now() })
    },
  })
  return { scheduler, fires }
}

describe("CronScheduler", () => {
  test("fires on the interval grid and re-arms after each fire", async () => {
    const clock = new FakeClock()
    const { scheduler, fires } = makeScheduler(clock)
    scheduler.onEvent(armedEvent())

    expect(scheduler.nextFireFor("c1", "j1")).toBe(300_000)
    clock.advance(300_000)
    await settle()
    expect(fires).toEqual([{ chatId: "c1", jobId: "j1", at: 300_000 }])

    expect(scheduler.nextFireFor("c1", "j1")).toBe(600_000)
    clock.advance(300_000)
    await settle()
    expect(fires).toHaveLength(2)
    scheduler.shutdown()
  })

  test("long horizons are chunked and recomputed, never one giant timeout", async () => {
    const clock = new FakeClock()
    const { scheduler, fires } = makeScheduler(clock)
    scheduler.onEvent(armedEvent({ scheduleText: "every 24h", schedule: scheduleOf("every 24h") }))

    clock.advance(6 * 3_600_000)
    await settle()
    expect(fires).toHaveLength(0)
    expect(clock.pending()).toBe(1)

    clock.advance(18 * 3_600_000)
    await settle()
    expect(fires).toHaveLength(1)
    scheduler.shutdown()
  })

  test("pause clears the timer, resume re-arms from now", async () => {
    const clock = new FakeClock()
    const { scheduler, fires } = makeScheduler(clock)
    scheduler.onEvent(armedEvent())
    scheduler.onEvent({ v: AUTO_CONTINUE_EVENT_VERSION, kind: "cron_paused", chatId: "c1", scheduleId: "j1", timestamp: 100 })

    expect(clock.pending()).toBe(0)
    clock.advance(600_000)
    await settle()
    expect(fires).toHaveLength(0)

    scheduler.onEvent({ v: AUTO_CONTINUE_EVENT_VERSION, kind: "cron_resumed", chatId: "c1", scheduleId: "j1", timestamp: 600_000 })
    expect(scheduler.nextFireFor("c1", "j1")).toBe(900_000)
    clock.advance(300_000)
    await settle()
    expect(fires).toHaveLength(1)
    scheduler.shutdown()
  })

  test("disarm and clearChat cancel timers", () => {
    const clock = new FakeClock()
    const { scheduler } = makeScheduler(clock)
    scheduler.onEvent(armedEvent())
    scheduler.onEvent({ v: AUTO_CONTINUE_EVENT_VERSION, kind: "cron_disarmed", reason: "user", chatId: "c1", scheduleId: "j1", timestamp: 100 })
    expect(clock.pending()).toBe(0)

    scheduler.onEvent(armedEvent({ scheduleId: "j2" }))
    scheduler.onEvent(armedEvent({ scheduleId: "j3", chatId: "c2" }))
    expect(clock.pending()).toBe(2)
    scheduler.clearChat("c1")
    expect(clock.pending()).toBe(1)
    scheduler.shutdown()
    expect(clock.pending()).toBe(0)
  })

  test("a fire error is contained and the job still re-arms", async () => {
    const clock = new FakeClock()
    const errors: Error[] = []
    let calls = 0
    const scheduler = new CronScheduler({
      clock,
      fire: async () => {
        calls += 1
        throw new Error("boom")
      },
      onError: (error) => errors.push(error),
    })
    scheduler.onEvent(armedEvent())
    clock.advance(300_000)
    await settle()
    expect(calls).toBe(1)
    expect(errors).toHaveLength(1)
    expect(scheduler.nextFireFor("c1", "j1")).toBe(600_000)
    scheduler.shutdown()
  })

  test("rehydrate skips missed fires, reports the count, and arms the future slot", async () => {
    const clock = new FakeClock()
    clock.advance(2_000_000)
    const { scheduler, fires } = makeScheduler(clock)

    const events: AutoContinueEvent[] = [
      armedEvent(),
      { v: AUTO_CONTINUE_EVENT_VERSION, kind: "cron_run_started", chatId: "c1", scheduleId: "j1", timestamp: 300_000, runId: "r1" },
      { v: AUTO_CONTINUE_EVENT_VERSION, kind: "cron_run_outcome", chatId: "c1", scheduleId: "j1", timestamp: 310_000, runId: "r1", ok: true },
    ]
    const missed = scheduler.rehydrate(events)

    expect(missed).toEqual([{ chatId: "c1", jobId: "j1", missedCount: 5 }])
    expect(fires).toHaveLength(0)
    expect(scheduler.nextFireFor("c1", "j1")).toBe(2_100_000)

    clock.advance(100_000)
    await settle()
    expect(fires).toEqual([{ chatId: "c1", jobId: "j1", at: 2_100_000 }])
    scheduler.shutdown()
  })

  test("rehydrate reports the same missed count over a compacted log", () => {
    const full: AutoContinueEvent[] = [armedEvent()]
    for (let i = 0; i < 120; i += 1) {
      const at = 300_000 + i * 1000
      full.push(
        { v: AUTO_CONTINUE_EVENT_VERSION, kind: "cron_run_started", chatId: "c1", scheduleId: "j1", timestamp: at, runId: `r${i}` },
        { v: AUTO_CONTINUE_EVENT_VERSION, kind: "cron_run_outcome", chatId: "c1", scheduleId: "j1", timestamp: at + 1, runId: `r${i}`, ok: true },
      )
    }
    const compacted = compactCronRunEvents([...full])
    expect(compacted.length).toBeLessThan(full.length)

    const fullClock = new FakeClock()
    fullClock.advance(2_000_000)
    const fullScheduler = makeScheduler(fullClock).scheduler
    const compactedClock = new FakeClock()
    compactedClock.advance(2_000_000)
    const compactedScheduler = makeScheduler(compactedClock).scheduler

    expect(compactedScheduler.rehydrate(compacted)).toEqual(fullScheduler.rehydrate(full))

    fullScheduler.shutdown()
    compactedScheduler.shutdown()
  })

  test("rehydrate does not arm paused or disarmed jobs", () => {
    const clock = new FakeClock()
    clock.advance(1_000_000)
    const { scheduler } = makeScheduler(clock)
    const missed = scheduler.rehydrate([
      armedEvent(),
      { v: AUTO_CONTINUE_EVENT_VERSION, kind: "cron_paused", chatId: "c1", scheduleId: "j1", timestamp: 100 },
      armedEvent({ scheduleId: "j2" }),
      { v: AUTO_CONTINUE_EVENT_VERSION, kind: "cron_disarmed", reason: "user", chatId: "c1", scheduleId: "j2", timestamp: 200 },
    ])
    expect(missed).toEqual([])
    expect(clock.pending()).toBe(0)
    scheduler.shutdown()
  })

  test("a job disarmed by its own fire does not re-arm", async () => {
    const clock = new FakeClock()
    const fired: string[] = []
    const scheduler = new CronScheduler({
      clock,
      fire: async (chatId, jobId) => {
        fired.push(jobId)
        scheduler.onEvent({ v: AUTO_CONTINUE_EVENT_VERSION, kind: "cron_disarmed", reason: "user", chatId, scheduleId: jobId, timestamp: clock.now() })
      },
    })
    scheduler.onEvent(armedEvent())
    clock.advance(300_000)
    await settle()
    expect(fired).toEqual(["j1"])
    expect(clock.pending()).toBe(0)
    await scheduler.shutdown()
  })

  test("shutdown drains an in-flight fire before returning", async () => {
    const clock = new FakeClock()
    let resolveFireFn!: () => void
    const fireBarrier = new Promise<void>((resolve) => {
      resolveFireFn = resolve
    })
    const fired: string[] = []
    const scheduler = new CronScheduler({
      clock,
      fire: async (_chatId, jobId) => {
        await fireBarrier
        fired.push(jobId)
      },
      shutdownDrainTimeoutMs: 10_000,
    })
    scheduler.onEvent(armedEvent())
    clock.advance(300_000)
    const shutdownPromise = scheduler.shutdown()
    expect(fired).toEqual([])
    resolveFireFn()
    await shutdownPromise
    expect(fired).toEqual(["j1"])
  }, 15_000)

  test("shutdown stops new fires and resolves immediately when none in flight", async () => {
    const clock = new FakeClock()
    const fires: string[] = []
    const scheduler = new CronScheduler({
      clock,
      fire: async (_chatId, jobId) => {
        fires.push(jobId)
      },
    })
    scheduler.onEvent(armedEvent())
    await scheduler.shutdown()
    expect(clock.pending()).toBe(0)
    clock.advance(300_000)
    await settle()
    expect(fires).toHaveLength(0)
  })

  test("a timer callback that races shutdown does not start a new fire", async () => {
    const clock = new FakeClock()
    const fires: string[] = []
    let resolveFireFn!: () => void
    const fireBarrier = new Promise<void>((resolve) => {
      resolveFireFn = resolve
    })
    const scheduler = new CronScheduler({
      clock,
      fire: async (_chatId, jobId) => {
        fires.push(jobId)
        await fireBarrier
      },
      shutdownDrainTimeoutMs: 10_000,
    })
    scheduler.onEvent(armedEvent())
    clock.advance(300_000)
    const shutdownPromise = scheduler.shutdown()
    resolveFireFn()
    await shutdownPromise
    expect(fires).toEqual(["j1"])
    expect(clock.pending()).toBe(0)
  }, 15_000)
})
