
import type { TranscriptEntry } from "../../shared/types"
import { hasActiveRun, type CronParseError, type CronParseResult } from "../../shared/cron/types"
import type { CronRepair } from "./repair"
import type { CronConfirm } from "./confirm"
import { chatAutomationEnvelope, type ChatAutomationEvent, type CronEvent } from "../auto-continue/events"
import { deriveCronJobs } from "./read-model"
import { planCronArm } from "./preview"
import { timestamped } from "../claude-message-normalizer"

export interface CronCommandStore {
  appendMessage(chatId: string, entry: TranscriptEntry): Promise<void>
  appendAutoContinueEvent(event: ChatAutomationEvent): Promise<void>
  getAutoContinueEvents(chatId: string): ChatAutomationEvent[]
}

export interface CronCommandDeps {
  store: CronCommandStore
  cronScheduler: { onEvent(event: ChatAutomationEvent): void } | null
  skipCoalescer?: { forget(chatId: string, jobId: string): void }
  emitStateChange(chatId: string): void
  pushCronJobsUpdate?: () => void
  cronRepair?: CronRepair
  cronConfirm?: CronConfirm
  now: () => number
  newJobId?: () => string
  resolveChatCwd?: (chatId: string) => string | undefined
}

export async function emitCronEvent(deps: CronCommandDeps, event: CronEvent): Promise<void> {
  await deps.store.appendAutoContinueEvent(event)
  deps.cronScheduler?.onEvent(event)
  if (event.kind === "cron_armed" || event.kind === "cron_disarmed" || event.kind === "cron_paused") {
    deps.skipCoalescer?.forget(event.chatId, event.scheduleId)
  }
  deps.emitStateChange(event.chatId)
  deps.pushCronJobsUpdate?.()
}

export async function runCronCommand(
  deps: CronCommandDeps,
  chatId: string,
  result: CronParseResult,
  model?: string,
): Promise<string | null> {
  if (!result.ok) {
    await refuseCronCommand(deps, chatId, result.error)
    return null
  }

  const command = result.command
  switch (command.sub) {
    case "help":
      await appendCronEntry(deps, chatId, { kind: "cron_list", help: true })
      return null
    case "list":
      await appendCronEntry(deps, chatId, { kind: "cron_list" })
      return null
    case "arm": {
      const now = deps.now()
      const cwd = deps.resolveChatCwd?.(chatId)
      const plan = planCronArm(command, now, { model, cwd })
      if (!plan.ok) {
        await refuseCronCommand(deps, chatId, {
          part: "schedule",
          message: `${plan.neverFires} — not armed`,
          input: `/cron ${command.instruction} ${command.mode} ${command.scheduleText}`,
        })
        return null
      }

      const jobId = pickJobId(deps, chatId)
      const summary = { ...plan.summary, jobId }
      await emitCronEvent(deps, {
        ...chatAutomationEnvelope(chatId, jobId, now),
        kind: "cron_armed",
        instruction: command.instruction,
        mode: command.mode,
        scheduleText: command.scheduleText,
        schedule: command.schedule,
        ...(model !== undefined ? { model } : {}),
      })
      await appendCronEntry(deps, chatId, {
        kind: "cron_armed",
        jobId,
        instruction: command.instruction,
        mode: command.mode,
        scheduleText: command.scheduleText,
        scheduleHuman: summary.scheduleHuman,
        nextFireAt: summary.upcomingFires[0] ?? null,
        ...(model !== undefined ? { model } : {}),
        upcomingFires: summary.upcomingFires,
        ...(cwd !== undefined ? { cwd } : {}),
      })
      await deps.cronConfirm?.offer(chatId, jobId, summary)
      return jobId
    }
    case "remove":
    case "pause":
    case "resume": {
      const now = deps.now()
      const jobs = deriveCronJobs(deps.store.getAutoContinueEvents(chatId), chatId, now)
      const job = jobs.find((candidate) => candidate.jobId === command.jobId)
      if (!job) {
        await appendCronEntry(deps, chatId, {
          kind: "cron_command_error",
          message: `no cron job "${command.jobId}" in this chat — run \`/cron list\` to see armed jobs`,
          suggestion: "/cron list",
        })
        return null
      }
      if (command.sub === "pause" && job.paused) {
        await appendCronEntry(deps, chatId, {
          kind: "cron_command_error",
          message: `cron job "${command.jobId}" is already paused`,
        })
        return null
      }
      if (command.sub === "resume" && !job.paused) {
        await appendCronEntry(deps, chatId, {
          kind: "cron_command_error",
          message: `cron job "${command.jobId}" is not paused`,
        })
        return null
      }

      const base = chatAutomationEnvelope(chatId, command.jobId, now)
      let event: CronEvent
      let change: "removed" | "paused" | "resumed"
      if (command.sub === "remove") {
        event = { ...base, kind: "cron_disarmed", reason: "user" }
        change = "removed"
      } else if (command.sub === "pause") {
        event = { ...base, kind: "cron_paused" }
        change = "paused"
      } else {
        event = { ...base, kind: "cron_resumed" }
        change = "resumed"
      }
      await emitCronEvent(deps, event)
      await appendCronEntry(deps, chatId, {
        kind: "cron_job_change",
        jobId: command.jobId,
        change,
      })
      return null
    }
    case "update": {
      const now = deps.now()
      const jobs = deriveCronJobs(deps.store.getAutoContinueEvents(chatId), chatId, now)
      const job = jobs.find((candidate) => candidate.jobId === command.jobId)
      if (!job) {
        await appendCronEntry(deps, chatId, {
          kind: "cron_command_error",
          message: `no cron job "${command.jobId}" in this chat — run \`/cron list\` to see armed jobs`,
          suggestion: "/cron list",
        })
        return null
      }
      if (hasActiveRun(job)) {
        await appendCronEntry(deps, chatId, {
          kind: "cron_command_error",
          message: `cannot update cron job "${command.jobId}" while a run is in flight — wait for it to finish`,
        })
        return null
      }
      const patch = command.patch
      const instruction = patch.instruction ?? job.instruction
      const mode = patch.mode ?? job.mode
      const schedule = patch.schedule ?? job.schedule
      const scheduleText = patch.scheduleText ?? job.scheduleText
      await emitCronEvent(deps, {
        ...chatAutomationEnvelope(chatId, command.jobId, now),
        kind: "cron_armed",
        instruction,
        mode,
        schedule,
        scheduleText,
        ...(job.model !== undefined ? { model: job.model } : {}),
        ...(job.paused ? { paused: true } : {}),
      })
      await appendCronEntry(deps, chatId, {
        kind: "cron_job_change",
        jobId: command.jobId,
        change: "updated",
      })
      return null
    }
  }
  return null
}

