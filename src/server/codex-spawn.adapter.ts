import { spawn, type SpawnOptionsWithStdioTuple, type StdioPipe } from "node:child_process"
import type { CodexAppServerProcess, SpawnCodexAppServer } from "./codex-app-server"
import { projectProcessEnv } from "./project-process-env"

type CodexSpawnOptions = SpawnOptionsWithStdioTuple<StdioPipe, StdioPipe, StdioPipe>

export function buildCodexSpawnOptions(platform: string, cwd: string): CodexSpawnOptions {
  const base: CodexSpawnOptions = {
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
  return spawn("codex", ["app-server"], buildCodexSpawnOptions(process.platform, cwd))
}

export const defaultSpawnCodexAppServer: SpawnCodexAppServer = spawnCodexProcess
