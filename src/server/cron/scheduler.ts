/**
 * CronScheduler — recurring timers for armed cron jobs.
 *
 * A deliberate sibling of `ScheduleManager` (one-shot, event-lifecycle
 * driven), not an extension of it: cron re-arms after every fire, carries
 * pause state, and computes its next occurrence from a schedule spec rather
 * than a timestamp stored in the event.
 *
 * Timer strategy: per-job one-shot timeouts CHUNKED at 6 h max and
 * recomputed from the wall clock on every wake. Chunking handles the
 * ~24.8-day setTimeout clamp, DST shifts, laptop sleep, and NTP drift —
 * next-fire is always recomputed from `clock.now()`, never accumulated.
 *
 * Missed fires (server was down) are SKIPPED: rehydrate reports one
 * `onMissedFires` per affected job (the coordinator appends a visible
 * `cron_run_skipped {reason:"server_offline"}`) and arms at the next FUTURE
 * occurrence. No run storm at boot.
 *
 * Graceful shutdown: `shutdown()` is async. It sets a `stopped` flag so any
 * timer callback that fires concurrently declines to start a NEW fire, then
 * awaits every in-flight `runFire` call under a bounded deadline. Fires that
 * outlive the deadline are abandoned (killed when the process exits) and
 * their runs are reconciled as `orphaned` at next boot by
 * `reconcileCronRunsAtBoot`.
 */

import type { CronSchedule } from "../../shared/cron/types"
import { nextFireAt } from "./next-fire"
import { deriveCronJobs } from "./read-model"
import type { AutoContinueEvent } from "../auto-continue/events"
import { realClock, type Clock } from "../auto-continue/schedule-manager"
import { log } from "../../shared/log"
import { toError } from "../../shared/errors"

const MAX_TIMER_CHUNK_MS = 6 * 3_600_000
/** Reported missed-fire counts are capped — "100+" is as useful as 4 032. */
const MAX_MISSED_COUNT = 100

/**
 * How long `shutdown()` waits for in-flight fires to complete. Shorter than
 * Docker's default 10 s kill grace so the drain finishes before SIGKILL.
 */
export const SHUTDOWN_DRAIN_TIMEOUT_MS = 5_000

export interface CronSchedulerArgs {
  clock?: Clock
  fire: (chatId: string, jobId: string) => Promise<void>
  onError?: (error: Error) => void
  shutdownDrainTimeoutMs?: number
}

interface ArmedJob {
  chatId: string
  jobId: string
  schedule: CronSchedule
  armedAt: number
  paused: boolean
  timerId: number | null
  nextFireAtMs: number | null
}

export class CronScheduler {
  private readonly clock: Clock
  private readonly fireFn: CronSchedulerArgs["fire"]
  private readonly onError: (error: Error) => void
  private readonly drainTimeoutMs: number
  private readonly jobs = new Map<string, ArmedJob>()
  private readonly inFlight = new Set<Promise<void>>()
  private stopped = false

  constructor(args: CronSchedulerArgs) {
    this.clock = args.clock ?? realClock
    this.fireFn = args.fire
    this.drainTimeoutMs = args.shutdownDrainTimeoutMs ?? SHUTDOWN_DRAIN_TIMEOUT_MS
    this.onError = args.onError ?? ((error) => log.error("[kanna/cron-scheduler]", String(error)))
  }

  /**
   * Replay the whole event log at boot. Returns the jobs that missed at
   * least one fire while the server was down, so the caller can append one
   * visible `server_offline` skip per job — the scheduler itself never
   * writes events.
   */
  rehydrate(
    events: readonly AutoContinueEvent[],
  ): Array<{ chatId: string; jobId: string; missedCount: number }> {
    const chatIds = new Set<string>()
    for (const event of events) chatIds.add(event.chatId)

    const missed: Array<{ chatId: string; jobId: string; missedCount: number }> = []
    const now = this.clock.now()
    for (const chatId of chatIds) {
      for (const snapshot of deriveCronJobs(events, chatId, now)) {
        const job: ArmedJob = {
          chatId,
          jobId: snapshot.jobId,
          schedule: snapshot.schedule,
          armedAt: snapshot.armedAt,
          paused: snapshot.paused,
          timerId: null,
          nextFireAtMs: null,
        }
        this.jobs.set(keyOf(chatId, snapshot.jobId), job)
        if (job.paused) continue

        const lastSeen = Math.max(snapshot.armedAt, snapshot.lastRun?.firedAt ?? 0)
        const missedCount = countMissedFires(snapshot.schedule, lastSeen, now, snapshot.armedAt)
        if (missedCount > 0) missed.push({ chatId, jobId: snapshot.jobId, missedCount })
        this.arm(job)
      }
    }
    return missed
  }

