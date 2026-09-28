import process from "node:process"
import os from "node:os"
import { spawn } from "node:child_process"
import { LOG_PREFIX } from "../shared/branding"
import { log } from "../shared/log"
import {
  isPathEndMarkerSeen,
  LOGIN_SHELL_PATH_RESOLVED_ENV_VAR,
  resolveLoginShellPath,
  type LoginShellPathOutcome,
  type LoginShellPathPort,
  type LoginShellRun,
} from "./login-shell-path"

function killProcessGroup(pid: number | undefined): boolean {
  if (pid === undefined) return false
  try {
    return process.kill(-pid, "SIGKILL")
  } catch {
    return false
  }
}

export function runLoginShell(run: LoginShellRun): Promise<string | null> {
  return new Promise((resolve) => {
    let stdout = ""
    let settled = false
    const child = spawn(run.shell, [...run.args], {
      env: { ...run.env },
      stdio: ["ignore", "pipe", "ignore"],
      detached: true,
    })
    const finish = (value: string | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      killProcessGroup(child.pid)
      resolve(value)
    }
    const timer = setTimeout(() => finish(null), run.timeoutMs)
    child.stdout.setEncoding("utf8")
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk
      if (isPathEndMarkerSeen(stdout)) finish(stdout)
    })
    child.once("error", () => finish(null))
    child.once("close", () => finish(stdout))
  })
}

function userShell(): string | null {
  try {
    return os.userInfo().shell || null
  } catch {
    return null
  }
}

function loginShellPathPort(): LoginShellPathPort {
  return {
    platform: process.platform,
    env: process.env,
    fallbackShell: userShell(),
    runShell: runLoginShell,
  }
}

function reportOutcome(outcome: LoginShellPathOutcome): void {
  if (outcome.kind === "merged" && outcome.added.length > 0) {
    log.info(`${LOG_PREFIX} added ${outcome.added.length} PATH entries from login shell ${outcome.shell}`, {
      added: outcome.added,
    })
  }
  if (outcome.kind === "unavailable") {
    log.warn(
      `${LOG_PREFIX} could not read PATH from login shell ${outcome.shell}; keeping the inherited PATH. `
        + "Raise KANNA_LOGIN_SHELL_TIMEOUT_MS if the shell starts slowly, or set KANNA_LOGIN_SHELL_PATH=disabled.",
    )
  }
}

export async function loginShellPathEnvForChild(): Promise<Record<string, string>> {
  const outcome = await resolveLoginShellPath(loginShellPathPort())
  reportOutcome(outcome)
  return {
    ...(outcome.kind === "merged" ? { PATH: outcome.path } : {}),
    [LOGIN_SHELL_PATH_RESOLVED_ENV_VAR]: "1",
  }
}

export async function inheritLoginShellPath(): Promise<void> {
  const outcome = await resolveLoginShellPath(loginShellPathPort())
  reportOutcome(outcome)
  if (outcome.kind === "merged") process.env.PATH = outcome.path
}