async function refuseCronCommand(
  deps: CronCommandDeps,
  chatId: string,
  error: CronParseError,
): Promise<void> {
  await appendCronEntry(deps, chatId, {
    kind: "cron_command_error",
    message: error.message,
    input: error.input,
    ...(error.suggestion !== undefined ? { suggestion: error.suggestion } : {}),
  })
  await deps.cronRepair?.offer(chatId, error)
}

export async function disarmCronJobsForChat(deps: CronCommandDeps, chatId: string): Promise<void> {
  const now = deps.now()
  const jobs = deriveCronJobs(deps.store.getAutoContinueEvents(chatId), chatId, now)
  for (const job of jobs) {
    await emitCronEvent(deps, {
      ...chatAutomationEnvelope(chatId, job.jobId, now),
      kind: "cron_disarmed",
      reason: "chat_deleted",
    })
  }
}

type NewTranscriptEntry = {
  [K in TranscriptEntry["kind"]]: Omit<Extract<TranscriptEntry, { kind: K }>, "_id" | "createdAt">
}[TranscriptEntry["kind"]]

export async function appendCronEntry(
  deps: CronCommandDeps,
  chatId: string,
  entry: NewTranscriptEntry,
): Promise<void> {
  const stamped: TranscriptEntry = timestamped(entry, deps.now())
  await deps.store.appendMessage(chatId, stamped)
  deps.emitStateChange(chatId)
}

function pickJobId(deps: CronCommandDeps, chatId: string): string {
  const taken = new Set(
    deriveCronJobs(deps.store.getAutoContinueEvents(chatId), chatId, deps.now()).map(
      (job) => job.jobId,
    ),
  )
  for (let attempt = 0; attempt < 8; attempt++) {
    const candidate = deps.newJobId?.() ?? `cron-${crypto.randomUUID().slice(0, 6)}`
    if (!taken.has(candidate)) return candidate
  }
  return `cron-${crypto.randomUUID()}`
}