  onEvent(event: AutoContinueEvent): void {
    switch (event.kind) {
      case "cron_armed": {
        this.clearJob(keyOf(event.chatId, event.scheduleId))
        const job: ArmedJob = {
          chatId: event.chatId,
          jobId: event.scheduleId,
          schedule: event.schedule,
          armedAt: event.timestamp,
          paused: event.paused ?? false,
          timerId: null,
          nextFireAtMs: null,
        }
        this.jobs.set(keyOf(event.chatId, event.scheduleId), job)
        if (!job.paused) this.arm(job)
        return
      }
      case "cron_disarmed":
        this.clearJob(keyOf(event.chatId, event.scheduleId))
        return
      case "cron_paused": {
        const job = this.jobs.get(keyOf(event.chatId, event.scheduleId))
        if (!job) return
        job.paused = true
        this.clearTimer(job)
        return
      }
      case "cron_resumed": {
        const job = this.jobs.get(keyOf(event.chatId, event.scheduleId))
        if (!job) return
        job.paused = false
        this.arm(job)
        break
      }
      default:
        // Run bookkeeping and non-cron events carry no timer consequences.
        break
    }
  }

  /** Next planned fire for a job, or null (unknown / paused / never fires). */
  nextFireFor(chatId: string, jobId: string): number | null {
    return this.jobs.get(keyOf(chatId, jobId))?.nextFireAtMs ?? null
  }

  /** Drop every job and timer for a chat (chat deleted). */
  clearChat(chatId: string): void {
    for (const [key, job] of this.jobs) {
      if (job.chatId !== chatId) continue
      this.clearTimer(job)
      this.jobs.delete(key)
    }
  }

  /**
   * Stop all timers, decline new fires, and wait for any in-flight fire to
   * complete (bounded by `drainTimeoutMs`). Fires still running at the
   * deadline are abandoned and will be reconciled as `orphaned` at next boot.
   */
  async shutdown(): Promise<void> {
    this.stopped = true
    for (const job of this.jobs.values()) this.clearTimer(job)
    this.jobs.clear()

    if (this.inFlight.size === 0) return

    const pending = this.inFlight.size
    const drained = await Promise.race([
      Promise.allSettled([...this.inFlight]).then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), this.drainTimeoutMs)),
    ])
    if (!drained) {
      log.warn(`[kanna/cron-scheduler] shutdown drain timed out with ${pending} fire(s) still in flight`)
    }
  }

  private arm(job: ArmedJob): void {
    this.clearTimer(job)
    const now = this.clock.now()
    const next = nextFireAt(job.schedule, now, job.armedAt)
    if (next === null) return
    job.nextFireAtMs = next
    this.armChunk(job)
  }

  /**
   * One bounded timeout toward `nextFireAtMs`. On wake either the fire is
   * due (run it, then re-arm from the current wall clock) or the remaining
   * distance gets a fresh chunk — recomputed against `clock.now()` each
   * time, so clock adjustments are absorbed at chunk granularity.
   */
  private armChunk(job: ArmedJob): void {
    if (job.nextFireAtMs === null) return
    const delay = Math.min(Math.max(0, job.nextFireAtMs - this.clock.now()), MAX_TIMER_CHUNK_MS)
    job.timerId = this.clock.setTimeout(() => {
      job.timerId = null
      if (this.stopped || job.paused || !this.jobs.has(keyOf(job.chatId, job.jobId))) return
      if (job.nextFireAtMs !== null && this.clock.now() < job.nextFireAtMs) {
        this.armChunk(job)
        return
      }
      const fire = this.runFire(job)
      this.inFlight.add(fire)
      fire.finally(() => this.inFlight.delete(fire))
    }, delay)
  }

  private async runFire(job: ArmedJob): Promise<void> {
    job.nextFireAtMs = null
    try {
      await this.fireFn(job.chatId, job.jobId)
    } catch (error) {
      this.onError(toError(error))
    }
    if (this.stopped || !this.jobs.has(keyOf(job.chatId, job.jobId)) || job.paused) return
    this.arm(job)
  }

  private clearJob(key: string): void {
    const job = this.jobs.get(key)
    if (!job) return
    this.clearTimer(job)
    this.jobs.delete(key)
  }

  private clearTimer(job: ArmedJob): void {
    if (job.timerId !== null) {
      this.clock.clearTimeout(job.timerId)
      job.timerId = null
    }
    job.nextFireAtMs = null
  }
}

function keyOf(chatId: string, jobId: string): string {
  return `${chatId} ${jobId}`
}

function countMissedFires(
  schedule: CronSchedule,
  lastSeenMs: number,
  nowMs: number,
  anchorMs: number,
): number {
  if (schedule.type === "interval") {
    const first = nextFireAt(schedule, lastSeenMs, anchorMs)
    if (first === null || first > nowMs) return 0
    return Math.min(MAX_MISSED_COUNT, Math.floor((nowMs - first) / schedule.ms) + 1)
  }
  let count = 0
  let cursor = lastSeenMs
  while (count < MAX_MISSED_COUNT) {
    const next = nextFireAt(schedule, cursor, anchorMs)
    if (next === null || next > nowMs) break
    count += 1
    cursor = next
  }
  return count
}
