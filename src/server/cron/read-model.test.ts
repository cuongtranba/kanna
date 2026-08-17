import { describe, expect, test } from "bun:test"
import { AUTO_CONTINUE_EVENT_VERSION, type AutoContinueEvent } from "../auto-continue/events"
import { deriveCronJobs, findRunningCronRuns, hasActiveRun, hasUnpausedCronJob } from "./read-model"
import { parseSchedule } from "../../shared/cron/parse-schedule"
import { MAX_RECENT_CRON_RUNS, type CronSchedule } from "../../shared/cron/types"

const CHAT = "chat-1"

function scheduleOf(text: string): CronSchedule {
  const parsed = parseSchedule(text)
  if (!parsed.ok) throw new Error(parsed.message)
  return parsed.schedule
}

function armed(
  jobId: string,
  timestamp: number,
  overrides?: Partial<Extract<AutoContinueEvent, { kind: "cron_armed" }>>,
): AutoContinueEvent {
  return {
    v: AUTO_CONTINUE_EVENT_VERSION,
    kind: "cron_armed",
    chatId: CHAT,
    scheduleId: jobId,
    timestamp,
    instruction: "check ci",
    mode: "inline",
    scheduleText: "every 5m",
    schedule: scheduleOf("every 5m"),
    ...overrides,
  }
}

function event(
  kind: "cron_disarmed" | "cron_paused" | "cron_resumed",
  jobId: string,
  timestamp: number,
): AutoContinueEvent {
  const base = { v: AUTO_CONTINUE_EVENT_VERSION, chatId: CHAT, scheduleId: jobId, timestamp }
  if (kind === "cron_disarmed") return { ...base, kind, reason: "user" }
  return { ...base, kind }
}

function runStarted(jobId: string, runId: string, timestamp: number, spawnedChatId?: string): AutoContinueEvent {
  return {
    v: AUTO_CONTINUE_EVENT_VERSION,
    kind: "cron_run_started",
    chatId: CHAT,
    scheduleId: jobId,
    timestamp,
    runId,
    ...(spawnedChatId !== undefined ? { spawnedChatId } : {}),
  }
}

function runOutcome(jobId: string, runId: string, timestamp: number, ok: boolean, errorCode?: string): AutoContinueEvent {
  return {
    v: AUTO_CONTINUE_EVENT_VERSION,
    kind: "cron_run_outcome",
    chatId: CHAT,
    scheduleId: jobId,
    timestamp,
    runId,
    ok,
    ...(errorCode !== undefined ? { errorCode } : {}),
  }
}

