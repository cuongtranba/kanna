import { spawn, type SpawnOptions } from "node:child_process"
import type { CodexAppServerProcess, SpawnCodexAppServer } from "./codex-app-server"

export function buildCodexSpawnOptions(platform: string, cwd: string): SpawnOptions {
  const base: SpawnOptions = {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env,
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
    env: process.env,
    shell: process.platform === "win32",
  })
  return child
}

export const defaultSpawnCodexAppServer: SpawnCodexAppServer = spawnCodexProcess
