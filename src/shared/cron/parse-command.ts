/**
 * The `/cron` command grammar.
 *
 *   /cron                                          → help
 *   /cron list                                     → list armed jobs
 *   /cron remove <jobId>                           → disarm one job
 *   /cron pause <jobId> | resume <jobId>           → suspend / resume firing
 *   /cron update <jobId> schedule <schedule>       → change schedule in place
 *   /cron update <jobId> mode <inline|spawn>       → change mode in place
 *   /cron update <jobId> instruction <text…>       → change instruction in place
 *   /cron <instruction> <inline|spawn> <schedule>  → arm a job
 *
 * The arm form needs no quoting: the parser anchors on the LAST
 * `inline`/`spawn` token — everything before it (after `/cron`) is the
 * instruction verbatim, everything after is the schedule text. A
 * double-quoted instruction is also accepted as an escape hatch for
 * instructions that end with a literal mode word.
 *
 * Disambiguation for `update`: a line is treated as an `update` subcommand
 * only when tokens[3] is a recognised field name (`schedule`, `mode`,
 * `instruction`) AND no mode word (`inline`/`spawn`) appears after position 3
 * — or, for the `mode` field specifically, when the line is exactly five
 * tokens long (/cron update <id> mode <value>). Everything else falls through
 * to `parseArm`, so `/cron update the docs inline @daily` arms as usual.
 *
 * Unlike `/clear` (whole-message-or-fallthrough), `/cron` ALWAYS intercepts:
 * an invalid `/cron …` line must surface a precise error plus a ready-to-send
 * corrected suggestion, never get sent to the model as a prompt.
 */

import {
  isCronMode,
  type CronCommand,
  type CronJobPatch,
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
      error: {
        part: "multiline",
        message: "a /cron command must be a single-line message",
      },
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
 * happens to start with "remove". `update` has its own disambiguation
 * because the `mode` field takes a mode word as its value.
 */
function parseSubcommand(line: string, tokens: Token[]): Outcome | null {
  const first = tokens[1]!.text.toLowerCase()
  const modeLater = tokens.slice(2).some((token) => isCronMode(token.text))

  if (first === "update") return parseUpdate(line, tokens, modeLater)

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

/**
 * `/cron update <jobId> <field> <value…>`
 *
 * Claims the line only when tokens[3] is a recognised field AND the line
 * cannot be an arm (no mode word after position 3, or exactly five tokens
 * for the `mode` field whose value IS a mode word).
 */
function parseUpdate(line: string, tokens: Token[], modeLater: boolean): Outcome | null {
  const jobId = tokens[2]?.text

  if (tokens.length < 4) {
    if (modeLater) return null
    if (!jobId) {
      return {
        ok: false,
        error: {
          part: "subcommand",
          message: "`/cron update` needs a job id and a field — run `/cron list` to see armed jobs",
          suggestion: "/cron list",
        },
      }
    }
    return {
      ok: false,
      error: {
        part: "subcommand",
        message: `\`/cron update ${jobId}\` needs a field: \`schedule\`, \`mode\`, or \`instruction\``,
        suggestion: "/cron list",
      },
    }
  }

  const field = tokens[3]!.text.toLowerCase()

  if (field === "mode") {
    // Mode value IS a mode word, so apply a tighter check: exactly 5 tokens.
    if (tokens.length !== 5) return null
    return parseUpdateMode(tokens)
  }

  if (field === "schedule" || field === "instruction") {
    if (modeLater) return null
    return parseUpdateFieldValue(line, tokens, field)
  }

  // Unknown field — fall through to arm when mode tokens are present; otherwise
  // surface a helpful error so the user knows the shape.
  if (modeLater) return null
  return {
    ok: false,
    error: {
      part: "subcommand",
      message:
        `\`/cron update\` accepts \`schedule\`, \`mode\`, or \`instruction\` as the field${field ? `, got "${field}"` : ""}`,
    },
  }
}

function parseUpdateMode(tokens: Token[]): Outcome {
  const jobId = tokens[2]!.text
  const value = tokens[4]!.text
  if (!isCronMode(value)) {
    return {
      ok: false,
      error: {
        part: "subcommand",
        message: `\`/cron update\` mode expects \`inline\` or \`spawn\`, got "${value}"`,
      },
    }
  }
  return { ok: true, command: { sub: "update", jobId, patch: { mode: value } } }
}

function parseUpdateFieldValue(line: string, tokens: Token[], field: "schedule" | "instruction"): Outcome {
  const jobId = tokens[2]!.text
  const valueText = tokens[4] !== undefined ? line.slice(tokens[4].start).trim() : ""

  if (field === "instruction") {
    if (!valueText) {
      return {
        ok: false,
        error: {
          part: "instruction",
          message: "`/cron update` instruction needs a value",
        },
      }
    }
    const patch: CronJobPatch = { instruction: valueText }
    return { ok: true, command: { sub: "update", jobId, patch } }
  }

  if (!valueText) {
    return {
      ok: false,
      error: {
        part: "schedule",
        message:
          "missing schedule value — expected 5- or 6-field cron (e.g. `0 9 * * 1`), a shortcut (`@daily`), or an interval (`every 5m`)",
      },
    }
  }
  const parsed = parseSchedule(valueText)
  if (!parsed.ok) {
    return {
      ok: false,
      error: {
        part: parsed.part,
        message: parsed.message,
        suggestion:
          parsed.correctedSchedule !== undefined
            ? validateSuggestion(`/cron update ${jobId} schedule ${parsed.correctedSchedule}`)
            : undefined,
      },
    }
  }
  const patch: CronJobPatch = { schedule: parsed.schedule, scheduleText: valueText }
  return { ok: true, command: { sub: "update", jobId, patch } }
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
          "missing schedule after the mode — expected 5- or 6-field cron (e.g. `0 9 * * 1`, `*/30 * * * * *`), a shortcut (`@daily`), or an interval (`every 30s`, `every 5m`)",
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
