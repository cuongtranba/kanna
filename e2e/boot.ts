import { spawn, type ChildProcess } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import { createConnection } from "node:net"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
import { fileURLToPath } from "node:url"

const TEST_PORT = 3299
const READY_TIMEOUT_MS = 60_000
const READY_POLL_INTERVAL_MS = 250
const KILL_GRACE_MS = 5_000
const KILL_HARD_TIMEOUT_MS = 10_000
const OUTPUT_TAIL_MAX_LINES = 200

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..")
const distClientDir = join(repoRoot, "dist", "client")

export interface KannaBoot {
  baseUrl: string
  kannaHome: string
  stop: () => Promise<void>
}

export interface BootKannaOptions {
  seed?: (kannaHome: string) => Promise<void>
}

class OutputTail {
  private lines: string[] = []

  append(chunk: Buffer | string): void {
    this.lines.push(...chunk.toString().split("\n"))
    if (this.lines.length > OUTPUT_TAIL_MAX_LINES) {
      this.lines = this.lines.slice(-OUTPUT_TAIL_MAX_LINES)
    }
  }

  toString(): string {
    return this.lines.join("\n")
  }
}

async function waitForLocalUrl(url: string, deadline: number): Promise<void> {
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) {
        return
      }
    } catch {
    }

    await sleep(READY_POLL_INTERVAL_MS)
  }

  throw new Error(`Timed out waiting for ${url}`)
}

function waitForChildExit(child: ChildProcess): Promise<never> {
  return new Promise((_resolve, reject) => {
    child.once("exit", (code, signal) => {
      reject(new Error(`bun run start exited before readiness (code=${String(code)}, signal=${String(signal)})`))
    })
  })
}

function isPortOccupied(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host: "127.0.0.1" })

    const finish = (occupied: boolean) => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(occupied)
    }

    socket.once("connect", () => finish(true))
    socket.once("error", () => finish(false))
  })
}

async function assertPortFree(port: number): Promise<void> {
  if (await isPortOccupied(port)) {
    throw new Error(
      `Port ${String(port)} is already in use — refusing to start the e2e harness against it. ` +
        "Free the port (or stop whatever is bound to it) and retry.",
    )
  }
}

function processGroupExists(pgid: number): boolean {
  try {
    process.kill(-pgid, 0)
    return true
  } catch {
    return false
  }
}

async function killChildTree(child: ChildProcess): Promise<void> {
  const pgid = child.pid
  if (pgid === undefined || !processGroupExists(pgid)) {
    return
  }

  process.kill(-pgid, "SIGTERM")

  const softDeadline = Date.now() + KILL_GRACE_MS
  while (Date.now() < softDeadline && processGroupExists(pgid)) {
    await sleep(100)
  }

  if (!processGroupExists(pgid)) {
    return
  }

  process.kill(-pgid, "SIGKILL")

  const hardDeadline = Date.now() + KILL_HARD_TIMEOUT_MS
  while (Date.now() < hardDeadline && processGroupExists(pgid)) {
    await sleep(100)
  }

  if (processGroupExists(pgid)) {
    console.warn(
      `[e2e/boot] process group ${String(pgid)} is still alive ${String(KILL_HARD_TIMEOUT_MS)}ms after SIGKILL; ` +
        "giving up on cleanup and moving on. This is a diagnostic, not a crash — investigate if it recurs.",
    )
  }
}

export async function bootKanna(options: BootKannaOptions = {}): Promise<KannaBoot> {
  if (!existsSync(distClientDir)) {
    throw new Error(
      `${distClientDir} does not exist — the e2e harness boots the PRODUCTION server, which requires a ` +
        "built client. Run `bun run build` first (the `test:e2e` script does this automatically).",
    )
  }

  await assertPortFree(TEST_PORT)

  const kannaHome = await mkdtemp(join(tmpdir(), "kanna-e2e-home-"))

  if (options.seed) {
    try {
      await options.seed(kannaHome)
    } catch (error) {
      await rm(kannaHome, { recursive: true, force: true })
      throw error
    }
  }

  const outputTail = new OutputTail()

  const child = spawn(
    "bun",
    ["run", "start", "--port", String(TEST_PORT), "--no-open", "--strict-port"],
    {
      cwd: repoRoot,
      env: { ...process.env, HOME: kannaHome, KANNA_DISABLE_SELF_UPDATE: "1" },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    },
  )

  child.once("error", (error) => outputTail.append(`${String(error)}\n`))

  child.stdout?.on("data", (chunk: Buffer) => outputTail.append(chunk))
  child.stderr?.on("data", (chunk: Buffer) => outputTail.append(chunk))

  const baseUrl = `http://localhost:${String(TEST_PORT)}`
  const healthUrl = `${baseUrl}/health`

  const stop = async () => {
    await killChildTree(child)
    await rm(kannaHome, { recursive: true, force: true })
  }

  try {
    const deadline = Date.now() + READY_TIMEOUT_MS
    await Promise.race([waitForLocalUrl(healthUrl, deadline), waitForChildExit(child)])
  } catch (error) {
    await stop()
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(
      `${reason}\n--- bun run start output (last ${String(OUTPUT_TAIL_MAX_LINES)} lines) ---\n${outputTail.toString()}`,
    )
  }

  return { baseUrl, kannaHome, stop }
}
