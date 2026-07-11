import { spawn } from "node:child_process"
import type { CodexAppServerProcess, SpawnCodexAppServer } from "./codex-app-server"

function spawnCodexProcess(cwd: string): CodexAppServerProcess {
  const child = spawn("codex", ["app-server"], {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env,
  })
  return child
}

export const defaultSpawnCodexAppServer: SpawnCodexAppServer = spawnCodexProcess
