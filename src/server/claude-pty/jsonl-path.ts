import path from "node:path"

export function encodeCwd(cwd: string): string {
  const trimmed = cwd.endsWith("/") && cwd !== "/" ? cwd.slice(0, -1) : cwd
  return trimmed.replace(/\//g, "-")
}

export function computeJsonlPath(args: {
  homeDir: string
  cwd: string
  sessionId: string
}): string {
  return path.join(
    args.homeDir,
    ".claude",
    "projects",
    encodeCwd(args.cwd),
    `${args.sessionId}.jsonl`,
  )
}
