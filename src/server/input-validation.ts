
import path from "node:path"
import { parse as shellParse } from "shell-quote"

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
