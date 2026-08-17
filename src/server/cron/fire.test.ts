import { describe, expect, test } from "bun:test"
import type { ChatAttachment, QueuedChatMessage, TranscriptEntry } from "../../shared/types"
import type { AutoContinueEvent } from "../auto-continue/events"
import { parseCronCommand } from "../../shared/cron/parse-command"
import type { SendMessageOptions } from "../claude-steer-log"
import { runCronCommand } from "./commands"
import { fireCronJob, recordCronTurnOutcome, reconcileCronRunsAtBoot, type CronFireDeps } from "./fire"
import { CronSkipCoalescer, SKIP_FLUSH_WINDOW_MS } from "./skip-coalescer"

const CHAT = "chat-1"

interface EnqueuedRecord {
  chatId: string
  content: string
  options?: SendMessageOptions
}

function makeDeps(opts: { busyChatIds?: string[]; now?: number } = {}) {
  const entries: Array<{ chatId: string; entry: TranscriptEntry }> = []
  const events: AutoContinueEvent[] = []
  const cleared: string[] = []
  const enqueued: EnqueuedRecord[] = []
  const drained: string[] = []
  const createdChats: string[] = []
  const queuedByChatId = new Map<string, QueuedChatMessage[]>()
  const busy = new Set(opts.busyChatIds ?? [])
  const clock = { now: opts.now ?? 1_000_000 }
  const skipCoalescer = new CronSkipCoalescer()
  let chatSeq = 0
  const deps: CronFireDeps & { getQueuedMessages: (chatId: string) => QueuedChatMessage[] } = {
    skipCoalescer,
    store: {
      appendMessage: async (chatId, entry) => {
        entries.push({ chatId, entry })
      },
      appendAutoContinueEvent: async (event) => {
        events.push(event)
      },
      getAutoContinueEvents: (chatId) => events.filter((event) => event.chatId === chatId),
    },
    cronScheduler: null,
    emitStateChange: () => {},
    now: () => clock.now,
    newJobId: () => "cron-abc",
    getChatRecord: (chatId) => (chatId === CHAT ? { projectId: "proj-1" } : null),
    isChatBusy: (chatId) => busy.has(chatId),
    clearChatContext: async (chatId) => {
      cleared.push(chatId)
    },
    createChat: async (projectId) => {
      createdChats.push(projectId)
      chatSeq += 1
      return { id: `spawned-${chatSeq}` }
    },
    enqueueMessage: async (chatId, content, _attachments: ChatAttachment[], options) => {
      enqueued.push({ chatId, content, options })
      if (options?.cronRun) {
        const list = queuedByChatId.get(chatId) ?? []
        list.push({ id: `qm-${list.length}`, content, attachments: [], createdAt: clock.now, cronRun: options.cronRun })
        queuedByChatId.set(chatId, list)
      }
    },
    maybeStartNextQueuedMessage: async (chatId) => {
      drained.push(chatId)
      return true
    },
    getQueuedMessages: (chatId) => queuedByChatId.get(chatId) ?? [],
  }
  return { deps, entries, events, cleared, enqueued, drained, createdChats, busy, clock, queuedByChatId }
}

async function armJob(deps: CronFireDeps, line: string) {
  const parsed = parseCronCommand(line)
  if (!parsed) throw new Error("not a cron line")
  await runCronCommand(deps, CHAT, parsed)
}

