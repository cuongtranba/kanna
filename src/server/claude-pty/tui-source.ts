import { readdir, stat, open } from "node:fs/promises"
import { existsSync, watch } from "node:fs"
import path from "node:path"
import { awaitClaudeSessionForPid } from "./claude-session-registry"
import { computeJsonlPath } from "./jsonl-path"

export async function findLatestTranscript(
  projectDir: string,
  opts: { minMtimeMs?: number } = {},
): Promise<string | null> {
  if (!existsSync(projectDir)) return null
  let entries: string[]
  try {
    entries = await readdir(projectDir)
  } catch {
    return null
  }
  const jsonlNames = entries.filter((n) => n.endsWith(".jsonl"))
  if (jsonlNames.length === 0) return null
  const floor = opts.minMtimeMs ?? 0
  let bestPath: string | null = null
  let bestMtime = 0
  for (const name of jsonlNames) {
    const full = path.join(projectDir, name)
    try {
      const s = await stat(full)
      // Skip stale JSONLs from prior sessions in the same project dir.
      // Without this floor, kanna's watcher locks onto the most-recently-
      // touched OLD transcript while claude is still in the middle of
      // creating its new one — events from the new session are lost.
      if (s.mtimeMs < floor) continue
      if (s.mtimeMs > bestMtime) {
        bestMtime = s.mtimeMs
        bestPath = full
      }
    } catch {
      /* skip */
    }
  }
  return bestPath
}

export interface TranscriptStream {
  lines: AsyncIterable<string>
  filePath: Promise<string>
  close(): void
}

export interface StartTranscriptStreamArgs {
  projectDir: string
  knownFilePath?: string
  /**
   * Mtime floor (ms) for JSONL discovery. When `knownFilePath` is unset
   * AND the session-registry lookup (via `claudeChildPid`) fails,
   * `findLatestTranscript` filters out files older than this — set to
   * spawn-start time so stale JSONLs from prior sessions in the same
   * project dir cannot win the race. The registry lookup, when it
   * succeeds, makes this floor moot.
   */
  minMtimeMs?: number
  pollMode?: boolean
  pollIntervalMs?: number
  firstFileTimeoutMs?: number
  /**
   * Live PID of the spawned `claude` child. When set together with
   * `homeDir`, `locateFirstFile` first polls `${homeDir}/.claude/sessions/<pid>.json`
   * (claude-code's own per-PID registry) to obtain the real session UUID,
   * then computes the JSONL path directly. This is race-free under
   * concurrent claude spawns sharing the same projectDir — the legacy
   * mtime heuristic can pick the wrong file when other claude TUIs run
   * in the same cwd. Falls back to `findLatestTranscript` if the
   * registry file does not appear within `sessionRegistryTimeoutMs`.
   */
  claudeChildPid?: number
  homeDir?: string
  sessionRegistryTimeoutMs?: number
  sessionRegistryPollMs?: number
}

const DEFAULT_FIRST_FILE_TIMEOUT_MS = 20_000
const DEFAULT_POLL_INTERVAL_MS = 50
const DEFAULT_SESSION_REGISTRY_TIMEOUT_MS = 2_000
const DEFAULT_SESSION_REGISTRY_POLL_MS = 20
const DEFAULT_SAFETY_POLL_MS = 500

