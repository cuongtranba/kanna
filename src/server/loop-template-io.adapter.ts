/**
 * IO leaf for `mcp__kanna__setup_loop`: ensure the loop's tracking file
 * exists on disk. Called after `validateLoopSetup` returns ok. Side-effect
 * seal exempt via the `.adapter.ts` filename convention.
 */

import { access, mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

export interface EnsureTrackingFileArgs {
  /** Absolute path resolved + confined by `loop-template.validateLoopSetup`. */
  absPath: string
  /** Content to write when the file does not yet exist. */
  skeleton: string
}

export interface EnsureTrackingFileResult {
  /** True if the file was newly created; false if it already existed. */
  created: boolean
  /** Absolute path (unchanged from input; echoed back for convenience). */
  absPath: string
}

/**
 * Create the tracking file if absent; otherwise leave it alone (never
 * overwrites — the user's / subagent's edits are authoritative between
 * iterations). Parent directories are created as needed.
 */
export async function ensureTrackingFile(
  args: EnsureTrackingFileArgs,
): Promise<EnsureTrackingFileResult> {
  try {
    await access(args.absPath)
    return { created: false, absPath: args.absPath }
  } catch {
    // fall through to create
  }
  await mkdir(path.dirname(args.absPath), { recursive: true })
  await writeFile(args.absPath, args.skeleton, { encoding: "utf8" })
  return { created: true, absPath: args.absPath }
}
