/**
 * The slash commands Kanna implements itself, rather than forwarding to a
 * provider as prompt text.
 *
 * This module is the single source of truth for both halves: the parser the
 * send pipeline dispatches on, and the catalog the composer's `/` picker
 * offers. A drift guard in the colocated test asserts every catalog entry
 * parses, so a command can never be advertised without being dispatchable.
 *
 * A builtin must be the WHOLE message. `/clear` with trailing words does not
 * match — silently discarding what the user typed is worse than treating the
 * line as an ordinary prompt.
 *
 * `/cron` is the deliberate exception: ANY message whose first token is
 * `/cron` is intercepted, valid or not. Its arm form carries a schedule that
 * must hard-validate, and sending a mistyped schedule to the model as prompt
 * text would silently arm nothing — so invalid `/cron` lines surface a
 * structured error (with a ready-to-send corrected suggestion) instead of
 * falling through.
 */

import type { SlashCommand } from "./types"
import { parseCronCommand } from "./cron/parse-command"
import type { CronParseResult } from "./cron/types"

export interface BuiltinClearCommand {
  name: "clear"
}

export interface BuiltinCompactCommand {
  name: "compact"
  instructions: string
}

export interface BuiltinCronCommand {
  name: "cron"
  /** Success or structured validation error — either way `/cron` intercepts. */
  result: CronParseResult
}

export type BuiltinCommand = BuiltinClearCommand | BuiltinCompactCommand | BuiltinCronCommand

const CLEAR_PATTERN = /^\/clear$/
const COMPACT_PATTERN = /^\/compact(?:[ \t]+(.*))?$/

export function parseBuiltinCommand(content: string): BuiltinCommand | null {
  // Before the newline guard: a multiline /cron message must intercept as an
  // error, not fall through as a prompt.
  const cron = parseCronCommand(content)
  if (cron) return { name: "cron", result: cron }

  if (content.includes("\n")) return null
  const line = content.trim()

  if (CLEAR_PATTERN.test(line)) return { name: "clear" }

  const compact = COMPACT_PATTERN.exec(line)
  if (compact) return { name: "compact", instructions: (compact[1] ?? "").trim() }

  return null
}

export const BUILTIN_SLASH_COMMANDS: readonly SlashCommand[] = [
  {
    name: "clear",
    description: "Clear conversation history and free up context",
    argumentHint: "",
    kind: "command",
    scope: "builtin",
  },
  {
    name: "compact",
    description: "Compact conversation history, optionally with focus instructions",
    argumentHint: "[instructions]",
    kind: "command",
    scope: "builtin",
  },
  {
    name: "cron",
    description: "Schedule an instruction — inline (this chat, fresh context per run) or spawn (new chat per run)",
    argumentHint: "<instruction> inline|spawn <schedule> · list · remove <id>",
    kind: "command",
    scope: "builtin",
  },
]

/**
 * The prompt Kanna sends when the user asks Codex to compact.
 *
 * Codex's app-server protocol has no compaction request, so Kanna performs the
 * compaction as an ordinary turn and reshapes the reply into a
 * `compact_summary` entry. The reply therefore has to be prose and nothing
 * else — a tool call or a preamble would end up rendered as the summary.
 */
export function buildCodexCompactPrompt(instructions: string): string {
  const focus = instructions
    ? `\n\nThe user asked you to focus the summary on: ${instructions}`
    : ""
  return `Summarize this entire conversation so far. The summary replaces the conversation as your context, so it must stand alone: capture the task, the decisions made and why, the files and code touched, what is done, what is still outstanding, and anything you would otherwise have to re-derive.${focus}\n\nRespond with the summary as prose and nothing else. Do not use any tools and do not add a preamble or a closing question.`
}
