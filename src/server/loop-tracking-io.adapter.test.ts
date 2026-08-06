import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { WatchWorkflowDeps } from "./workflow-watch-io.adapter"
import { readTrackingFile, watchTrackingFile } from "./loop-tracking-io.adapter"

const dirs: string[] = []
function tmp(): string { const d = mkdtempSync(join(tmpdir(), "loop-track-")); dirs.push(d); return d }
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

interface FakeWatch {
  deps: WatchWorkflowDeps
  emit: (filename: string | null) => void
  flushTimers: () => void
}

function fakeWatch(): FakeWatch {
  let changeCb: ((event: string, filename: string | null) => void) | null = null
  const pending = new Map<number, () => void>()
  let nextId = 1
  return {
    deps: {
      watch: ((_dir: string, _opts: unknown, cb: (event: string, filename: string | null) => void) => {
        changeCb = cb
        return { close() {} }
      }) as unknown as WatchWorkflowDeps["watch"],
      setTimeout: (fn) => {
        const id = nextId++
        pending.set(id, fn)
        return id as unknown as ReturnType<typeof setTimeout>
      },
      clearTimeout: (handle) => { pending.delete(handle as unknown as number) },
      setInterval: (() => 0 as unknown as ReturnType<typeof setInterval>),
      clearInterval: () => {},
    },
    emit: (filename) => changeCb?.("change", filename),
    flushTimers: () => {
      const fns = [...pending.values()]
      pending.clear()
      for (const fn of fns) fn()
    },
  }
}

describe("loop-tracking-io.adapter", () => {
  test("readTrackingFile returns the file's bytes", () => {
    const d = tmp()
    writeFileSync(join(d, "PROGRESS.md"), "## Goal\nship it\n")
    expect(readTrackingFile(join(d, "PROGRESS.md"))).toBe("## Goal\nship it\n")
  })

  test("readTrackingFile returns null for a missing or unreadable file", () => {
    expect(readTrackingFile(join(tmp(), "nope.md"))).toBeNull()
    expect(readTrackingFile(tmp())).toBeNull()
  })

  test("a sibling file changing in the same directory does not fire the watch", () => {
    const d = tmp()
    const watcher = fakeWatch()
    let calls = 0
    const dispose = watchTrackingFile(
      join(d, "PROGRESS.md"),
      () => { calls += 1 },
      { debounceMs: 10, deps: watcher.deps },
    )

    watcher.emit("README.md")
    watcher.flushTimers()
    expect(calls).toBe(0)

    watcher.emit("PROGRESS.md")
    watcher.flushTimers()
    expect(calls).toBe(1)

    dispose()
  })

  test("a platform that reports no filename still fires, so a change is never missed", () => {
    const d = tmp()
    const watcher = fakeWatch()
    let calls = 0
    const dispose = watchTrackingFile(
      join(d, "PROGRESS.md"),
      () => { calls += 1 },
      { debounceMs: 10, deps: watcher.deps },
    )

    watcher.emit(null)
    watcher.flushTimers()
    expect(calls).toBe(1)

    dispose()
  })
})
