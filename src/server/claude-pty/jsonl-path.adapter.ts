import { realpathSync } from "node:fs"
import path from "node:path"

const MAX_SANITIZED_LENGTH = 200

function djb2Hash(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0
  }
  return hash
}

function hashSuffix(name: string): string {
  const globalWithBun: { Bun?: { hash: (s: string) => number | bigint } } = globalThis
  const maybeBun = globalWithBun.Bun
  if (maybeBun && typeof maybeBun.hash === "function") {
    return maybeBun.hash(name).toString(36)
  }
  return Math.abs(djb2Hash(name)).toString(36)
}

function sanitizePath(name: string): string {
  const sanitized = name.replace(/[^a-zA-Z0-9]/g, "-")
  if (sanitized.length <= MAX_SANITIZED_LENGTH) return sanitized
  return `${sanitized.slice(0, MAX_SANITIZED_LENGTH)}-${hashSuffix(name)}`
}

export function encodeCwd(cwd: string): string {
  const real = realpathSync(cwd)
  const normalized = real.normalize("NFC")
  return sanitizePath(normalized)
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

export function computeWorkflowsDir(args: {
  homeDir: string
  cwd: string
  sessionId: string
}): string {
  return path.join(
    computeProjectDir({ homeDir: args.homeDir, cwd: args.cwd }),
    args.sessionId,
    "workflows",
  )
}
