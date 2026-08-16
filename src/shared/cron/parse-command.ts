/**
 * The `/cron` command grammar.
 *
 *   /cron                                   → help
 *   /cron list                              → list armed jobs
 *   /cron remove <jobId>                    → disarm one job
 *   /cron pause <jobId> | resume <jobId>    → suspend / resume firing
 *   /cron <instruction> <inline|spawn> <schedule>   → arm a job
 *
 * The arm form needs no quoting: the parser anchors on the LAST
 * `inline`/`spawn` token — everything before it (after `/cron`) is the
 * instruction verbatim, everything after is the schedule text. A
 * double-quoted instruction is also accepted as an escape hatch for
 * instructions that end with a literal mode word.
 *
 * Unlike `/clear` (whole-message-or-fallthrough), `/cron` ALWAYS intercepts:
 * an invalid `/cron …` line must surface a precise error plus a ready-to-send
 * corrected suggestion, never get sent to the model as a prompt.
 */

import {
  isCronMode,
  type CronCommand,
  type CronMode,
  type CronParseError,
  type CronParseResult,
} from "./types"
import { levenshtein, parseSchedule } from "./parse-schedule"

interface Token {
  text: string
  start: number
  end: number
}

/**
 * What the grammar itself produces. `parseCronCommand` stamps `input` on the
 * way out, so no failure path can forget to record the line it rejected — and
 * a new one cannot be written without it.
 */
type Outcome =
  | { ok: true; command: CronCommand }
  | { ok: false; error: Omit<CronParseError, "input"> }

const MODE_HINT = "`inline` (runs in this chat, cleared each cycle) or `spawn` (a new chat per run)"
const ARM_SHAPE = "`/cron <instruction> <inline|spawn> <schedule>`"

/**
 * Returns null when the message is not a `/cron` command at all; otherwise
 * always a result — success or a structured error, never a fallthrough.
 */
export function parseCronCommand(content: string): CronParseResult | null {
  const line = content.trim()
  const firstToken = /^\S+/.exec(line)?.[0]
  if (firstToken !== "/cron") return null

  const outcome = parseCronLine(line)
  if (outcome.ok) return outcome
  return { ok: false, error: { ...outcome.error, input: line } }
}

function parseCronLine(line: string): Outcome {
  if (line.includes("\n")) {
    return {
      ok: false,
      error: { part: "subcommand", message: "a /cron command must be a single-line message" },
    }
  }

  const tokens = tokenize(line)
  if (tokens.length === 1) return { ok: true, command: { sub: "help" } }
  if (tokens.length === 2 && tokens[1]!.text.toLowerCase() === "help") {
    return { ok: true, command: { sub: "help" } }
  }

  const subcommand = parseSubcommand(line, tokens)
  if (subcommand) return subcommand

  return parseArm(line, tokens)
}

function tokenize(line: string): Token[] {
  const tokens: Token[] = []
  const re = /\S+/g
  for (let match = re.exec(line); match !== null; match = re.exec(line)) {
    tokens.push({ text: match[0], start: match.index, end: match.index + match[0].length })
  }
  return tokens
}

/**
 * Management subcommands only claim the line when no mode token follows —
 * `/cron remove old sessions inline @daily` is an arm whose instruction
 * happens to start with "remove".
 */
function parseSubcommand(line: string, tokens: Token[]): Outcome | null {
  const first = tokens[1]!.text.toLowerCase()
  const modeLater = tokens.slice(2).some((token) => isCronMode(token.text))
  if (modeLater) return null

  if (first === "list") {
    if (tokens.length === 2) return { ok: true, command: { sub: "list" } }
    return {
      ok: false,
      error: {
        part: "subcommand",
        message: `unexpected arguments after \`list\`: "${line.slice(tokens[2]!.start)}"`,
        suggestion: "/cron list",
      },
    }
  }

  if (first === "remove" || first === "pause" || first === "resume") {
    if (tokens.length === 3) {
      return { ok: true, command: { sub: first, jobId: tokens[2]!.text } }
    }
    if (tokens.length === 2) {
      return {
        ok: false,
        error: {
          part: "subcommand",
          message: `\`/cron ${first}\` needs a job id — run \`/cron list\` to see them`,
          suggestion: "/cron list",
        },
      }
    }
    return {
      ok: false,
      error: {
        part: "subcommand",
        message: `\`/cron ${first}\` takes exactly one job id, got "${line.slice(tokens[2]!.start)}"`,
        suggestion: validateSuggestion(`/cron ${first} ${tokens[2]!.text}`),
      },
    }
  }

  return null
}

