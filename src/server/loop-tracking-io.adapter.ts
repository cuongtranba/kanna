
import { readFileSync } from "node:fs"
import { basename, dirname } from "node:path"
import type { WatchWorkflowDeps } from "./workflow-watch-io.adapter"
import { watchWorkflowDir } from "./workflow-watch-io.adapter"

export function readTrackingFile(absPath: string): string | null {
  try {
    return readFileSync(absPath, "utf8")
  } catch {
    return null
  }
}

export function watchTrackingFile(
  absPath: string,
  onChange: () => void,
  opts?: { debounceMs?: number; deps?: WatchWorkflowDeps },
): () => void {
  return watchWorkflowDir(dirname(absPath), onChange, { ...opts, filterBasename: basename(absPath) })
}
