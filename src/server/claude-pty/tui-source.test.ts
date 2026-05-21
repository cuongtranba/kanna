import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  findLatestTranscript,
  startTranscriptStream,
  waitForResultEntry,
} from "./tui-source"

let workHome: string
let projectDir: string

beforeEach(async () => {
  workHome = await mkdtemp(path.join(tmpdir(), "kanna-tui-source-"))
  projectDir = path.join(workHome, ".claude", "projects", "fake-cwd")
  await mkdir(projectDir, { recursive: true })
})

afterEach(async () => {
  await rm(workHome, { recursive: true, force: true })
})

describe("findLatestTranscript", () => {
  test("returns null when project dir empty", async () => {
    const result = await findLatestTranscript(projectDir)
    expect(result).toBeNull()
  })

  test("returns path of newest .jsonl file", async () => {
    const fileA = path.join(projectDir, "aaa.jsonl")
    const fileB = path.join(projectDir, "bbb.jsonl")
    await writeFile(fileA, "{}\n")
    await new Promise((r) => setTimeout(r, 20))
    await writeFile(fileB, "{}\n")
    const result = await findLatestTranscript(projectDir)
    expect(result).toBe(fileB)
  })

  test("ignores non-.jsonl files", async () => {
    await writeFile(path.join(projectDir, "notes.txt"), "hello")
    const result = await findLatestTranscript(projectDir)
    expect(result).toBeNull()
  })

  test("returns null when project dir does not exist", async () => {
    const result = await findLatestTranscript(path.join(workHome, "no-such-dir"))
    expect(result).toBeNull()
  })

  test("minMtimeMs filter skips JSONLs older than the floor", async () => {
    const stale = path.join(projectDir, "stale.jsonl")
    const fresh = path.join(projectDir, "fresh.jsonl")
    await writeFile(stale, "{}\n")
    await new Promise((r) => setTimeout(r, 20))
    const floor = Date.now()
    await new Promise((r) => setTimeout(r, 20))
    await writeFile(fresh, "{}\n")
    const result = await findLatestTranscript(projectDir, { minMtimeMs: floor })
    expect(result).toBe(fresh)
  })

  test("minMtimeMs returns null when every JSONL is older than the floor", async () => {
    const a = path.join(projectDir, "a.jsonl")
    await writeFile(a, "{}\n")
    await new Promise((r) => setTimeout(r, 20))
    const result = await findLatestTranscript(projectDir, { minMtimeMs: Date.now() })
    expect(result).toBeNull()
  })
})

