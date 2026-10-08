import { spawn, type ChildProcess } from "node:child_process"
import type { BeaconOs } from "../shared/beacon-protocol"
import type { BeaconExecLimits, BeaconRequestSink, BeaconShellPort } from "./ports"

export const TIMEOUT_EXIT_CODE = 124
export const SPAWN_FAILURE_EXIT_CODE = 127

interface Launch {
  command: string
  args: readonly string[]
  cwd?: string
}

function killTree(child: ChildProcess, os: BeaconOs): void {
  if (child.pid === undefined) return
  if (os === "windows") {
    child.kill("SIGKILL")
    return
  }
  try {
    process.kill(-child.pid, "SIGKILL")
  } catch {
    child.kill("SIGKILL")
  }
}

function runLaunch(os: BeaconOs, launch: Launch, sink: BeaconRequestSink, limits: BeaconExecLimits): Promise<number> {
  return new Promise((resolve) => {
    const options = launch.cwd === undefined ? {} : { cwd: launch.cwd }
    const child = spawn(launch.command, [...launch.args], {
      ...options,
      stdio: ["ignore", "pipe", "pipe"],
      detached: os !== "windows",
      windowsHide: true,
    })
    let forwarded = 0
    let truncated = false
    let settled = false

    function finish(code: number): void {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(code)
    }

    function forward(write: (chunk: string) => void, chunk: string): void {
      if (truncated) return
      const room = limits.outputByteCap - forwarded
      const size = Buffer.byteLength(chunk)
      if (size <= room) {
        forwarded += size
        write(chunk)
        return
      }
      truncated = true
      if (room > 0) write(Buffer.from(chunk).subarray(0, room).toString("utf8"))
      sink.stderr(`\n[output truncated at ${limits.outputByteCap} bytes]\n`)
    }

    const timer = setTimeout(() => {
      killTree(child, os)
      child.stdout?.destroy()
      child.stderr?.destroy()
      sink.stderr(`\n[timed out after ${limits.timeoutMs} ms]\n`)
      finish(TIMEOUT_EXIT_CODE)
    }, limits.timeoutMs)

    child.stdout?.setEncoding("utf8")
    child.stderr?.setEncoding("utf8")
    child.stdout?.on("data", (chunk: string) => forward((text) => sink.stdout(text), chunk))
    child.stderr?.on("data", (chunk: string) => forward((text) => sink.stderr(text), chunk))
    child.on("error", (error) => {
      sink.stderr(`${error.message}\n`)
      finish(SPAWN_FAILURE_EXIT_CODE)
    })
    child.on("close", (code) => finish(code ?? 1))
  })
}

function scriptLaunch(os: BeaconOs, body: string): Launch {
  if (os === "windows") return { command: "powershell.exe", args: ["-NoProfile", "-Command", body] }
  return { command: "/bin/sh", args: ["-lc", body] }
}

export function createBeaconShell(os: BeaconOs): BeaconShellPort {
  return {
    exec(args, sink, limits) {
      const launch: Launch =
        args.cwd === undefined
          ? { command: args.cmd, args: args.cmdArgs }
          : { command: args.cmd, args: args.cmdArgs, cwd: args.cwd }
      return runLaunch(os, launch, sink, limits)
    },
    script(body, sink, limits) {
      return runLaunch(os, scriptLaunch(os, body), sink, limits)
    },
  }
}
