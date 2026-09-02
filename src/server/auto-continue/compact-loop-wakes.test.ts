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

  test("keeps the sole loop_armed when there is no successor", () => {
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

function loopDisarmed(scheduleId = "ld-1"): AutoContinueEvent {
  return {
    v: AUTO_CONTINUE_EVENT_VERSION,
    kind: "loop_disarmed",
    timestamp: 4,
    chatId: CHAT,
    scheduleId,
    reason: "goal_met",
  }
}

describe("compactLoopWakeEvents — superseded loop_armed trimming", () => {
  test("superseded loop_armed dropped when a later loop_armed follows", () => {
    const log: AutoContinueEvent[] = [
      loopArmed("la-1"),
      loopRunOutcome(true, "lo-1"),
      loopArmed("la-2"),
    ]
    const compacted = compactLoopWakeEvents([...log])
    expect(compacted.filter((e) => e.kind === "loop_armed")).toHaveLength(1)
    expect(compacted.find((e) => e.kind === "loop_armed")?.scheduleId).toBe("la-2")
  })

  test("loop_run_outcome events before the superseded arm are also dropped", () => {
    const log: AutoContinueEvent[] = [
      loopArmed("la-1"),
      loopRunOutcome(true, "lo-1"),
      loopRunOutcome(false, "lo-2"),
      loopArmed("la-2"),
      loopRunOutcome(true, "lo-3"),
    ]
    const compacted = compactLoopWakeEvents([...log])
    expect(compacted.filter((e) => e.kind === "loop_run_outcome")).toHaveLength(1)
    expect(compacted.find((e) => e.kind === "loop_run_outcome")?.scheduleId).toBe("lo-3")
  })

  // The last `loop_armed` is RETAINED as a tombstone once disarmed. It is the
  // sole carrier of subagentId / prompt / verifyCommand / workdirAbs /
  // trackingFileRel, and dropping it made a disarm irreversible: `resume_loop`
  // had nothing to re-arm from, and the un-armed delivery prompt had no way to
  // name the loop's real tracking file. One retained event per chat is bounded;
  // the waste this module exists to reclaim is the per-WAKE re-embedding.
  test("retains the last loop_armed as a tombstone when the loop is disarmed", () => {
    const log: AutoContinueEvent[] = [
      loopArmed("la-1"),
      loopRunOutcome(true, "lo-1"),
      loopDisarmed("ld-1"),
    ]
    const compacted = compactLoopWakeEvents([...log])
    expect(compacted.filter((e) => e.kind === "loop_armed")).toHaveLength(1)
    expect(compacted.find((e) => e.kind === "loop_armed")?.scheduleId).toBe("la-1")
    // The disarm half must survive too, or the tombstone replays as ARMED.
    expect(compacted.filter((e) => e.kind === "loop_disarmed")).toHaveLength(1)
    expect(compacted.some((e) => e.kind === "loop_run_outcome")).toBe(false)
  })

  test("keeps only the newest tombstone across several arm/disarm cycles", () => {
    const log: AutoContinueEvent[] = [
      loopArmed("la-1"),
      loopDisarmed("ld-1"),
      loopArmed("la-2"),
      loopRunOutcome(false, "lo-1"),
      loopDisarmed("ld-2"),
    ]
    const compacted = compactLoopWakeEvents([...log])
    expect(compacted.filter((e) => e.kind === "loop_armed")).toHaveLength(1)
    expect(compacted.find((e) => e.kind === "loop_armed")?.scheduleId).toBe("la-2")
  })

  test("non-loop events preserved when loop is disarmed", () => {
    const log: AutoContinueEvent[] = [
      loopArmed("la-1"),
      accepted("s-1"),
      fired("s-1"),
      loopDisarmed("ld-1"),
      nonLoopAccepted("s-user"),
    ]
    const compacted = compactLoopWakeEvents([...log])
    expect(compacted.some((e) => e.kind === "auto_continue_accepted" && e.scheduleId === "s-user")).toBe(true)
  })

  test("deriveLoopState output unchanged after superseded-arm compaction", () => {
    const log: AutoContinueEvent[] = [
      loopArmed("la-1"),
      loopRunOutcome(false, "lo-1"),
      loopArmed("la-2"),
      loopRunOutcome(false, "lo-2"),
      loopRunOutcome(false, "lo-3"),
      accepted("s-1"),
    ]
    const compacted = compactLoopWakeEvents([...log])
    expect(deriveLoopState(compacted, CHAT)).toEqual(deriveLoopState(log, CHAT))
  })

  test("deriveLoopState returns null after disarmed-loop compaction", () => {
    const log: AutoContinueEvent[] = [
      loopArmed("la-1"),
      loopRunOutcome(true, "lo-1"),
      loopDisarmed("ld-1"),
    ]
    const compacted = compactLoopWakeEvents([...log])
    expect(deriveLoopState(compacted, CHAT)).toBeNull()
    expect(deriveLoopState(log, CHAT)).toBeNull()
  })

  test("deriveChatSchedules output unchanged after superseded-arm compaction", () => {
    const log: AutoContinueEvent[] = [
      loopArmed("la-1"),
      loopArmed("la-2"),
      accepted("s-pending"),
    ]
    const compacted = compactLoopWakeEvents([...log])
    expect(deriveChatSchedules(compacted, CHAT)).toEqual(deriveChatSchedules(log, CHAT))
  })

  test("returns input by reference when only one loop_armed and no disarm", () => {
    const log: AutoContinueEvent[] = [loopArmed("la-1"), accepted("s-1")]
    const compacted = compactLoopWakeEvents(log)
    expect(compacted).toBe(log)
  })
})

describe("compactLoopWakeEvents — live-arm outcome cap", () => {
  test("outcomes beyond cap are dropped (oldest first)", () => {
    // 10 iterations: only the last 3 outcomes should survive
    const outcomes = Array.from({ length: 10 }, (_, i) =>
      loopRunOutcome(true, `lo-${i + 1}`)
    )
    const log: AutoContinueEvent[] = [loopArmed("la-1"), ...outcomes]
    const compacted = compactLoopWakeEvents([...log])
    const kept = compacted.filter((e) => e.kind === "loop_run_outcome")
    expect(kept).toHaveLength(3)
    expect(kept[0]?.scheduleId).toBe("lo-8")
    expect(kept[1]?.scheduleId).toBe("lo-9")
    expect(kept[2]?.scheduleId).toBe("lo-10")
  })

  test("deriveLoopState consecutiveFailures unchanged after cap", () => {
    // Many ok outcomes followed by 2 failures: cap should not change the count
    const outcomes = [
      ...Array.from({ length: 20 }, (_, i) => loopRunOutcome(true, `ok-${i}`)),
      loopRunOutcome(false, "fail-1"),
      loopRunOutcome(false, "fail-2"),
    ]
    const log: AutoContinueEvent[] = [loopArmed("la-1"), ...outcomes]
    const compacted = compactLoopWakeEvents([...log])
    expect(deriveLoopState(compacted, CHAT)?.consecutiveFailures).toBe(
      deriveLoopState(log, CHAT)?.consecutiveFailures,
    )
    expect(deriveLoopState(compacted, CHAT)?.consecutiveFailures).toBe(2)
  })

  test("exactly-cap outcomes unchanged by reference", () => {
    const log: AutoContinueEvent[] = [
      loopArmed("la-1"),
      loopRunOutcome(true, "lo-1"),
      loopRunOutcome(true, "lo-2"),
      loopRunOutcome(true, "lo-3"),
    ]
    const compacted = compactLoopWakeEvents(log)
    expect(compacted).toBe(log)
  })

  test("cap does not apply to a disarmed loop (all outcomes already dropped)", () => {
    const outcomes = Array.from({ length: 10 }, (_, i) =>
      loopRunOutcome(true, `lo-${i + 1}`)
    )
    const log: AutoContinueEvent[] = [loopArmed("la-1"), ...outcomes, loopDisarmed("ld-1")]
    const compacted = compactLoopWakeEvents([...log])
    expect(compacted.filter((e) => e.kind === "loop_run_outcome")).toHaveLength(0)
  })
})