describe("startTranscriptStream (dir-watch)", () => {
  test("picks up file written after stream start", async () => {
    const stream = await startTranscriptStream({ projectDir, firstFileTimeoutMs: 2000 })
    const filePath = path.join(projectDir, "new.jsonl")
    setTimeout(() => writeFile(filePath, '{"type":"hello"}\n'), 100)
    const resolved = await stream.filePath
    expect(resolved).toBe(filePath)
    stream.close()
  }, 5000)

  test("opens existing file when present at start", async () => {
    const filePath = path.join(projectDir, "existing.jsonl")
    await writeFile(filePath, '{"type":"hello"}\n')
    const stream = await startTranscriptStream({ projectDir, firstFileTimeoutMs: 2000 })
    const resolved = await stream.filePath
    expect(resolved).toBe(filePath)
    stream.close()
  }, 5000)

  test("emits complete lines as they are appended", async () => {
    const filePath = path.join(projectDir, "stream.jsonl")
    await writeFile(filePath, '{"type":"one"}\n')
    const stream = await startTranscriptStream({ projectDir, firstFileTimeoutMs: 2000 })
    const iter = stream.lines[Symbol.asyncIterator]()
    const first = await iter.next()
    expect(first.value).toBe('{"type":"one"}')
    setTimeout(() => writeFile(filePath, '{"type":"one"}\n{"type":"two"}\n'), 100)
    const second = await iter.next()
    expect(second.value).toBe('{"type":"two"}')
    stream.close()
  }, 5000)

  test("holds partial line across writes", async () => {
    const filePath = path.join(projectDir, "partial.jsonl")
    await writeFile(filePath, '{"type":')
    const stream = await startTranscriptStream({
      projectDir,
      firstFileTimeoutMs: 2000,
      pollMode: true,
      pollIntervalMs: 30,
    })
    const iter = stream.lines[Symbol.asyncIterator]()
    let resolved = false
    // Capture the first pending promise — it should not resolve yet (partial line)
    const firstPromise = iter.next().then((r: IteratorResult<string>) => { resolved = true; return r })
    await new Promise((r) => setTimeout(r, 200))
    expect(resolved).toBe(false)
    // Overwrite the file with a complete line — poller should pick it up
    await writeFile(filePath, '{"type":"one"}\n')
    const first = await firstPromise
    expect(first.value).toBe('{"type":"one"}')
    stream.close()
  }, 5000)

  test("times out when no file appears within firstFileTimeoutMs", async () => {
    const stream = await startTranscriptStream({ projectDir, firstFileTimeoutMs: 200 })
    await expect(stream.filePath).rejects.toThrow(/transcript file did not appear/)
    stream.close()
  }, 5000)

  test("knownFilePath skips dir-watch", async () => {
    const filePath = path.join(projectDir, "known.jsonl")
    await writeFile(filePath, '{"type":"hello"}\n')
    const stream = await startTranscriptStream({
      projectDir,
      knownFilePath: filePath,
      firstFileTimeoutMs: 500,
    })
    const resolved = await stream.filePath
    expect(resolved).toBe(filePath)
    stream.close()
  }, 5000)
})

describe("startTranscriptStream (poll-mode)", () => {
  test("emits lines via polling when pollMode=true", async () => {
    const stream = await startTranscriptStream({
      projectDir,
      pollMode: true,
      pollIntervalMs: 30,
      firstFileTimeoutMs: 2000,
    })
    const filePath = path.join(projectDir, "poll.jsonl")
    setTimeout(() => writeFile(filePath, '{"type":"polled"}\n'), 100)
    const iter = stream.lines[Symbol.asyncIterator]()
    const first = await iter.next()
    expect(first.value).toBe('{"type":"polled"}')
    stream.close()
  }, 5000)
})

describe("waitForResultEntry", () => {
  test("resolves on first result line", async () => {
    const filePath = path.join(projectDir, "result.jsonl")
    await writeFile(filePath, '{"type":"system"}\n{"type":"assistant"}\n')
    const stream = await startTranscriptStream({ projectDir, firstFileTimeoutMs: 2000 })
    setTimeout(() => writeFile(filePath, '{"type":"system"}\n{"type":"assistant"}\n{"type":"result","subtype":"success"}\n'), 100)
    const entry = await waitForResultEntry(stream, { timeoutMs: 2000 })
    expect(entry.parsed.type).toBe("result")
    stream.close()
  }, 5000)

  test("rejects on abort signal", async () => {
    const filePath = path.join(projectDir, "abort.jsonl")
    await writeFile(filePath, '{"type":"system"}\n')
    const stream = await startTranscriptStream({ projectDir, firstFileTimeoutMs: 2000 })
    const ctrl = new AbortController()
    setTimeout(() => ctrl.abort(), 50)
    await expect(waitForResultEntry(stream, { signal: ctrl.signal })).rejects.toThrow(/aborted/i)
    stream.close()
  }, 5000)

  test("rejects on timeout", async () => {
    const filePath = path.join(projectDir, "timeout.jsonl")
    await writeFile(filePath, '{"type":"system"}\n')
    const stream = await startTranscriptStream({ projectDir, firstFileTimeoutMs: 2000 })
    await expect(waitForResultEntry(stream, { timeoutMs: 100 })).rejects.toThrow(/timed out/i)
    stream.close()
  }, 5000)
})
