import { formatCronArmSummary } from "./arm-summary"
import type { CronArmSummary } from "./types"

export function formatCronConfirmRequest(summary: CronArmSummary): string {
  return [
    "The user just armed a cron job by typing a `/cron` command. Present the full configuration and ask them to confirm:",
    formatCronArmSummary(summary),
    "Call AskUserQuestion with these exact options: Confirm / Change schedule / Change mode / Change instruction / Disarm.",
    [
      `- If they confirm, acknowledge and stop — the job is live.`,
      `- If they choose a change, call arm_cron with the corrected line and remove the old job with \`/cron remove ${summary.jobId ?? "<jobId>"}\`.`,
      `- If they disarm, remove the job with \`/cron remove ${summary.jobId ?? "<jobId>"}\` and tell them it was removed.`,
    ].join("\n"),
    "Note: the job is already running. If it fires before the user answers, the Disarm option removes it.",
  ].join("\n\n")
}
