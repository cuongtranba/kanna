import { describe, expect, test } from "bun:test"
import type { TranscriptEntry } from "../../shared/types"
import type { AutoContinueEvent } from "../auto-continue/events"
import { parseCronCommand } from "../../shared/cron/parse-command"
import type { CronParseError, CronParseResult } from "../../shared/cron/types"
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

  // A parseable schedule with no occurrence is still an invalid setup the user
  // meant something by, so it escalates on a reconstructed line.
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

  // The repair module owns the suggestion / part bounds; dispatch just forwards.
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

    // Pausing again is a visible no-op error.
    await runCronCommand(deps, CHAT, parsed("/cron pause cron-abc"))
    expect(entries.at(-1)).toMatchObject({ kind: "cron_command_error" })

    await runCronCommand(deps, CHAT, parsed("/cron resume cron-abc"))
    expect(events.at(-1)).toMatchObject({ kind: "cron_resumed" })
    expect(entries.at(-1)).toMatchObject({ kind: "cron_job_change", change: "resumed" })

    // Resuming an unpaused job is a visible no-op error.
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
