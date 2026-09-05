
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

import { confinePathToDir } from "./input-validation"

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
    return { ok: false, stdout: "" }
  }
}

export interface TrackingFileInspection {
  exists: boolean
  content: string | null
  gitTracked: boolean
}

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

export async function isWorktreeOfSameRepo(projectCwd: string, workdir: string): Promise<boolean> {
  const [project, target] = await Promise.all([
    git(["rev-parse", "--path-format=absolute", "--git-common-dir"], projectCwd),
    git(["rev-parse", "--path-format=absolute", "--git-common-dir"], workdir),
  ])
  if (!project.ok || !target.ok) return false
  if (project.stdout.length === 0 || target.stdout.length === 0) return false
  return path.resolve(project.stdout) === path.resolve(target.stdout)
}

export async function readOracleScript(
  workdirAbs: string,
  scriptPath: string,
): Promise<string | null> {
  const confined = confinePathToDir(scriptPath, workdirAbs, "verify script")
  if ("error" in confined) return null
  try {
    return await readFile(confined.abs, "utf8")
  } catch {
    return null
  }
}

export interface EnsureTrackingFileArgs {
  absPath: string
  skeleton: string
  reconcile: (existing: string) => { content: string; changed: boolean; actions: string[] }
}

export interface EnsureTrackingFileResult {
  created: boolean
  reconciled: boolean
  actions: string[]
  absPath: string
}

export async function ensureTrackingFile(
  args: EnsureTrackingFileArgs,
): Promise<EnsureTrackingFileResult> {
  let existing: string | null = null
  try {
    existing = await readFile(args.absPath, "utf8")
  } catch {
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