export async function startTranscriptStream(args: StartTranscriptStreamArgs): Promise<TranscriptStream> {
  const lineQueue: string[] = []
  const lineWaiters: Array<(r: IteratorResult<string, undefined>) => void> = []
  let buffer = ""
  let position = 0
  let closed = false
  let watcher: ReturnType<typeof watch> | null = null
  let pollTimer: ReturnType<typeof setInterval> | null = null

  function pushLine(line: string) {
    const w = lineWaiters.shift()
    if (w) w({ value: line, done: false })
    else lineQueue.push(line)
  }

  function endLines() {
    const done: IteratorReturnResult<undefined> = { value: undefined, done: true }
    while (lineWaiters.length > 0) {
      const w = lineWaiters.shift()
      if (w) w(done)
    }
  }

  async function readNewBytes(filePath: string) {
    try {
      const s = await stat(filePath)
      if (s.size <= position) return
      const fd = await open(filePath, "r")
      try {
        const length = s.size - position
        const buf = Buffer.alloc(length)
        await fd.read(buf, 0, length, position)
        position = s.size
        buffer += buf.toString("utf8")
        const parts = buffer.split("\n")
        buffer = parts.pop() ?? ""
        for (const line of parts) {
          if (line.length === 0) continue
          pushLine(line)
        }
      } finally {
        await fd.close()
      }
    } catch {
      /* file rotated / truncated mid-read; next tick recovers */
    }
  }

  function startFollowing(filePath: string) {
    if (args.pollMode) {
      const interval = args.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
      pollTimer = setInterval(() => { void readNewBytes(filePath) }, interval)
    } else {
      try {
        watcher = watch(filePath, () => { void readNewBytes(filePath) })
      } catch {
        const interval = args.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
        pollTimer = setInterval(() => { void readNewBytes(filePath) }, interval)
      }
      // Safety-net poll alongside fs.watch: macOS FSEvents was observed to
      // coalesce or drop events when claude appended several lines in rapid
      // succession at turn end (final `assistant` + `system/turn_duration`
      // rows silently lost). The watcher handles low-latency streaming;
      // this poll guarantees eventual delivery within DEFAULT_SAFETY_POLL_MS.
      pollTimer = setInterval(() => { void readNewBytes(filePath) }, DEFAULT_SAFETY_POLL_MS)
    }
    void readNewBytes(filePath)
  }

  async function locateFirstFile(): Promise<string> {
    if (args.knownFilePath) return args.knownFilePath
    // Preferred path: read claude's per-PID session file to learn the real
    // session UUID, then compute the JSONL path directly. Race-free.
    if (args.claudeChildPid && args.homeDir) {
      const entry = await awaitClaudeSessionForPid({
        homeDir: args.homeDir,
        pid: args.claudeChildPid,
        timeoutMs: args.sessionRegistryTimeoutMs ?? DEFAULT_SESSION_REGISTRY_TIMEOUT_MS,
        pollIntervalMs: args.sessionRegistryPollMs ?? DEFAULT_SESSION_REGISTRY_POLL_MS,
      })
      if (entry) {
        const computed = computeJsonlPath({
          homeDir: args.homeDir,
          cwd: entry.cwd,
          sessionId: entry.sessionId,
        })
        // Registry resolved: the JSONL path is AUTHORITATIVE for this
        // child pid. Poll existsSync until close. Do NOT fall back to
        // mtime — when the registry-resolved JSONL never appears (e.g.
        // claude was spawned but no prompt was ever sent), mtime
        // discovery silently picks the newest unrelated JSONL in the
        // shared project dir, causing cross-session transcript bleed.
        const jsonlPollMs = args.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
        while (!closed) {
          if (existsSync(computed)) return computed
          await new Promise((r) => setTimeout(r, jsonlPollMs))
        }
        throw new Error("transcript stream closed before registry-resolved JSONL appeared")
      }
    }
    const timeoutMs = args.firstFileTimeoutMs ?? DEFAULT_FIRST_FILE_TIMEOUT_MS
    const findOpts = { minMtimeMs: args.minMtimeMs }
    const existing = await findLatestTranscript(args.projectDir, findOpts)
    if (existing) return existing
    return new Promise<string>((resolve, reject) => {
      const start = Date.now()
      const pollMs = args.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
      const timer = setInterval(async () => {
        if (closed) {
          clearInterval(timer)
          reject(new Error("transcript stream closed before first file appeared"))
          return
        }
        if (Date.now() - start > timeoutMs) {
          clearInterval(timer)
          reject(new Error(`transcript file did not appear in ${timeoutMs}ms under ${args.projectDir}`))
          return
        }
        const found = await findLatestTranscript(args.projectDir, findOpts)
        if (found) {
          clearInterval(timer)
          resolve(found)
        }
      }, pollMs)
    })
  }

  const filePathPromise = locateFirstFile()
  void filePathPromise
    .then((fp) => { if (!closed) startFollowing(fp) })
    .catch(() => {
      /* surfaced via filePath rejection */
    })

  const lines: AsyncIterable<string> = {
    [Symbol.asyncIterator]() {
      return {
        next(): Promise<IteratorResult<string, undefined>> {
          if (lineQueue.length > 0) {
            const v = lineQueue.shift()
            if (v !== undefined) return Promise.resolve({ value: v, done: false })
          }
          if (closed) return Promise.resolve({ value: undefined, done: true as const })
          return new Promise((resolve) => lineWaiters.push(resolve))
        },
      }
    },
  }

  return {
    lines,
    filePath: filePathPromise,
    close() {
      if (closed) return
      closed = true
      if (watcher) try { watcher.close() } catch { /* swallow */ }
      if (pollTimer) clearInterval(pollTimer)
      endLines()
    },
  }
}