describe("deriveCronJobs", () => {
  test("arm then disarm leaves nothing", () => {
    const jobs = deriveCronJobs([armed("j1", 1000), event("cron_disarmed", "j1", 2000)], CHAT, 3000)
    expect(jobs).toEqual([])
  })

  test("multiple jobs stay isolated and sort by armedAt", () => {
    const jobs = deriveCronJobs(
      [
        armed("j2", 2000, { instruction: "later job" }),
        armed("j1", 1000, { instruction: "earlier job" }),
        runStarted("j1", "r1", 2500),
      ],
      CHAT,
      3000,
    )
    expect(jobs.map((job) => job.jobId)).toEqual(["j1", "j2"])
    expect(jobs[0]!.recentRuns).toHaveLength(1)
    expect(jobs[1]!.recentRuns).toHaveLength(0)
  })

  test("events for other chats are ignored", () => {
    const foreign = { ...armed("j1", 1000), chatId: "other-chat" }
    expect(deriveCronJobs([foreign], CHAT, 2000)).toEqual([])
  })

  test("pause nulls nextFireAt, resume restores it", () => {
    const paused = deriveCronJobs([armed("j1", 1000), event("cron_paused", "j1", 2000)], CHAT, 3000)
    expect(paused[0]!.paused).toBe(true)
    expect(paused[0]!.nextFireAt).toBeNull()

    const resumed = deriveCronJobs(
      [armed("j1", 1000), event("cron_paused", "j1", 2000), event("cron_resumed", "j1", 2500)],
      CHAT,
      3000,
    )
    expect(resumed[0]!.paused).toBe(false)
    // Interval anchors at armedAt: next grid slot after now=3000 is 1000 + 300000.
    expect(resumed[0]!.nextFireAt).toBe(301_000)
  })

  test("run lifecycle: started is running, outcome settles it", () => {
    const running = deriveCronJobs([armed("j1", 1000), runStarted("j1", "r1", 2000)], CHAT, 3000)
    expect(running[0]!.lastRun).toMatchObject({ runId: "r1", status: "running" })
    expect(hasActiveRun(running[0]!)).toBe(true)

    const failed = deriveCronJobs(
      [armed("j1", 1000), runStarted("j1", "r1", 2000), runOutcome("j1", "r1", 2500, false, "orphaned")],
      CHAT,
      3000,
    )
    expect(failed[0]!.lastRun).toMatchObject({ runId: "r1", status: "failed", errorCode: "orphaned" })
    expect(hasActiveRun(failed[0]!)).toBe(false)
  })

  test("spawn runs carry their spawned chat id", () => {
    const jobs = deriveCronJobs([armed("j1", 1000), runStarted("j1", "r1", 2000, "spawned-chat")], CHAT, 3000)
    expect(jobs[0]!.lastRun?.spawnedChatId).toBe("spawned-chat")
  })

  test("skips are recorded as runs but do not count as active", () => {
    const jobs = deriveCronJobs(
      [
        armed("j1", 1000),
        runStarted("j1", "r1", 2000),
        runOutcome("j1", "r1", 2100, true),
        {
          v: AUTO_CONTINUE_EVENT_VERSION,
          kind: "cron_run_skipped",
          chatId: CHAT,
          scheduleId: "j1",
          timestamp: 2600,
          reason: "chat_busy",
        },
      ],
      CHAT,
      3000,
    )
    expect(jobs[0]!.lastRun).toMatchObject({ status: "skipped", skipReason: "chat_busy" })
    expect(hasActiveRun(jobs[0]!)).toBe(false)
  })

  test("hasActiveRun looks past skips to the newest real run", () => {
    const jobs = deriveCronJobs(
      [
        armed("j1", 1000),
        runStarted("j1", "r1", 2000),
        {
          v: AUTO_CONTINUE_EVENT_VERSION,
          kind: "cron_run_skipped",
          chatId: CHAT,
          scheduleId: "j1",
          timestamp: 2600,
          reason: "previous_run_active",
        },
      ],
      CHAT,
      3000,
    )
    expect(hasActiveRun(jobs[0]!)).toBe(true)
  })

  test("re-arming the same id replaces the job and clears run history", () => {
    const jobs = deriveCronJobs(
      [
        armed("j1", 1000),
        runStarted("j1", "r1", 2000),
        armed("j1", 5000, { instruction: "new instruction", scheduleText: "every 2h", schedule: scheduleOf("every 2h") }),
      ],
      CHAT,
      6000,
    )
    expect(jobs).toHaveLength(1)
    expect(jobs[0]!.instruction).toBe("new instruction")
    expect(jobs[0]!.recentRuns).toEqual([])
  })

  test("recent runs are bounded newest-first", () => {
    const events: AutoContinueEvent[] = [armed("j1", 0)]
    for (let i = 0; i < MAX_RECENT_CRON_RUNS + 10; i++) {
      events.push(runStarted("j1", `r${i}`, 1000 + i))
      events.push(runOutcome("j1", `r${i}`, 1500 + i, true))
    }
    const jobs = deriveCronJobs(events, CHAT, 10_000)
    expect(jobs[0]!.recentRuns).toHaveLength(MAX_RECENT_CRON_RUNS)
    expect(jobs[0]!.recentRuns[0]!.runId).toBe(`r${MAX_RECENT_CRON_RUNS + 9}`)
  })

  test("run events for unknown or disarmed jobs are ignored", () => {
    const jobs = deriveCronJobs([runStarted("ghost", "r1", 1000)], CHAT, 2000)
    expect(jobs).toEqual([])
  })

  test("hasUnpausedCronJob tracks arm, pause, resume, disarm", () => {
    expect(hasUnpausedCronJob([], CHAT)).toBe(false)
    expect(hasUnpausedCronJob([armed("j1", 1000)], CHAT)).toBe(true)
    expect(hasUnpausedCronJob([armed("j1", 1000), event("cron_paused", "j1", 2000)], CHAT)).toBe(false)
    expect(
      hasUnpausedCronJob(
        [armed("j1", 1000), event("cron_paused", "j1", 2000), event("cron_resumed", "j1", 3000)],
        CHAT,
      ),
    ).toBe(true)
    expect(hasUnpausedCronJob([armed("j1", 1000), event("cron_disarmed", "j1", 2000)], CHAT)).toBe(false)
    // A paused job alongside an unpaused one still counts.
    expect(
      hasUnpausedCronJob([armed("j1", 1000), armed("j2", 1500), event("cron_paused", "j1", 2000)], CHAT),
    ).toBe(true)
  })

  test("cron_run_outcome is first-terminal-wins: a second outcome for the same runId is ignored", () => {
    const jobs = deriveCronJobs(
      [
        armed("j1", 1000),
        runStarted("j1", "r1", 2000),
        runOutcome("j1", "r1", 2500, false, "orphaned"),
        runOutcome("j1", "r1", 3000, true),
      ],
      CHAT,
      4000,
    )
    expect(jobs[0]!.lastRun).toMatchObject({ runId: "r1", status: "failed", errorCode: "orphaned" })
  })

  test("loop and provider-failure events do not disturb cron state", () => {
    const jobs = deriveCronJobs(
      [
        armed("j1", 1000),
        {
          v: AUTO_CONTINUE_EVENT_VERSION,
          kind: "loop_armed",
          chatId: CHAT,
          scheduleId: "loop-1",
          timestamp: 1500,
          subagentId: "agent",
          prompt: "loop prompt",
        },
        {
          v: AUTO_CONTINUE_EVENT_VERSION,
          kind: "auto_continue_fired",
          chatId: CHAT,
          scheduleId: "ac-1",
          timestamp: 1600,
        },
      ],
      CHAT,
      2000,
    )
    expect(jobs).toHaveLength(1)
  })

  test("model is captured from cron_armed and surfaced on the snapshot", () => {
    const jobs = deriveCronJobs([armed("j1", 1000, { model: "claude-sonnet-5" })], CHAT, 2000)
    expect(jobs[0]!.model).toBe("claude-sonnet-5")
  })

  test("model is absent when not recorded (backward compat)", () => {
    const jobs = deriveCronJobs([armed("j1", 1000)], CHAT, 2000)
    expect(jobs[0]!.model).toBeUndefined()
  })

  test("re-arming picks up the new model", () => {
    const jobs = deriveCronJobs(
      [
        armed("j1", 1000, { model: "claude-opus-4-8" }),
        armed("j1", 5000, { model: "claude-sonnet-5" }),
      ],
      CHAT,
      6000,
    )
    expect(jobs[0]!.model).toBe("claude-sonnet-5")
  })
})

