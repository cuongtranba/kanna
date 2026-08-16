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
 * run (or, inline, the chat) is busy appends a visible `cron_run_skipped`
 * and does nothing else. The turn carries a `CronRunTag`; the store's
 * turn-terminal observer routes the outcome back to the arming chat via
 * `recordCronTurnOutcome`. If that hook is ever missed, `fireCronJob`
 * self-heals: a run still "running" whose chat is demonstrably idle is
 * settled as failed(`orphaned`) instead of skipping forever.
 */

import type { ChatAttachment } from "../../shared/types"
import type { CronJobSnapshot, CronRunSnapshot, CronRunTag } from "../../shared/cron/types"
import type { SendMessageOptions } from "../claude-steer-log"
import { AUTO_CONTINUE_EVENT_VERSION } from "../auto-continue/events"
import { deriveCronJobs, hasActiveRun } from "./read-model"
import { emitCronEvent, appendCronEntry, type CronCommandDeps } from "./commands"

export interface CronFireDeps extends CronCommandDeps {
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
 * server was down; (b) any run still "running" is orphaned — no turn
 * survives a restart — and settles as failed.
 */
export async function reconcileCronRunsAtBoot(
  deps: CronCommandDeps,
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
    for (const job of deriveCronJobs(deps.store.getAutoContinueEvents(chatId), chatId, now)) {
      for (const run of job.recentRuns) {
        if (run.status !== "running") continue
        await emitCronEvent(deps, {
          v: AUTO_CONTINUE_EVENT_VERSION,
          kind: "cron_run_outcome",
          chatId,
          scheduleId: job.jobId,
          timestamp: now,
          runId: run.runId,
          ok: false,
          errorCode: "orphaned",
        })
      }
    }
  }
}

async function skip(
  deps: CronFireDeps,
  chatId: string,
  jobId: string,
  reason: "chat_busy" | "previous_run_active",
): Promise<void> {
  await emitCronEvent(deps, {
    v: AUTO_CONTINUE_EVENT_VERSION,
    kind: "cron_run_skipped",
    chatId,
    scheduleId: jobId,
    timestamp: deps.now?.() ?? Date.now(),
    reason,
  })
  await appendCronEntry(deps, chatId, { kind: "cron_run_skipped", jobId, reason })
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
