// src/server/codex-session-scanner.adapter.ts
//
// Finds codex rollout files under `<homeDir>/.codex/sessions`, which is laid
// out `YYYY/MM/DD/rollout-<ISO>-<uuid>.jsonl`.
//
// Two rules that are load-bearing rather than tidy:
//
//  - `rollout-*.jsonl` ONLY. The `sessions/` root also holds unrelated JSONL
//    (`responders-codex-*.jsonl`) that is not a rollout at all; a bare
//    `.jsonl` filter picks those up and the parser then rejects them one by one.
//  - `locateCodexRolloutFile` matches the DIRENT NAME and opens nothing. The
//    session id is the uuid tail of the basename, so the file can be found
//    without reading a byte. There are 553 rollouts on the reference machine
//    and opening each one to read its first line is precisely what makes the
//    existing discovery walk slow.
//
// Nothing here throws: a missing `~/.codex`, a missing `sessions/`, or a
// directory the user cannot read yields empty / null. A MISSING directory is
// silent because it is the normal state of a machine with no codex; anything
// else is logged — see `readDirSorted`.
//
// SYMLINKS ARE SKIPPED, DELIBERATELY. `Dirent.isFile()` / `isDirectory()` do
// not follow links, so a symlinked rollout, and a `sessions` tree symlinked to
// external storage, are both invisible here. That is what makes a symlink loop
// impossible to walk into — but it is also a silent zero for anyone who
// arranges their corpus that way, so it is a choice, not an oversight.

import { readdirSync } from "node:fs"
import path from "node:path"
import { errorMessage, isErrnoException } from "../shared/errors"
import { log } from "../shared/log"

const ROLLOUT_PREFIX = "rollout-"
const ROLLOUT_SUFFIX = ".jsonl"

export function codexSessionsDir(homeDir: string): string {
  return path.join(homeDir, ".codex", "sessions")
}

function compareNames(a: string, b: string): number {
  if (a < b) return -1
  return a > b ? 1 : 0
}

function isRolloutName(name: string): boolean {
  return name.startsWith(ROLLOUT_PREFIX) && name.endsWith(ROLLOUT_SUFFIX)
}

/**
 * Directory entries sorted by name. Sorting makes the walk deterministic —
 * `readdirSync` returns the filesystem's own order, which differs between APFS
 * and ext4, so an unsorted walk gives one result locally and another on CI.
 * (The React-root sweep note in CLAUDE.md is the same CLASS of bug on bun's
 * test-FILE ordering, not about `readdirSync` entry order.)
 *
 * A directory that cannot be read yields no entries either way, but the two
 * causes are not the same fact:
 *
 *  - ENOENT is silent and correct. A machine with no `~/.codex` is not broken,
 *    and `walk` starts at a root that need not exist.
 *  - Anything else — EACCES on `sessions/2026/07`, ENOTDIR, EIO — makes a whole
 *    subtree the user believes is importable vanish, and `locateCodexRolloutFile`
 *    then answers `not_found` for a session that exists. One warning per
 *    directory is the only thing that separates that from an empty corpus.
 */
function readDirSorted(directory: string): { name: string; isDirectory: boolean; isFile: boolean }[] {
  let entries
  try {
    entries = readdirSync(directory, { withFileTypes: true })
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") return []
    log.warn(`[kanna/import] codex sessions directory unreadable ${directory}: ${errorMessage(error)}`)
    return []
  }
  return entries
    // Neither predicate follows a symlink, so a linked rollout or a linked
    // subtree reads as neither — see the symlink note in the file header.
    .map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory(), isFile: entry.isFile() }))
    .sort((a, b) => compareNames(a.name, b.name))
}

function walk(directory: string, visit: (filePath: string, name: string) => boolean): boolean {
  for (const entry of readDirSorted(directory)) {
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory) {
      if (!walk(fullPath, visit)) return false
      continue
    }
    // A non-file dirent named `rollout-….jsonl` (a directory, a socket) is not
    // a rollout. This is also what keeps `locate` from ever opening anything.
    if (!entry.isFile || !isRolloutName(entry.name)) continue
    if (!visit(fullPath, entry.name)) return false
  }
  return true
}

/** Every `rollout-*.jsonl` under `<homeDir>/.codex/sessions`, name-sorted. */
export function scanCodexRollouts(homeDir: string): string[] {
  const files: string[] = []
  walk(codexSessionsDir(homeDir), (filePath) => {
    files.push(filePath)
    return true
  })
  return files
}

/**
 * The rollout whose basename ends `-<sessionId>.jsonl`, or null.
 *
 * Opens no file: the id is read off the dirent name. The walk stops at the
 * first match.
 */
export function locateCodexRolloutFile(homeDir: string, sessionId: string): string | null {
  if (!sessionId) return null
  const tail = `-${sessionId}${ROLLOUT_SUFFIX}`
  let found: string | null = null
  walk(codexSessionsDir(homeDir), (filePath, name) => {
    if (!name.endsWith(tail)) return true
    found = filePath
    return false
  })
  return found
}
