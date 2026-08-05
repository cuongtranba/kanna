import { describe, expect, test } from "bun:test"
import { deriveChatSchedules, deriveLoopState } from "./read-model"
import type { AutoContinueEvent } from "./events"

function armed(chatId: string, subagentId: string, prompt: string, at = 1_000): AutoContinueEvent {
  return { v: 3, kind: "loop_armed", timestamp: at, chatId, scheduleId: `arm-${at}`, subagentId, prompt }
}

function outcome(chatId: string, ok: boolean, at = 1_500, errorCode?: string): AutoContinueEvent {
  return { v: 3, kind: "loop_run_outcome", timestamp: at, chatId, scheduleId: `out-${at}`, ok, errorCode }
}

function disarmed(chatId: string, at = 2_000): AutoContinueEvent {
  return { v: 3, kind: "loop_disarmed", timestamp: at, chatId, scheduleId: `dis-${at}`, reason: "goal_met" }
}

describe("deriveLoopState", () => {
  test("no loop events → null", () => {
    expect(deriveLoopState([], "c1")).toBeNull()
  })

  test("loop_armed → armed state with subagentId + prompt", () => {
    const state = deriveLoopState([armed("c1", "sub-1", "LOOP PROMPT")], "c1")
    expect(state).toEqual({ subagentId: "sub-1", prompt: "LOOP PROMPT", armedAt: 1_000, consecutiveFailures: 0, verifyCommand: null, workdirAbs: null, trackingFileRel: null })
  })

  test("carries trackingFileRel through; legacy events without it replay as null", () => {
    // The label fallback reads `## Next chunk` from this file, so a loop armed
    // before the field existed must degrade to "no fallback", not crash.
    const withFile: AutoContinueEvent = {
      v: 3,
      kind: "loop_armed",
      timestamp: 1_000,
      chatId: "c1",
      scheduleId: "arm-1000",
      subagentId: "sub-1",
      prompt: "P",
      trackingFileRel: "PROGRESS-session-tabs.md",
      workdirAbs: "/tmp/wt",
      verifyCommand: "bun run lint",
    }
    expect(deriveLoopState([withFile], "c1")?.trackingFileRel).toBe("PROGRESS-session-tabs.md")
    expect(deriveLoopState([armed("c1", "sub-1", "P")], "c1")?.trackingFileRel).toBeNull()
  })

  test("loop_disarmed after loop_armed → null", () => {
    const state = deriveLoopState([armed("c1", "sub-1", "P"), disarmed("c1")], "c1")
    expect(state).toBeNull()
  })

  test("re-arm after disarm → latest armed wins", () => {
    const state = deriveLoopState([
      armed("c1", "sub-1", "P1", 1_000),
      disarmed("c1", 2_000),
      armed("c1", "sub-2", "P2", 3_000),
    ], "c1")
    expect(state).toEqual({ subagentId: "sub-2", prompt: "P2", armedAt: 3_000, consecutiveFailures: 0, verifyCommand: null, workdirAbs: null, trackingFileRel: null })
  })

  test("consecutive failures accumulate across iterations", () => {
    const state = deriveLoopState([
      armed("c1", "sub-1", "P"),
      outcome("c1", false, 1_100, "AUTH_REQUIRED"),
      outcome("c1", false, 1_200, "AUTH_REQUIRED"),
    ], "c1")
    expect(state?.consecutiveFailures).toBe(2)
  })

  test("a success resets the failure count", () => {
    const state = deriveLoopState([
      armed("c1", "sub-1", "P"),
      outcome("c1", false, 1_100),
      outcome("c1", true, 1_200),
    ], "c1")
    expect(state?.consecutiveFailures).toBe(0)
  })

  test("re-arming resets the failure count", () => {
    const state = deriveLoopState([
      armed("c1", "sub-1", "P1", 1_000),
      outcome("c1", false, 1_100),
      outcome("c1", false, 1_200),
      armed("c1", "sub-1", "P2", 1_300),
    ], "c1")
    expect(state?.consecutiveFailures).toBe(0)
  })

  test("outcomes for a disarmed loop are ignored, not counted", () => {
    const state = deriveLoopState([
      armed("c1", "sub-1", "P"),
      disarmed("c1", 1_050),
      outcome("c1", false, 1_100),
    ], "c1")
    expect(state).toBeNull()
  })

  test("armed state is per-chat", () => {
    const events = [armed("c1", "sub-1", "P1"), armed("c2", "sub-2", "P2")]
    expect(deriveLoopState(events, "c1")?.subagentId).toBe("sub-1")
    expect(deriveLoopState(events, "c2")?.subagentId).toBe("sub-2")
  })
})

function proposed(chatId: string, scheduleId: string, at = 1_000): AutoContinueEvent {
  return {
    v: 3,
    kind: "auto_continue_proposed",
    timestamp: at,
    chatId,
    scheduleId,
    detectedAt: at,
    resetAt: at + 10_000,
    tz: "Asia/Saigon",

  }
}

