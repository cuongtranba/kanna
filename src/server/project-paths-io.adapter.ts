import { readdir } from "node:fs/promises"
import { existsSync, statSync, type Dirent } from "node:fs"
import { spawn } from "bun"

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

export async function runGitCapture(cwd: string, args: string[], env: NodeJS.ProcessEnv): Promise<{ stdout: string; exitCode: number } | null> {
  try {
    const proc = spawn(["git", ...args], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
      env,
    })
    const stdout = await new Response(proc.stdout).text()
    const exitCode = await proc.exited
    return { stdout, exitCode }
  } catch {
    return null
  }
}
