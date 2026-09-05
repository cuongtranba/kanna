import { describe, expect, test } from "bun:test"
import type { TranscriptEntry } from "../../shared/types"
import { AUTO_CONTINUE_EVENT_VERSION, type AutoContinueEvent } from "../auto-continue/events"
import { parseCronCommand } from "../../shared/cron/parse-command"
import type { CronJobPatch, CronParseError, CronParseResult } from "../../shared/cron/types"
import { disarmCronJobsForChat, runCronCommand, type CronCommandDeps } from "./commands"

const CHAT = "chat-1"

function parsed(line: string): CronParseResult {
  const result = parseCronCommand(line)
  if (!result) throw new Error(`not a /cron line: ${line}`)
  return result
}

function makeDeps(opts: { now?: number; jobIds?: string[] } = {}) {
  const entries: TranscriptEntry[] = []
  const events: AutoContinueEvent[] = []
  const schedulerEvents: AutoContinueEvent[] = []
  const stateChanges: string[] = []
  const pushes: number[] = []
  const offered: CronParseError[] = []
  const jobIds = [...(opts.jobIds ?? [])]
  const deps: CronCommandDeps = {
    store: {
      appendMessage: async (_chatId, entry) => {
        entries.push(entry)
      },
      appendAutoContinueEvent: async (event) => {
        events.push(event)
      },
      getAutoContinueEvents: (chatId) => events.filter((event) => event.chatId === chatId),
    },
    cronScheduler: { onEvent: (event) => schedulerEvents.push(event) },
    emitStateChange: (chatId) => stateChanges.push(chatId),
    pushCronJobsUpdate: () => pushes.push(1),
    cronRepair: {
      offer: (_chatId, error) => {
        offered.push(error)
        return Promise.resolve()
      },
    },
    now: () => opts.now ?? 1_000_000,
    ...(jobIds.length > 0 ? { newJobId: () => jobIds.shift() ?? "cron-fallback" } : {}),
  }
  return { deps, entries, events, schedulerEvents, stateChanges, pushes, offered }
}

