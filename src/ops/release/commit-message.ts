import { parser } from "@conventional-commits/parser"

/**
 * Is this commit message one release-please can actually read?
 *
 * release-please parses every commit since the last tag with
 * `@conventional-commits/parser`. When that parser THROWS it logs
 * `commit could not be parsed` and **drops the commit** — from the changelog
 * and from the version calculation — then exits 0. The workflow is green, the
 * release PR simply lacks the entry, and nothing anywhere reports a problem.
 *
 * Two commits were lost that way before this gate existed: #1057
 * (`feat(motion)`, the whole motion layer) and #1047 (`refactor(types)`). The
 * changelog omission is the visible cost; the latent one is worse — a window
 * whose only `feat` is dropped gets bumped as a patch, or not released at all.
 *
 * **This runs the REAL parser rather than a regex over the shape that happened
 * to break.** Reproducing release-please's own verdict is the only check that
 * cannot drift from it, and it is the difference between measuring the concept
 * and measuring one spelling — a regex tuned to the known trigger would pass
 * the next message that breaks the parser some other way.
 *
 * The pin: this reproduces the exact error release-please logged for #1057,
 * `unexpected token '(' at 259:14`, byte for byte (see the colocated test).
 *
 * Version skew is the one real risk. If this package and the one inside
 * release-please diverge, the gate and the release could disagree — in which
 * direction depends on the change. It is a dev dependency, so an upgrade is a
 * visible diff, and the test pins a real failing message so a parser that
 * stopped rejecting it would fail here loudly rather than silently.
 */

export interface CommitMessageOk {
  readonly ok: true
}

export interface CommitMessageFailure {
  readonly ok: false
  /** The parser's own message, verbatim — this is what release-please logs. */
  readonly reason: string
  /** 1-based line the parser stopped at, when it reported one. */
  readonly line: number | null
  /** 1-based column the parser stopped at, when it reported one. */
  readonly column: number | null
  /** The offending source line, so the report shows the text and not a number. */
  readonly offendingLine: string | null
}

export type CommitMessageVerdict = CommitMessageOk | CommitMessageFailure

/** `unexpected token '(' at 259:14, valid tokens [)]` → `{line: 259, column: 14}`. */
function positionOf(reason: string): { line: number | null; column: number | null } {
  const match = /\bat (\d+):(\d+)/.exec(reason)
  if (!match) return { line: null, column: null }
  return { line: Number(match[1]), column: Number(match[2]) }
}

export function validateCommitMessage(message: string): CommitMessageVerdict {
  try {
    parser(message)
    return { ok: true }
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause)
    const { line, column } = positionOf(reason)
    const lines = message.split("\n")
    return {
      ok: false,
      reason,
      line,
      column,
      offendingLine: line === null ? null : lines[line - 1] ?? null,
    }
  }
}

/**
 * The shape behind almost every real failure, named so a report can say
 * something more useful than the parser's token position.
 *
 * A body line that BEGINS with `word(` reads to the grammar like a
 * `type(scope):` header, so it then requires a `)` and dies on a nested `(`.
 * The same text is fine with anything in front of it — `` `calc(2 * var(--x))` ``
 * at the start of a line throws, `see `calc(2 * var(--x))`` does not — which is
 * why this is a HINT and never the check itself.
 */
export function looksLikeLineInitialNesting(line: string | null): boolean {
  if (line === null) return false
  // A leading `-`/`*` bullet is deliberately NOT allowed here: verified, a
  // bulleted line parses fine (`- calc(2 * var(--a))` is accepted), so
  // matching one would produce a hint for a line that is not the problem.
  const opener = /^\s*[`'"]*[A-Za-z_$][\w$.-]*\(/.exec(line)
  if (!opener) return false
  const rest = line.slice(opener[0].length)
  const close = rest.indexOf(")")
  const open = rest.indexOf("(")
  return open !== -1 && (close === -1 || open < close)
}

/** One human-readable report for a failing message. */
export function formatCommitMessageFailure(
  label: string,
  failure: CommitMessageFailure,
): string {
  const parts = [
    `${label}: release-please cannot parse this commit message.`,
    `  ${failure.reason}`,
  ]
  if (failure.offendingLine !== null) {
    parts.push(`  line ${failure.line}: ${failure.offendingLine}`)
    if (failure.column !== null) {
      parts.push(`  ${" ".repeat(`  line ${failure.line}: `.length - 2 + failure.column - 1)}^`)
    }
  }
  if (looksLikeLineInitialNesting(failure.offendingLine)) {
    parts.push(
      "  A body line that STARTS with `word(` is read as a `type(scope):` header,",
      "  so a nested `(` before the closing `)` breaks it. Put any word in front",
      "  of it, or reword — `see `calc(2 * var(--x))`` parses, the same text at",
      "  the start of the line does not.",
    )
  }
  parts.push(
    "  Left unfixed, release-please drops this commit from the changelog AND",
    "  from the version bump, silently, with a green build.",
  )
  return parts.join("\n")
}
