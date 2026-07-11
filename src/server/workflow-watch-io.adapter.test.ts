import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { WatchWorkflowDeps, WorkflowJournalEntry } from "./workflow-watch-io.adapter"
import { listWorkflowRunDirs, readWorkflowDir, readWorkflowRunJournal, watchWorkflowDir } from "./workflow-watch-io.adapter"

const dirs: string[] = []
function tmp(): string { const d = mkdtempSync(join(tmpdir(), "wf-")); dirs.push(d); return d }
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

describe("workflow-watch-io.adapter", () => {
  test("readWorkflowDir returns raw JSON for each wf_*.json, ignores other files", () => {
    const d = tmp()
    writeFileSync(join(d, "wf_a.json"), JSON.stringify({ runId: "wf_a" }))
    writeFileSync(join(d, "notes.txt"), "x")
    const items = readWorkflowDir(d)
    expect(items).toHaveLength(1)
    expect((items[0].raw as { runId: string }).runId).toBe("wf_a")
  })

  test("readWorkflowDir returns [] for a missing dir", () => {
    expect(readWorkflowDir(join(tmp(), "nope"))).toEqual([])
  })

  test("readWorkflowDir skips unparseable files without throwing", () => {
    const d = tmp()
    writeFileSync(join(d, "wf_bad.json"), "{not json")
    writeFileSync(join(d, "wf_ok.json"), JSON.stringify({ runId: "wf_ok" }))
    const items = readWorkflowDir(d)
    expect(items.map((i) => i.runId)).toEqual(["wf_ok"])
  })

  test("arms when the workflows dir is created AFTER watch starts (watches parent)", async () => {
    const base = tmp()                      // exists
    const dir = join(base, "workflows")     // does NOT exist yet
    let calls = 0
    const dispose = watchWorkflowDir(dir, () => { calls += 1 }, { debounceMs: 20 })
    mkdirSync(dir)
    writeFileSync(join(dir, "wf_a.json"), "{}")
    await new Promise((r) => setTimeout(r, 200))
    expect(calls).toBeGreaterThanOrEqual(1)
    dispose()
  }, 5000)

  test("watchWorkflowDir coalesces rapid change events into one debounced call; dispose stops it", () => {
    // Deterministic: inject a fake watcher + controllable timers so the test
    // never depends on real fs-event delivery latency or wall-clock timer
    // scheduling (both load-sensitive — the prior sleep-based version flaked
    // under a busy suite, firing 0 or 2 times instead of the expected 1).
    const d = tmp() // must exist so watchWorkflowDir takes the armTarget path
    let calls = 0
    let changeCb: (() => void) | null = null
    const pendingTimeouts = new Map<number, () => void>()
    let nextTimerId = 1
    const deps: WatchWorkflowDeps = {
      watch: ((_dir: string, _opts: unknown, cb: () => void) => {
        changeCb = cb
        return { close() {} }
      }) as unknown as WatchWorkflowDeps["watch"],
      setTimeout: (fn) => {
        const id = nextTimerId++
        pendingTimeouts.set(id, fn)
        return id as unknown as ReturnType<typeof setTimeout>
      },
      clearTimeout: (handle) => { pendingTimeouts.delete(handle as unknown as number) },
      setInterval: (() => 0 as unknown as ReturnType<typeof setInterval>),
      clearInterval: () => {},
    }
    const flushTimers = () => {
      const fns = [...pendingTimeouts.values()]
      pendingTimeouts.clear()
      for (const fn of fns) fn()
    }

    const dispose = watchWorkflowDir(d, () => { calls += 1 }, { debounceMs: 30, deps })
    expect(changeCb).not.toBeNull()

    // Two rapid change events land inside one debounce window: the second
    // fire() clears the first pending timer, so exactly one timer survives.
    changeCb!()
    changeCb!()
    flushTimers()
    expect(calls).toBe(1)

    // After dispose, a late change event must never produce another call — the
    // `disposed` guard short-circuits fire() regardless of timing.
    dispose()
    changeCb!()
    flushTimers()
    expect(calls).toBe(1)
  })

  test("listWorkflowRunDirs reads sibling subagents/workflows/wf_* with newest mtime", () => {
    const session = tmp()
    const workflowsDir = join(session, "workflows")          // registered (sidecar) dir
    const liveRoot = join(session, "subagents", "workflows") // live run dirs
    mkdirSync(join(liveRoot, "wf_a"), { recursive: true })
    mkdirSync(join(liveRoot, "wf_b"), { recursive: true })
    mkdirSync(join(liveRoot, "ignore"), { recursive: true })  // not wf_*
    writeFileSync(join(liveRoot, "wf_a", "journal.jsonl"), "{}")
    writeFileSync(join(liveRoot, "wf_b", "agent-x.jsonl"), "{}")

    const out = listWorkflowRunDirs(workflowsDir)
    expect(out.map((r) => r.runId).sort()).toEqual(["wf_a", "wf_b"])
    expect(out.every((r) => r.newestMtimeMs > 0)).toBe(true)
  })

  test("listWorkflowRunDirs returns [] when the sibling dir is absent", () => {
    const session = tmp()
    expect(listWorkflowRunDirs(join(session, "workflows"))).toEqual([])
  })

  test("readWorkflowRunJournal parses started + result lines for a runId", () => {
    const session = tmp()
    const liveRoot = join(session, "subagents", "workflows")
    const runDir = join(liveRoot, "wf_a")
    mkdirSync(runDir, { recursive: true })
    writeFileSync(
      join(runDir, "journal.jsonl"),
      `${[
        JSON.stringify({ type: "started", agentId: "a1", key: "v2:x" }),
        JSON.stringify({
          type: "result",
          agentId: "a1",
          key: "v2:x",
          result: { dir: "/repo/pkg/x", fixed: 3, test_status: "pass", summary: "ok" },
        }),
      ].join("\n")  }\n`,
    )

    const entries = readWorkflowRunJournal(join(session, "workflows"), "wf_a")
    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({ type: "started", agentId: "a1" })
    expect(entries[1]).toMatchObject({ type: "result", agentId: "a1" })
    expect(entries[1].result).toMatchObject({ dir: "/repo/pkg/x", fixed: 3, test_status: "pass" })
  })

  test("readWorkflowRunJournal normalizes array count fields + parses real result shape", () => {
    const session = tmp()
    const runDir = join(session, "subagents", "workflows", "wf_real")
    mkdirSync(runDir, { recursive: true })
    writeFileSync(
      join(runDir, "journal.jsonl"),
      // The real sonar-sweep workflow returns count fields as ARRAYS, plus a
      // boolean testsPass and a long notes string — the prior parser silently
      // dropped all of these (it expected `fixed: number`, `test_status`).
      `${JSON.stringify({
        type: "result",
        agentId: "r1",
        result: { dir: "backend-core/pkg/enmime/internal/coding", fixed: [1941], stale: [1511, 2107], skipped: [], testsPass: true, notes: "Finding #1941 fixed." },
      })  }\n`,
    )

    const entries = readWorkflowRunJournal(join(session, "workflows"), "wf_real")
    expect(entries).toHaveLength(1)
    // Arrays collapse to their length; testsPass + notes survive.
    expect(entries[0].result).toMatchObject({
      dir: "backend-core/pkg/enmime/internal/coding",
      fixed: 1, stale: 2, skipped: 0, testsPass: true, notes: "Finding #1941 fixed.",
    })
  })

  test("readWorkflowRunJournal skips blank + unparseable lines; returns [] for missing file", () => {
    const session = tmp()
    const liveRoot = join(session, "subagents", "workflows")
    const runDir = join(liveRoot, "wf_b")
    mkdirSync(runDir, { recursive: true })
    writeFileSync(
      join(runDir, "journal.jsonl"),
      `${[
        "",
        "{not json",
        JSON.stringify({ type: "started", agentId: "b1" }),
        JSON.stringify({ type: "unrelated", agentId: "x" }),
      ].join("\n")  }\n`,
    )

    const entries = readWorkflowRunJournal(join(session, "workflows"), "wf_b")
    expect(entries.map((e: WorkflowJournalEntry) => e.agentId)).toEqual(["b1"])

    expect(readWorkflowRunJournal(join(session, "workflows"), "wf_missing")).toEqual([])
  })
})