describe("fireCronJob — inline", () => {
  test("clears context, records the run, and starts the instruction with its tag", async () => {
    const { deps, events, cleared, enqueued, drained } = makeDeps()
    await armJob(deps, "/cron check ci inline every 5m")

    await fireCronJob(deps, CHAT, "cron-abc")

    expect(cleared).toEqual([CHAT])
    const started = events.find((event) => event.kind === "cron_run_started")
    expect(started).toMatchObject({ chatId: CHAT, scheduleId: "cron-abc" })
    expect(enqueued).toHaveLength(1)
    expect(enqueued[0]).toMatchObject({ chatId: CHAT, content: "check ci" })
    expect(enqueued[0]!.options?.cronRun).toMatchObject({ jobId: "cron-abc", originChatId: CHAT })
    expect(drained).toEqual([CHAT])
  })

  test("busy chat skips with a visible chat_busy notice and no context clear", async () => {
    const { deps, events, cleared, enqueued, entries, busy } = makeDeps()
    await armJob(deps, "/cron check ci inline every 5m")
    busy.add(CHAT)

    await fireCronJob(deps, CHAT, "cron-abc")

    expect(cleared).toEqual([])
    expect(enqueued).toEqual([])
    const skipped = events.find((event) => event.kind === "cron_run_skipped")
    expect(skipped).toMatchObject({ reason: "chat_busy" })
    expect(entries.at(-1)?.entry).toMatchObject({ kind: "cron_run_skipped", reason: "chat_busy" })
  })

  test("own previous run still live (busy chat) skips as previous_run_active", async () => {
    const { deps, events, busy } = makeDeps()
    await armJob(deps, "/cron check ci inline every 5m")
    await fireCronJob(deps, CHAT, "cron-abc") // run 1 started, still "running"
    busy.add(CHAT)

    await fireCronJob(deps, CHAT, "cron-abc")

    const skipped = events.find((event) => event.kind === "cron_run_skipped")
    expect(skipped).toMatchObject({ reason: "previous_run_active" })
  })

  test("a running run whose chat is idle is settled as orphaned, then the fire proceeds", async () => {
    const { deps, events, enqueued } = makeDeps()
    await armJob(deps, "/cron check ci inline every 5m")
    await fireCronJob(deps, CHAT, "cron-abc") // run 1 never got an outcome

    await fireCronJob(deps, CHAT, "cron-abc")

    const outcomes = events.filter((event) => event.kind === "cron_run_outcome")
    expect(outcomes).toHaveLength(1)
    expect(outcomes[0]).toMatchObject({ ok: false, errorCode: "orphaned" })
    // Both fires ran (the second proceeded after settling the orphan).
    expect(enqueued).toHaveLength(2)
  })

  test("paused or unknown jobs and missing chats are no-ops", async () => {
    const { deps, events } = makeDeps()
    await armJob(deps, "/cron check ci inline every 5m")
    const before = events.length

    await fireCronJob(deps, CHAT, "ghost")
    await fireCronJob(deps, "missing-chat", "cron-abc")
    expect(events).toHaveLength(before)
  })
})

describe("fireCronJob — spawn", () => {
  test("creates a chat in the arming chat's project and runs there, carding the arming chat", async () => {
    const { deps, events, entries, enqueued, createdChats, cleared } = makeDeps()
    await armJob(deps, "/cron nightly report spawn @daily")

    await fireCronJob(deps, CHAT, "cron-abc")

    expect(createdChats).toEqual(["proj-1"])
    expect(cleared).toEqual([]) // spawn mode never clears the arming chat
    const started = events.find((event) => event.kind === "cron_run_started")
    expect(started).toMatchObject({ chatId: CHAT, spawnedChatId: "spawned-1" })
    const card = entries.find((record) => record.entry.kind === "cron_run")
    expect(card?.chatId).toBe(CHAT)
    expect(card?.entry).toMatchObject({ instruction: "nightly report", spawnedChatId: "spawned-1" })
    expect(enqueued[0]).toMatchObject({ chatId: "spawned-1", content: "nightly report" })
    expect(enqueued[0]!.options?.cronRun).toMatchObject({ originChatId: CHAT })
  })

  test("a still-running spawned run skips the tick; an idle one is orphan-settled", async () => {
    const { deps, events, busy } = makeDeps()
    await armJob(deps, "/cron nightly report spawn @daily")
    await fireCronJob(deps, CHAT, "cron-abc")
    busy.add("spawned-1")

    await fireCronJob(deps, CHAT, "cron-abc")
    expect(events.find((event) => event.kind === "cron_run_skipped")).toMatchObject({
      reason: "previous_run_active",
    })

    busy.delete("spawned-1")
    await fireCronJob(deps, CHAT, "cron-abc")
    expect(events.filter((event) => event.kind === "cron_run_outcome")).toHaveLength(1)
    expect(events.filter((event) => event.kind === "cron_run_started")).toHaveLength(2)
  })
})

