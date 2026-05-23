import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { mkdtemp, rm, writeFile, mkdir, appendFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  findLatestTranscript,
  startTranscriptStream,
  waitForResultEntry,
} from "./tui-source.adapter"
import { encodeCwd } from "./jsonl-path.adapter"

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

describe("startTranscriptStream (registry resolution)", () => {
  // Regression: claude-code's per-pid session registry pins the JSONL path
  // to the live child. When the registry-resolved JSONL never appears (e.g.
  // claude was spawned but no prompt sent), older builds fell back to the
  // newest mtime in the project dir — which is another concurrent chat's
  // JSONL. That caused cross-session transcript bleed. The fix removed the
  // fallback: registry path is authoritative, poll until close.
  test("registry resolves but JSONL missing — never falls back to other JSONL in same dir", async () => {
    const pid = 99001
    // Real cwd dir so `encodeCwd` (which realpaths) doesn't ENOENT.
    const realCwd = await mkdtemp(path.join(workHome, "real-cwd-"))
    const encoded = encodeCwd(realCwd)
    const ownProjectDir = path.join(workHome, ".claude", "projects", encoded)
    await mkdir(ownProjectDir, { recursive: true })
    const sessionsDir = path.join(workHome, ".claude", "sessions")
    await mkdir(sessionsDir, { recursive: true })
    const ownSessionId = "our-session-aaaaaaaaaa"
    await writeFile(
      path.join(sessionsDir, `${pid}.json`),
      JSON.stringify({ pid, sessionId: ownSessionId, cwd: realCwd, kind: "interactive", startedAt: Date.now() }),
    )
    // Tempt the bug: drop a NEWER unrelated JSONL into the same project dir.
    // Under the old mtime fallback this would have been picked up after
    // `firstFileTimeoutMs` elapsed with no own-JSONL present.
    const strangerFile = path.join(ownProjectDir, "stranger-session.jsonl")
    await writeFile(strangerFile, '{"type":"assistant","message":{"content":[{"type":"text","text":"NOT OURS"}]}}\n')

    const stream = await startTranscriptStream({
      projectDir: ownProjectDir,
      homeDir: workHome,
      claudeChildPid: pid,
      sessionRegistryTimeoutMs: 300,
      // High timeout so the registry-poll timeout cannot fire during the
      // 600 ms pending check below — this test guards bleed isolation, not
      // timeout behaviour (covered separately).
      firstFileTimeoutMs: 5_000,
      pollIntervalMs: 20,
    })

    // filePath must NOT resolve to the stranger file even after timeouts.
    const beforeWrite = await Promise.race([
      stream.filePath
        .then((fp) => ({ kind: "resolved" as const, fp }))
        .catch((err: Error) => ({ kind: "rejected" as const, err })),
      new Promise<{ kind: "pending" }>((r) => setTimeout(() => r({ kind: "pending" }), 600)),
    ])
    expect(beforeWrite.kind).toBe("pending")

    // Now the registry-pointed JSONL appears — filePath should resolve to it.
    const ownFile = path.join(ownProjectDir, `${ownSessionId}.jsonl`)
    await writeFile(ownFile, '{"type":"assistant","message":{"content":[{"type":"text","text":"ours"}]}}\n')
    const resolved = await stream.filePath
    expect(resolved).toBe(ownFile)
    expect(resolved).not.toBe(strangerFile)
    stream.close()
  }, 5000)

  // Regression: when claude TUI rendered the input box but the first prompt
  // never reached it (input-handler mount race, splash banner swallow, etc.),
  // the registry-resolved JSONL was never created and the driver waited
  // forever inside locateFirstFile. firstFileTimeoutMs now bounds that wait;
  // the rejection surfaces as a failure event and the user can retry instead
  // of seeing a wedged session.
  test("registry resolved but JSONL never appears — filePath rejects after firstFileTimeoutMs", async () => {
    const pid = 99003
    const realCwd = await mkdtemp(path.join(workHome, "real-cwd-"))
    const encoded = encodeCwd(realCwd)
    const ownProjectDir = path.join(workHome, ".claude", "projects", encoded)
    await mkdir(ownProjectDir, { recursive: true })
    const sessionsDir = path.join(workHome, ".claude", "sessions")
    await mkdir(sessionsDir, { recursive: true })
    const ownSessionId = "our-session-cccccccccc"
    await writeFile(
      path.join(sessionsDir, `${pid}.json`),
      JSON.stringify({ pid, sessionId: ownSessionId, cwd: realCwd, kind: "interactive", startedAt: Date.now() }),
    )

    const stream = await startTranscriptStream({
      projectDir: ownProjectDir,
      homeDir: workHome,
      claudeChildPid: pid,
      sessionRegistryTimeoutMs: 300,
      firstFileTimeoutMs: 150,
      pollIntervalMs: 20,
    })

    const start = Date.now()
    await expect(stream.filePath).rejects.toThrow(/did not appear in 150ms/)
    const elapsed = Date.now() - start
    // Allow scheduler slack but ensure we did not wait orders of magnitude longer.
    expect(elapsed).toBeLessThan(1_500)
    stream.close()
  }, 5000)

  test("registry resolves with existing JSONL — returns registry path immediately", async () => {
    const pid = 99002
    const realCwd = await mkdtemp(path.join(workHome, "real-cwd-"))
    const encoded = encodeCwd(realCwd)
    const ownProjectDir = path.join(workHome, ".claude", "projects", encoded)
    await mkdir(ownProjectDir, { recursive: true })
    const sessionsDir = path.join(workHome, ".claude", "sessions")
    await mkdir(sessionsDir, { recursive: true })
    const ownSessionId = "our-session-bbbbbbbbbb"
    const ownFile = path.join(ownProjectDir, `${ownSessionId}.jsonl`)
    await writeFile(ownFile, "{}\n")
    await writeFile(
      path.join(sessionsDir, `${pid}.json`),
      JSON.stringify({ pid, sessionId: ownSessionId, cwd: realCwd, kind: "interactive", startedAt: Date.now() }),
    )
    // Newer stranger JSONL must not win — registry path is authoritative.
    await new Promise((r) => setTimeout(r, 20))
    await writeFile(path.join(ownProjectDir, "stranger.jsonl"), "{}\n")

    const stream = await startTranscriptStream({
      projectDir: ownProjectDir,
      homeDir: workHome,
      claudeChildPid: pid,
    })
    const resolved = await stream.filePath
    expect(resolved).toBe(ownFile)
    stream.close()
  }, 5000)
})

