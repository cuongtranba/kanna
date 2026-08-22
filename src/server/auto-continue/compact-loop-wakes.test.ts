import { describe, expect, test } from "bun:test"
import { compactLoopWakeEvents } from "./compact-loop-wakes"
import { deriveChatSchedules, deriveLoopState } from "./read-model"
import type { AutoContinueEvent } from "./events"

const AUTO_CONTINUE_EVENT_VERSION = 3 as const
const CHAT = "chat-1"
const SUBAGENT = "sub-1"
const LOOP_PROMPT = "L".repeat(3000)

function loopArmed(scheduleId = "la-1"): AutoContinueEvent {
  return {
    v: AUTO_CONTINUE_EVENT_VERSION,
    kind: "loop_armed",
    timestamp: 1,
    chatId: CHAT,
    scheduleId,
    subagentId: SUBAGENT,
    prompt: LOOP_PROMPT,
    verifyCommand: "bun test",
    workdirAbs: "/tmp",
    trackingFileRel: "PROGRESS.md",
  }
}

function loopRunOutcome(ok: boolean, scheduleId = "lo-1"): AutoContinueEvent {
  return {
    v: AUTO_CONTINUE_EVENT_VERSION,
    kind: "loop_run_outcome",
    timestamp: Date.now(),
    chatId: CHAT,
    scheduleId,
    ok,
  }
}

function accepted(scheduleId: string, prompt = LOOP_PROMPT): AutoContinueEvent {
  return {
    v: AUTO_CONTINUE_EVENT_VERSION,
    kind: "auto_continue_accepted",
    timestamp: 2,
    chatId: CHAT,
    scheduleId,
    scheduledAt: 2,
    tz: "system",
    source: "subagent_background",
    resetAt: 2,
    detectedAt: 2,
    prompt,
  }
}

function fired(scheduleId: string): AutoContinueEvent {
  return {
    v: AUTO_CONTINUE_EVENT_VERSION,
    kind: "auto_continue_fired",
    timestamp: 3,
    chatId: CHAT,
    scheduleId,
  }
}

function cancelled(scheduleId: string): AutoContinueEvent {
  return {
    v: AUTO_CONTINUE_EVENT_VERSION,
    kind: "auto_continue_cancelled",
    timestamp: 3,
    chatId: CHAT,
    scheduleId,
    reason: "user",
  }
}

function nonLoopAccepted(scheduleId: string): AutoContinueEvent {
  return {
    v: AUTO_CONTINUE_EVENT_VERSION,
    kind: "auto_continue_accepted",
    timestamp: 2,
    chatId: CHAT,
    scheduleId,
    scheduledAt: 2,
    tz: "system",
    source: "user",
    resetAt: 2,
    detectedAt: 2,
  }
}

describe("compactLoopWakeEvents — parity with both readers", () => {
  test("fired loop-wake pairs dropped — loop state unchanged", () => {
    const log: AutoContinueEvent[] = [
      loopArmed(),
      loopRunOutcome(true, "r-1"),
      accepted("s-1"),
      fired("s-1"),
      loopRunOutcome(true, "r-2"),
      accepted("s-2"),
      fired("s-2"),
      accepted("s-3"),
    ]
    const compacted = compactLoopWakeEvents([...log])
    expect(deriveLoopState(compacted, CHAT)).toEqual(deriveLoopState(log, CHAT))
  })

  test("fired loop-wake pairs dropped — live schedule unchanged", () => {
    const log: AutoContinueEvent[] = [
      loopArmed(),
      accepted("s-1"),
      fired("s-1"),
      accepted("s-2"),
    ]
    const compacted = compactLoopWakeEvents([...log])
    expect(deriveChatSchedules(compacted, CHAT).liveScheduleId).toBe(
      deriveChatSchedules(log, CHAT).liveScheduleId,
    )
  })

  test("live schedule entry identical after compaction", () => {
    const log: AutoContinueEvent[] = [
      loopArmed(),
      accepted("s-1"),
      fired("s-1"),
      accepted("s-2"),
    ]
    const compacted = compactLoopWakeEvents([...log])
    const liveId = deriveChatSchedules(log, CHAT).liveScheduleId
    if (liveId) {
      expect(deriveChatSchedules(compacted, CHAT).schedules[liveId]).toEqual(
        deriveChatSchedules(log, CHAT).schedules[liveId],
      )
    }
  })
})

