import { cronModeConsequence } from "../../shared/cron/arm-summary"
import { humanizeSchedule } from "../../shared/cron/humanize"
import { parseCronCommand } from "../../shared/cron/parse-command"
import { formatCronDefect } from "../../shared/cron/repair-report"
import type { CronArmSummary, CronCommand } from "../../shared/cron/types"
import { nextFireAt } from "./next-fire"

export type CronArmCommand = Extract<CronCommand, { sub: "arm" }>

export type CronPreview =
  | { ok: true; command: CronArmCommand; summary: CronArmSummary }
  | { ok: false; reason: string }

export type CronArmPlan =
  | { ok: true; summary: CronArmSummary }
  | { ok: false; neverFires: string }

export interface CronArmContext {
  model?: string
  cwd?: string
}

const UPCOMING_FIRES = 3

export function planCronArm(command: CronArmCommand, nowMs: number, context: CronArmContext = {}): CronArmPlan {
  const fires = upcomingFires(command, nowMs)
  if (fires.length === 0) {
    return {
      ok: false,
      neverFires: `schedule "${command.scheduleText}" never fires (no matching date exists)`,
    }
  }
  return {
    ok: true,
    summary: {
      jobId: null,
      instruction: command.instruction,
      mode: command.mode,
      modeConsequence: cronModeConsequence(command.mode),
      scheduleText: command.scheduleText,
      scheduleHuman: humanizeSchedule(command.schedule, command.scheduleText),
      upcomingFires: fires,
      model: context.model ?? null,
      cwd: context.cwd ?? null,
    },
  }
}

export function previewCronCommand(line: string, nowMs: number): CronPreview {
  const parsed = parseCronCommand(line)
  if (!parsed) {
    return {
      ok: false,
      reason: `Not a /cron command: ${line}\nIt must start with \`/cron\`, e.g. \`/cron check ci inline @daily\`.`,
    }
  }
  if (!parsed.ok) return { ok: false, reason: formatCronDefect(parsed.error) }
  if (parsed.command.sub !== "arm") {
    return {
      ok: false,
      reason: `\`${line}\` is the \`${parsed.command.sub}\` subcommand — it manages jobs rather than scheduling one. To schedule, use \`/cron <instruction> <inline|spawn> <schedule>\`.`,
    }
  }

  const plan = planCronArm(parsed.command, nowMs)
  if (!plan.ok) {
    return { ok: false, reason: `${plan.neverFires} — nothing would be scheduled.` }
  }
  return { ok: true, command: parsed.command, summary: plan.summary }
}

function upcomingFires(command: CronArmCommand, nowMs: number): number[] {
  const fires: number[] = []
  let cursor = nowMs
  for (let i = 0; i < UPCOMING_FIRES; i++) {
    const next = nextFireAt(command.schedule, cursor, nowMs)
    if (next === null) break
    fires.push(next)
    cursor = next
  }
  return fires
}
