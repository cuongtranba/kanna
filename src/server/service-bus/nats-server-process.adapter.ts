import { spawn as nodeSpawn, execFile } from "node:child_process"
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:net"
import { errorMessage } from "../../shared/errors"
import { log } from "../../shared/log"
import { embeddedStoreBytes, renderNatsConfig, type EmbeddedServerSettings } from "../../shared/service-bus/jetstream-config"
import { addCounter, NATS_SERVER_RESTARTS_TOTAL } from "../observability"
import { natsRuntimePaths } from "./nats-server-release"
import { defaultSchedule, type NatsScheduler } from "./scheduler"

export interface NatsChild {
  pid: number
  kill: (signal: "SIGTERM" | "SIGKILL") => void
  onOutput: (listener: (chunk: string) => void) => void
  onExit: (listener: (code: number | null) => void) => void
}

export type NatsSpawn = (command: string, args: string[]) => NatsChild
export type NatsProcessState = "stopped" | "starting" | "ready" | "restarting"

export interface NatsProcessStatus {
  state: NatsProcessState
  port: number | null
  restarts: number
  lastError: string | null
}

export type NatsProcessEvent =
  | { kind: "ready"; port: number; restart: boolean }
  | { kind: "exited"; code: number | null; retryInMs: number }
  | { kind: "failed"; message: string; retryInMs: number }

export interface NatsServerProcessOptions {
  binaryPath: string
  dataDir: string
  settings: EmbeddedServerSettings
  token: string
  spawn?: NatsSpawn
  now?: () => number
  pickPort?: () => Promise<number>
  schedule?: NatsScheduler
}

export interface NatsServerProcess {
  start: () => Promise<{ port: number }>
  stop: () => Promise<void>
  subscribe: (listener: (event: NatsProcessEvent) => void) => () => void
  status: () => NatsProcessStatus
}

export const READY_LINE = "Server is ready"
export const READY_TIMEOUT_MS = 15_000
export const STOP_GRACE_MS = 5_000
export const RESTART_BACKOFF_INITIAL_MS = 1_000
export const RESTART_BACKOFF_MAX_MS = 60_000
export const STABLE_RUN_MS = 60_000
const TAIL_LINES = 12
const PRIVATE_FILE_MODE = 0o600
const PRIVATE_DIR_MODE = 0o700

function defaultSpawn(command: string, args: string[]): NatsChild {
  const child = nodeSpawn(command, args, { stdio: ["ignore", "pipe", "pipe"], env: { PATH: process.env.PATH ?? "" } })
  return {
    pid: child.pid ?? -1,
    kill: (signal) => {
      child.kill(signal)
    },
    onOutput: (listener) => {
      child.stdout.on("data", (chunk: Buffer) => listener(chunk.toString("utf8")))
      child.stderr.on("data", (chunk: Buffer) => listener(chunk.toString("utf8")))
    },
    onExit: (listener) => {
      child.on("exit", (code: number | null) => listener(code))
      child.on("error", () => listener(null))
    },
  }
}

export function pickFreeLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.once("error", reject)
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address()
      const port = typeof address === "object" && address !== null ? address.port : 0
      probe.close(() => {
        if (port > 0) resolve(port)
        else reject(new Error("could not pick a free port"))
      })
    })
  })
}

function commandOf(pid: number): Promise<string> {
  return new Promise((resolve) => {
    execFile("ps", ["-p", String(pid), "-o", "comm="], (error, stdout) => {
      resolve(error === null ? stdout.trim() : "")
    })
  })
}

export async function reapStaleNatsServer(pidFile: string): Promise<boolean> {
  const text = await readFile(pidFile, "utf8").catch(() => "")
  const pid = Number.parseInt(text.trim(), 10)
  if (!Number.isInteger(pid) || pid <= 1) return false
  const command = await commandOf(pid)
  if (!command.includes("nats-server")) return false
  try {
    process.kill(pid, "SIGTERM")
    return true
  } catch {
    return false
  }
}

async function writePrivateFile(path: string, text: string): Promise<void> {
  const staged = `${path}.kanna-part`
  await writeFile(staged, text, { mode: PRIVATE_FILE_MODE })
  await chmod(staged, PRIVATE_FILE_MODE)
  await rename(staged, path)
}

