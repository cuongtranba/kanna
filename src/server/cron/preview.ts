/**
 * "Is this line an armable cron job, and what does it actually mean?"
 *
 * The one answer both cron MCP tools give: `validate_cron` shows it to the
 * model, `arm_cron` acts on it. Sharing it is what stops the model from being
 * told a line is valid by one tool and refused by the other — and keeps both
 * on the same parser the send pipeline uses, so a model can never arm
 * something a user could not have typed.
 *
 * Server-side because the fire times come from `nextFireAt`, which the client
 * deliberately never computes.
 */

import { cronModeConsequence } from "../../shared/cron/arm-summary"
import { humanizeSchedule } from "../../shared/cron/humanize"
import { parseCronCommand } from "../../shared/cron/parse-command"
import { formatCronDefect } from "../../shared/cron/repair-report"
import type { CronArmSummary, CronCommand } from "../../shared/cron/types"
import { nextFireAt } from "./next-fire"

type ArmCommand = Extract<CronCommand, { sub: "arm" }>

export type CronPreview =
  | { ok: true; command: ArmCommand; summary: CronArmSummary }
  | { ok: false; reason: string }

/** How many upcoming fires to show. Enough to reveal the cadence, not a calendar. */
const PREVIEW_FIRES = 3

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

  const command = parsed.command
  const fires = upcomingFires(command, nowMs)
  if (fires.length === 0) {
    return {
      ok: false,
      reason: `schedule "${command.scheduleText}" never fires (no matching date exists) — nothing would be scheduled.`,
    }
  }

  const summary: CronArmSummary = {
    jobId: null,
    instruction: command.instruction,
    mode: command.mode,
    modeConsequence: cronModeConsequence(command.mode),
    scheduleText: command.scheduleText,
    scheduleHuman: humanizeSchedule(command.schedule, command.scheduleText),
    upcomingFires: fires,
    model: null,
    cwd: null,
  }

  return { ok: true, command, summary }
}

function upcomingFires(command: ArmCommand, nowMs: number): number[] {
  const fires: number[] = []
  let cursor = nowMs
  for (let i = 0; i < PREVIEW_FIRES; i++) {
    const next = nextFireAt(command.schedule, cursor, nowMs)
    if (next === null) break
    fires.push(next)
    cursor = next
  }
  return fires
}
