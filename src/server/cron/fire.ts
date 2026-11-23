
import { type AgentProvider, type ChatAttachment, type QueuedChatMessage } from "../../shared/types"
import { splitClaudeApiModelId, type ModelOptions } from "../../shared/provider-model-types"
import { hasActiveRun, type CronJobSnapshot, type CronRunSnapshot, type CronRunTag } from "../../shared/cron/types"
import type { SendMessageOptions } from "../claude-turn-starter-types"
import { chatAutomationEnvelope } from "../auto-continue/events"
import { deriveLoopState } from "../auto-continue/read-model"
import { deriveCronJobs, findRunningCronRuns } from "./read-model"
import { emitCronEvent, appendCronEntry, type CronCommandDeps, type CronCommandStore } from "./commands"
import type { CoalescedSkipReason, CronSkipCoalescerPort } from "./skip-coalescer"

export interface CronFireStore extends CronCommandStore {
  clearChatTaskList(chatId: string, now: number): Promise<void>
}

export interface CronFireDeps extends CronCommandDeps {
  store: CronFireStore
  skipCoalescer: CronSkipCoalescerPort
  getChatRecord(chatId: string): { projectId: string; provider: AgentProvider | null } | null
  isChatBusy(chatId: string): boolean
  holdsBackgroundWork(chatId: string): boolean
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
  const now = deps.now()
  if (!deps.getChatRecord(chatId)) return

  const jobs = deriveCronJobs(deps.store.getAutoContinueEvents(chatId), chatId, now)
  let job = jobs.find((candidate) => candidate.jobId === jobId)
  if (!job || job.paused) return

  if (hasActiveRun(job)) {
    const stale = latestRealRun(job)
    const runChatId = stale?.spawnedChatId ?? chatId
    if (stale && !deps.isChatBusy(runChatId)) {
      await emitCronEvent(deps, {
        ...chatAutomationEnvelope(chatId, jobId, now),
        kind: "cron_run_outcome",
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
    if (deps.holdsBackgroundWork(chatId)) {
      await skip(deps, chatId, jobId, "background_work_pending")
      return
    }
    await flushSkipStreak(deps, chatId, jobId)
    await deps.clearChatContext(chatId)
    if (deriveLoopState(deps.store.getAutoContinueEvents(chatId), chatId) === null) {
      await deps.store.clearChatTaskList(chatId, deps.now())
    }
    const runId = newRunId()
    await emitCronEvent(deps, {
      ...chatAutomationEnvelope(chatId, jobId, deps.now()),
      kind: "cron_run_started",
      runId,
    })
    const tag: CronRunTag = { jobId, runId, originChatId: chatId }
    await deps.enqueueMessage(chatId, job.instruction, [], cronRunOptions(job, tag, deps.getChatRecord(chatId)?.provider ?? null))
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
  const firedAt = deps.now()
  await emitCronEvent(deps, {
    ...chatAutomationEnvelope(chatId, jobId, firedAt),
    kind: "cron_run_started",
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
  await deps.enqueueMessage(spawned.id, job.instruction, [], cronRunOptions(job, tag, project.provider))
  await deps.maybeStartNextQueuedMessage(spawned.id)
  deps.emitStateChange(spawned.id)
}

export async function recordCronTurnOutcome(
  deps: CronCommandDeps,
  tag: CronRunTag,
  outcome: "finished" | "failed" | "cancelled",
): Promise<void> {
  await emitCronEvent(deps, {
    ...chatAutomationEnvelope(tag.originChatId, tag.jobId, deps.now()),
    kind: "cron_run_outcome",
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
      ...chatAutomationEnvelope(entry.chatId, entry.jobId, deps.now()),
      kind: "cron_run_skipped",
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
    const now = deps.now()
    for (const run of findRunningCronRuns(deps.store.getAutoContinueEvents(chatId), chatId)) {
      const runChatId = run.spawnedChatId ?? chatId
      const isQueued = deps.getQueuedMessages(runChatId).some((msg) => msg.cronRun?.runId === run.runId)
      if (isQueued) continue
      await emitCronEvent(deps, {
        ...chatAutomationEnvelope(chatId, run.jobId, now),
        kind: "cron_run_outcome",
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
  const now = deps.now()
  const record = deps.skipCoalescer.record(chatId, jobId, reason, now)
  if (!record) return
  await writeSkip(deps, chatId, jobId, record.reason, record.count)
}

async function flushSkipStreak(deps: CronFireDeps, chatId: string, jobId: string): Promise<void> {
  const record = deps.skipCoalescer.flushPending(chatId, jobId, deps.now())
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
    ...chatAutomationEnvelope(chatId, jobId, deps.now()),
    kind: "cron_run_skipped",
    reason,
    ...missed,
  })
  await appendCronEntry(deps, chatId, { kind: "cron_run_skipped", jobId, reason, ...missed })
}

function cronRunOptions(job: CronJobSnapshot, cronRun: CronRunTag, provider: AgentProvider | null): SendMessageOptions {
  if (job.model === undefined && job.modelOptions === undefined) return { cronRun }
  const split = job.model !== undefined ? splitClaudeApiModelId(job.model) : null
  const modelOptions: ModelOptions | undefined =
    split?.contextWindow === "1m"
      ? { ...job.modelOptions, claude: { ...job.modelOptions?.claude, contextWindow: "1m" } }
      : job.modelOptions
  return {
    cronRun,
    ...(split ? { model: split.modelId, ...(provider ? { provider } : {}) } : {}),
    ...(modelOptions !== undefined ? { modelOptions } : {}),
  }
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