describe("startTranscriptStream (safety-net poll vs fs.watch drops)", () => {
  // Regression: fs.watch on macOS/FSEvents was observed to coalesce or drop
  // events when claude appended `assistant` + `system/turn_duration` rows in
  // rapid succession at the end of a turn — Kanna's stream would silently
  // stop reading at ~52k bytes while the JSONL grew to ~55k. The safety-net
  // poll runs alongside fs.watch and guarantees eventual delivery.
  test("appends made after stream setup are delivered even with no further watcher fires", async () => {
    const filePath = path.join(projectDir, "watched.jsonl")
    await writeFile(filePath, '{"type":"system","subtype":"init"}\n')
    const stream = await startTranscriptStream({
      projectDir,
      knownFilePath: filePath,
      firstFileTimeoutMs: 500,
    })
    const iter = stream.lines[Symbol.asyncIterator]()
    const first = await iter.next()
    expect(first.value).toContain('"system"')

    // Append multiple rows AFTER the watcher is set up. On a buggy build
    // where fs.watch drops the second/third append, the safety-net poll
    // (fires every 500 ms) must still pick them up within the test
    // timeout.
    await appendFile(filePath, '{"type":"assistant","message":{"content":[{"type":"text","text":"a"}]}}\n')
    await appendFile(filePath, '{"type":"assistant","message":{"content":[{"type":"text","text":"b"}]}}\n')
    await appendFile(filePath, '{"type":"system","subtype":"turn_duration","durationMs":42}\n')

    const collected: string[] = []
    const deadline = Date.now() + 2_000
    while (collected.length < 3 && Date.now() < deadline) {
      const nxt = await Promise.race([
        iter.next(),
        new Promise<{ value: undefined; done: true }>((r) => setTimeout(() => r({ value: undefined, done: true }), 1_500)),
      ])
      if (nxt.done) break
      collected.push(nxt.value)
    }
    expect(collected.length).toBe(3)
    expect(collected[0]).toContain('"a"')
    expect(collected[1]).toContain('"b"')
    expect(collected[2]).toContain("turn_duration")
    stream.close()
  }, 8000)
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
