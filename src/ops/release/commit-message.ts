import { parser } from "@conventional-commits/parser"


export interface CommitMessageOk {
  readonly ok: true
}

export interface CommitMessageFailure {
  readonly ok: false
  readonly reason: string
  readonly line: number | null
  readonly column: number | null
  readonly offendingLine: string | null
}

export type CommitMessageVerdict = CommitMessageOk | CommitMessageFailure

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

export function looksLikeLineInitialNesting(line: string | null): boolean {
  if (line === null) return false
  const opener = /^\s*[`'"]*[A-Za-z_$][\w$.-]*\(/.exec(line)
  if (!opener) return false
  const rest = line.slice(opener[0].length)
  const close = rest.indexOf(")")
  const open = rest.indexOf("(")
  return open !== -1 && (close === -1 || open < close)
}

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