describe("findRunningCronRuns", () => {
  test("returns an empty array for no events", () => {
    expect(findRunningCronRuns([], CHAT)).toEqual([])
  })

  test("returns nothing when all runs have outcomes", () => {
    const runs = findRunningCronRuns(
      [armed("j1", 1000), runStarted("j1", "r1", 2000), runOutcome("j1", "r1", 2500, true)],
      CHAT,
    )
    expect(runs).toEqual([])
  })

  test("returns a run that has no outcome", () => {
    const runs = findRunningCronRuns([armed("j1", 1000), runStarted("j1", "r1", 2000)], CHAT)
    expect(runs).toEqual([{ jobId: "j1", runId: "r1" }])
  })

  test("includes spawnedChatId when present", () => {
    const events: AutoContinueEvent[] = [
      armed("j1", 1000),
      runStarted("j1", "r1", 2000, "spawned-chat"),
    ]
    const runs = findRunningCronRuns(events, CHAT)
    expect(runs).toEqual([{ jobId: "j1", runId: "r1", spawnedChatId: "spawned-chat" }])
  })

  test("finds a running run buried under more than MAX_RECENT_CRON_RUNS skip records", () => {
    const events: AutoContinueEvent[] = [armed("j1", 1000), runStarted("j1", "r1", 2000)]
    for (let i = 0; i < MAX_RECENT_CRON_RUNS + 5; i++) {
      events.push({
        v: AUTO_CONTINUE_EVENT_VERSION,
        kind: "cron_run_skipped",
        chatId: CHAT,
        scheduleId: "j1",
        timestamp: 3000 + i,
        reason: "previous_run_active",
      })
    }
    const runs = findRunningCronRuns(events, CHAT)
    expect(runs).toEqual([{ jobId: "j1", runId: "r1" }])
  })

  test("re-arm clears the previous run for that job", () => {
    const runs = findRunningCronRuns(
      [
        armed("j1", 1000),
        runStarted("j1", "r1", 2000),
        armed("j1", 5000, { instruction: "new" }),
      ],
      CHAT,
    )
    expect(runs).toEqual([])
  })

  test("disarm clears the run for that job", () => {
    const runs = findRunningCronRuns(
      [armed("j1", 1000), runStarted("j1", "r1", 2000), event("cron_disarmed", "j1", 3000)],
      CHAT,
    )
    expect(runs).toEqual([])
  })

  test("ignores events for other chats", () => {
    const foreign = { ...armed("j1", 1000), chatId: "other" }
    const foreignRun = { ...runStarted("j1", "r1", 2000), chatId: "other" }
    expect(findRunningCronRuns([foreign, foreignRun], CHAT)).toEqual([])
  })
})
