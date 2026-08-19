import { describe, expect, test } from "bun:test"
import { AUTO_CONTINUE_EVENT_VERSION, type AutoContinueEvent } from "../auto-continue/events"
import { compactCronRunEvents } from "./compact"
import { deriveCronJobs, findRunningCronRuns } from "./read-model"
import { parseSchedule } from "../../shared/cron/parse-schedule"
import { MAX_RECENT_CRON_RUNS, type CronSchedule, type CronSkipReason } from "../../shared/cron/types"

const CHAT = "chat-1"
const NOW = 10_000_000

function scheduleOf(text: string): CronSchedule {
  const parsed = parseSchedule(text)
  if (!parsed.ok) throw new Error(parsed.message)
  return parsed.schedule
}

function armed(jobId: string, timestamp: number, chatId = CHAT): AutoContinueEvent {
  return {
    v: AUTO_CONTINUE_EVENT_VERSION,
    kind: "cron_armed",
    chatId,
    scheduleId: jobId,
    timestamp,
    instruction: "check ci",
    mode: "inline",
    scheduleText: "every 5m",
    schedule: scheduleOf("every 5m"),
  }
}

function lifecycle(
  kind: "cron_disarmed" | "cron_paused" | "cron_resumed",
  jobId: string,
  timestamp: number,
  chatId = CHAT,
): AutoContinueEvent {
  const base = { v: AUTO_CONTINUE_EVENT_VERSION, chatId, scheduleId: jobId, timestamp }
  if (kind === "cron_disarmed") return { ...base, kind, reason: "user" }
  return { ...base, kind }
}

function runStarted(
  jobId: string,
  runId: string,
  timestamp: number,
  spawnedChatId?: string,
  chatId = CHAT,
): AutoContinueEvent {
  return {
    v: AUTO_CONTINUE_EVENT_VERSION,
    kind: "cron_run_started",
    chatId,
    scheduleId: jobId,
    timestamp,
    runId,
    ...(spawnedChatId !== undefined ? { spawnedChatId } : {}),
  }
}

function runOutcome(jobId: string, runId: string, timestamp: number, ok = true, chatId = CHAT): AutoContinueEvent {
  return {
    v: AUTO_CONTINUE_EVENT_VERSION,
    kind: "cron_run_outcome",
    chatId,
    scheduleId: jobId,
    timestamp,
    runId,
    ok,
  }
}

function runSkipped(
  jobId: string,
  timestamp: number,
  reason: CronSkipReason = "chat_busy",
  missedCount?: number,
  chatId = CHAT,
): AutoContinueEvent {
  return {
    v: AUTO_CONTINUE_EVENT_VERSION,
    kind: "cron_run_skipped",
    chatId,
    scheduleId: jobId,
    timestamp,
    reason,
    ...(missedCount !== undefined ? { missedCount } : {}),
  }
}

/** `count` fully-settled runs (start + outcome), timestamps stepping by 1000. */
function settledRuns(jobId: string, count: number, startAt: number): AutoContinueEvent[] {
  const out: AutoContinueEvent[] = []
  for (let i = 0; i < count; i += 1) {
    const at = startAt + i * 1000
    out.push(runStarted(jobId, `${jobId}-run-${i}`, at), runOutcome(jobId, `${jobId}-run-${i}`, at + 1))
  }
  return out
}

function skips(jobId: string, count: number, startAt: number): AutoContinueEvent[] {
  return Array.from({ length: count }, (_, i) => runSkipped(jobId, startAt + i * 1000))
}

/**
 * The whole point of the module: compaction must be invisible to both readers
 * of cron run events. Every shape below is checked against BOTH, so a shape
 * that breaks one is not silently excused by the other.
 */
const PARITY_SHAPES: Array<{ name: string; log: AutoContinueEvent[] }> = [
  { name: "200 settled pairs", log: [armed("j1", 1), ...settledRuns("j1", 200, 100)] },
  { name: "200 skips", log: [armed("j1", 1), ...skips("j1", 200, 100)] },
  {
    name: "interleaved pairs and skips",
    log: [
      armed("j1", 1),
      ...settledRuns("j1", 60, 100),
      ...skips("j1", 60, 100_000),
      ...settledRuns("j1", 60, 300_000),
    ],
  },
  {
    name: "pause and resume mid-stream",
    log: [
      armed("j1", 1),
      ...settledRuns("j1", 40, 100),
      lifecycle("cron_paused", "j1", 50_000),
      ...skips("j1", 40, 60_000),
      lifecycle("cron_resumed", "j1", 100_000),
      ...settledRuns("j1", 40, 110_000),
    ],
  },
  {
    name: "re-arm mid-stream",
    log: [
      armed("j1", 1),
      ...settledRuns("j1", 50, 100),
      armed("j1", 200_000),
      ...settledRuns("j1", 50, 210_000),
    ],
  },
  {
    name: "two jobs interleaved",
    log: [
      armed("j1", 1),
      armed("j2", 2),
      ...settledRuns("j1", 80, 100).flatMap((e, i) => (i % 2 === 0 ? [e, runSkipped("j2", 100 + i)] : [e])),
    ],
  },
  {
    name: "pinned unsettled start buried under 60 records",
    log: [armed("j1", 1), runStarted("j1", "pinned", 100), ...skips("j1", 60, 1000)],
  },
  {
    name: "disarmed job",
    log: [armed("j1", 1), ...settledRuns("j1", 50, 100), lifecycle("cron_disarmed", "j1", 200_000)],
  },
  {
    name: "outcome with no surviving start",
    log: [armed("j1", 1), runOutcome("j1", "ghost", 100), ...settledRuns("j1", 30, 1000)],
  },
]

