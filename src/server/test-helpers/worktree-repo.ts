import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"

export function git(cwd: string, ...args: string[]): string {
  const r = spawnSync("git", args, {
    cwd,
    stdio: "pipe",
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      GIT_ASKPASS: "echo",
      SSH_ASKPASS: "echo",
      GCM_INTERACTIVE: "Never",
    },
  })
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr.toString()}`)
  return r.stdout.toString().trim()
}

export interface TempRepo {
  dir: string
  cleanup: () => void
}

export function makeTempRepo(): TempRepo {
  const dir = mkdtempSync(join(tmpdir(), "kanna-wt-"))
  git(dir, "init", "-q", "-b", "main")
  git(dir, "config", "user.email", "test@example.com")
  git(dir, "config", "user.name", "Test")
  git(dir, "commit", "--allow-empty", "-m", "init")
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}
