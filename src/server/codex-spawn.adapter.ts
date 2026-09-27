import { spawn, type SpawnOptions } from "node:child_process"
import type { CodexAppServerProcess, SpawnCodexAppServer } from "./codex-app-server"
import { projectProcessEnv } from "./project-process-env"

export function buildCodexSpawnOptions(platform: string, cwd: string): SpawnOptions {
  const base: SpawnOptions = {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
    env: projectProcessEnv(process.env),
  }
  if (platform === "win32") {
    return { ...base, shell: true }
  }
  return base
}

function spawnCodexProcess(cwd: string): CodexAppServerProcess {
  const child = spawn("codex", ["app-server"], {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
    env: projectProcessEnv(process.env),
    shell: process.platform === "win32",
  })
  return child
}

export const defaultSpawnCodexAppServer: SpawnCodexAppServer = spawnCodexProcess
