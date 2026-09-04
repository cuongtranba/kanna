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

export async function spawnPsCommand(pid: number): Promise<string> {
  const proc = Bun.spawn({
    cmd: ["ps", "-p", String(pid), "-o", "command="],
    stdin: "ignore",
    stdout: "pipe",
    stderr: "ignore",
  })
  const out = (await new Response(proc.stdout).text()).trim()
  await proc.exited
  return out
}

export async function spawnCapture(command: string, args: string[], cwd: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn({ cmd: [command, ...args], cwd, stdout: "pipe", stderr: "pipe" })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { stdout, stderr, exitCode }
}
