
import { cronModeConsequence } from "./arm-summary"
import { CRON_SHORTCUTS } from "./parse-schedule"
import type { CronParseError } from "./types"

export function formatCronDefect(error: CronParseError): string {
  const parts = [`Invalid /cron (${error.part}): ${error.message}`]
  if (error.suggestion !== undefined) parts.push(`Suggested fix: ${error.suggestion}`)
  return parts.join("\n")
}

const GRAMMAR = [
  "    /cron <instruction> <inline|spawn> <schedule>",
  "",
  "- <instruction> is what the agent should do, copied from what the user wrote — never invent one they did not ask for.",
  `- the mode is \`inline\` (${cronModeConsequence("inline")}) or \`spawn\` (${cronModeConsequence("spawn")}).`,
  `- <schedule> is cron with 5 fields (\`0 9 * * 1\`) or 6 with a leading second (\`*/30 * * * * *\`), a shortcut (${CRON_SHORTCUTS.join(", ")}), or an interval (\`every 30s\`, \`every 5m\`, \`every 2h\`).`,
  "- sub-minute schedules ARE supported and have no floor: `every 2s` and `*/2 * * * * *` both arm. Never tell the user cron cannot run faster than once a minute.",
].join("\n")

export function formatCronRepairRequest(error: CronParseError): string {
  return [
    "The user typed a `/cron` command that could not be parsed, so nothing was scheduled:",
    `    ${error.input}`,
    `${error.part}: ${error.message}`,
    "Kanna has no deterministic fix for this one, so repairing it is yours. The grammar is:",
    GRAMMAR,
    "Check any line you are considering with `mcp__kanna__validate_cron` first — it answers with the schedule in words and the next few fire times, which is how you confirm `0 9 * * *` means what the user actually asked for.",
    "Then finish the job in this turn:",
    [
      "- If their intent is clear, arm it with `mcp__kanna__arm_cron` and tell them what you scheduled and when it next runs.",
      "- If it is genuinely ambiguous — the mode is neither stated nor implied, or the time could mean more than one thing — ask with AskUserQuestion first, then arm their answer. Do not guess.",
    ].join("\n"),
    "Do not just reply with a corrected `/cron` line for them to retype; they already tried typing it.",
  ].join("\n\n")
}
