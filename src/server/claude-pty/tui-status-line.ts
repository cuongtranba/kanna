import type { PtyTuiStatus } from "../../shared/pty-instance"

export type { PtyTuiStatus }

// Matches a single ANSI/VT escape sequence (CSI colors, cursor moves, erases).
// The PTY output ring accumulates many in-place spinner redraws, each wrapped
// in escapes; we strip them before pattern-matching the human-readable text.
const ANSI_PATTERN =
  /[][[\]()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-PR-TZcf-ntqry=><~]/g

// Claude Code's spinner status line, e.g.
//   "✻ Whirlpooling… (11m 11s · ↓ 40.5k tokens · almost done thinking with xhigh effort)"
// The leading glyph varies (✻/✶/etc) so we anchor on the gerund verb + ellipsis
// followed by a parenthesised, "·"-separated detail group.
const SPINNER_PATTERN = /([A-Za-z][A-Za-z ]*?)…\s*\(([^)]*)\)/g
const ELAPSED_PATTERN = /^(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?\s*(?:(\d+)\s*s)?$/
const TOKENS_PATTERN = /([\d.]+)\s*([km]?)\s*tokens/i

function stripAnsi(input: string): string {
  return input.replace(ANSI_PATTERN, "")
}

function parseElapsed(segment: string): number | null {
  const m = ELAPSED_PATTERN.exec(segment.trim())
  if (m === null) return null
  const [, h, mm, ss] = m
  if (h === undefined && mm === undefined && ss === undefined) return null
  return (h ? Number(h) * 3600 : 0) + (mm ? Number(mm) * 60 : 0) + (ss ? Number(ss) : 0)
}

function parseTokens(segment: string): number | null {
  const m = TOKENS_PATTERN.exec(segment)
  if (m === null) return null
  const value = Number(m[1])
  if (Number.isNaN(value)) return null
  const unit = m[2].toLowerCase()
  const multiplier = unit === "k" ? 1000 : unit === "m" ? 1_000_000 : 1
  return Math.round(value * multiplier)
}

/**
 * Extract the most recent Claude Code TUI spinner status line from a slice of
 * raw PTY output (typically the output ring tail). Returns `null` when no
 * spinner line is present — empty output, a plain input prompt, or a spinner
 * format this parser does not recognise (graceful degradation across `claude`
 * versions; the UI simply hides the segment).
 *
 * This is live process metadata derived from stdout, NOT a transcript event —
 * it must never be fed into the HarnessEvent pipeline (c3-225 invariant).
 */
export function parseTuiStatusLine(output: string): PtyTuiStatus | null {
  if (!output) return null
  const clean = stripAnsi(output)

  let last: RegExpExecArray | null = null
  let match: RegExpExecArray | null
  SPINNER_PATTERN.lastIndex = 0
  while ((match = SPINNER_PATTERN.exec(clean)) !== null) {
    last = match
  }
  if (last === null) return null

  const verb = last[1].trim() || null
  const raw = last[0].trim()
  const segments = last[2]
    .split("·")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)

  let elapsedSeconds: number | null = null
  let tokens: number | null = null
  const leftover: string[] = []
  for (const segment of segments) {
    if (elapsedSeconds === null) {
      const elapsed = parseElapsed(segment)
      if (elapsed !== null) {
        elapsedSeconds = elapsed
        continue
      }
    }
    if (tokens === null && /tokens/i.test(segment)) {
      const parsed = parseTokens(segment)
      if (parsed !== null) {
        tokens = parsed
        continue
      }
    }
    leftover.push(segment)
  }

  return {
    verb,
    elapsedSeconds,
    tokens,
    effort: leftover.length > 0 ? leftover.join(" · ") : null,
    raw,
  }
}
