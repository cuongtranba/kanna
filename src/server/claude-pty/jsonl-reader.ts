import { watch } from "node:fs"
import { open, stat } from "node:fs/promises"
import path from "node:path"
import type { HarnessEvent } from "../harness-types"
import { parseJsonlLine } from "./jsonl-to-event"

export interface JsonlReader extends AsyncIterable<HarnessEvent> {
  close(): void
}

// Cheap bookmark: only inode + byte offset, no content hash.
interface StatBookmark {
  ino: bigint
  byteOffset: number
}

export function createJsonlReader(args: { filePath: string }): JsonlReader {
  const filePath = args.filePath
  const dir = path.dirname(filePath)
  const baseName = path.basename(filePath)

  let bookmark: StatBookmark | null = null
  let closed = false
  const queue: HarnessEvent[] = []
  // All concurrent next() calls share a single pending promise so that when
  // an event is delivered to the first waiter, all callers re-check the queue.
  let pendingResolve: ((result: IteratorResult<HarnessEvent>) => void) | null = null
  let pendingPromise: Promise<IteratorResult<HarnessEvent>> | null = null
  let processing = false
  let partial = ""

  function deliver(event: HarnessEvent) {
    if (pendingResolve) {
      const r = pendingResolve
      pendingResolve = null
      pendingPromise = null
      r({ value: event, done: false })
    } else {
      queue.push(event)
    }
  }

  function endIfClosed() {
    if (!closed) return
    if (pendingResolve) {
      const r = pendingResolve
      pendingResolve = null
      pendingPromise = null
      r({ value: undefined as unknown as HarnessEvent, done: true })
    }
  }

  async function tryRead() {
    if (closed || processing) return
    processing = true
    try {
      // Fix 4: use stat() for cheap inode+size check instead of hashing the entire file
      let fileStat: { ino: bigint; size: bigint }
      try {
        const s = await stat(filePath, { bigint: true })
        fileStat = { ino: s.ino, size: s.size }
      } catch {
        // File doesn't exist yet — nothing to read
        return
      }

      let startOffset = 0
      if (bookmark && bookmark.ino === fileStat.ino) {
        // Same inode means same file — safe to resume from last byte position.
        // An append only grows the file, so the prefix we already read is unchanged.
        // If the current file size is less than our bookmark offset the file was
        // truncated; in that case reset and re-read from the start.
        if (Number(fileStat.size) >= bookmark.byteOffset) {
          startOffset = bookmark.byteOffset
        } else {
          // Truncated — start over
          partial = ""
        }
      } else {
        // Different inode (file replaced) or no bookmark — start from the beginning
        partial = ""
      }

      const fd = await open(filePath, "r")
      try {
        const buf = Buffer.alloc(64 * 1024)
        let pos = startOffset
        while (true) {
          const { bytesRead } = await fd.read(buf, 0, buf.length, pos)
          if (bytesRead === 0) break
          partial += buf.subarray(0, bytesRead).toString("utf8")
          pos += bytesRead
          let nl = partial.indexOf("\n")
          while (nl !== -1) {
            const line = partial.slice(0, nl)
            partial = partial.slice(nl + 1)
            for (const ev of parseJsonlLine(line)) deliver(ev)
            nl = partial.indexOf("\n")
          }
        }
        // Update bookmark from stat ino + final byte position (no hash needed)
        bookmark = { ino: fileStat.ino, byteOffset: pos }
      } finally {
        await fd.close()
      }
    } catch (err) {
      console.warn("[claude-pty/jsonl-reader] tryRead error", err)
    } finally {
      processing = false
    }
  }

  const watcher = watch(dir, (_eventType, filename) => {
    if (filename === baseName || filename === null) {
      void tryRead()
    }
  })

  // Fallback polling in case fs.watch misses events on fast filesystems
  const pollInterval = setInterval(() => {
    void tryRead()
  }, 100)

  void tryRead()

  function doClose() {
    if (closed) return
    closed = true
    watcher.close()
    clearInterval(pollInterval)
    endIfClosed()
  }

  return {
    [Symbol.asyncIterator]() {
      return {
        next(): Promise<IteratorResult<HarnessEvent>> {
          if (queue.length > 0) {
            const ev = queue.shift()
            if (ev) return Promise.resolve({ value: ev, done: false })
          }
          if (closed) {
            return Promise.resolve({ value: undefined as unknown as HarnessEvent, done: true })
          }
          // All concurrent next() callers share the same pending promise.
          // When an event arrives it resolves that promise and all callers
          // that are racing it will re-call next() on their own.
          if (!pendingPromise) {
            pendingPromise = new Promise((resolve) => {
              pendingResolve = resolve
            })
          }
          return pendingPromise
        },
        return(): Promise<IteratorResult<HarnessEvent>> {
          doClose()
          return Promise.resolve({ value: undefined as unknown as HarnessEvent, done: true })
        },
      }
    },
    close() {
      doClose()
    },
  }
}
