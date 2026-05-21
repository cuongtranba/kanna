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
  // Mirror claude-code/src/utils/sessionStoragePortable.ts: prefer Bun.hash
  // (wyhash) when running under Bun, fall back to djb2 elsewhere. Both encode
  // base36. Cross-runtime stability matters only for paths >200 chars.
  const maybeBun = (globalThis as { Bun?: { hash: (s: string) => bigint } }).Bun
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
  // Ported verbatim from claude-code v2.1.146:
  // bootstrap/state.ts realpath + NFC normalize, then sessionStoragePortable.ts
  // sanitizePath. Throws ENOENT if cwd is missing — callers guarantee an
  // existing directory.
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