describe("compactCronRunEvents — parity with both readers", () => {
  for (const { name, log } of PARITY_SHAPES) {
    test(`deriveCronJobs is unchanged: ${name}`, () => {
      expect(deriveCronJobs(compactCronRunEvents([...log]), CHAT, NOW))
        .toEqual(deriveCronJobs(log, CHAT, NOW))
    })

    test(`findRunningCronRuns is unchanged: ${name}`, () => {
      expect(findRunningCronRuns(compactCronRunEvents([...log]), CHAT))
        .toEqual(findRunningCronRuns(log, CHAT))
    })
  }
})

describe("compactCronRunEvents — invariants", () => {
  test("A: job lifecycle events are never dropped", () => {
    const log = [
      armed("j1", 1),
      ...skips("j1", 60, 100),
      lifecycle("cron_paused", "j1", 90_000),
      lifecycle("cron_resumed", "j1", 91_000),
      ...skips("j1", 60, 100_000),
      lifecycle("cron_disarmed", "j1", 200_000),
    ]
    const kept = compactCronRunEvents([...log])
    const lifecycleKinds = new Set(["cron_armed", "cron_paused", "cron_resumed", "cron_disarmed"])
    expect(kept.filter((e) => lifecycleKinds.has(e.kind)))
      .toEqual(log.filter((e) => lifecycleKinds.has(e.kind)))
  })

  test("B: an unsettled start survives however many records bury it", () => {
    const log = [armed("j1", 1), runStarted("j1", "live", 100), ...skips("j1", 60, 1000)]
    const kept = compactCronRunEvents([...log])

    expect(kept.some((e) => e.kind === "cron_run_started" && e.runId === "live")).toBe(true)
    expect(findRunningCronRuns(kept, CHAT).map((r) => r.runId)).toEqual(["live"])
  })

  test("C: start and outcome are dropped as a unit — no half-pair survives", () => {
    const kept = compactCronRunEvents([armed("j1", 1), ...settledRuns("j1", 60, 100)])

    const startIds = new Set(
      kept.filter((e) => e.kind === "cron_run_started").map((e) => (e as { runId: string }).runId),
    )
    const outcomeIds = new Set(
      kept.filter((e) => e.kind === "cron_run_outcome").map((e) => (e as { runId: string }).runId),
    )
    expect([...startIds].sort()).toEqual([...outcomeIds].sort())
    // A surviving half-pair is what makes boot write a bogus `orphaned` outcome.
    expect(findRunningCronRuns(kept, CHAT)).toEqual([])
  })

  test("D: spawnedChatId rides along with a pinned start", () => {
    const log = [armed("j1", 1), runStarted("j1", "live", 100, "spawned-chat"), ...skips("j1", 60, 1000)]
    expect(findRunningCronRuns(compactCronRunEvents([...log]), CHAT)[0]?.spawnedChatId).toBe("spawned-chat")
  })

  test("E: the newest record survives, so lastRun is exact", () => {
    const log = [armed("j1", 1), ...settledRuns("j1", 100, 100)]
    expect(deriveCronJobs(compactCronRunEvents([...log]), CHAT, NOW)[0]?.lastRun)
      .toEqual(deriveCronJobs(log, CHAT, NOW)[0]?.lastRun)
  })

  test("F: output is an order-preserving subsequence of the input", () => {
    const log = [armed("j1", 1), ...settledRuns("j1", 60, 100), ...skips("j1", 60, 200_000)]
    const kept = compactCronRunEvents([...log])
    const keptSet = new Set(kept)

    expect(kept).toEqual(log.filter((e) => keptSet.has(e)))
  })

  test("G: a quiet job is not starved by a chatty one sharing the chat", () => {
    const chatty = settledRuns("busy", 200, 1000)
    const log = [armed("quiet", 1), armed("busy", 2), ...settledRuns("quiet", 2, 100), ...chatty]
    const kept = compactCronRunEvents([...log])

    expect(kept.filter((e) => e.kind === "cron_run_started" && e.scheduleId === "quiet")).toHaveLength(2)
  })

  test("H: retention is bounded by the display cap, per job", () => {
    const kept = compactCronRunEvents([armed("j1", 1), ...settledRuns("j1", 500, 100)])

    expect(kept.filter((e) => e.kind === "cron_run_started")).toHaveLength(MAX_RECENT_CRON_RUNS)
  })

  // Deliberately runs FAR more non-cron events past the retention budget than
  // the budget allows: a version of this test with only one or two of them
  // passes even when the code treats them as droppable run records, because
  // the budget is never reached.
  test("I/J: non-cron events are never touched, however many there are", () => {
    const loopArmed: AutoContinueEvent = {
      v: AUTO_CONTINUE_EVENT_VERSION,
      kind: "loop_armed",
      chatId: CHAT,
      scheduleId: "loop-1",
      timestamp: 5,
      subagentId: "agent-1",
      prompt: "do the work",
      verifyCommand: "bun run lint",
      trackingFileRel: "PROGRESS.md",
    }
    const loopOutcomes: AutoContinueEvent[] = Array.from({ length: 200 }, (_, i) => ({
      v: AUTO_CONTINUE_EVENT_VERSION,
      kind: "loop_run_outcome",
      chatId: CHAT,
      scheduleId: "loop-1",
      timestamp: 6 + i,
      ok: true,
    }))
    const accepted: AutoContinueEvent[] = Array.from({ length: 200 }, (_, i) => ({
      v: AUTO_CONTINUE_EVENT_VERSION,
      kind: "auto_continue_accepted",
      chatId: CHAT,
      scheduleId: "loop-1",
      timestamp: 500 + i,
      scheduledAt: 400 + i,
      tz: "UTC",
      source: "subagent_background",
      resetAt: 0,
      detectedAt: 0,
      prompt: "go",
    }))
    const nonCron = [loopArmed, ...loopOutcomes, ...accepted]
    const log = [...nonCron, armed("j1", 1), ...settledRuns("j1", 200, 100_000)]
    const kept = compactCronRunEvents([...log])

    expect(kept.filter((e) => !e.kind.startsWith("cron_"))).toEqual(nonCron)
    // The cron side must still actually be compacted, or this proves nothing.
    expect(kept.filter((e) => e.kind === "cron_run_started")).toHaveLength(MAX_RECENT_CRON_RUNS)
  })
})

