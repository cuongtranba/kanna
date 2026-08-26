import { readdirSync } from "node:fs"
import type { Dirent } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import { isErrnoException, toError } from "../shared/errors"
import { log } from "../shared/log"

function listDir(dirPath: string): Dirent[] {
  try {
    return readdirSync(dirPath, { withFileTypes: true })
  } catch (err) {
    if (isErrnoException(err) && err.code === "ENOENT") return []
    log.warn("[kanna/import] cannot read directory:", dirPath, toError(err).message)
    return []
  }
}

function collectFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of listDir(dir)) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...collectFiles(full))
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      files.push(full)
    }
  }
  return files
}

export function scanCodexSessions(homeDir: string = homedir()): string[] {
  return collectFiles(path.join(homeDir, ".codex", "sessions"))
}

export function locateCodexRolloutFile(homeDir: string, sessionId: string): string | null {
  for (const filePath of scanCodexSessions(homeDir)) {
    if (path.basename(filePath).includes(sessionId)) return filePath
  }
  return null
}
