/**
 * The words a rejected `/cron` line is reported in.
 *
 * Two surfaces say it: the `validate_cron` tool result the model reads while
 * composing a fix, and the repair prompt Kanna sends when its own parser had
 * no fix to offer. They share this module so the model is never taught two
 * vocabularies for the same defect.
 *
 * Pure — the grammar text lives beside the parser that enforces it.
 */

import { CRON_SHORTCUTS } from "./parse-schedule"
import type { CronParseError } from "./types"

/** One parse failure: which part, why, and the fix when Kanna knows it. */
export function formatCronDefect(error: CronParseError): string {
  const parts = [`Invalid /cron (${error.part}): ${error.message}`]
  if (error.suggestion !== undefined) parts.push(`Suggested fix: ${error.suggestion}`)
  return parts.join("\n")
}

const GRAMMAR = [
  "    /cron <instruction> <inline|spawn> <schedule>",
  "",
  "- <instruction> is what the agent should do, copied from what the user wrote — never invent one they did not ask for.",
  "- the mode is `inline` (runs in this chat, context cleared each cycle) or `spawn` (a new chat per run).",
  `- <schedule> is 5-field cron (\`0 9 * * 1\`), a shortcut (${CRON_SHORTCUTS.join(", ")}), or an interval (\`every 5m\`, \`every 2h\`).`,
].join("\n")

/**
 * Asks the model to repair a line Kanna could not. Only sent when the parser
 * produced no suggestion of its own, so the model is never spending a turn on
 * something a copy-and-send affordance already solved.
 */
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