describe("runCronCommand", () => {
  test("invalid input appends an error entry with the suggestion and arms nothing", async () => {
    const { deps, entries, events } = makeDeps()
    await runCronCommand(deps, CHAT, parsed("/cron check ci spwan @daily"))
    expect(events).toHaveLength(0)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      kind: "cron_command_error",
      suggestion: "/cron check ci spawn @daily",
    })
  })

  test("arm emits cron_armed through the scheduler and appends the confirmation card", async () => {
    const { deps, entries, events, schedulerEvents, pushes } = makeDeps({ jobIds: ["cron-abc"] })
    await runCronCommand(deps, CHAT, parsed("/cron check ci inline every 5m"))

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      kind: "cron_armed",
      chatId: CHAT,
      scheduleId: "cron-abc",
      instruction: "check ci",
      mode: "inline",
      scheduleText: "every 5m",
    })
    expect(schedulerEvents).toHaveLength(1)
    expect(pushes.length).toBeGreaterThanOrEqual(1)
    expect(entries[0]).toMatchObject({
      kind: "cron_armed",
      jobId: "cron-abc",
      scheduleHuman: "every 5 minutes",
      nextFireAt: 1_300_000,
    })
  })

  test("arm records model on cron_armed when provided", async () => {
    const { deps, events } = makeDeps({ jobIds: ["cron-abc"] })
    await runCronCommand(deps, CHAT, parsed("/cron check ci inline every 5m"), "claude-sonnet-5")
    expect(events[0]).toMatchObject({ kind: "cron_armed", model: "claude-sonnet-5" })
  })

  test("arm omits model from cron_armed when not provided", async () => {
    const { deps, events } = makeDeps({ jobIds: ["cron-abc"] })
    await runCronCommand(deps, CHAT, parsed("/cron check ci inline every 5m"))
    expect(events[0]).toMatchObject({ kind: "cron_armed" })
    expect((events[0] as { model?: string }).model).toBeUndefined()
  })

  test("arm includes model and upcomingFires (3 fires) on the transcript entry", async () => {
    const { deps, entries } = makeDeps({ jobIds: ["cron-abc"], now: 1_000_000 })
    await runCronCommand(deps, CHAT, parsed("/cron check ci inline every 5m"), "claude-sonnet-5")
    const entry = entries[0]
    expect(entry).toMatchObject({ kind: "cron_armed", model: "claude-sonnet-5" })
    if (entry?.kind !== "cron_armed") throw new Error("expected cron_armed entry")
    expect(entry.upcomingFires).toHaveLength(3)
    expect(entry.upcomingFires?.[0]).toBe(1_300_000)
    expect(entry.upcomingFires?.[1]).toBe(1_600_000)
    expect(entry.upcomingFires?.[2]).toBe(1_900_000)
  })

  test("arm includes cwd from resolveChatCwd on the transcript entry", async () => {
    const { deps, entries } = makeDeps({ jobIds: ["cron-abc"] })
    deps.resolveChatCwd = (_chatId) => "/home/user/project"
    await runCronCommand(deps, CHAT, parsed("/cron check ci inline every 5m"))
    const entry = entries[0]
    if (entry?.kind !== "cron_armed") throw new Error("expected cron_armed entry")
    expect(entry.cwd).toBe("/home/user/project")
  })

  test("arm omits cwd when resolveChatCwd is not wired", async () => {
    const { deps, entries } = makeDeps({ jobIds: ["cron-abc"] })
    await runCronCommand(deps, CHAT, parsed("/cron check ci inline every 5m"))
    const entry = entries[0]
    if (entry?.kind !== "cron_armed") throw new Error("expected cron_armed entry")
    expect(entry.cwd).toBeUndefined()
  })

  test("a schedule that never fires is refused at arm time", async () => {
    const { deps, entries, events } = makeDeps()
    await runCronCommand(deps, CHAT, parsed("/cron impossible inline 0 0 30 2 *"))
    expect(events).toHaveLength(0)
    expect(entries[0]).toMatchObject({ kind: "cron_command_error" })
    if (entries[0]!.kind !== "cron_command_error") throw new Error("expected error entry")
    expect(entries[0]!.message).toContain("never fires")
  })

  test("the error entry keeps the line that failed", async () => {
    const { deps, entries } = makeDeps()
    await runCronCommand(deps, CHAT, parsed("/cron check CI inline 9am every day"))
    expect(entries[0]).toMatchObject({
      kind: "cron_command_error",
      input: "/cron check CI inline 9am every day",
    })
  })
})

