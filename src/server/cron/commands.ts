/**
 * Cron command handler cluster — arm / list / remove / pause / resume plus
 * the single choke-point `emitCronEvent` (append event → scheduler.onEvent →
 * state broadcast → global topic push), mirroring `emitAutoContinueEvent`.
 *
 * Side-effect seal: no direct IO; everything effectful is injected.
 */

import type { TranscriptEntry } from "../../shared/types"
import { hasActiveRun, type CronArmSummary, type CronParseError, type CronParseResult } from "../../shared/cron/types"
import type { CronRepair } from "./repair"
import type { CronConfirm } from "./confirm"
import { cronModeConsequence } from "../../shared/cron/arm-summary"
import { humanizeSchedule } from "../../shared/cron/humanize"
import { nextFireAt } from "./next-fire"
import type { AutoContinueEvent } from "../auto-continue/events"
import { AUTO_CONTINUE_EVENT_VERSION } from "../auto-continue/events"
import { deriveCronJobs } from "./read-model"
import { timestamped } from "../claude-message-normalizer"

export interface CronCommandStore {
  appendMessage(chatId: string, entry: TranscriptEntry): Promise<unknown>
  appendAutoContinueEvent(event: AutoContinueEvent): Promise<void>
  getAutoContinueEvents(chatId: string): AutoContinueEvent[]
}

export interface CronCommandDeps {
  store: CronCommandStore
  /** Timer registry; null in tests that only exercise event/entry output. */
  cronScheduler: { onEvent(event: AutoContinueEvent): void } | null
  /**
   * Skip-streak state, so a job that stops existing cannot leave one behind.
   * Optional: dropping a streak is cleanup, and its absence can only lose a
   * count — unlike on the fire path, where absence would restore a write per
   * tick, so there it is required.
   */
  skipCoalescer?: { forget(chatId: string, jobId: string): void }
  emitStateChange(chatId: string): void
  /** Re-push the global cron-jobs topic. Optional: wired by the WS router. */
  pushCronJobsUpdate?: () => void
  /**
   * Hands a rejected line to the model when Kanna has no fix of its own.
   * Optional so tests exercising event/entry output need not wire it.
   */
  cronRepair?: CronRepair
  /**
   * Escalates a successful typed arm to a model review turn so the user can
   * confirm, adjust, or disarm the job before it runs unchecked.
   * Optional: absent on the arm_cron tool path (model already confirms
   * in-turn) and in tests exercising event/entry output only.
   */
  cronConfirm?: CronConfirm
  now?: () => number
  newJobId?: () => string
  resolveChatCwd?: (chatId: string) => string | undefined
}

/**
 * The one write path for cron events. Everything that arms, disarms, pauses,
 * or records a run goes through here so the scheduler, the per-chat snapshot,
 * and the global management page can never disagree.
 */
export async function emitCronEvent(deps: CronCommandDeps, event: AutoContinueEvent): Promise<void> {
  await deps.store.appendAutoContinueEvent(event)
  deps.cronScheduler?.onEvent(event)
  // A job that is gone, paused, or freshly re-armed owns no unreported skips:
  // the streak dies with it rather than surfacing under the next arming.
  if (event.kind === "cron_armed" || event.kind === "cron_disarmed" || event.kind === "cron_paused") {
    deps.skipCoalescer?.forget(event.chatId, event.scheduleId)
  }
  deps.emitStateChange(event.chatId)
  deps.pushCronJobsUpdate?.()
}

