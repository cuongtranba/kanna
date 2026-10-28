
import type { ChatAutomationEvent } from "../auto-continue/events"
import { MAX_RECENT_CRON_RUNS } from "../../shared/cron/types"
import { cronJobKey } from "./job-key"

const RETAINED_RUNS_PER_JOB = MAX_RECENT_CRON_RUNS

interface RunRecord {
  indices: number[]
  runId: string | null
  settled: boolean
}

interface JobRetention {
  records: RunRecord[]
  settledCount: number
  byRunId: Map<string, RunRecord>
}

export function compactCronRunEvents(events: ChatAutomationEvent[]): ChatAutomationEvent[] {
  const dropped = new Set<number>()
  const jobs = new Map<string, JobRetention>()

  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]
    if (event === undefined) continue

    switch (event.kind) {
      case "cron_armed":
      case "cron_disarmed": {
        const job = jobs.get(cronJobKey(event.chatId, event.scheduleId))
        if (!job) break
        for (const record of job.records) {
          for (const dead of record.indices) dropped.add(dead)
        }
        job.records = []
        job.settledCount = 0
        job.byRunId.clear()
        break
      }

      case "cron_run_started": {
        const job = retentionOf(jobs, event.chatId, event.scheduleId)
        const record: RunRecord = { indices: [index], runId: event.runId, settled: false }
        job.records.push(record)
        job.byRunId.set(event.runId, record)
        break
      }

      case "cron_run_outcome": {
        const job = retentionOf(jobs, event.chatId, event.scheduleId)
        const record = job.byRunId.get(event.runId)
        if (!record) {
          dropped.add(index)
          break
        }
        record.indices.push(index)
        record.settled = true
        job.settledCount += 1
        evictSettled(job, dropped)
        break
      }

      case "cron_run_skipped": {
        const job = retentionOf(jobs, event.chatId, event.scheduleId)
        job.records.push({ indices: [index], runId: null, settled: true })
        job.settledCount += 1
        evictSettled(job, dropped)
        break
      }

      default:
        break
    }
  }

  if (dropped.size === 0) return events
  return events.filter((_, index) => !dropped.has(index))
}

function retentionOf(jobs: Map<string, JobRetention>, chatId: string, scheduleId: string): JobRetention {
  const key = cronJobKey(chatId, scheduleId)
  const existing = jobs.get(key)
  if (existing) return existing
  const created: JobRetention = { records: [], settledCount: 0, byRunId: new Map() }
  jobs.set(key, created)
  return created
}

function evictSettled(job: JobRetention, dropped: Set<number>): void {
  while (job.settledCount > RETAINED_RUNS_PER_JOB) {
    const oldest = job.records.findIndex((record) => record.settled)
    if (oldest === -1) return
    const [record] = job.records.splice(oldest, 1)
    if (record === undefined) return
    for (const index of record.indices) dropped.add(index)
    if (record.runId !== null) job.byRunId.delete(record.runId)
    job.settledCount -= 1
  }
}
