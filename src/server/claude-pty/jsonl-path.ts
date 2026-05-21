import { realpathSync } from "node:fs"
import path from "node:path"

export function encodeCwd(cwd: string): string {
  // Throws ENOENT if cwd is missing — callers guarantee an existing directory.
  const real = realpathSync(cwd)
  const trimmed = real.endsWith("/") && real !== "/" ? real.slice(0, -1) : real
  return trimmed.replace(/\//g, "-").replace(/\./g, "-")
}

export function computeProjectDir(args: {
  homeDir: string
  cwd: string
}): string {
  return path.join(args.homeDir, ".claude", "projects", encodeCwd(args.cwd))
}

export function computeJsonlPath(args: {
  homeDir: string
  cwd: string
  sessionId: string
}): string {
  return path.join(
    computeProjectDir({ homeDir: args.homeDir, cwd: args.cwd }),
    `${args.sessionId}.jsonl`,
  )
}