describe("runCronCommand escalation to the model", () => {
  test("offers a line Kanna cannot fix", async () => {
    const { deps, offered } = makeDeps()
    await runCronCommand(deps, CHAT, parsed("/cron check CI inline 9am every day"))
    expect(offered).toHaveLength(1)
    expect(offered[0]?.input).toBe("/cron check CI inline 9am every day")
  })

  test("offers a schedule that parses but never fires", async () => {
    const { deps, offered } = makeDeps()
    await runCronCommand(deps, CHAT, parsed("/cron impossible inline 0 0 30 2 *"))
    expect(offered).toHaveLength(1)
    expect(offered[0]?.input).toBe("/cron impossible inline 0 0 30 2 *")
  })

  test("never offers a command that succeeded", async () => {
    const { deps, offered } = makeDeps({ jobIds: ["cron-abc"] })
    await runCronCommand(deps, CHAT, parsed("/cron check ci inline every 5m"))
    await runCronCommand(deps, CHAT, parsed("/cron list"))
    expect(offered).toEqual([])
  })

  test("forwards the error verbatim, bounds included", async () => {
    const { deps, offered } = makeDeps()
    await runCronCommand(deps, CHAT, parsed("/cron check ci spwan @daily"))
    expect(offered[0]).toMatchObject({
      part: "mode",
      suggestion: "/cron check ci spawn @daily",
    })
  })

  test("help and list append list cards", async () => {
    const { deps, entries } = makeDeps()
    await runCronCommand(deps, CHAT, parsed("/cron"))
    await runCronCommand(deps, CHAT, parsed("/cron list"))
    expect(entries[0]).toMatchObject({ kind: "cron_list", help: true })
    expect(entries[1]).toMatchObject({ kind: "cron_list" })
    expect(entries[1]).not.toMatchObject({ help: true })
  })

  test("managing an unknown job points at /cron list", async () => {
    const { deps, entries, events } = makeDeps()
    await runCronCommand(deps, CHAT, parsed("/cron remove ghost"))
    expect(events).toHaveLength(0)
    expect(entries[0]).toMatchObject({ kind: "cron_command_error", suggestion: "/cron list" })
  })

  test("remove, pause, resume emit their events and change entries", async () => {
    const { deps, entries, events } = makeDeps({ jobIds: ["cron-abc"] })
    await runCronCommand(deps, CHAT, parsed("/cron check ci inline every 5m"))

    await runCronCommand(deps, CHAT, parsed("/cron pause cron-abc"))
    expect(events.at(-1)).toMatchObject({ kind: "cron_paused", scheduleId: "cron-abc" })
    expect(entries.at(-1)).toMatchObject({ kind: "cron_job_change", change: "paused" })

    await runCronCommand(deps, CHAT, parsed("/cron pause cron-abc"))
    expect(entries.at(-1)).toMatchObject({ kind: "cron_command_error" })

    await runCronCommand(deps, CHAT, parsed("/cron resume cron-abc"))
    expect(events.at(-1)).toMatchObject({ kind: "cron_resumed" })
    expect(entries.at(-1)).toMatchObject({ kind: "cron_job_change", change: "resumed" })

    await runCronCommand(deps, CHAT, parsed("/cron resume cron-abc"))
    expect(entries.at(-1)).toMatchObject({ kind: "cron_command_error" })

    await runCronCommand(deps, CHAT, parsed("/cron remove cron-abc"))
    expect(events.at(-1)).toMatchObject({ kind: "cron_disarmed", reason: "user" })
    expect(entries.at(-1)).toMatchObject({ kind: "cron_job_change", change: "removed" })
  })

  test("job ids never collide with an armed job", async () => {
    const { deps, events } = makeDeps({ jobIds: ["cron-dup", "cron-dup", "cron-fresh"] })
    await runCronCommand(deps, CHAT, parsed("/cron first inline every 5m"))
    await runCronCommand(deps, CHAT, parsed("/cron second inline every 2h"))
    const armIds = events.filter((event) => event.kind === "cron_armed").map((event) => event.scheduleId)
    expect(armIds[0]).toBe("cron-dup")
    expect(armIds[1]).toBe("cron-fresh")
  })
})

