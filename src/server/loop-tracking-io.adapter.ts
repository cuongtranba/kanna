/**
 * Filesystem leaf for the loop-tracking read model: read one tracking file,
 * and watch it for changes. No domain logic — the registry owns parsing and
 * caching.
 */

import { readFileSync } from "node:fs"
import { basename, dirname } from "node:path"
import type { WatchWorkflowDeps } from "./workflow-watch-io.adapter"
import { watchWorkflowDir } from "./workflow-watch-io.adapter"

/** Null on any read error — missing, unreadable, or caught mid-write. */
export function readTrackingFile(absPath: string): string | null {
  try {
    return readFileSync(absPath, "utf8")
  } catch {
    return null
  }
}

/**
 * Watch one tracking file. The watch is armed on its PARENT directory and
 * filtered by basename, so an editor or a worker that writes via rename cannot
 * orphan an inode-bound watcher, and a file that does not exist yet — a loop
 * can arm before its skeleton lands — still gets picked up.
 */
export function watchTrackingFile(
  absPath: string,
  onChange: () => void,
  opts?: { debounceMs?: number; deps?: WatchWorkflowDeps },
): () => void {
  return watchWorkflowDir(dirname(absPath), onChange, { ...opts, filterBasename: basename(absPath) })
}