describe("compactLoopWakeEvents — invariants", () => {
  test("returns input by reference when nothing to drop", () => {
    const log: AutoContinueEvent[] = [loopArmed(), accepted("s-1")]
    const compacted = compactLoopWakeEvents(log)
    expect(compacted).toBe(log)
  })

  test("drops accepted+fired pair", () => {
    const log: AutoContinueEvent[] = [
      loopArmed(),
      accepted("s-1"),
      fired("s-1"),
    ]
    const compacted = compactLoopWakeEvents([...log])
    expect(compacted.some((e) => e.kind === "auto_continue_accepted" && e.scheduleId === "s-1")).toBe(false)
    expect(compacted.some((e) => e.kind === "auto_continue_fired" && e.scheduleId === "s-1")).toBe(false)
  })

  test("drops accepted+cancelled pair", () => {
    const log: AutoContinueEvent[] = [
      loopArmed(),
      accepted("s-1"),
      cancelled("s-1"),
    ]
    const compacted = compactLoopWakeEvents([...log])
    expect(compacted.some((e) => e.kind === "auto_continue_accepted" && e.scheduleId === "s-1")).toBe(false)
    expect(compacted.some((e) => e.kind === "auto_continue_cancelled" && e.scheduleId === "s-1")).toBe(false)
  })

  test("never drops a pending (unfired) accepted event", () => {
    const log: AutoContinueEvent[] = [loopArmed(), accepted("s-1")]
    const compacted = compactLoopWakeEvents([...log])
    expect(compacted.some((e) => e.kind === "auto_continue_accepted" && e.scheduleId === "s-1")).toBe(true)
  })

  test("never drops loop_armed, loop_disarmed, loop_run_outcome events", () => {
    const log: AutoContinueEvent[] = [
      loopArmed("la-1"),
      loopRunOutcome(true, "lo-1"),
      loopRunOutcome(false, "lo-2"),
      accepted("s-1"),
      fired("s-1"),
    ]
    const compacted = compactLoopWakeEvents([...log])
    expect(compacted.some((e) => e.kind === "loop_armed")).toBe(true)
    expect(compacted.filter((e) => e.kind === "loop_run_outcome")).toHaveLength(2)
  })

  test("never drops non-subagent-background accepted events", () => {
    const log: AutoContinueEvent[] = [
      nonLoopAccepted("s-user"),
      fired("s-user"),
    ]
    const compacted = compactLoopWakeEvents([...log])
    expect(compacted.some((e) => e.kind === "auto_continue_accepted" && e.scheduleId === "s-user")).toBe(true)
  })

  test("drops multiple fired pairs, keeps one pending", () => {
    const log: AutoContinueEvent[] = [
      loopArmed(),
      accepted("s-1"),
      fired("s-1"),
      accepted("s-2"),
      fired("s-2"),
      accepted("s-3"),
      fired("s-3"),
      accepted("s-pending"),
    ]
    const compacted = compactLoopWakeEvents([...log])
    const acceptedEvents = compacted.filter((e) => e.kind === "auto_continue_accepted")
    expect(acceptedEvents).toHaveLength(1)
    expect(acceptedEvents[0]?.scheduleId).toBe("s-pending")
  })

  test("reduces memory footprint by removing large prompt duplicates", () => {
    const log: AutoContinueEvent[] = [
      loopArmed(),
      ...Array.from({ length: 10 }, (_, i) => [
        accepted(`s-${i}`),
        fired(`s-${i}`),
      ]).flat(),
      accepted("s-pending"),
    ]
    const compacted = compactLoopWakeEvents([...log])
    const promptBytes = compacted.filter((e) => e.kind === "auto_continue_accepted")
      .reduce((sum, e) => sum + (e.prompt?.length ?? 0), 0)
    expect(promptBytes).toBe(LOOP_PROMPT.length)
  })
})