describe("compactCronRunEvents — reclaim rules", () => {
  test("run records before the most recent arm are dropped wholesale", () => {
    const log = [armed("j1", 1), ...settledRuns("j1", 5, 100), armed("j1", 200_000)]
    const kept = compactCronRunEvents([...log])

    expect(kept.filter((e) => e.kind.startsWith("cron_run_"))).toEqual([])
  })

  test("a disarmed, never re-armed job retains no run records", () => {
    const log = [armed("j1", 1), ...settledRuns("j1", 5, 100), lifecycle("cron_disarmed", "j1", 200_000)]
    const kept = compactCronRunEvents([...log])

    expect(kept.filter((e) => e.kind.startsWith("cron_run_"))).toEqual([])
  })

  test("pins are retained IN ADDITION to the newest N, not instead of one", () => {
    // Counting the pin against the budget would evict a settled record that is
    // still inside the true newest-20 window, diverging from the read model.
    const log = [
      armed("j1", 1),
      runStarted("j1", "live", 100),
      ...skips("j1", MAX_RECENT_CRON_RUNS + 5, 1000),
    ]
    const kept = compactCronRunEvents([...log])

    expect(kept.filter((e) => e.kind === "cron_run_skipped")).toHaveLength(MAX_RECENT_CRON_RUNS)
    expect(deriveCronJobs(kept, CHAT, NOW)).toEqual(deriveCronJobs(log, CHAT, NOW))
  })

  test("job identity is scoped per chat — an arm in one chat spares another's pin", () => {
    const other = "chat-2"
    const log = [
      armed("shared-id", 1, other),
      runStarted("shared-id", "other-live", 100, undefined, other),
      armed("shared-id", 200, CHAT),
      ...settledRuns("shared-id", 40, 1000),
      armed("shared-id", 500_000, CHAT),
    ]
    const kept = compactCronRunEvents([...log])

    expect(findRunningCronRuns(kept, other).map((r) => r.runId)).toEqual(["other-live"])
  })
})

describe("compactCronRunEvents — allocation contract", () => {
  test("returns the input array by reference when nothing is dropped", () => {
    const log = [armed("j1", 1), ...settledRuns("j1", 3, 100)]
    expect(compactCronRunEvents(log)).toBe(log)
  })

  test("is idempotent", () => {
    const once = compactCronRunEvents([armed("j1", 1), ...settledRuns("j1", 200, 100)])
    expect(compactCronRunEvents(once)).toBe(once)
  })

  test("never mutates its input", () => {
    const log = [armed("j1", 1), ...settledRuns("j1", 200, 100)]
    const before = log.slice()
    compactCronRunEvents(log)

    expect(log).toEqual(before)
  })
})
