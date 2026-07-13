/**
 * IO leaf for `mcp__kanna__setup_loop`: ensure the loop's tracking file
 * exists on disk and conforms to the loop schema. Called after
 * `validateLoopSetup` returns ok. Side-effect seal exempt via the
 * `.adapter.ts` filename convention. Schema logic stays in the pure layer —
 * the caller injects `reconcile` (see `reconcileTrackingFile`).
 */

import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

export interface EnsureTrackingFileArgs {
  /** Absolute path resolved + confined by `loop-template.validateLoopSetup`. */
  absPath: string
  /** Content to write when the file does not yet exist. */
  skeleton: string
  /** Pure reconcile applied to an existing file's content (deterministic). */
  reconcile: (existing: string) => { content: string; changed: boolean; actions: string[] }
}

export interface EnsureTrackingFileResult {
  /** True if the file was newly created; false if it already existed. */
  created: boolean
  /** True if an existing file was rewritten to conform to the loop schema. */
  reconciled: boolean
  /** Section-level reconcile actions taken; empty when created or already conformant. */
  actions: string[]
  /** Absolute path (unchanged from input; echoed back for convenience). */
  absPath: string
}

/**
 * Create the tracking file if absent; otherwise deterministically reconcile
 * it against the loop schema, rewriting only when the injected pure
 * reconcile reports a change. Parent directories are created as needed.
 */
export async function ensureTrackingFile(
  args: EnsureTrackingFileArgs,
): Promise<EnsureTrackingFileResult> {
  let existing: string | null = null
  try {
    existing = await readFile(args.absPath, "utf8")
  } catch {
    // absent — fall through to create
  }

  if (existing === null) {
    await mkdir(path.dirname(args.absPath), { recursive: true })
    await writeFile(args.absPath, args.skeleton, { encoding: "utf8" })
    return { created: true, reconciled: false, actions: [], absPath: args.absPath }
  }

  const result = args.reconcile(existing)
  if (!result.changed) {
    return { created: false, reconciled: false, actions: [], absPath: args.absPath }
  }
  await writeFile(args.absPath, result.content, { encoding: "utf8" })
  return { created: false, reconciled: true, actions: result.actions, absPath: args.absPath }
}
