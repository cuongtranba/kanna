import { spawn, spawnSync } from "node:child_process"
import { isErrnoException, toError } from "../shared/errors"

function formatSpawnError(command: string, error: Error): Error {
  if (isErrnoException(error) && error.code === "ENOENT") {
    return new Error(`Command not found: ${command}`)
  }

  return new Error(error.message || `Failed to start ${command}`)
}

export function spawnDetached(command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    let child
    try {
      child = spawn(command, args, { stdio: "ignore", detached: true })
    } catch (error) {
      reject(formatSpawnError(command, toError(error)))
      return
    }

    const handleError = (error: Error) => {
      reject(formatSpawnError(command, error))
    }

    child.once("error", handleError)
    child.once("spawn", () => {
      child.off("error", handleError)
      child.unref()
      resolve()
    })
  })
}

export function hasCommand(command: string) {
  if (process.platform === "win32") {
    const result = spawnSync("where", [command], { stdio: "ignore" })
    return result.status === 0
  }
  const result = spawnSync("sh", ["-lc", `command -v ${command}`], { stdio: "ignore" })
  return result.status === 0
}

export function canOpenMacApp(appName: string) {
  const result = spawnSync("open", ["-Ra", appName], { stdio: "ignore" })
  return result.status === 0
}

export interface SpawnSyncResult {
  status: number | null
  stdout: string
  stderr: string
}

export function spawnSyncCapture(command: string, args: string[]): SpawnSyncResult {
  const result = spawnSync(command, args, { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" })
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  }
}

export function sleep(ms: number): Promise<void> {
  return Bun.sleep(ms)
}

export interface CapturedRun {
  stdout: string
  stderr: string
  exitCode: number
}

export interface CaptureOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  signal?: AbortSignal
}

export async function spawnCapture(argv: string[], options: CaptureOptions = {}): Promise<CapturedRun> {
  const proc = Bun.spawn(argv, { cwd: options.cwd, env: options.env, stdin: "ignore", stdout: "pipe", stderr: "pipe" })
  const kill = () => {
    try {
      proc.kill()
    } catch {
    }
  }
  if (options.signal?.aborted) kill()
  options.signal?.addEventListener("abort", kill, { once: true })
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    return { stdout, stderr, exitCode }
  } finally {
    options.signal?.removeEventListener("abort", kill)
  }
}

export async function spawnPsCommand(pid: number): Promise<string> {
  const run = await spawnCapture(["ps", "-p", String(pid), "-o", "command="])
  return run.stdout.trim()
}

interface SignalTarget {
  readonly pid?: number
  kill(signal: NodeJS.Signals): void
}

export function signalProcessGroup(target: SignalTarget | number | null | undefined, signal: NodeJS.Signals): boolean {
  if (target === null || target === undefined) return false
  const pid = typeof target === "number" ? target : target.pid
  const groupLeader = pid !== undefined && Number.isFinite(pid) && pid > 0
  if (groupLeader && process.platform !== "win32") {
    try {
      process.kill(-pid, signal)
      return true
    } catch {
    }
  }
  if (typeof target === "number") return false
  try {
    target.kill(signal)
    return true
  } catch {
    return false
  }
}
