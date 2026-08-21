import { spawn, type ChildProcess } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import { createConnection } from "node:net"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
import { fileURLToPath } from "node:url"

// Deliberately NOT `PROD_SERVER_PORT` (3210, see src/shared/ports.ts) — using a distinct port
// means this harness can never accidentally attach to (and report false success against) a
// developer's already-running `bun run start`/`kanna` instance.
//
// Why the production server, not `bun run dev`: Vite's dev-server WebSocket proxy leg
// (`vite.config.ts` `"/ws": { ws: true }`) never completes the upgrade under Bun in this
// environment (verified with raw `curl`: through Vite `/ws` -> hangs / http_code=000; direct to
// the Bun backend `/ws` -> 101 Switching Protocols). Under `bun run dev` the app therefore never
// leaves the "Connecting to workspace" bootstrap splash, and no real-browser layout can be
// observed. `bun run start` serves the SPA and `/ws` from ONE Bun process with no proxy hop
// (same origin), which does reach the real UI. See the Warchief amendment in
// docs/tribe/planning/typography-scale-preference-plan.md (Wave 1 audit) for the full record.
const TEST_PORT = 3299
const READY_TIMEOUT_MS = 60_000
const READY_POLL_INTERVAL_MS = 250
const KILL_GRACE_MS = 5_000
const KILL_HARD_TIMEOUT_MS = 10_000
const OUTPUT_TAIL_MAX_LINES = 200

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..")
const distClientDir = join(repoRoot, "dist", "client")

export interface KannaBoot {
  /** Base URL of the booted production server, e.g. http://localhost:3299 */
  baseUrl: string
  /** Kills the `bun run start` process tree and removes the seeded temp KANNA_HOME. */
  stop: () => Promise<void>
}

/** A rolling tail of a child process's combined stdout+stderr, kept for failure diagnostics. */
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

/**
 * Mirrors the readiness-polling shape of `waitForLocalUrl` at scripts/dev.ts:110-127: poll a
 * URL until it answers `ok`, or throw once `deadline` (an absolute `Date.now()` timestamp) has
 * passed.
 */
async function waitForLocalUrl(url: string, deadline: number): Promise<void> {
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) {
        return
      }
    } catch {
      // Keep polling until the URL answers or the deadline passes.
    }

    await sleep(READY_POLL_INTERVAL_MS)
  }

  throw new Error(`Timed out waiting for ${url}`)
}

/**
 * Rejects the moment `child` exits, with a message naming the exit code/signal. Boot races this
 * against readiness polling so a backend that fails to bind (e.g. `--strict-port` hitting an
 * occupied port) is reported immediately instead of only after the full readiness timeout.
 */
function waitForChildExit(child: ChildProcess): Promise<never> {
  return new Promise((_resolve, reject) => {
    child.once("exit", (code, signal) => {
      reject(new Error(`bun run start exited before readiness (code=${String(code)}, signal=${String(signal)})`))
    })
  })
}

/** Resolves to `true` once a TCP connection to `127.0.0.1:port` succeeds, i.e. the port is occupied. */
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

/**
 * Refuses to boot if the port this harness needs is already bound — attaching to a pre-existing
 * process on that port would silently exercise a stranger's server, not this harness's own
 * seeded, temp-`KANNA_HOME` instance.
 */
async function assertPortFree(port: number): Promise<void> {
  if (await isPortOccupied(port)) {
    throw new Error(
      `Port ${String(port)} is already in use — refusing to start the e2e harness against it. ` +
        "Free the port (or stop whatever is bound to it) and retry.",
    )
  }
}

/**
 * Reports whether any process in the group led by `pgid` is still alive, via the POSIX
 * convention that signal 0 performs no-op existence/permission checks.
 */
function processGroupExists(pgid: number): boolean {
  try {
    process.kill(-pgid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * Kills the ENTIRE process group `child` leads (not just `child` itself) and waits until every
 * member has actually exited.
 *
 * The post-SIGKILL poll is bounded: if the group is somehow still alive `KILL_HARD_TIMEOUT_MS`
 * after SIGKILL (a kernel wedged the process, a permission issue, etc.), this warns loudly and
 * returns rather than hanging the test run forever.
 */
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

/**
 * Boots the real Kanna **production** server (`bun run start`, i.e. `src/server/cli.ts`) against
 * a seeded temp `KANNA_HOME` — never the developer's real `~/.kanna` — on a port distinct from
 * the real production default, and waits for `/health` on that same port to answer before
 * resolving. Unlike the dev-server pair, the production server serves the SPA and `/ws` from ONE
 * Bun process with no proxy hop, so a single readiness probe is sufficient — see the module
 * header comment for why `bun run dev` cannot be used here.
 *
 * Requires `dist/client` to already exist (built via `bun run build`) — this function only boots
 * the server, it never builds, so calling it against a missing/stale build fails loudly instead
 * of silently serving nothing.
 *
 * Both the child process tree and the temp home are guaranteed to be cleaned up: if readiness
 * polling fails (timeout, or the child exiting early), `stop()` runs before the error is
 * rethrown, with the child's captured stdout+stderr tail attached for diagnostics; on success,
 * the caller owns calling `stop()` (e.g. from `test.afterAll`).
 */
export async function bootKanna(): Promise<KannaBoot> {
  if (!existsSync(distClientDir)) {
    throw new Error(
      `${distClientDir} does not exist — the e2e harness boots the PRODUCTION server, which requires a ` +
        "built client. Run `bun run build` first (the `test:e2e` script does this automatically).",
    )
  }

  await assertPortFree(TEST_PORT)

  const kannaHome = await mkdtemp(join(tmpdir(), "kanna-e2e-home-"))
  const outputTail = new OutputTail()

  // `detached: true` makes `child` the leader of its own process group, so `killChildTree` can
  // signal the whole tree via `-pgid`. `stdio: "pipe"` (rather than "ignore") means a boot
  // failure leaves a diagnostic trail instead of vanishing silently.
  const child = spawn(
    "bun",
    ["run", "start", "--port", String(TEST_PORT), "--no-open", "--strict-port"],
    {
      cwd: repoRoot,
      env: { ...process.env, HOME: kannaHome },
      stdio: "pipe",
      detached: true,
    },
  )

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

  return { baseUrl, stop }
}
