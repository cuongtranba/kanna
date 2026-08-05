/**
 * IO leaf for the loop's verify command (the "oracle") and for the workspace
 * digest that lets a caller CACHE an oracle result. Side-effect seal exempt via
 * the `.adapter.ts` filename convention — every subprocess spawn and `stat` for
 * this feature lives here, so the cache/decision logic above it stays pure.
 *
 * Two facts shape this module:
 *  - The oracle is expensive (a real repo's lint/test gate is tens of seconds),
 *    so callers reuse a recorded result whenever the working tree is
 *    bit-for-bit unchanged since the run that produced it.
 *  - A hung oracle would wedge the whole loop, so every spawn is
 *    non-interactive (`stdin: "ignore"`, `GIT_TERMINAL_PROMPT=0`) and is hard
 *    killed — process group and all — once its deadline passes.
 */

import { spawn } from "node:child_process"
import type { Readable } from "node:stream"
import { createHash } from "node:crypto"
import { stat } from "node:fs/promises"
import path from "node:path"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default cap on the captured output; the TAIL is what a caller needs. */
const DEFAULT_MAX_OUTPUT_CHARS = 4000

/** Leading marker prepended when output was tail-truncated. */
const TRUNCATION_MARKER = "[output truncated - showing tail]\n"

/** Grace between SIGTERM and SIGKILL for a command that ignores the term. */
const SIGKILL_GRACE_MS = 2000

/**
 * Grace for the stdout/stderr readers to finish after the process exits. A
 * backgrounded grandchild can inherit (and hold open) the pipes, so completion
 * is gated on the `exit` event, never on stream EOF alone.
 */
const OUTPUT_DRAIN_GRACE_MS = 2000

/** Exit code reported for a timed-out run when the signal left none (GNU `timeout` convention). */
const TIMEOUT_EXIT_CODE = 124

/** Deadline for the digest's own git calls — a hung git would wedge the loop too. */
const GIT_TIMEOUT_MS = 15_000

// ---------------------------------------------------------------------------
// Export 1 — run the oracle
// ---------------------------------------------------------------------------

export interface RunVerifyArgs {
  /** Shell command to run. Executed via a shell so pipes/&&/redirects work. */
  command: string
  /** Absolute working directory to run it in. */
  cwd: string
  /** Kill the command after this many ms. */
  timeoutMs: number
}

export interface RunVerifyResult {
  exitCode: number
  /** Combined stdout+stderr, TAIL-truncated to at most `maxOutputChars` (default 4000) with a leading elision marker when truncated. */
  output: string
  timedOut: boolean
  durationMs: number
}

/**
 * Run the loop's verify command and report its outcome. A non-zero exit is a
 * normal result (the goal is not met yet) and never throws; only an impossible
 * spawn does.
 */
export async function runVerifyCommand(
  args: RunVerifyArgs & { maxOutputChars?: number },
): Promise<RunVerifyResult> {
  const maxOutputChars = args.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS
  const startedAt = Date.now()

  // A shell, so the stored command strings — which contain `&&`, absolute
  // paths and redirects — behave exactly as when a human runs them.
  const capture = await spawnCapture(["bash", "-lc", args.command], {
    cwd: args.cwd,
    timeoutMs: args.timeoutMs,
    maxOutputChars,
  })

  const combined = joinStreams(capture.stdout, capture.stderr)

  return {
    exitCode: capture.timedOut && capture.exitCode === 0 ? TIMEOUT_EXIT_CODE : capture.exitCode,
    output: tailTruncate(combined, maxOutputChars, capture.dropped),
    timedOut: capture.timedOut,
    durationMs: Date.now() - startedAt,
  }
}

// ---------------------------------------------------------------------------
// Export 2 — workspace digest
// ---------------------------------------------------------------------------

/**
 * Stable fingerprint of the working tree, or null when `cwd` is not a git
 * repo (callers then skip caching rather than risk a stale pass).
 *
 * Composition, and why:
 *  - `git rev-parse HEAD` alone is NOT enough. Uncommitted edits are exactly
 *    what the loop produces mid-iteration, so a HEAD-only digest would report
 *    "unchanged" across the very work the oracle must re-judge.
 *  - `git status --porcelain=v1 --untracked-files=all` adds the identity of
 *    every dirty/untracked path, catching adds, deletes and renames.
 *  - size + mtime-ms per dirty path catches an in-place edit that leaves the
 *    porcelain status letters identical. Hashing full file CONTENTS would be
 *    correct-er but far too slow on a large repo — this runs on every loop
 *    iteration, and the whole point of the cache is to SAVE wall-clock. Do not
 *    "fix" this to content hashing.
 *
 * The failure mode is deliberately asymmetric: a false "changed" only costs one
 * extra oracle run, while a false "unchanged" would serve a stale pass and end
 * the loop early. Hence null (un-cacheable), never a constant, when git cannot
 * answer.
 */
