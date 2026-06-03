import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { listWorkflowRunDirs, readWorkflowDir, watchWorkflowDir } from "./workflow-watch-io.adapter"

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

  test("watchWorkflowDir fires (debounced) on a new file, dispose stops it", async () => {
    const d = tmp()
    let calls = 0
    const dispose = watchWorkflowDir(d, () => { calls += 1 }, { debounceMs: 30 })
    writeFileSync(join(d, "wf_a.json"), "{}")
    writeFileSync(join(d, "wf_a.json"), "{}")
    await new Promise((r) => setTimeout(r, 80))
    expect(calls).toBe(1)
    dispose()
    writeFileSync(join(d, "wf_b.json"), "{}")
    await new Promise((r) => setTimeout(r, 80))
    expect(calls).toBe(1)
  }, 5000)

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
})
