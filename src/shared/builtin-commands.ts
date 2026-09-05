
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
  result: CronParseResult
}

export type BuiltinCommand = BuiltinClearCommand | BuiltinCompactCommand | BuiltinCronCommand

const CLEAR_PATTERN = /^\/clear$/
const COMPACT_PATTERN = /^\/compact(?:[ \t]+(.*))?$/

export function parseBuiltinCommand(content: string): BuiltinCommand | null {
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

export function buildCodexCompactPrompt(instructions: string): string {
  const focus = instructions
    ? `\n\nThe user asked you to focus the summary on: ${instructions}`
    : ""
  return `Summarize this entire conversation so far. The summary replaces the conversation as your context, so it must stand alone: capture the task, the decisions made and why, the files and code touched, what is done, what is still outstanding, and anything you would otherwise have to re-derive.${focus}\n\nRespond with the summary as prose and nothing else. Do not use any tools and do not add a preamble or a closing question.`
}
