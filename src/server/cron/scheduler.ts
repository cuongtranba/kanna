
import type { CronSchedule } from "../../shared/cron/types"
import { nextFireAt } from "./next-fire"
import { foldCronJobs } from "./read-model"
import type { ChatAutomationEvent } from "../auto-continue/events"
import { realClock, type Clock } from "../auto-continue/schedule-manager"
import { log } from "../../shared/log"
import { toError } from "../../shared/errors"
import { cronJobKey } from "./job-key"

const MAX_TIMER_CHUNK_MS = 6 * 3_600_000
const MAX_MISSED_COUNT = 100

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

  rehydrate(
    events: readonly ChatAutomationEvent[],
  ): Array<{ chatId: string; jobId: string; missedCount: number }> {
    const chatIds = new Set<string>()
    for (const event of events) chatIds.add(event.chatId)

    const missed: Array<{ chatId: string; jobId: string; missedCount: number }> = []
    const now = this.clock.now()
    for (const chatId of chatIds) {
      for (const snapshot of foldCronJobs(events, chatId)) {
        const job: ArmedJob = {
          chatId,
          jobId: snapshot.jobId,
          schedule: snapshot.schedule,
          armedAt: snapshot.armedAt,
          paused: snapshot.paused,
          timerId: null,
          nextFireAtMs: null,
        }
        this.jobs.set(cronJobKey(chatId, snapshot.jobId), job)
        if (job.paused) continue

        const lastSeen = Math.max(snapshot.armedAt, snapshot.lastRun?.firedAt ?? 0)
        const missedCount = countMissedFires(snapshot.schedule, lastSeen, now, snapshot.armedAt)
        if (missedCount > 0) missed.push({ chatId, jobId: snapshot.jobId, missedCount })
        this.arm(job)
      }
    }
    return missed
  }

  onEvent(event: ChatAutomationEvent): void {
    switch (event.kind) {
      case "cron_armed": {
        this.clearJob(cronJobKey(event.chatId, event.scheduleId))
        const job: ArmedJob = {
          chatId: event.chatId,
          jobId: event.scheduleId,
          schedule: event.schedule,
          armedAt: event.timestamp,
          paused: event.paused ?? false,
          timerId: null,
          nextFireAtMs: null,
        }
        this.jobs.set(cronJobKey(event.chatId, event.scheduleId), job)
        if (!job.paused) this.arm(job)
        return
      }
      case "cron_disarmed":
        this.clearJob(cronJobKey(event.chatId, event.scheduleId))
        return
      case "cron_paused": {
        const job = this.jobs.get(cronJobKey(event.chatId, event.scheduleId))
        if (!job) return
        job.paused = true
        this.clearTimer(job)
        return
      }
      case "cron_resumed": {
        const job = this.jobs.get(cronJobKey(event.chatId, event.scheduleId))
        if (!job) return
        job.paused = false
        this.arm(job)
        break
      }
      default:
        break
    }
  }

  nextFireFor(chatId: string, jobId: string): number | null {
    return this.jobs.get(cronJobKey(chatId, jobId))?.nextFireAtMs ?? null
  }

  clearChat(chatId: string): void {
    for (const [key, job] of this.jobs) {
      if (job.chatId !== chatId) continue
      this.clearTimer(job)
      this.jobs.delete(key)
    }
  }

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

  private armChunk(job: ArmedJob): void {
    if (job.nextFireAtMs === null) return
    const delay = Math.min(Math.max(0, job.nextFireAtMs - this.clock.now()), MAX_TIMER_CHUNK_MS)
    job.timerId = this.clock.setTimeout(() => {
      job.timerId = null
      if (this.stopped || job.paused || !this.jobs.has(cronJobKey(job.chatId, job.jobId))) return
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
    if (this.stopped || !this.jobs.has(cronJobKey(job.chatId, job.jobId)) || job.paused) return
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