describe("fireCronJob — consecutive skips coalesce", () => {
  function skippedEvents(events: AutoContinueEvent[]) {
    return events.filter((event) => event.kind === "cron_run_skipped")
  }

  /**
   * The reason this exists: `every 5s` against a 20 s task skips three ticks
   * per cycle. One card each buries the runs that did happen, in a log that is
   * never compacted.
   */
  test("a burst of skipped ticks writes once, not once per tick", async () => {
    const { deps, events, entries, busy, clock } = makeDeps()
    await armJob(deps, "/cron check ci inline every 5s")
    busy.add(CHAT)

    for (const offset of [0, 5_000, 10_000, 15_000]) {
      clock.now = 1_000_000 + offset
      await fireCronJob(deps, CHAT, "cron-abc")
    }

    expect(skippedEvents(events)).toHaveLength(1)
    expect(entries.filter((record) => record.entry.kind === "cron_run_skipped")).toHaveLength(1)
  })

  test("the folded ticks are reported with their count once the window passes", async () => {
    const { deps, events, busy, clock } = makeDeps()
    await armJob(deps, "/cron check ci inline every 5s")
    busy.add(CHAT)

    for (const offset of [0, 5_000, 10_000, SKIP_FLUSH_WINDOW_MS]) {
      clock.now = 1_000_000 + offset
      await fireCronJob(deps, CHAT, "cron-abc")
    }

    const skipped = skippedEvents(events)
    expect(skipped).toHaveLength(2)
    expect(skipped[0]).toMatchObject({ reason: "chat_busy" })
    expect(skipped[0]).not.toHaveProperty("missedCount")
    expect(skipped[1]).toMatchObject({ reason: "chat_busy", missedCount: 3 })
  })

  test("the tail lands next to the run it was waiting on", async () => {
    const { deps, events, entries, busy, clock } = makeDeps()
    await armJob(deps, "/cron check ci inline every 5s")
    busy.add(CHAT)
    for (const offset of [0, 5_000, 10_000]) {
      clock.now = 1_000_000 + offset
      await fireCronJob(deps, CHAT, "cron-abc")
    }

    busy.delete(CHAT)
    clock.now = 1_000_000 + SKIP_FLUSH_WINDOW_MS
    await fireCronJob(deps, CHAT, "cron-abc")

    const skipped = skippedEvents(events)
    expect(skipped.at(-1)).toMatchObject({ reason: "chat_busy", missedCount: 2 })
    // The summary is written BEFORE the run it precedes, so the transcript
    // reads in the order things happened.
    const kinds = events.map((event) => event.kind)
    expect(kinds.lastIndexOf("cron_run_skipped")).toBeLessThan(kinds.lastIndexOf("cron_run_started"))
    expect(entries.filter((record) => record.entry.kind === "cron_run_skipped")).toHaveLength(2)
  })

  /** A slow schedule must not wait for a window that only a later tick notices. */
  test("a sparse skip is still reported immediately", async () => {
    const { deps, events, busy, clock } = makeDeps()
    await armJob(deps, "/cron nightly report inline @daily")
    busy.add(CHAT)

    await fireCronJob(deps, CHAT, "cron-abc")
    clock.now = 1_000_000 + 86_400_000
    await fireCronJob(deps, CHAT, "cron-abc")

    expect(skippedEvents(events)).toHaveLength(2)
  })

  test("pausing the job drops the folded count instead of carrying it past the resume", async () => {
    const { deps, events, busy, clock } = makeDeps()
    await armJob(deps, "/cron check ci inline every 5s")
    busy.add(CHAT)
    for (const offset of [0, 5_000, 10_000]) {
      clock.now = 1_000_000 + offset
      await fireCronJob(deps, CHAT, "cron-abc")
    }

    await armJob(deps, "/cron pause cron-abc")
    await armJob(deps, "/cron resume cron-abc")
    clock.now = 1_000_000 + SKIP_FLUSH_WINDOW_MS
    await fireCronJob(deps, CHAT, "cron-abc")

    // The resumed job leads its own window: one skip, standing for itself only.
    expect(skippedEvents(events).at(-1)).not.toHaveProperty("missedCount")
  })
})

describe("recordCronTurnOutcome", () => {
  test("routes outcomes to the arming chat with the right shape", async () => {
    const { deps, events } = makeDeps()
    const tag = { jobId: "cron-abc", runId: "run-1", originChatId: CHAT }

    await recordCronTurnOutcome(deps, tag, "finished")
    expect(events.at(-1)).toMatchObject({ kind: "cron_run_outcome", chatId: CHAT, ok: true })

    await recordCronTurnOutcome(deps, tag, "cancelled")
    expect(events.at(-1)).toMatchObject({ ok: false, errorCode: "cancelled" })

    await recordCronTurnOutcome(deps, tag, "failed")
    expect(events.at(-1)).toMatchObject({ ok: false, errorCode: "error" })
  })
})