/**
 * Dispatch a parsed `/cron` message. Never starts a turn; every outcome —
 * success or validation failure — lands as a visible transcript entry.
 */
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
      const now = deps.now?.() ?? Date.now()
      const fires = computeUpcomingFires(command.schedule, now, 3)
      if (fires.length === 0) {
        await refuseCronCommand(deps, chatId, {
          part: "schedule",
          message: `schedule "${command.scheduleText}" never fires (no matching date exists) — not armed`,
          input: `/cron ${command.instruction} ${command.mode} ${command.scheduleText}`,
        })
        return null
      }

      const jobId = pickJobId(deps, chatId)
      await emitCronEvent(deps, {
        v: AUTO_CONTINUE_EVENT_VERSION,
        kind: "cron_armed",
        chatId,
        scheduleId: jobId,
        timestamp: now,
        instruction: command.instruction,
        mode: command.mode,
        scheduleText: command.scheduleText,
        schedule: command.schedule,
        ...(model !== undefined ? { model } : {}),
      })
      const cwd = deps.resolveChatCwd?.(chatId)
      const scheduleHuman = humanizeSchedule(command.schedule, command.scheduleText)
      await appendCronEntry(deps, chatId, {
        kind: "cron_armed",
        jobId,
        instruction: command.instruction,
        mode: command.mode,
        scheduleText: command.scheduleText,
        scheduleHuman,
        nextFireAt: fires[0] ?? null,
        ...(model !== undefined ? { model } : {}),
        upcomingFires: fires,
        ...(cwd !== undefined ? { cwd } : {}),
      })
      const summary: CronArmSummary = {
        jobId,
        instruction: command.instruction,
        mode: command.mode,
        modeConsequence: cronModeConsequence(command.mode),
        scheduleText: command.scheduleText,
        scheduleHuman,
        upcomingFires: fires,
        model: model ?? null,
        cwd: cwd ?? null,
      }
      await deps.cronConfirm?.offer(chatId, jobId, summary)
      return jobId
    }
    case "remove":
    case "pause":
    case "resume": {
      const now = deps.now?.() ?? Date.now()
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

      const base = {
        v: AUTO_CONTINUE_EVENT_VERSION,
        chatId,
        scheduleId: command.jobId,
        timestamp: now,
      } as const
      let event: AutoContinueEvent
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
      const now = deps.now?.() ?? Date.now()
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
        v: AUTO_CONTINUE_EVENT_VERSION,
        kind: "cron_armed",
        chatId,
        scheduleId: command.jobId,
        timestamp: now,
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

/**
 * The one way a `/cron` line is refused: the card the reader sees and the
 * offer to the model are a single step, so a new refusal cannot record one
 * without the other. The repair itself decides whether to spend a turn — a
 * failure Kanna already has a suggestion for is dropped there, not here.
 */
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

/**
 * Disarm every cron job on a chat (chat deleted). Emits `cron_disarmed` per
 * job — which also clears its timer through the scheduler — but appends no
 * transcript entries: the chat is going away.
 */
export async function disarmCronJobsForChat(deps: CronCommandDeps, chatId: string): Promise<void> {
  const now = deps.now?.() ?? Date.now()
  const jobs = deriveCronJobs(deps.store.getAutoContinueEvents(chatId), chatId, now)
  for (const job of jobs) {
    await emitCronEvent(deps, {
      v: AUTO_CONTINUE_EVENT_VERSION,
      kind: "cron_disarmed",
      reason: "chat_deleted",
      chatId,
      scheduleId: job.jobId,
      timestamp: now,
    })
  }
}

/**
 * `Omit` over the whole union collapses to the common keys and rejects
 * per-kind fields; distributing it per member keeps excess-property checks.
 */
type NewTranscriptEntry = {
  [K in TranscriptEntry["kind"]]: Omit<Extract<TranscriptEntry, { kind: K }>, "_id" | "createdAt">
}[TranscriptEntry["kind"]]

export async function appendCronEntry(
  deps: CronCommandDeps,
  chatId: string,
  entry: NewTranscriptEntry,
): Promise<void> {
  const stamped: TranscriptEntry = timestamped(entry, deps.now?.() ?? Date.now())
  await deps.store.appendMessage(chatId, stamped)
  deps.emitStateChange(chatId)
}

function computeUpcomingFires(schedule: import("../../shared/cron/types").CronSchedule, nowMs: number, count: number): number[] {
  const fires: number[] = []
  let cursor = nowMs
  for (let i = 0; i < count; i++) {
    const next = nextFireAt(schedule, cursor, nowMs)
    if (next === null) break
    fires.push(next)
    cursor = next
  }
  return fires
}

function pickJobId(deps: CronCommandDeps, chatId: string): string {
  const taken = new Set(
    deriveCronJobs(deps.store.getAutoContinueEvents(chatId), chatId, deps.now?.() ?? Date.now()).map(
      (job) => job.jobId,
    ),
  )
  for (let attempt = 0; attempt < 8; attempt++) {
    const candidate = deps.newJobId?.() ?? `cron-${crypto.randomUUID().slice(0, 6)}`
    if (!taken.has(candidate)) return candidate
  }
  // Injected generators that always collide fall through to a full UUID.
  return `cron-${crypto.randomUUID()}`
}
