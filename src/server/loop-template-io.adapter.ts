/**
 * IO leaf for `mcp__kanna__setup_loop`: ensure the loop's tracking file
 * exists on disk and conforms to the loop schema. Called after
 * `validateLoopSetup` returns ok. Side-effect seal exempt via the
 * `.adapter.ts` filename convention. Schema logic stays in the pure layer —
 * the caller injects `reconcile` (see `reconcileTrackingFile`).
 */

import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

/**
 * Run a git command and report success + trimmed stdout. Every spawn here
 * pins `stdin: "ignore"` and `GIT_TERMINAL_PROMPT=0` so a repo with a
 * credential helper can never block `setup_loop` on an invisible prompt.
 */
async function git(args: string[], cwd: string): Promise<{ ok: boolean; stdout: string }> {
  try {
    const proc = Bun.spawn(["git", ...args], {
      cwd,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "ignore",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    })
    const stdout = await new Response(proc.stdout).text()
    const exitCode = await proc.exited
    return { ok: exitCode === 0, stdout: stdout.trim() }
  } catch {
    // cwd missing, or git absent — callers treat this as "not a repo".
    return { ok: false, stdout: "" }
  }
}

export interface TrackingFileInspection {
  exists: boolean
  /** Current content, or null when the file does not exist. */
  content: string | null
  /** True only when git reports the path as tracked (i.e. committed history is at risk). */
  gitTracked: boolean
}

/**
 * Read the tracking file and ask git whether it is tracked, so the pure layer
 * (`assertTrackingFileSafe`) can decide whether reconciling it would destroy
 * committed history. Never throws: a missing file, a non-repo directory and a
 * machine without git all resolve to a benign "untracked" answer.
 */
export async function inspectTrackingFile(absPath: string): Promise<TrackingFileInspection> {
  let content: string
  try {
    content = await readFile(absPath, "utf8")
  } catch {
    return { exists: false, content: null, gitTracked: false }
  }

  const { ok } = await git(
    ["ls-files", "--error-unmatch", path.basename(absPath)],
    path.dirname(absPath),
  )
  return { exists: true, content, gitTracked: ok }
}

/**
 * True when `workdir` is the project checkout itself, or a linked worktree of
 * the SAME repository as `projectCwd`.
 *
 * This is the guard on `setup_loop`'s `workdir`: a loop must be able to reach
 * a sibling worktree (the house rule is "always use a git worktree"), but that
 * must not become a way to aim a loop at an arbitrary directory. Comparing
 * `--git-common-dir` is what makes every worktree of one repo compare equal
 * while an unrelated repo does not — `--git-dir` differs per worktree.
 */
export async function isWorktreeOfSameRepo(projectCwd: string, workdir: string): Promise<boolean> {
  const [project, target] = await Promise.all([
    git(["rev-parse", "--path-format=absolute", "--git-common-dir"], projectCwd),
    git(["rev-parse", "--path-format=absolute", "--git-common-dir"], workdir),
  ])
  if (!project.ok || !target.ok) return false
  if (project.stdout.length === 0 || target.stdout.length === 0) return false
  return path.resolve(project.stdout) === path.resolve(target.stdout)
}

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
