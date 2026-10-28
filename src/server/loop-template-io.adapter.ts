
import { readFile } from "node:fs/promises"
import path from "node:path"

import { tryRunGit } from "./git-runner.adapter"
import { confinePathToDir } from "./input-validation"

async function git(args: string[], cwd: string): Promise<{ ok: boolean; stdout: string }> {
  const run = await tryRunGit(args, cwd)
  return run === null ? { ok: false, stdout: "" } : { ok: run.exitCode === 0, stdout: run.stdout.trim() }
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
