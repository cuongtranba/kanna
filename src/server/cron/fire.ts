
import type { ChatAttachment, QueuedChatMessage } from "../../shared/types"
import { hasActiveRun, type CronJobSnapshot, type CronRunSnapshot, type CronRunTag } from "../../shared/cron/types"
import type { SendMessageOptions } from "../claude-steer-log"
import { AUTO_CONTINUE_EVENT_VERSION } from "../auto-continue/events"
import { deriveCronJobs, findRunningCronRuns } from "./read-model"
import { emitCronEvent, appendCronEntry, type CronCommandDeps } from "./commands"
import type { CoalescedSkipReason, CronSkipCoalescerPort } from "./skip-coalescer"

export interface CronFireDeps extends CronCommandDeps {
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
  ): Promise<QueuedChatMessage>
  maybeStartNextQueuedMessage(chatId: string): Promise<boolean>
  onChatSpawned?(originChatId: string, spawnedChatId: string): void
}

export async function fireCronJob(deps: CronFireDeps, chatId: string, jobId: string): Promise<void> {
  const now = deps.now?.() ?? Date.now()
  if (!deps.getChatRecord(chatId)) return

  const jobs = deriveCronJobs(deps.store.getAutoContinueEvents(chatId), chatId, now)
  let job = jobs.find((candidate) => candidate.jobId === jobId)
  if (!job || job.paused) return

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
    await flushSkipStreak(deps, chatId, jobId)
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

  const project = deps.getChatRecord(chatId)
  if (!project) return
  await flushSkipStreak(deps, chatId, jobId)
  const spawned = await deps.createChat(project.projectId)
  try {
    deps.onChatSpawned?.(chatId, spawned.id)
  } catch {
  }
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