export async function computeWorkspaceDigest(cwd: string): Promise<string | null> {
  // Repo probe first: a non-repo cwd (or a missing git binary) is un-cacheable.
  const insideWorkTree = await runGit(["rev-parse", "--is-inside-work-tree"], cwd)
  if (!insideWorkTree || insideWorkTree.exitCode !== 0) {
    return null
  }

  // An unborn branch (repo with no commits) has no HEAD; that is still a real
  // repo, so digest it with an empty head component rather than bailing.
  const head = await runGit(["rev-parse", "HEAD"], cwd)
  const headSha = head && head.exitCode === 0 ? head.stdout.trim() : ""

  const status = await runGit(["status", "--porcelain=v1", "--untracked-files=all"], cwd)
  if (!status || status.exitCode !== 0) {
    return null
  }

  // Sorted so the digest is order-independent across git versions.
  const statusLines = status.stdout
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .sort((left, right) => left.localeCompare(right))

  const parts: string[] = [`head:${headSha}`]
  for (const line of statusLines) {
    const relPath = parseStatusPath(line)
    const stamp = relPath ? await statStamp(path.resolve(cwd, relPath)) : "nopath"
    parts.push(`${line} ${stamp}`)
  }

  return createHash("sha256").update(parts.join("\n"), "utf8").digest("hex")
}

// ---------------------------------------------------------------------------
// Internals — subprocess
// ---------------------------------------------------------------------------

interface SpawnCaptureOptions {
  cwd: string
  timeoutMs: number
  /** Rolling per-stream cap; omit for unbounded capture. */
  maxOutputChars?: number
}

interface SpawnCaptureResult {
  exitCode: number
  stdout: string
  stderr: string
  /** True when a rolling sink discarded head bytes to stay within its cap. */
  dropped: boolean
  timedOut: boolean
}

/**
 * Spawn, capture both streams, and enforce a deadline. The child is spawned
 * `detached` so it leads its own process group: a verify command is typically a
 * shell that spawns a test runner, and killing the shell pid alone would orphan
 * that runner to keep burning CPU. On timeout the whole GROUP takes SIGTERM,
 * then SIGKILL after a grace period, so nothing survives the deadline.
 *
 * Rejects only when the spawn itself is impossible (e.g. no `bash` on PATH).
 */
function spawnCapture(argv: string[], options: SpawnCaptureOptions): Promise<SpawnCaptureResult> {
  const [command, ...rest] = argv
  return new Promise<SpawnCaptureResult>((resolve, reject) => {
    const child = spawn(command!, rest, {
      cwd: options.cwd,
      detached: true,
      // stdin ignored: a subprocess blocking forever on a credential prompt
      // would wedge the loop with no way back.
      stdio: ["ignore", "pipe", "pipe"] as const,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    })

    const stdoutSink = createTailSink(options.maxOutputChars)
    const stderrSink = createTailSink(options.maxOutputChars)
    attachSink(child.stdout, stdoutSink)
    attachSink(child.stderr, stderrSink)

    let timedOut = false
    let settled = false
    let killTimer: ReturnType<typeof setTimeout> | undefined

    const deadlineTimer = setTimeout(() => {
      timedOut = true
      killTree(child, "SIGTERM")
      killTimer = setTimeout(() => killTree(child, "SIGKILL"), SIGKILL_GRACE_MS)
    }, options.timeoutMs)

    const cleanup = () => {
      clearTimeout(deadlineTimer)
      if (killTimer) clearTimeout(killTimer)
    }

    child.once("error", (error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    })

    child.once("exit", (code) => {
      if (settled) return
      settled = true
      cleanup()
      // Give the readers a bounded moment to flush; a backgrounded grandchild
      // may still hold the pipes open, so this can never be an unbounded wait.
      settleWithin(streamsClosed(child), OUTPUT_DRAIN_GRACE_MS).then(() => {
        resolve({
          exitCode: code ?? TIMEOUT_EXIT_CODE,
          stdout: stdoutSink.text(),
          stderr: stderrSink.text(),
          dropped: stdoutSink.dropped() || stderrSink.dropped(),
          timedOut,
        })
      })
    })
  })
}