describe("update command", () => {
  test("unknown jobId cards error with /cron list suggestion and emits no events", async () => {
    const { deps, entries, events } = makeDeps()
    await runCronCommand(deps, CHAT, {
      ok: true,
      command: { sub: "update", jobId: "cron-unknown", patch: { mode: "spawn" } },
    })
    expect(events).toHaveLength(0)
    expect(entries[0]).toMatchObject({ kind: "cron_command_error", suggestion: "/cron list" })
  })

  test("active run is refused and emits no cron_armed event", async () => {
    const { deps, entries, events } = makeDeps({ jobIds: ["cron-a1"] })
    await runCronCommand(deps, CHAT, parsed("/cron check ci inline every 5m"))
    events.push({
      v: AUTO_CONTINUE_EVENT_VERSION,
      kind: "cron_run_started",
      chatId: CHAT,
      scheduleId: "cron-a1",
      runId: "run-1",
      timestamp: 2_000_000,
    })
    const prevEventCount = events.length
    await runCronCommand(deps, CHAT, {
      ok: true,
      command: { sub: "update", jobId: "cron-a1", patch: { mode: "spawn" } },
    })
    expect(events.length).toBe(prevEventCount)
    expect(entries.at(-1)).toMatchObject({ kind: "cron_command_error" })
  })

  test("schedule update emits exactly one cron_armed event with the same jobId", async () => {
    const { deps, events } = makeDeps({ jobIds: ["cron-a1"] })
    await runCronCommand(deps, CHAT, parsed("/cron check ci inline every 5m"))
    const armResult = parseCronCommand("/cron x inline 0 10 * * *")
    if (!armResult?.ok || armResult.command.sub !== "arm") throw new Error("fixture failed")
    const before = events.length
    const patch: CronJobPatch = { schedule: armResult.command.schedule, scheduleText: "0 10 * * *" }
    await runCronCommand(deps, CHAT, { ok: true, command: { sub: "update", jobId: "cron-a1", patch } })
    const newEvents = events.slice(before)
    expect(newEvents).toHaveLength(1)
    expect(newEvents[0]).toMatchObject({ kind: "cron_armed", scheduleId: "cron-a1" })
  })

  test("update preserves the paused state of the job", async () => {
    const { deps, events } = makeDeps({ jobIds: ["cron-a1"] })
    await runCronCommand(deps, CHAT, parsed("/cron check ci inline every 5m"))
    await runCronCommand(deps, CHAT, { ok: true, command: { sub: "pause", jobId: "cron-a1" } })
    await runCronCommand(deps, CHAT, {
      ok: true,
      command: { sub: "update", jobId: "cron-a1", patch: { mode: "spawn" } },
    })
    const armed = events.filter((e) => e.kind === "cron_armed" && e.scheduleId === "cron-a1")
    const lastArmed = armed[armed.length - 1]
    expect((lastArmed as Extract<AutoContinueEvent, { kind: "cron_armed" }>).paused).toBe(true)
  })

  test("update on an unpaused job emits cron_armed without paused flag", async () => {
    const { deps, events } = makeDeps({ jobIds: ["cron-a1"] })
    await runCronCommand(deps, CHAT, parsed("/cron check ci inline every 5m"))
    await runCronCommand(deps, CHAT, {
      ok: true,
      command: { sub: "update", jobId: "cron-a1", patch: { mode: "spawn" } },
    })
    const armed = events.filter((e) => e.kind === "cron_armed" && e.scheduleId === "cron-a1")
    const lastArmed = armed[armed.length - 1] as Extract<AutoContinueEvent, { kind: "cron_armed" }>
    expect(lastArmed.paused).toBeUndefined()
  })

  test("instruction update keeps existing schedule and mode", async () => {
    const { deps, events, entries } = makeDeps({ jobIds: ["cron-a1"] })
    await runCronCommand(deps, CHAT, parsed("/cron check ci inline every 5m"))
    const firstArmed = events[0] as Extract<AutoContinueEvent, { kind: "cron_armed" }>
    await runCronCommand(deps, CHAT, {
      ok: true,
      command: { sub: "update", jobId: "cron-a1", patch: { instruction: "check nightly builds" } },
    })
    const updateEvent = events[1] as Extract<AutoContinueEvent, { kind: "cron_armed" }>
    expect(updateEvent.instruction).toBe("check nightly builds")
    expect(updateEvent.schedule).toEqual(firstArmed.schedule)
    expect(updateEvent.mode).toBe(firstArmed.mode)
    expect(entries.at(-1)).toMatchObject({ kind: "cron_job_change", change: "updated" })
  })
})

describe("disarmCronJobsForChat", () => {
  test("disarms every job with chat_deleted and appends no entries", async () => {
    const { deps, entries, events } = makeDeps({ jobIds: ["cron-a", "cron-b"] })
    await runCronCommand(deps, CHAT, parsed("/cron first inline every 5m"))
    await runCronCommand(deps, CHAT, parsed("/cron second spawn @daily"))
    const entriesBefore = entries.length

    await disarmCronJobsForChat(deps, CHAT)
    const disarms = events.filter((event) => event.kind === "cron_disarmed")
    expect(disarms).toHaveLength(2)
    expect(disarms.every((event) => event.kind === "cron_disarmed" && event.reason === "chat_deleted")).toBe(true)
    expect(entries.length).toBe(entriesBefore)
  })
})