export async function waitForResultEntry(
  stream: TranscriptStream,
  opts: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<{ rawLine: string; parsed: { type: string } }> {
  const timeoutMs = opts.timeoutMs
  return new Promise((resolve, reject) => {
    let settled = false

    const timer = timeoutMs !== undefined
      ? setTimeout(() => {
          if (settled) return
          settled = true
          stream.close()
          reject(new Error(`waitForResultEntry timed out after ${timeoutMs}ms`))
        }, timeoutMs)
      : null

    const onAbort = () => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      stream.close()
      reject(new Error("aborted"))
    }

    if (opts.signal) {
      if (opts.signal.aborted) {
        onAbort()
        return
      }
      opts.signal.addEventListener("abort", onAbort, { once: true })
    }

    async function consume() {
      try {
        for await (const line of stream.lines) {
          if (settled) return
          let parsed: { type?: string; subtype?: string; error?: string; isApiErrorMessage?: boolean; apiErrorStatus?: number }
          try { parsed = JSON.parse(line) as typeof parsed } catch { continue }
          // Two completion markers:
          //   - `type: "result"` — SDK / `claude -p` output (one-shot)
          //   - `type: "system", subtype: "turn_duration"` — interactive TUI
          //     turn end (interactive mode never writes a `result` row).
          // Reference: canon/index.ts:711 turnDurationMsFromRows.
          const isTurnEnd =
            parsed.type === "result" ||
            (parsed.type === "system" && parsed.subtype === "turn_duration")
          if (isTurnEnd) {
            settled = true
            if (timer) clearTimeout(timer)
            if (opts.signal) opts.signal.removeEventListener("abort", onAbort)
            resolve({ rawLine: line, parsed: { type: parsed.type ?? "result" } })
            return
          }
          // Rate-limit responses (HTTP 429) arrive as assistant messages rather
          // than result entries — surface them immediately so callers can
          // distinguish a transient limit from a structural probe failure.
          if (parsed.type === "assistant" && parsed.isApiErrorMessage && parsed.apiErrorStatus === 429) {
            settled = true
            if (timer) clearTimeout(timer)
            if (opts.signal) opts.signal.removeEventListener("abort", onAbort)
            const rlErr = new Error("rate_limited") as Error & { code: string }
            rlErr.code = "rate_limited"
            reject(rlErr)
            return
          }
        }
        if (!settled) {
          settled = true
          if (timer) clearTimeout(timer)
          if (opts.signal) opts.signal.removeEventListener("abort", onAbort)
          reject(new Error("transcript stream ended before result entry"))
        }
      } catch (err) {
        if (!settled) {
          settled = true
          if (timer) clearTimeout(timer)
          if (opts.signal) opts.signal.removeEventListener("abort", onAbort)
          reject(err)
        }
      }
    }

    void consume()
  })
}