/** Signal the child's whole process group, falling back to the pid alone. */
function killTree(child: { pid?: number; kill: (signal: NodeJS.Signals) => boolean }, signal: NodeJS.Signals) {
  try {
    if (child.pid) {
      // Negative pid = the process group the detached child leads.
      process.kill(-child.pid, signal)
      return
    }
  } catch {
    // Group gone (already exited) or not a leader — fall through.
  }
  try {
    child.kill(signal)
  } catch {
    // Already exited — nothing to kill.
  }
}

interface GitCapture {
  stdout: string
  exitCode: number
}

/** Non-interactive `git` capture; null when git cannot be spawned or times out. */
async function runGit(args: string[], cwd: string): Promise<GitCapture | null> {
  try {
    // No output cap: truncating `git status` would silently drop paths from the
    // digest, which is exactly the stale-pass bug this module exists to avoid.
    const result = await spawnCapture(["git", ...args], { cwd, timeoutMs: GIT_TIMEOUT_MS })
    if (result.timedOut) return null
    return { stdout: result.stdout, exitCode: result.exitCode }
  } catch {
    return null
  }
}

/** Resolve when `promise` settles, or after `ms`, whichever comes first. */
function settleWithin(promise: Promise<unknown>, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms)
    const finish = () => {
      clearTimeout(timer)
      resolve()
    }
    promise.then(finish, finish)
  })
}

// ---------------------------------------------------------------------------
// Internals — output capture
// ---------------------------------------------------------------------------

interface TailSink {
  push: (chunk: string) => void
  text: () => string
  /** True once the sink discarded head bytes to stay within its cap. */
  dropped: () => boolean
}

/** Rolling buffer that keeps only the last `max` chars, so a runaway command cannot balloon memory. */
function createTailSink(max: number | undefined): TailSink {
  let buffer = ""
  let dropped = false
  return {
    push(chunk) {
      buffer += chunk
      if (max !== undefined && buffer.length > max) {
        buffer = buffer.slice(buffer.length - max)
        dropped = true
      }
    },
    text: () => buffer,
    dropped: () => dropped,
  }
}

function attachSink(stream: Readable | null, sink: TailSink) {
  if (!stream) return
  stream.setEncoding("utf8")
  stream.on("data", (chunk: string) => sink.push(chunk))
  // A read error just ends capture; the exit code remains the real signal.
  stream.once("error", () => {})
}

/** Resolves once both pipes have hit EOF (may never, hence the bounded wait). */
function streamsClosed(child: { stdout: Readable | null; stderr: Readable | null }): Promise<void> {
  const wait = (stream: Readable | null) =>
    new Promise<void>((resolve) => {
      if (!stream || stream.readableEnded || stream.destroyed) {
        resolve()
        return
      }
      stream.once("end", resolve)
      stream.once("close", resolve)
      stream.once("error", () => resolve())
    })
  return Promise.all([wait(child.stdout), wait(child.stderr)]).then(() => undefined)
}

function joinStreams(stdout: string, stderr: string): string {
  if (!stderr) return stdout
  if (!stdout) return stderr
  return stdout.endsWith("\n") ? `${stdout}${stderr}` : `${stdout}\n${stderr}`
}

/**
 * Keep the TAIL, not the head: the useful part of a failing lint/test run is
 * the summary at the end. `dropped` carries truncation that already happened
 * inside the rolling sinks.
 */
function tailTruncate(text: string, max: number, dropped: boolean): string {
  if (!dropped && text.length <= max) {
    return text
  }
  if (max <= TRUNCATION_MARKER.length) {
    return text.slice(Math.max(0, text.length - max))
  }
  const keep = max - TRUNCATION_MARKER.length
  return `${TRUNCATION_MARKER}${text.slice(Math.max(0, text.length - keep))}`
}

// ---------------------------------------------------------------------------
// Internals — porcelain parsing
// ---------------------------------------------------------------------------

/**
 * Pull the path out of one `--porcelain=v1` line (`XY <path>`, or
 * `XY <old> -> <new>` for a rename; paths with unusual bytes come back
 * git-quoted). We only need something to `stat`, so an unparsable or
 * already-deleted path simply contributes no stamp — the status letters
 * themselves are already in the hash.
 */
function parseStatusPath(line: string): string | null {
  if (line.length < 4) return null
  const rest = line.slice(3)
  const renameIndex = rest.indexOf(" -> ")
  const raw = renameIndex >= 0 ? rest.slice(renameIndex + 4) : rest
  const unquoted = raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw
  return unquoted.length > 0 ? unquoted : null
}

/** `<size>:<mtimeMs>` for a path, or a marker when it no longer exists. */
async function statStamp(absPath: string): Promise<string> {
  const stats = await stat(absPath).catch(() => null)
  if (!stats) return "absent"
  return `${stats.size}:${stats.mtimeMs}`
}
