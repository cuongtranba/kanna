import { describe, expect, test } from "bun:test"
import { compactCronRunEvents } from "../cron/compact"
import { compactAutoContinueEvents } from "./compact"
import { compactLoopWakeEvents } from "./compact-loop-wakes"
import type { ChatAutomationEvent } from "./events"

const VERSION = 3 as const
const CHAT = "chat-1"

function loopArmed(scheduleId: string, timestamp: number): ChatAutomationEvent {
  return {
    v: VERSION,
    kind: "loop_armed",
    timestamp,
    chatId: CHAT,
    scheduleId,
    subagentId: "sub-1",
    prompt: "loop prompt",
    verifyCommand: "bun test",
    workdirAbs: "/tmp",
    trackingFileRel: "PROGRESS.md",
  }
}

function cronSkipped(index: number): ChatAutomationEvent {
  return {
    v: VERSION,
    kind: "cron_run_skipped",
    timestamp: 100 + index,
    chatId: CHAT,
    scheduleId: "job-1",
    reason: "chat_busy",
  }
}

describe("compactAutoContinueEvents", () => {
  test("applies cron-run retention first and loop-wake retention to its result", () => {
    const log: ChatAutomationEvent[] = [
      loopArmed("la-1", 1),
      loopArmed("la-2", 2),
      ...Array.from({ length: 80 }, (_unused, index) => cronSkipped(index)),
    ]

    expect(compactAutoContinueEvents([...log])).toEqual(compactLoopWakeEvents(compactCronRunEvents([...log])))
  })

  test("leaves a short log untouched", () => {
    const log = [loopArmed("la-1", 1)]

    expect(compactAutoContinueEvents([...log])).toEqual(log)
  })
})
