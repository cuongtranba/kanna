/**
 * Cron fire paths — what happens when a job's schedule triggers.
 *
 * inline: the run executes in the arming chat itself. Context is cleared
 * before EVERY run (fresh cycle; the chat is a monitoring view), then the
 * instruction starts as a normal turn.
 *
 * spawn: every run creates a brand-new chat in the arming chat's project and
 * executes there; the arming chat gets a `cron_run` card whose live status
 * joins the run by `runId` from the snapshot.
 *
 * Overlap policy is skip-and-record: a tick that lands while the previous
 * run (or, inline, the chat) is busy records a visible `cron_run_skipped` and
 * does nothing else. CONSECUTIVE skips collapse into one counted record
 * (`skip-coalescer.ts`) — under a sub-minute schedule the skipped ticks
 * outnumber the runs, and one card each buries the runs that did happen. The
 * streak is written when it ends, which is why both fire paths flush before
 * they start a run. The turn carries a `CronRunTag`; the store's
 * turn-terminal observer routes the outcome back to the arming chat via
 * `recordCronTurnOutcome`. If that hook is ever missed, `fireCronJob`
 * self-heals: a run still "running" whose chat is demonstrably idle is
 * settled as failed(`orphaned`) instead of skipping forever.
 */

import type { ChatAttachment } from "../../shared/types"
import type { CronJobSnapshot, CronRunSnapshot, CronRunTag } from "../../shared/cron/types"
import type { SendMessageOptions } from "../claude-steer-log"
import { AUTO_CONTINUE_EVENT_VERSION } from "../auto-continue/events"
import { deriveCronJobs, findRunningCronRuns, hasActiveRun } from "./read-model"
import { emitCronEvent, appendCronEntry, type CronCommandDeps } from "./commands"
import type { CoalescedSkipReason, CronSkipCoalescerPort } from "./skip-coalescer"

export interface CronFireDeps extends CronCommandDeps {
  /** Required here, unlike on the command deps: without it every tick writes. */
  skipCoalescer: CronSkipCoalescerPort
  getChatRecord(chatId: string): { projectId: string } | null
  isChatBusy(chatId: string): boolean
  clearChatContext(chatId: string): Promise<void>
  createChat(projectId: string): Promise<{ id: string }>
  enqueueMessage(
    chatId: string,
    content: string,
    attachments: ChatAttachment[],
    options?: SendMessageOptions,
  ): Promise<unknown>
  maybeStartNextQueuedMessage(chatId: string): Promise<boolean>
}

export async function fireCronJob(deps: CronFireDeps, chatId: string, jobId: string): Promise<void> {
  const now = deps.now?.() ?? Date.now()
  if (!deps.getChatRecord(chatId)) return

  const jobs = deriveCronJobs(deps.store.getAutoContinueEvents(chatId), chatId, now)
  let job = jobs.find((candidate) => candidate.jobId === jobId)
  if (!job || job.paused) return

  // Previous run still marked running: either it truly is (skip this tick)
  // or its outcome was lost (chat idle → settle as orphaned and proceed).
  if (hasActiveRun(job)) {
    const stale = latestRealRun(job)
    const runChatId = stale?.spawnedChatId ?? chatId
    if (stale && !deps.isChatBusy(runChatId)) {
      await emitCronEvent(deps, {
        v: AUTO_CONTINUE_EVENT_VERSION,
        kind: "cron_run_outcome",
        chatId,
        scheduleId: jobId,
        timestamp: now,
        runId: stale.runId,
        ok: false,
        errorCode: "orphaned",
      })
      job = deriveCronJobs(deps.store.getAutoContinueEvents(chatId), chatId, now)
        .find((candidate) => candidate.jobId === jobId)
      if (!job) return
    } else {
      await skip(deps, chatId, jobId, "previous_run_active")
      return
    }
  }

  if (job.mode === "inline") {
    if (deps.isChatBusy(chatId)) {
      await skip(deps, chatId, jobId, "chat_busy")
      return
    }
    // The streak (if any) ended here, so it is reported before the run it was
    // waiting on — the transcript then reads in the order things happened.
    await flushSkipStreak(deps, chatId, jobId)
    // Fresh context every cycle — the arming chat is a monitoring view.
    await deps.clearChatContext(chatId)
    const runId = newRunId()
    await emitCronEvent(deps, {
      v: AUTO_CONTINUE_EVENT_VERSION,
      kind: "cron_run_started",
      chatId,
      scheduleId: jobId,
      timestamp: deps.now?.() ?? Date.now(),
      runId,
    })
    const tag: CronRunTag = { jobId, runId, originChatId: chatId }
    await deps.enqueueMessage(chatId, job.instruction, [], { cronRun: tag })
    await deps.maybeStartNextQueuedMessage(chatId)
    return
  }

  // spawn: a new chat per run, in the arming chat's project.
  const project = deps.getChatRecord(chatId)
  if (!project) return
  await flushSkipStreak(deps, chatId, jobId)
  const spawned = await deps.createChat(project.projectId)
  const runId = newRunId()
  const firedAt = deps.now?.() ?? Date.now()
  await emitCronEvent(deps, {
    v: AUTO_CONTINUE_EVENT_VERSION,
    kind: "cron_run_started",
    chatId,
    scheduleId: jobId,
    timestamp: firedAt,
    runId,
    spawnedChatId: spawned.id,
  })
  await appendCronEntry(deps, chatId, {
    kind: "cron_run",
    jobId,
    runId,
    instruction: job.instruction,
    spawnedChatId: spawned.id,
    firedAt,
  })
  const tag: CronRunTag = { jobId, runId, originChatId: chatId }
  await deps.enqueueMessage(spawned.id, job.instruction, [], { cronRun: tag })
  await deps.maybeStartNextQueuedMessage(spawned.id)
  deps.emitStateChange(spawned.id)
}

