import { spawn, type SpawnOptionsWithStdioTuple, type StdioPipe } from "node:child_process"
import type { SpawnAntigravityAcp } from "./antigravity-acp"
import type { StdioProcess } from "./stdio-process"
import { projectProcessEnv } from "./project-process-env"

type AntigravitySpawnOptions = SpawnOptionsWithStdioTuple<StdioPipe, StdioPipe, StdioPipe>

export function buildAntigravitySpawnOptions(platform: string, cwd: string): AntigravitySpawnOptions {
  const base: AntigravitySpawnOptions = {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
    env: projectProcessEnv(process.env),
  }
  if (platform === "win32") {
    return { ...base, shell: true }
  }
  return base
}

function spawnAntigravityProcess(cwd: string): StdioProcess {
  return spawn("agy", ["acp", "--dangerously-skip-permissions"], buildAntigravitySpawnOptions(process.platform, cwd))
}

export const defaultSpawnAntigravityAcp: SpawnAntigravityAcp = spawnAntigravityProcess
