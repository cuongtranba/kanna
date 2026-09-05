import { describe, expect, test } from "bun:test"
import { CronSkipCoalescer, SKIP_FLUSH_WINDOW_MS } from "./skip-coalescer"

const CHAT = "chat-1"
const JOB = "cron-abc"

describe("CronSkipCoalescer", () => {
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
    expect(coalescer.record(CHAT, JOB, "chat_busy", SKIP_FLUSH_WINDOW_MS + 5_000)).toBeNull()
  })

  test("a run flushes the tail once the window has passed", () => {
    const coalescer = new CronSkipCoalescer()
    coalescer.record(CHAT, JOB, "chat_busy", 0)
    coalescer.record(CHAT, JOB, "chat_busy", 5_000)
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

  test("pending skip count is process-local and is silently dropped on process exit", () => {
    const coalescer = new CronSkipCoalescer()
    coalescer.record(CHAT, JOB, "chat_busy", 0)
    coalescer.record(CHAT, JOB, "chat_busy", 1_000)
    coalescer.record(CHAT, JOB, "chat_busy", 2_000)
    const nextBootCoalescer = new CronSkipCoalescer()
    expect(nextBootCoalescer.flushPending(CHAT, JOB, 0)).toBeNull()
    expect(nextBootCoalescer.record(CHAT, JOB, "chat_busy", 0)).toEqual({
      reason: "chat_busy",
      count: 1,
    })
  })
})
