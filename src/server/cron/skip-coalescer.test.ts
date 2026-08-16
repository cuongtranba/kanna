import { describe, expect, test } from "bun:test"
import { CronSkipCoalescer, SKIP_FLUSH_WINDOW_MS } from "./skip-coalescer"

const CHAT = "chat-1"
const JOB = "cron-abc"

describe("CronSkipCoalescer", () => {
  /**
   * The property a slow schedule depends on: a `@daily` job skipped at 09:00
   * says so at 09:00. Holding the first skip for a window would delay that
   * notice until the next tick — a day later.
   */
  test("the first skip after a quiet stretch is written immediately", () => {
    const coalescer = new CronSkipCoalescer()
    expect(coalescer.record(CHAT, JOB, "chat_busy", 1_000)).toEqual({
      reason: "chat_busy",
      count: 1,
    })
  })

  test("a sparse second skip is written immediately too", () => {
    const coalescer = new CronSkipCoalescer()
    coalescer.record(CHAT, JOB, "chat_busy", 0)
    // A day later — nothing to fold, so it leads its own window.
    expect(coalescer.record(CHAT, JOB, "chat_busy", 86_400_000)).toEqual({
      reason: "chat_busy",
      count: 1,
    })
  })

  test("skips inside the window are counted, not written", () => {
    const coalescer = new CronSkipCoalescer()
    coalescer.record(CHAT, JOB, "chat_busy", 0)
    expect(coalescer.record(CHAT, JOB, "chat_busy", 5_000)).toBeNull()
    expect(coalescer.record(CHAT, JOB, "chat_busy", 10_000)).toBeNull()
    expect(coalescer.record(CHAT, JOB, "chat_busy", 15_000)).toBeNull()
  })

  test("the first tick past the window reports everything it folded", () => {
    const coalescer = new CronSkipCoalescer()
    coalescer.record(CHAT, JOB, "chat_busy", 0)
    coalescer.record(CHAT, JOB, "chat_busy", 5_000)
    coalescer.record(CHAT, JOB, "chat_busy", 10_000)
    expect(coalescer.record(CHAT, JOB, "chat_busy", SKIP_FLUSH_WINDOW_MS)).toEqual({
      reason: "chat_busy",
      count: 3,
    })
    // The window restarts from the write, so no tick is ever reported twice.
    expect(coalescer.record(CHAT, JOB, "chat_busy", SKIP_FLUSH_WINDOW_MS + 5_000)).toBeNull()
  })

  test("a run flushes the tail once the window has passed", () => {
    const coalescer = new CronSkipCoalescer()
    coalescer.record(CHAT, JOB, "chat_busy", 0)
    coalescer.record(CHAT, JOB, "chat_busy", 5_000)
    // Still inside the window: the run does not earn its own card.
    expect(coalescer.flushPending(CHAT, JOB, 10_000)).toBeNull()
    expect(coalescer.flushPending(CHAT, JOB, SKIP_FLUSH_WINDOW_MS)).toEqual({
      reason: "chat_busy",
      count: 1,
    })
  })

  test("nothing to flush when the job never skipped", () => {
    expect(new CronSkipCoalescer().flushPending(CHAT, JOB, 1_000)).toBeNull()
  })

  test("a changed reason reports what the old one still owed, under the OLD reason", () => {
    const coalescer = new CronSkipCoalescer()
    coalescer.record(CHAT, JOB, "chat_busy", 0)
    coalescer.record(CHAT, JOB, "chat_busy", 5_000)
    coalescer.record(CHAT, JOB, "chat_busy", 10_000)
    expect(coalescer.record(CHAT, JOB, "previous_run_active", 15_000)).toEqual({
      reason: "chat_busy",
      count: 2,
    })
  })

  test("a changed reason with nothing owed is written under the new reason", () => {
    const coalescer = new CronSkipCoalescer()
    coalescer.record(CHAT, JOB, "chat_busy", 0)
    expect(coalescer.record(CHAT, JOB, "previous_run_active", 5_000)).toEqual({
      reason: "previous_run_active",
      count: 1,
    })
  })

  test("forget drops a job's state without reporting it", () => {
    const coalescer = new CronSkipCoalescer()
    coalescer.record(CHAT, JOB, "chat_busy", 0)
    coalescer.record(CHAT, JOB, "chat_busy", 5_000)
    coalescer.forget(CHAT, JOB)
    expect(coalescer.flushPending(CHAT, JOB, SKIP_FLUSH_WINDOW_MS)).toBeNull()
  })

  test("clearChat drops every job on that chat and no other", () => {
    const coalescer = new CronSkipCoalescer()
    coalescer.record(CHAT, JOB, "chat_busy", 0)
    coalescer.record("chat-2", JOB, "chat_busy", 0)
    coalescer.clearChat(CHAT)
    // A cleared job leads its own window again; an untouched one keeps folding.
    expect(coalescer.record(CHAT, JOB, "chat_busy", 5_000)).toEqual({
      reason: "chat_busy",
      count: 1,
    })
    expect(coalescer.record("chat-2", JOB, "chat_busy", 5_000)).toBeNull()
  })

  test("windows are per job — two jobs on one chat count separately", () => {
    const coalescer = new CronSkipCoalescer()
    coalescer.record(CHAT, JOB, "chat_busy", 0)
    coalescer.record(CHAT, JOB, "chat_busy", 1_000)
    expect(coalescer.record(CHAT, "cron-other", "chat_busy", 1_000)).toEqual({
      reason: "chat_busy",
      count: 1,
    })
    expect(coalescer.flushPending(CHAT, JOB, SKIP_FLUSH_WINDOW_MS)).toEqual({
      reason: "chat_busy",
      count: 1,
    })
    expect(coalescer.flushPending(CHAT, "cron-other", SKIP_FLUSH_WINDOW_MS)).toBeNull()
  })
})
