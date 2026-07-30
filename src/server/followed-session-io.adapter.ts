import { statSync } from "node:fs"

export function statSessionFile(path: string): { size: number; mtimeMs: number } | null {
  try {
    const s = statSync(path)
    return s.isFile() ? { size: s.size, mtimeMs: s.mtimeMs } : null
  } catch {
    return null
  }
}