describe("reconcileCronRunsAtBoot", () => {
  test("appends server_offline notices and settles runs no restart kept alive", async () => {
    const { deps, events, entries } = makeDeps()
    await armJob(deps, "/cron check ci inline every 5m")
    await fireCronJob(deps, CHAT, "cron-abc") // running, no outcome — "crashed" here
    // Drain the queued message so no queue entry survives (simulates crash before dequeue-on-commit)
    deps.getQueuedMessages(CHAT).length = 0

    await reconcileCronRunsAtBoot(
      deps,
      [{ chatId: CHAT, jobId: "cron-abc", missedCount: 3 }],
      [CHAT],
    )

    const skipped = events.find(
      (event) => event.kind === "cron_run_skipped" && event.reason === "server_offline",
    )
    expect(skipped).toMatchObject({ missedCount: 3 })
    expect(entries.some((record) => record.entry.kind === "cron_run_skipped")).toBe(true)
    const outcome = events.find((event) => event.kind === "cron_run_outcome")
    expect(outcome).toMatchObject({ ok: false, errorCode: "orphaned" })
  })

  test("queued inline run is skipped at boot — recoverQueuedMessages owns it", async () => {
    const { deps, events } = makeDeps()
    await armJob(deps, "/cron check ci inline every 5m")
    await fireCronJob(deps, CHAT, "cron-abc") // message stays in queue (dequeue-on-commit)

    await reconcileCronRunsAtBoot(deps, [], [CHAT])

    const outcome = events.find((event) => event.kind === "cron_run_outcome")
    expect(outcome).toBeUndefined()
  })

  test("queued spawn run is skipped — a concurrent tick still skips as previous_run_active", async () => {
    const { deps, events, busy } = makeDeps()
    await armJob(deps, "/cron nightly report spawn @daily")
    await fireCronJob(deps, CHAT, "cron-abc") // run started in spawned-1, message queued there
    busy.add("spawned-1") // simulate recoverQueuedMessages starting the turn

    await reconcileCronRunsAtBoot(deps, [], [CHAT])

    expect(events.find((e) => e.kind === "cron_run_outcome")).toBeUndefined()
    // A concurrent tick must still skip — the run is still "running" in the read model.
    await fireCronJob(deps, CHAT, "cron-abc")
    expect(events.find((e) => e.kind === "cron_run_skipped")).toMatchObject({ reason: "previous_run_active" })
  })

  test("queued run completes: exactly one cron_run_outcome with ok:true and no errorCode", async () => {
    const { deps, events } = makeDeps()
    await armJob(deps, "/cron check ci inline every 5m")
    await fireCronJob(deps, CHAT, "cron-abc")
    const tag = deps.getQueuedMessages(CHAT)[0]!.cronRun!

    // Boot reconcile skips it (queue still holds the message)
    await reconcileCronRunsAtBoot(deps, [], [CHAT])
    expect(events.filter((e) => e.kind === "cron_run_outcome")).toHaveLength(0)

    // Turn completes via recoverQueuedMessages path
    await recordCronTurnOutcome(deps, tag, "finished")

    const outcomes = events.filter((e) => e.kind === "cron_run_outcome")
    expect(outcomes).toHaveLength(1)
    expect(outcomes[0]).toMatchObject({ ok: true })
    expect(outcomes[0]).not.toHaveProperty("errorCode")
  })

  test("a running run buried under many skips is still found and orphaned", async () => {
    const { deps, events } = makeDeps()
    await armJob(deps, "/cron check ci inline every 5m")
    await fireCronJob(deps, CHAT, "cron-abc") // run started, no outcome
    deps.getQueuedMessages(CHAT).length = 0 // no queued message (crashed before dequeue-on-commit)

    // Emit 25 skip records, pushing the running run past MAX_RECENT_CRON_RUNS
    for (let i = 0; i < 25; i++) {
      events.push({
        v: 3,
        kind: "cron_run_skipped",
        chatId: CHAT,
        scheduleId: "cron-abc",
        timestamp: 1_000_000 + i * 60_000,
        reason: "previous_run_active",
      })
    }

    await reconcileCronRunsAtBoot(deps, [], [CHAT])

    const outcome = events.find((e) => e.kind === "cron_run_outcome")
    expect(outcome).toMatchObject({ ok: false, errorCode: "orphaned" })
  })
})
