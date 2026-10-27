import { spawnCapture, type CapturedRun } from "./process-utils.adapter"
import { projectProcessEnv } from "./project-process-env"

const NON_INTERACTIVE_GIT_ENV = {
  GIT_TERMINAL_PROMPT: "0",
  GIT_ASKPASS: "echo",
  SSH_ASKPASS: "echo",
  GCM_INTERACTIVE: "Never",
} as const

export function nonInteractiveGitEnv(): NodeJS.ProcessEnv {
  return { ...projectProcessEnv(process.env), ...NON_INTERACTIVE_GIT_ENV }
}

export function runGit(args: string[], cwd: string, signal?: AbortSignal): Promise<CapturedRun> {
  return spawnCapture(["git", "-C", cwd, ...args], { env: nonInteractiveGitEnv(), signal })
}

export async function tryRunGit(args: string[], cwd: string, timeoutMs?: number): Promise<CapturedRun | null> {
  const signal = timeoutMs === undefined ? undefined : AbortSignal.timeout(timeoutMs)
  try {
    const run = await runGit(args, cwd, signal)
    return signal?.aborted ? null : run
  } catch {
    return null
  }
}