function accepted(chatId: string, scheduleId: string, at = 2_000, source: "user" | "auto_setting" = "user"): AutoContinueEvent {
  return {
    v: 3,
    kind: "auto_continue_accepted",
    timestamp: at,
    chatId,
    scheduleId,
    scheduledAt: at + 10_000,
    tz: "Asia/Saigon",
    source,
    resetAt: at + 10_000,
    detectedAt: at,
  }
}

describe("deriveChatSchedules", () => {
  test("empty event list returns empty map + null live", () => {
    const result = deriveChatSchedules([])
    expect(result.schedules).toEqual({})
    expect(result.liveScheduleId).toBeNull()
  })

  test("subagent_background accepted event carries prompt onto the schedule", () => {
    const wake: AutoContinueEvent = {
      v: 3,
      kind: "auto_continue_accepted",
      timestamp: 2_000,
      chatId: "c1",
      scheduleId: "s1",
      scheduledAt: 12_000,
      tz: "system",
      source: "subagent_background",
      resetAt: 12_000,
      detectedAt: 2_000,
      prompt: "Read PROGRESS.md, decide next action.",
    }
    const result = deriveChatSchedules([wake], "c1")
    expect(result.schedules.s1.state).toBe("scheduled")
    expect(result.schedules.s1.prompt).toBe("Read PROGRESS.md, decide next action.")
    expect(result.liveScheduleId).toBe("s1")
  })

  test("provider-failure accepted event leaves prompt undefined", () => {
    const result = deriveChatSchedules([accepted("c1", "s1")], "c1")
    expect(result.schedules.s1.prompt).toBeUndefined()
  })

  test("proposed event yields state=proposed with liveScheduleId set", () => {
    const result = deriveChatSchedules([proposed("c1", "s1")])
    expect(result.schedules.s1.state).toBe("proposed")
    expect(result.schedules.s1.scheduledAt).toBeNull()
    expect(result.liveScheduleId).toBe("s1")
  })

  test("accept after propose promotes to scheduled", () => {
    const result = deriveChatSchedules([proposed("c1", "s1"), accepted("c1", "s1")])
    expect(result.schedules.s1.state).toBe("scheduled")
    expect(result.schedules.s1.scheduledAt).toBe(12_000)
    expect(result.liveScheduleId).toBe("s1")
  })

  test("accept with source=auto_setting without prior proposed still produces scheduled", () => {
    const result = deriveChatSchedules([accepted("c1", "s1", 1_500, "auto_setting")])
    expect(result.schedules.s1.state).toBe("scheduled")
    expect(result.schedules.s1.resetAt).toBe(11_500)
    expect(result.liveScheduleId).toBe("s1")
  })

  test("cancelled schedule is terminal and not live", () => {
    const result = deriveChatSchedules([
      proposed("c1", "s1"),
      accepted("c1", "s1"),
      { v: 3, kind: "auto_continue_cancelled", timestamp: 3_000, chatId: "c1", scheduleId: "s1", reason: "user" },
    ])
    expect(result.schedules.s1.state).toBe("cancelled")
    expect(result.liveScheduleId).toBeNull()
  })

  test("fired schedule is terminal and retains scheduledAt", () => {
    const result = deriveChatSchedules([
      proposed("c1", "s1"),
      accepted("c1", "s1"),
      { v: 3, kind: "auto_continue_fired", timestamp: 12_000, chatId: "c1", scheduleId: "s1" },
    ])
    expect(result.schedules.s1.state).toBe("fired")
    expect(result.schedules.s1.scheduledAt).toBe(12_000)
    expect(result.liveScheduleId).toBeNull()
  })

  test("live schedule tracks most recent non-terminal", () => {
    const result = deriveChatSchedules([
      proposed("c1", "s1", 1_000),
      { v: 3, kind: "auto_continue_cancelled", timestamp: 1_100, chatId: "c1", scheduleId: "s1", reason: "user" },
      proposed("c1", "s2", 2_000),
    ])
    expect(result.schedules.s1.state).toBe("cancelled")
    expect(result.schedules.s2.state).toBe("proposed")
    expect(result.liveScheduleId).toBe("s2")
  })

  test("reschedule updates scheduledAt without changing state", () => {
    const result = deriveChatSchedules([
      proposed("c1", "s1"),
      accepted("c1", "s1"),
      { v: 3, kind: "auto_continue_rescheduled", timestamp: 2_500, chatId: "c1", scheduleId: "s1", scheduledAt: 20_000 },
    ])
    expect(result.schedules.s1.state).toBe("scheduled")
    expect(result.schedules.s1.scheduledAt).toBe(20_000)
  })

  test("events for different chats produce independent results", () => {
    const events = [proposed("c1", "s1"), proposed("c2", "s2")]
    expect(deriveChatSchedules(events, "c1").liveScheduleId).toBe("s1")
    expect(deriveChatSchedules(events, "c2").liveScheduleId).toBe("s2")
  })
})
