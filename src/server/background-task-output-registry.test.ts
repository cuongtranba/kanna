import { describe, test, expect } from "bun:test"
import { createBackgroundTaskOutputRegistry } from "./background-task-output-registry"
import type { BackgroundTaskOutputDeps } from "./background-task-output-registry"
import { OUTPUT_RING_DEFAULT_BYTES } from "./claude-pty/output-ring"

function makeDeps(fileContents: Map<string, string> = new Map()): BackgroundTaskOutputDeps & { advance(path: string, append: string): void } {
  const contents = new Map(fileContents)
  const timers: Map<ReturnType<typeof setInterval>, { fn: () => void }> = new Map()

  return {
    statSize(path: string): number | null {
      const c = contents.get(path)
      return c !== undefined ? Buffer.byteLength(c, "utf8") : null
    },
    readAppend(path: string, fromByte: number): { data: string; endByte: number } {
      const c = contents.get(path) ?? ""
      const slice = c.slice(fromByte)
      return { data: slice, endByte: fromByte + Buffer.byteLength(slice, "utf8") }
    },
    setInterval(fn: () => void, _ms: number): () => void {
      const id = setInterval(fn, 999_999_999) as ReturnType<typeof setInterval>
      timers.set(id, { fn })
      return () => { clearInterval(id); timers.delete(id) }
    },
    advance(path: string, append: string): void {
      contents.set(path, (contents.get(path) ?? "") + append)
      for (const { fn } of timers.values()) fn()
    },
  }
}

describe("BackgroundTaskOutputRegistry", () => {
  test("getOutput returns null for untracked task", () => {
    const reg = createBackgroundTaskOutputRegistry(makeDeps())
    expect(reg.getOutput("chat1", "task1")).toBeNull()
  })

  test("getOutput returns null for a task tracked with null outputPath", () => {
    const reg = createBackgroundTaskOutputRegistry(makeDeps())
    reg.trackTask("chat1", "task1", null)
    expect(reg.getOutput("chat1", "task1")).toBeNull()
  })

  test("getOutput returns empty content before any watcher", () => {
    const reg = createBackgroundTaskOutputRegistry(makeDeps(new Map([["/tmp/t.out", "hello"]])))
    reg.trackTask("chat1", "task1", "/tmp/t.out")
    expect(reg.getOutput("chat1", "task1")).toEqual({ content: "", truncated: false })
  })

  test("polling starts on first watcher and reads content", () => {
    const deps = makeDeps()
    const reg = createBackgroundTaskOutputRegistry(deps)
    reg.trackTask("chat1", "task1", "/tmp/t.out")
    const dispose = reg.addWatcher("chat1", "task1")
    deps.advance("/tmp/t.out", "line1\n")
    expect(reg.getOutput("chat1", "task1")).toEqual({ content: "line1\n", truncated: false })
    dispose()
  })

  test("polling stops when last watcher is removed", () => {
    const deps = makeDeps(new Map([["/tmp/t.out", "initial"]]))
    const reg = createBackgroundTaskOutputRegistry(deps)
    reg.trackTask("chat1", "task1", "/tmp/t.out")
    const dispose = reg.addWatcher("chat1", "task1")
    deps.advance("/tmp/t.out", "")
    dispose()
    deps.advance("/tmp/t.out", " appended")
    expect(reg.getOutput("chat1", "task1")?.content ?? "").not.toContain("appended")
  })

  test("second watcher does not restart polling", () => {
    const deps = makeDeps()
    const reg = createBackgroundTaskOutputRegistry(deps)
    reg.trackTask("chat1", "task1", "/tmp/t.out")
    const d1 = reg.addWatcher("chat1", "task1")
    const d2 = reg.addWatcher("chat1", "task1")
    deps.advance("/tmp/t.out", "hello")
    expect(reg.getOutput("chat1", "task1")?.content).toBe("hello")
    d1()
    deps.advance("/tmp/t.out", " world")
    expect(reg.getOutput("chat1", "task1")?.content).toBe("hello world")
    d2()
  })

  test("untrackTask stops polling and removes state", () => {
    const deps = makeDeps()
    const reg = createBackgroundTaskOutputRegistry(deps)
    reg.trackTask("chat1", "task1", "/tmp/t.out")
    reg.addWatcher("chat1", "task1")
    reg.untrackTask("chat1", "task1")
    expect(reg.getOutput("chat1", "task1")).toBeNull()
  })

  test("fires subscribe callback when output grows", () => {
    const deps = makeDeps()
    const reg = createBackgroundTaskOutputRegistry(deps)
    reg.trackTask("chat1", "task1", "/tmp/t.out")
    reg.addWatcher("chat1", "task1")

    const calls: Array<{ chatId: string; taskId: string }> = []
    reg.subscribe((chatId, taskId) => calls.push({ chatId, taskId }))
    deps.advance("/tmp/t.out", "new output")
    expect(calls).toEqual([{ chatId: "chat1", taskId: "task1" }])
  })

  test("does not fire subscribe callback when file size is unchanged after initial read", () => {
    const deps = makeDeps()
    const reg = createBackgroundTaskOutputRegistry(deps)
    reg.trackTask("chat1", "task1", "/tmp/t.out")
    reg.addWatcher("chat1", "task1")
    deps.advance("/tmp/t.out", "initial")

    const calls: Array<unknown> = []
    reg.subscribe(() => calls.push(true))
    deps.advance("/tmp/t.out", "")
    expect(calls).toHaveLength(0)
  })

  test("bounds content to 256 KB ring (truncated flag set)", () => {
    const deps = makeDeps()
    const reg = createBackgroundTaskOutputRegistry(deps)
    reg.trackTask("chat1", "task1", "/tmp/t.out")
    reg.addWatcher("chat1", "task1")

    const big = "x".repeat(OUTPUT_RING_DEFAULT_BYTES + 100)
    deps.advance("/tmp/t.out", big)
    const out = reg.getOutput("chat1", "task1")
    expect(out?.content.length).toBe(OUTPUT_RING_DEFAULT_BYTES)
    expect(out?.truncated).toBe(true)
  })

  test("addWatcher returns a no-op for an untracked task", () => {
    const reg = createBackgroundTaskOutputRegistry(makeDeps())
    expect(() => {
      const dispose = reg.addWatcher("chat1", "missing")
      dispose()
    }).not.toThrow()
  })

  test("subscribe dispose removes the observer", () => {
    const deps = makeDeps()
    const reg = createBackgroundTaskOutputRegistry(deps)
    reg.trackTask("chat1", "task1", "/tmp/t.out")
    reg.addWatcher("chat1", "task1")

    const calls: number[] = []
    const unsub = reg.subscribe(() => calls.push(1))
    deps.advance("/tmp/t.out", "a")
    unsub()
    deps.advance("/tmp/t.out", "b")
    expect(calls).toHaveLength(1)
  })
})
