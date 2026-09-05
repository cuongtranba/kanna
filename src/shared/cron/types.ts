
export type CronMode = "inline" | "spawn"

export const CRON_MODES: readonly CronMode[] = ["inline", "spawn"]

export function isCronMode(token: string): token is CronMode {
  return token === "inline" || token === "spawn"
}

export type CronField = { kind: "any" } | { kind: "values"; values: readonly number[] }

export type CronSchedule =
  | {
      type: "cron"
      expression: string
      second?: CronField
      minute: CronField
      hour: CronField
      dom: CronField
      month: CronField
      dow: CronField
    }
  | { type: "interval"; ms: number }

export type CronParsePart =
  | "subcommand"
  | "multiline"
  | "instruction"
  | "mode"
  | "schedule"
  | "schedule_field"

export interface CronParseError {
  part: CronParsePart
  message: string
  input: string
  suggestion?: string
}

export interface CronJobPatch {
  instruction?: string
  mode?: CronMode
  schedule?: CronSchedule
  scheduleText?: string
}

export type CronCommand =
  | { sub: "help" }
  | { sub: "list" }
  | { sub: "remove"; jobId: string }
  | { sub: "pause"; jobId: string }
  | { sub: "resume"; jobId: string }
  | {
      sub: "arm"
      instruction: string
      mode: CronMode
      schedule: CronSchedule
      scheduleText: string
    }
  | { sub: "update"; jobId: string; patch: CronJobPatch }

export type CronParseResult =
  | { ok: true; command: CronCommand }
  | { ok: false; error: CronParseError }

export type CronSkipReason = "chat_busy" | "previous_run_active" | "server_offline"

export type CronRunStatus = "running" | "completed" | "failed" | "skipped"

export interface CronRunSnapshot {
  runId: string
  firedAt: number
  status: CronRunStatus
  spawnedChatId?: string
  skipReason?: CronSkipReason
  missedCount?: number
  errorCode?: string
}

export interface CronJobSnapshot {
  jobId: string
  instruction: string
  mode: CronMode
  scheduleText: string
  schedule: CronSchedule
  paused: boolean
  armedAt: number
  model?: string
  nextFireAt: number | null
  lastRun: CronRunSnapshot | null
  recentRuns: readonly CronRunSnapshot[]
}

export const MAX_RECENT_CRON_RUNS = 20

export function hasActiveRun(job: CronJobSnapshot): boolean {
  for (const run of job.recentRuns) {
    if (run.status === "skipped") continue
    return run.status === "running"
  }
  return false
}

export interface CronJobsGlobalRow {
  projectId: string
  projectPath: string
  chatId: string
  chatTitle: string
  job: CronJobSnapshot
}

export interface CronJobsGlobalSnapshot {
  rows: readonly CronJobsGlobalRow[]
}

export interface CronRunTag {
  jobId: string
  runId: string
  originChatId: string
}

export interface CronArmSummary {
  jobId: string | null
  instruction: string
  mode: CronMode
  modeConsequence: string
  scheduleText: string
  scheduleHuman: string
  upcomingFires: readonly number[]
  model: string | null
  cwd: string | null
}