function parseArm(line: string, tokens: Token[]): Outcome {
  if (line[tokens[1]!.start] === '"') return parseQuotedArm(line, tokens)

  let modeIndex = -1
  let mode: CronMode | null = null
  for (let i = tokens.length - 1; i >= 1; i--) {
    const text = tokens[i]!.text
    if (isCronMode(text)) {
      modeIndex = i
      mode = text
      break
    }
  }
  if (mode === null || modeIndex === -1) return missingModeError(line, tokens)

  const instruction = line.slice(tokens[1]!.start, tokens[modeIndex]!.start).trim()
  const scheduleText = stripQuotes(line.slice(tokens[modeIndex]!.end).trim())
  return finishArm(instruction, mode, scheduleText)
}

function parseQuotedArm(line: string, tokens: Token[]): Outcome {
  const openIndex = tokens[1]!.start
  const closeIndex = line.indexOf('"', openIndex + 1)
  if (closeIndex === -1) {
    return {
      ok: false,
      error: { part: "instruction", message: "unclosed quote in instruction" },
    }
  }
  const instruction = line.slice(openIndex + 1, closeIndex).trim()
  const rest = tokenize(line.slice(closeIndex + 1))
  const firstText = rest[0]?.text
  if (firstText === undefined || !isCronMode(firstText)) {
    const got = firstText === undefined ? "nothing" : `"${firstText}"`
    return {
      ok: false,
      error: {
        part: "mode",
        message: `expected ${MODE_HINT} after the quoted instruction, got ${got}`,
      },
    }
  }
  const mode = firstText
  const scheduleText = stripQuotes(
    line
      .slice(closeIndex + 1)
      .slice(rest[0]!.end)
      .trim(),
  )
  return finishArm(instruction, mode, scheduleText)
}

function finishArm(instruction: string, mode: CronMode, scheduleText: string): Outcome {
  if (instruction === "") {
    return {
      ok: false,
      error: {
        part: "instruction",
        message: `missing instruction — the shape is ${ARM_SHAPE}`,
      },
    }
  }
  if (scheduleText === "") {
    return {
      ok: false,
      error: {
        part: "schedule",
        message:
          "missing schedule after the mode — expected 5-field cron (e.g. `0 9 * * 1`), a shortcut (`@daily`), or an interval (`every 5m`)",
      },
    }
  }

  const parsed = parseSchedule(scheduleText)
  if (!parsed.ok) {
    return {
      ok: false,
      error: {
        part: parsed.part,
        message: parsed.message,
        suggestion:
          parsed.correctedSchedule !== undefined
            ? validateSuggestion(`/cron ${instruction} ${mode} ${parsed.correctedSchedule}`)
            : undefined,
      },
    }
  }

  return {
    ok: true,
    command: { sub: "arm", instruction, mode, schedule: parsed.schedule, scheduleText },
  }
}

/**
 * No mode token anywhere. Two recovery heuristics, strongest first:
 * a near-miss token (edit distance ≤ 2 of inline/spawn) whose suffix parses
 * as a schedule, else a parseable schedule suffix with the mode simply
 * omitted (suggests `inline`).
 */
function missingModeError(line: string, tokens: Token[]): Outcome {
  for (let i = tokens.length - 2; i >= 2; i--) {
    const token = tokens[i]!
    const nearest = nearestMode(token.text)
    if (nearest === null) continue
    if (!parseSchedule(stripQuotes(line.slice(token.end).trim())).ok) continue
    const corrected = `${line.slice(0, token.start)}${nearest}${line.slice(token.end)}`
    return {
      ok: false,
      error: {
        part: "mode",
        message: `unknown mode "${token.text}" — expected ${MODE_HINT}`,
        suggestion: validateSuggestion(corrected),
      },
    }
  }

  for (const suffixLength of [5, 2, 1]) {
    const firstScheduleToken = tokens.length - suffixLength
    if (firstScheduleToken < 2) continue
    const scheduleText = line.slice(tokens[firstScheduleToken]!.start)
    if (!parseSchedule(stripQuotes(scheduleText.trim())).ok) continue
    const instruction = line.slice(tokens[1]!.start, tokens[firstScheduleToken]!.start).trim()
    return {
      ok: false,
      error: {
        part: "mode",
        message: `missing mode — expected ${MODE_HINT} between the instruction and the schedule`,
        suggestion: validateSuggestion(`/cron ${instruction} inline ${scheduleText.trim()}`),
      },
    }
  }

  return {
    ok: false,
    error: {
      part: "mode",
      message: `missing mode — the shape is ${ARM_SHAPE}, where mode is ${MODE_HINT}`,
    },
  }
}

function nearestMode(token: string): CronMode | null {
  const lowered = token.toLowerCase()
  if (levenshtein(lowered, "inline", 2) <= 2) return "inline"
  if (levenshtein(lowered, "spawn", 2) <= 2) return "spawn"
  return null
}

function stripQuotes(text: string): string {
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    return text.slice(1, -1).trim()
  }
  return text
}

/** A suggestion is only worth offering when it re-parses cleanly. */
function validateSuggestion(candidate: string): string | undefined {
  const reparsed = parseCronCommand(candidate)
  return reparsed?.ok === true ? candidate : undefined
}
