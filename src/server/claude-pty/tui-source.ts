import { readdir, stat, open } from "node:fs/promises"
import { existsSync, watch } from "node:fs"
import path from "node:path"

export async function findLatestTranscript(projectDir: string): Promise<string | null> {
  if (!existsSync(projectDir)) return null
  let entries: string[]
  try {
    entries = await readdir(projectDir)
  } catch {
    return null
  }
  const jsonlNames = entries.filter((n) => n.endsWith(".jsonl"))
  if (jsonlNames.length === 0) return null
  let bestPath: string | null = null
  let bestMtime = 0
  for (const name of jsonlNames) {
    const full = path.join(projectDir, name)
    try {
      const s = await stat(full)
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
  pollMode?: boolean
  pollIntervalMs?: number
  firstFileTimeoutMs?: number
}

const DEFAULT_FIRST_FILE_TIMEOUT_MS = 20_000
const DEFAULT_POLL_INTERVAL_MS = 50

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
    }
    void readNewBytes(filePath)
  }

  async function locateFirstFile(): Promise<string> {
    if (args.knownFilePath) return args.knownFilePath
    const timeoutMs = args.firstFileTimeoutMs ?? DEFAULT_FIRST_FILE_TIMEOUT_MS
    const existing = await findLatestTranscript(args.projectDir)
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
        const found = await findLatestTranscript(args.projectDir)
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
          let parsed: { type?: string; error?: string; isApiErrorMessage?: boolean; apiErrorStatus?: number }
          try { parsed = JSON.parse(line) as typeof parsed } catch { continue }
          if (parsed.type === "result") {
            settled = true
            if (timer) clearTimeout(timer)
            if (opts.signal) opts.signal.removeEventListener("abort", onAbort)
            resolve({ rawLine: line, parsed: { type: parsed.type } })
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
