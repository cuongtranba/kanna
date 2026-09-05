import { readFile } from "node:fs/promises"
import path from "node:path"

export interface ClaudeSessionRegistryEntry {
  pid: number
  sessionId: string
  cwd: string
  kind: string
  startedAt: number
}

export function computeClaudeSessionFilePath(homeDir: string, pid: number): string {
  return path.join(homeDir, ".claude", "sessions", `${pid}.json`)
}

export async function readClaudeSessionByPid(
  homeDir: string,
  pid: number,
): Promise<ClaudeSessionRegistryEntry | null> {
  const filePath = computeClaudeSessionFilePath(homeDir, pid)
  let raw: string
  try {
    raw = await readFile(filePath, "utf8")
  } catch {
    return null
  }
  let parsed: Partial<ClaudeSessionRegistryEntry>
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (
    typeof parsed.pid !== "number"
    || !Number.isFinite(parsed.pid)
    || typeof parsed.sessionId !== "string"
    || parsed.sessionId.length === 0
  ) {
    return null
  }
  return {
    pid: parsed.pid,
    sessionId: parsed.sessionId,
    cwd: typeof parsed.cwd === "string" ? parsed.cwd : "",
    kind: typeof parsed.kind === "string" ? parsed.kind : "",
    startedAt: typeof parsed.startedAt === "number" ? parsed.startedAt : 0,
  }
}

export interface AwaitClaudeSessionForPidArgs {
  homeDir: string
  pid: number
  timeoutMs: number
  pollIntervalMs?: number
}

export async function awaitClaudeSessionForPid(
  args: AwaitClaudeSessionForPidArgs,
): Promise<ClaudeSessionRegistryEntry | null> {
  const interval = args.pollIntervalMs ?? 20
  const deadline = Date.now() + args.timeoutMs
  for (;;) {
    const entry = await readClaudeSessionByPid(args.homeDir, args.pid)
    if (entry && entry.pid === args.pid) return entry
    if (Date.now() >= deadline) return null
    await new Promise((resolve) => setTimeout(resolve, interval))
  }
}