export function createNatsServerProcess(options: NatsServerProcessOptions): NatsServerProcess {
  const spawn = options.spawn ?? defaultSpawn
  const now = options.now ?? Date.now
  const pickPort = options.pickPort ?? pickFreeLoopbackPort
  const schedule = options.schedule ?? defaultSchedule
  const paths = natsRuntimePaths(options.dataDir)
  const listeners = new Set<(event: NatsProcessEvent) => void>()
  const exitWaiters = new Set<() => void>()

  let state: NatsProcessState = "stopped"
  let port: number | null = options.settings.port === "auto" ? null : options.settings.port
  let child: NatsChild | null = null
  let stopping = false
  let restarts = 0
  let backoff = RESTART_BACKOFF_INITIAL_MS
  let startedAt = 0
  let lastError: string | null = null
  let cancelRestart: (() => void) | null = null
  let tail: string[] = []

  function emit(event: NatsProcessEvent): void {
    for (const listener of [...listeners]) {
      try {
        listener(event)
      } catch (error) {
        log.warn("[nats-server] listener failed:", errorMessage(error))
      }
    }
  }

  function remember(chunk: string): void {
    tail = [...tail, ...chunk.split(/\r?\n/).filter((line) => line.length > 0)].slice(-TAIL_LINES)
  }

  async function writeConfig(listenPort: number): Promise<void> {
    await mkdir(paths.root, { recursive: true, mode: PRIVATE_DIR_MODE })
    await mkdir(paths.store, { recursive: true, mode: PRIVATE_DIR_MODE })
    const bytes = embeddedStoreBytes(options.settings)
    await writePrivateFile(
      paths.config,
      renderNatsConfig({
        port: listenPort,
        storeDir: paths.store,
        token: options.token,
        maxMemoryStoreBytes: bytes.memory,
        maxFileStoreBytes: bytes.file,
        logLevel: options.settings.logLevel,
        pidFile: paths.pid,
      }),
    )
  }

  function launch(): Promise<number> {
    return new Promise((resolve, reject) => {
      void (async () => {
        try {
          await reapStaleNatsServer(paths.pid)
          const listenPort = port ?? (await pickPort())
          port = listenPort
          await writeConfig(listenPort)
          tail = []
          const spawned = spawn(options.binaryPath, ["-c", paths.config])
          child = spawned
          let ready = false
          let settled = false
          const cancelReadyTimer = schedule(() => {
            if (settled) return
            settled = true
            spawned.kill("SIGKILL")
            reject(new Error(`nats-server did not become ready within ${String(READY_TIMEOUT_MS / 1000)}s`))
          }, READY_TIMEOUT_MS)
          spawned.onOutput((chunk) => {
            remember(chunk)
            if (!ready && chunk.includes(READY_LINE) && !settled) {
              ready = true
              settled = true
              cancelReadyTimer()
              startedAt = now()
              resolve(listenPort)
            }
          })
          spawned.onExit((code) => {
            cancelReadyTimer()
            if (child === spawned) child = null
            for (const waiter of [...exitWaiters]) waiter()
            if (!ready) {
              if (!settled) {
                settled = true
                reject(new Error(`nats-server exited with code ${String(code)} before it was ready: ${tail.slice(-3).join(" | ")}`))
              }
              return
            }
            if (!stopping) onUnexpectedExit(code)
          })
        } catch (error) {
          reject(error instanceof Error ? error : new Error(errorMessage(error)))
        }
      })()
    })
  }

  function scheduleRestart(): number {
    const retryInMs = backoff
    backoff = Math.min(backoff * 2, RESTART_BACKOFF_MAX_MS)
    cancelRestart = schedule(() => {
      cancelRestart = null
      void relaunch()
    }, retryInMs)
    return retryInMs
  }

  function onUnexpectedExit(code: number | null): void {
    if (now() - startedAt >= STABLE_RUN_MS) backoff = RESTART_BACKOFF_INITIAL_MS
    restarts += 1
    addCounter(NATS_SERVER_RESTARTS_TOTAL, 1)
    state = "restarting"
    lastError = tail.length > 0 ? tail.slice(-2).join(" | ") : `exited with code ${String(code)}`
    emit({ kind: "exited", code, retryInMs: scheduleRestart() })
  }

  async function relaunch(): Promise<void> {
    if (stopping) return
    try {
      const listenPort = await launch()
      state = "ready"
      lastError = null
      emit({ kind: "ready", port: listenPort, restart: true })
    } catch (error) {
      if (stopping) return
      state = "restarting"
      lastError = errorMessage(error)
      emit({ kind: "failed", message: lastError, retryInMs: scheduleRestart() })
    }
  }

  return {
    async start() {
      stopping = false
      state = "starting"
      try {
        const listenPort = await launch()
        state = "ready"
        lastError = null
        emit({ kind: "ready", port: listenPort, restart: false })
        return { port: listenPort }
      } catch (error) {
        state = "stopped"
        lastError = errorMessage(error)
        throw error
      }
    },
    async stop() {
      stopping = true
      cancelRestart?.()
      cancelRestart = null
      const running = child
      if (running !== null) {
        await new Promise<void>((resolve) => {
          exitWaiters.add(resolve)
          const cancelKill = schedule(() => {
            running.kill("SIGKILL")
          }, STOP_GRACE_MS)
          exitWaiters.add(cancelKill)
          running.kill("SIGTERM")
        })
        exitWaiters.clear()
      }
      state = "stopped"
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    status() {
      return { state, port, restarts, lastError }
    },
  }
}

export async function resetNatsStore(dataDir: string): Promise<void> {
  await rm(natsRuntimePaths(dataDir).store, { recursive: true, force: true })
}
