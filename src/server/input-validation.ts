/**
 * Shared pure input-validation helpers.
 *
 * Extracted from `loop-template.ts` so the loop setup and the orchestration run
 * validators enforce IDENTICAL rules (shell-command parseability, path
 * confinement). NO IO — path logic operates on strings only; callers supply the
 * base dir.
 */

import path from "node:path"
import { parse as shellParse } from "shell-quote"

/**
 * A shell command is "parseable" when quotes balance and it yields at least one
 * token. shell-quote is intentionally lenient (an unclosed quote parses to two
 * tokens rather than throwing), so quote balance is enforced explicitly. Quote
 * chars escaped with a preceding backslash are ignored.
 */
export function shellCommandIsParseable(cmd: string): boolean {
  let singles = 0
  let doubles = 0
  for (let i = 0; i < cmd.length; i += 1) {
    const ch = cmd[i]
    if (ch === "\\") { i += 1; continue }
    if (ch === "'") singles += 1
    else if (ch === "\"") doubles += 1
  }
  if (singles % 2 !== 0 || doubles % 2 !== 0) return false
  try {
    return shellParse(cmd).length > 0
  } catch {
    return false
  }
}

export type ConfinedPath = { abs: string; rel: string } | { error: string }

/**
 * Resolve `input` against `baseDir` and refuse anything that escapes it. Returns
 * both the absolute path and the base-relative path, or a single error string.
 * A blank input, a NUL byte, `..` escape, or a path equal to the base itself is
 * rejected.
 */
export function confinePathToDir(input: string, baseDir: string, label = "path"): ConfinedPath {
  const raw = input.trim()
  if (raw === "") return { error: `${label} is blank` }
  const normalized = raw.replaceAll("\\", "/")
  if (normalized.includes("\0")) return { error: `${label} contains a NUL byte` }
  const baseAbs = path.resolve(baseDir)
  const abs = path.isAbsolute(normalized)
    ? path.resolve(normalized)
    : path.resolve(baseAbs, normalized)
  const rel = path.relative(baseAbs, abs)
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
    return { error: `${label} must resolve inside ${baseDir}` }
  }
  return { abs, rel }
}
