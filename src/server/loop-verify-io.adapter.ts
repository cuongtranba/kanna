
import { spawn } from "node:child_process"
import type { Readable } from "node:stream"
import { createHash } from "node:crypto"
import { stat } from "node:fs/promises"
import path from "node:path"


const DEFAULT_MAX_OUTPUT_CHARS = 4000

const TRUNCATION_MARKER = "[output truncated - showing tail]\n"

const SIGKILL_GRACE_MS = 2000

const OUTPUT_DRAIN_GRACE_MS = 2000

const TIMEOUT_EXIT_CODE = 124

const GIT_TIMEOUT_MS = 15_000


export interface RunVerifyArgs {
  command: string
  cwd: string
  timeoutMs: number
}

export interface RunVerifyResult {
  exitCode: number
  output: string
  timedOut: boolean
  durationMs: number
}

export async function runVerifyCommand(
  args: RunVerifyArgs & { maxOutputChars?: number },
): Promise<RunVerifyResult> {
  const maxOutputChars = args.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS
  const startedAt = Date.now()

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


export async function computeWorkspaceDigest(cwd: string): Promise<string | null> {
  const insideWorkTree = await runGit(["rev-parse", "--is-inside-work-tree"], cwd)
  if (!insideWorkTree || insideWorkTree.exitCode !== 0) {
    return null
  }

  const head = await runGit(["rev-parse", "HEAD"], cwd)
  const headSha = head && head.exitCode === 0 ? head.stdout.trim() : ""

  const status = await runGit(["status", "--porcelain=v1", "--untracked-files=all"], cwd)
  if (!status || status.exitCode !== 0) {
    return null
  }

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


interface SpawnCaptureOptions {
  cwd: string
  timeoutMs: number
  maxOutputChars?: number
}

interface SpawnCaptureResult {
  exitCode: number
  stdout: string
  stderr: string
  dropped: boolean
  timedOut: boolean
}

function spawnCapture(argv: string[], options: SpawnCaptureOptions): Promise<SpawnCaptureResult> {
  const [command, ...rest] = argv
  return new Promise<SpawnCaptureResult>((resolve, reject) => {
    const child = spawn(command!, rest, {
      cwd: options.cwd,
      detached: true,
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

function killTree(child: { pid?: number; kill: (signal: NodeJS.Signals) => boolean }, signal: NodeJS.Signals) {
  try {
    if (child.pid) {
      process.kill(-child.pid, signal)
      return
    }
  } catch {
  }
  try {
    child.kill(signal)
  } catch {
  }
}

interface GitCapture {
  stdout: string
  exitCode: number
}

async function runGit(args: string[], cwd: string): Promise<GitCapture | null> {
  try {
    const result = await spawnCapture(["git", ...args], { cwd, timeoutMs: GIT_TIMEOUT_MS })
    if (result.timedOut) return null
    return { stdout: result.stdout, exitCode: result.exitCode }
  } catch {
    return null
  }
}

function settleWithin<T>(promise: Promise<T>, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms)
    const finish = () => {
      clearTimeout(timer)
      resolve()
    }
    promise.then(finish, finish)
  })
}


interface TailSink {
  push: (chunk: string) => void
  text: () => string
  dropped: () => boolean
}

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
  stream.once("error", () => {})
}

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


function parseStatusPath(line: string): string | null {
  if (line.length < 4) return null
  const rest = line.slice(3)
  const renameIndex = rest.indexOf(" -> ")
  const raw = renameIndex >= 0 ? rest.slice(renameIndex + 4) : rest
  const unquoted = raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw
  return unquoted.length > 0 ? unquoted : null
}

async function statStamp(absPath: string): Promise<string> {
  const stats = await stat(absPath).catch(() => null)
  if (!stats) return "absent"
  return `${stats.size}:${stats.mtimeMs}`
}
