import { describe, expect, test } from "bun:test"
import { createWorkflowRegistry } from "./workflow-registry"
import type { WorkflowRawFile } from "./workflow-watch-io.adapter"

function fakeIo(files: Map<string, WorkflowRawFile[]>) {
  const cbs = new Map<string, () => void>()
  return {
    read: (dir: string): WorkflowRawFile[] => files.get(dir) ?? [],
    watch: (dir: string, onChange: () => void) => { cbs.set(dir, onChange); return () => cbs.delete(dir) },
    trigger: (dir: string) => cbs.get(dir)?.(),
  }
}

describe("WorkflowRegistry", () => {
  test("register reads + snapshots, sorted newest-first", () => {
    const files = new Map<string, WorkflowRawFile[]>([["/d", [
      { runId: "wf_old", raw: { runId: "wf_old", startTime: 1, status: "completed" } },
      { runId: "wf_new", raw: { runId: "wf_new", startTime: 2, status: "running" } },
    ]]])
    const io = fakeIo(files)
    const reg = createWorkflowRegistry({ read: io.read, watch: io.watch })
    reg.register("chat1", "/d")
    const snap = reg.snapshot("chat1")
    expect(snap.map((r) => r.runId)).toEqual(["wf_new", "wf_old"])
  })

  test("watch change re-reads and notifies subscribers with chatId", () => {
    const files = new Map<string, WorkflowRawFile[]>([["/d", []]])
    const io = fakeIo(files)
    const reg = createWorkflowRegistry({ read: io.read, watch: io.watch })
    const seen: string[] = []
    reg.subscribe((chatId) => seen.push(chatId))
    reg.register("chat1", "/d")
    files.set("/d", [{ runId: "wf_a", raw: { runId: "wf_a", status: "running" } }])
    io.trigger("/d")
    expect(seen).toContain("chat1")
    expect(reg.snapshot("chat1").map((r) => r.runId)).toEqual(["wf_a"])
  })

  test("getRun returns full run incl. heavy fields; null when unknown", () => {
    const files = new Map<string, WorkflowRawFile[]>([["/d", [
      { runId: "wf_a", raw: { runId: "wf_a", status: "running", script: "S", args: "[]" } },
    ]]])
    const io = fakeIo(files)
    const reg = createWorkflowRegistry({ read: io.read, watch: io.watch })
    reg.register("chat1", "/d")
    expect(reg.getRun("chat1", "wf_a")?.script).toBe("S")
    expect(reg.getRun("chat1", "nope")).toBeNull()
  })

  test("unregister stops watching and clears snapshot", () => {
    const files = new Map<string, WorkflowRawFile[]>([["/d", [
      { runId: "wf_a", raw: { runId: "wf_a", status: "running" } },
    ]]])
    const io = fakeIo(files)
    const reg = createWorkflowRegistry({ read: io.read, watch: io.watch })
    reg.register("chat1", "/d")
    reg.unregister("chat1")
    expect(reg.snapshot("chat1")).toEqual([])
  })

  describe("hasActiveRun", () => {
    const NOW = 1_000_000
    const FRESH = 600_000
    function regWith(runDirs: { runId: string; newestMtimeMs: number }[], sidecars: WorkflowRawFile[] = []) {
      const io = fakeIo(new Map([["/d", sidecars]]))
      const reg = createWorkflowRegistry({ read: io.read, watch: io.watch, listRunDirs: () => runDirs })
      reg.register("chat1", "/d")
      return reg
    }

    test("true: fresh live run dir with NO terminal sidecar (the mid-run window)", () => {
      const reg = regWith([{ runId: "wf_a", newestMtimeMs: NOW - 1000 }])
      expect(reg.hasActiveRun("chat1", FRESH, NOW)).toBe(true)
    })

    test("false: run dir present but a terminal sidecar exists (killed/completed)", () => {
      const reg = regWith(
        [{ runId: "wf_a", newestMtimeMs: NOW - 1000 }],
        [{ runId: "wf_a", raw: { runId: "wf_a", status: "killed" } }],
      )
      expect(reg.hasActiveRun("chat1", FRESH, NOW)).toBe(false)
    })

    test("true: sidecar exists but status still running", () => {
      const reg = regWith(
        [{ runId: "wf_a", newestMtimeMs: NOW - 1000 }],
        [{ runId: "wf_a", raw: { runId: "wf_a", status: "running" } }],
      )
      expect(reg.hasActiveRun("chat1", FRESH, NOW)).toBe(true)
    })

    test("false: run dir activity older than the freshness window (stalled/crashed)", () => {
      const reg = regWith([{ runId: "wf_a", newestMtimeMs: NOW - FRESH - 1 }])
      expect(reg.hasActiveRun("chat1", FRESH, NOW)).toBe(false)
    })

    test("false: no listRunDirs dep (legacy) or unknown chat", () => {
      const io = fakeIo(new Map([["/d", []]]))
      const legacy = createWorkflowRegistry({ read: io.read, watch: io.watch })
      legacy.register("chat1", "/d")
      expect(legacy.hasActiveRun("chat1", FRESH, NOW)).toBe(false)
      expect(regWith([{ runId: "wf_a", newestMtimeMs: NOW }]).hasActiveRun("unknown", FRESH, NOW)).toBe(false)
    })
  })
})