/**
 * Called from the store's `onTurnTerminal` observer (via AgentCoordinator)
 * when a cron-tagged turn reaches its terminal event. Outcomes always land
 * on the ARMING chat.
 */
export async function recordCronTurnOutcome(
  deps: CronCommandDeps,
  tag: CronRunTag,
  outcome: "finished" | "failed" | "cancelled",
): Promise<void> {
  await emitCronEvent(deps, {
    v: AUTO_CONTINUE_EVENT_VERSION,
    kind: "cron_run_outcome",
    chatId: tag.originChatId,
    scheduleId: tag.jobId,
    timestamp: deps.now?.() ?? Date.now(),
    runId: tag.runId,
    ok: outcome === "finished",
    ...(outcome === "finished" ? {} : { errorCode: outcome === "cancelled" ? "cancelled" : "error" }),
  })
}

/**
 * Boot-time reconciliation, called right after `CronScheduler.rehydrate`:
 * (a) one visible `server_offline` skip per job that missed fires while the
 * server was down; (b) any run still "running" without a surviving queued
 * message is orphaned and settles as failed — runs whose tagged message is
 * still in the durable queue are left for `recoverQueuedMessages`.
 *
 * The orphan scan uses `findRunningCronRuns` (unbounded event walk) instead
 * of the display-capped `job.recentRuns` so a running run buried under many
 * skip records is never silently missed.
 */
export async function reconcileCronRunsAtBoot(
  deps: CronCommandDeps & {
    getQueuedMessages: (chatId: string) => ReadonlyArray<{ cronRun?: { runId: string } }>
  },
  missed: ReadonlyArray<{ chatId: string; jobId: string; missedCount: number }>,
  chatIds: readonly string[],
): Promise<void> {
  for (const entry of missed) {
    await emitCronEvent(deps, {
      v: AUTO_CONTINUE_EVENT_VERSION,
      kind: "cron_run_skipped",
      chatId: entry.chatId,
      scheduleId: entry.jobId,
      timestamp: deps.now?.() ?? Date.now(),
      reason: "server_offline",
      missedCount: entry.missedCount,
    })
    await appendCronEntry(deps, entry.chatId, {
      kind: "cron_run_skipped",
      jobId: entry.jobId,
      reason: "server_offline",
      missedCount: entry.missedCount,
    })
  }

  for (const chatId of chatIds) {
    const now = deps.now?.() ?? Date.now()
    for (const run of findRunningCronRuns(deps.store.getAutoContinueEvents(chatId), chatId)) {
      const runChatId = run.spawnedChatId ?? chatId
      const isQueued = deps.getQueuedMessages(runChatId).some((msg) => msg.cronRun?.runId === run.runId)
      if (isQueued) continue
      await emitCronEvent(deps, {
        v: AUTO_CONTINUE_EVENT_VERSION,
        kind: "cron_run_outcome",
        chatId,
        scheduleId: run.jobId,
        timestamp: now,
        runId: run.runId,
        ok: false,
        errorCode: "orphaned",
      })
    }
  }
}

/**
 * One skipped tick. Most of them write nothing — the coalescer decides, and
 * only hands back a record when a streak has to be reported (its reason
 * changed, or it has run past the flush window).
 */
async function skip(
  deps: CronFireDeps,
  chatId: string,
  jobId: string,
  reason: CoalescedSkipReason,
): Promise<void> {
  const now = deps.now?.() ?? Date.now()
  const record = deps.skipCoalescer.record(chatId, jobId, reason, now)
  if (!record) return
  await writeSkip(deps, chatId, jobId, record.reason, record.count)
}

/** The streak ended: report what it accumulated but never wrote. */
async function flushSkipStreak(deps: CronFireDeps, chatId: string, jobId: string): Promise<void> {
  const record = deps.skipCoalescer.flushPending(chatId, jobId, deps.now?.() ?? Date.now())
  if (!record) return
  await writeSkip(deps, chatId, jobId, record.reason, record.count)
}

async function writeSkip(
  deps: CronFireDeps,
  chatId: string,
  jobId: string,
  reason: CoalescedSkipReason,
  count: number,
): Promise<void> {
  // A count of one is the shape this event has always had; the field appears
  // only when it says something a reader could not assume.
  const missed = count > 1 ? { missedCount: count } : {}
  await emitCronEvent(deps, {
    v: AUTO_CONTINUE_EVENT_VERSION,
    kind: "cron_run_skipped",
    chatId,
    scheduleId: jobId,
    timestamp: deps.now?.() ?? Date.now(),
    reason,
    ...missed,
  })
  await appendCronEntry(deps, chatId, { kind: "cron_run_skipped", jobId, reason, ...missed })
}

function latestRealRun(job: CronJobSnapshot): CronRunSnapshot | null {
  for (const run of job.recentRuns) {
    if (run.status !== "skipped") return run
  }
  return null
}

function newRunId(): string {
  return `run-${crypto.randomUUID().slice(0, 8)}`
}
