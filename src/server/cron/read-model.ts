/**
 * Cron read model — folds the auto-continue event log into the chat's armed
 * cron jobs. Pure replay over the same durable stream `deriveLoopState`
 * uses, so cron state survives restart for free. Consumed by
 * `deriveChatSnapshot` (per-chat panel + run cards), the global cron-jobs
 * topic, the scheduler's rehydrate, and the fire path's overlap guard.
 */

import {
  MAX_RECENT_CRON_RUNS,
  type CronJobSnapshot,
  type CronRunSnapshot,
} from "../../shared/cron/types"
import { nextFireAt } from "./next-fire"
import type { AutoContinueEvent } from "../auto-continue/events"

interface JobAccum {
  job: Omit<CronJobSnapshot, "nextFireAt" | "lastRun" | "recentRuns">
  /** Newest first, already bounded. */
  runs: CronRunSnapshot[]
}

export function deriveCronJobs(
  events: readonly AutoContinueEvent[],
  chatId: string,
  nowMs: number,
): CronJobSnapshot[] {
  const jobs = new Map<string, JobAccum>()

  for (const event of events) {
    if (event.chatId !== chatId) continue
    switch (event.kind) {
      case "cron_armed":
        // Re-arming an existing id replaces the job wholesale — run history
        // belongs to the arming, not the id. `event.paused` is set on
        // update-in-place of a paused job so the paused state is preserved;
        // absent means a fresh arm which always starts unpaused.
        jobs.set(event.scheduleId, {
          job: {
            jobId: event.scheduleId,
            instruction: event.instruction,
            mode: event.mode,
            scheduleText: event.scheduleText,
            schedule: event.schedule,
            paused: event.paused ?? false,
            armedAt: event.timestamp,
            ...(event.model !== undefined ? { model: event.model } : {}),
          },
          runs: [],
        })
        break
      case "cron_disarmed":
        jobs.delete(event.scheduleId)
        break
      case "cron_paused": {
        const accum = jobs.get(event.scheduleId)
        if (accum) accum.job.paused = true
        break
      }
      case "cron_resumed": {
        const accum = jobs.get(event.scheduleId)
        if (accum) accum.job.paused = false
        break
      }
      case "cron_run_started": {
        const accum = jobs.get(event.scheduleId)
        if (!accum) break
        pushRun(accum, {
          runId: event.runId,
          firedAt: event.timestamp,
          status: "running",
          ...(event.spawnedChatId !== undefined ? { spawnedChatId: event.spawnedChatId } : {}),
        })
        break
      }
      case "cron_run_outcome": {
        const accum = jobs.get(event.scheduleId)
        if (!accum) break
        const run = accum.runs.find((candidate) => candidate.runId === event.runId)
        if (!run || run.status !== "running") break
        run.status = event.ok ? "completed" : "failed"
        if (event.errorCode !== undefined) run.errorCode = event.errorCode
        break
      }
      case "cron_run_skipped": {
        const accum = jobs.get(event.scheduleId)
        if (!accum) break
        pushRun(accum, {
          runId: `skipped:${event.timestamp}`,
          firedAt: event.timestamp,
          status: "skipped",
          skipReason: event.reason,
          ...(event.missedCount !== undefined ? { missedCount: event.missedCount } : {}),
        })
        break
      }
      default:
        break
    }
  }

  const snapshots: CronJobSnapshot[] = []
  for (const accum of jobs.values()) {
    snapshots.push({
      ...accum.job,
      nextFireAt: accum.job.paused
        ? null
        : nextFireAt(accum.job.schedule, nowMs, accum.job.armedAt),
      lastRun: accum.runs[0] ?? null,
      recentRuns: accum.runs,
    })
  }
  snapshots.sort((a, b) => a.armedAt - b.armedAt)
  return snapshots
}

function pushRun(accum: JobAccum, run: CronRunSnapshot): void {
  accum.runs.unshift(run)
  if (accum.runs.length > MAX_RECENT_CRON_RUNS) accum.runs.length = MAX_RECENT_CRON_RUNS
}

/**
 * Whether the chat has at least one armed, unpaused cron job — a light fold
 * for the sidebar's `hasAutomation` badge that skips run bookkeeping (the
 * sidebar derives every chat on every broadcast).
 */
export function hasUnpausedCronJob(events: readonly AutoContinueEvent[], chatId: string): boolean {
  const armed = new Set<string>()
  const paused = new Set<string>()
  for (const event of events) {
    if (event.chatId !== chatId) continue
    switch (event.kind) {
      case "cron_armed":
        armed.add(event.scheduleId)
        paused.delete(event.scheduleId)
        break
      case "cron_disarmed":
        armed.delete(event.scheduleId)
        paused.delete(event.scheduleId)
        break
      case "cron_paused":
        if (armed.has(event.scheduleId)) paused.add(event.scheduleId)
        break
      case "cron_resumed":
        paused.delete(event.scheduleId)
        break
      default:
        break
    }
  }
  for (const jobId of armed) {
    if (!paused.has(jobId)) return true
  }
  return false
}

/** The job's most recent real run is still in flight (overlap guard). */
export function hasActiveRun(job: CronJobSnapshot): boolean {
  for (const run of job.recentRuns) {
    if (run.status === "skipped") continue
    return run.status === "running"
  }
  return false
}

/**
 * Scans the full, unbounded event log and returns every run that has a
 * `cron_run_started` but no `cron_run_outcome`. Used by boot reconciliation
 * instead of `job.recentRuns` (capped at `MAX_RECENT_CRON_RUNS`) so a running
 * run buried under many skip records cannot silently escape the orphan pass.
 */
export function findRunningCronRuns(
  events: readonly AutoContinueEvent[],
  chatId: string,
): Array<{ jobId: string; runId: string; spawnedChatId?: string }> {
  const running = new Map<string, { jobId: string; runId: string; spawnedChatId?: string }>()
  const activeJobs = new Set<string>()

  for (const event of events) {
    if (event.chatId !== chatId) continue
    switch (event.kind) {
      case "cron_armed":
        activeJobs.add(event.scheduleId)
        for (const [runId, run] of running) {
          if (run.jobId === event.scheduleId) running.delete(runId)
        }
        break
      case "cron_disarmed":
        activeJobs.delete(event.scheduleId)
        for (const [runId, run] of running) {
          if (run.jobId === event.scheduleId) running.delete(runId)
        }
        break
      case "cron_run_started":
        if (activeJobs.has(event.scheduleId)) {
          running.set(event.runId, {
            jobId: event.scheduleId,
            runId: event.runId,
            ...(event.spawnedChatId !== undefined ? { spawnedChatId: event.spawnedChatId } : {}),
          })
        }
        break
      case "cron_run_outcome":
        running.delete(event.runId)
        break
      default:
        break
    }
  }

  return [...running.values()]
}
