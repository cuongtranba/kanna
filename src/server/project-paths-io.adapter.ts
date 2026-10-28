import { readdir } from "node:fs/promises"
import { existsSync, statSync, type Dirent } from "node:fs"

export type DirEntry = Dirent

export function pathExists(p: string): boolean {
  return existsSync(p)
}

export function statMtimeMsOrNull(p: string): number | null {
  try {
    return statSync(p).mtimeMs
  } catch {
    return null
  }
}

export function readDirEntries(p: string): Promise<DirEntry[]> {
  return readdir(p, { withFileTypes: true })
}
