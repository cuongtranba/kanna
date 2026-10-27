
import {
  MAX_RECENT_CRON_RUNS,
  type CronJobSnapshot,
  type CronRunSnapshot,
} from "../../shared/cron/types"
import { nextFireAt } from "./next-fire"
import type { ChatAutomationEvent } from "../auto-continue/events"

interface JobAccum {
  job: Omit<CronJobSnapshot, "nextFireAt" | "lastRun" | "recentRuns">
  runs: CronRunSnapshot[]
}

export type CronJobState = Omit<CronJobSnapshot, "nextFireAt">

export function foldCronJobs(events: readonly ChatAutomationEvent[], chatId: string): CronJobState[] {
  const jobs = new Map<string, JobAccum>()

  for (const event of events) {
    if (event.chatId !== chatId) continue
    switch (event.kind) {
      case "cron_armed":
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

  const states: CronJobState[] = []
  for (const accum of jobs.values()) {
    states.push({
      ...accum.job,
      lastRun: accum.runs[0] ?? null,
      recentRuns: accum.runs,
    })
  }
  states.sort((a, b) => a.armedAt - b.armedAt)
  return states
}

export function deriveCronJobs(
  events: readonly ChatAutomationEvent[],
  chatId: string,
  nowMs: number,
): CronJobSnapshot[] {
  return foldCronJobs(events, chatId).map((state) => ({
    ...state,
    nextFireAt: state.paused ? null : nextFireAt(state.schedule, nowMs, state.armedAt),
  }))
}

function pushRun(accum: JobAccum, run: CronRunSnapshot): void {
  accum.runs.unshift(run)
  if (accum.runs.length > MAX_RECENT_CRON_RUNS) accum.runs.length = MAX_RECENT_CRON_RUNS
}

export function findRunningCronRuns(
  events: readonly ChatAutomationEvent[],
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
