import { spawn, type ChildProcess } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
import { fileURLToPath } from "node:url"

const CLIENT_PORT = 5174
const READY_TIMEOUT_MS = 60_000
const READY_POLL_INTERVAL_MS = 250
const KILL_GRACE_MS = 5_000

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..")

export interface KannaBoot {
  /** Base URL of the booted dev client, e.g. http://localhost:5174 */
  baseUrl: string
  /** Kills the `bun run dev` process tree and removes the seeded temp KANNA_HOME. */
  stop: () => Promise<void>
}

/**
 * Mirrors the readiness-polling shape of `waitForLocalUrl` at scripts/dev.ts:110-127: poll a
 * URL until it answers `ok`, or throw once `timeoutMs` elapses.
 */
async function waitForLocalUrl(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) {
        return
      }
    } catch {
      // Keep polling until the dev server answers or the timeout expires.
    }

    await sleep(READY_POLL_INTERVAL_MS)
  }

  throw new Error(`Timed out waiting for ${url}`)
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
 * `scripts/dev.ts`'s own shutdown handler sends SIGTERM to its vite/server children and then
 * calls `process.exit()` immediately — it does not wait for them to die. So `child`'s own "exit"
 * event fires while its grandchildren (the real vite + backend processes holding KANNA_HOME file
 * handles) are still alive. Polling `processGroupExists` instead of trusting `child`'s exit event
 * is what makes it safe to remove the temp home directory right after this resolves.
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

  while (processGroupExists(pgid)) {
    await sleep(100)
  }
}

/**
 * Boots the real Kanna dev server (`bun run dev`, i.e. `scripts/dev.ts`'s vite client + backend
 * pair) against a seeded temp `KANNA_HOME` — never the developer's real `~/.kanna` — and waits
 * for the dev client to answer before resolving.
 *
 * Both the child process tree and the temp home are guaranteed to be cleaned up: if readiness
 * polling fails, `stop()` runs before the error is rethrown; on success, the caller owns calling
 * `stop()` (e.g. from `test.afterAll`).
 */
export async function bootKanna(): Promise<KannaBoot> {
  const kannaHome = await mkdtemp(join(tmpdir(), "kanna-e2e-home-"))

  // `detached: true` makes `child` the leader of its own process group, so `killChildTree` can
  // signal the whole tree (bun run dev + the vite/backend grandchildren it spawns) via `-pgid`
  // instead of only the top wrapper process.
  const child = spawn("bun", ["run", "dev"], {
    cwd: repoRoot,
    env: { ...process.env, HOME: kannaHome },
    stdio: "ignore",
    detached: true,
  })

  const baseUrl = `http://localhost:${CLIENT_PORT}`

  const stop = async () => {
    await killChildTree(child)
    await rm(kannaHome, { recursive: true, force: true })
  }

  try {
    await waitForLocalUrl(baseUrl, READY_TIMEOUT_MS)
  } catch (error) {
    await stop()
    throw error
  }

  return { baseUrl, stop }
}
