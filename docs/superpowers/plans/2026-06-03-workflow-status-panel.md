# Workflow Status Panel (PTY disk-watch) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show Claude Code `Workflow` tool runs in Kanna's web UI (PTY driver) — a per-chat panel listing every run with live status + drill-in progress, plus an inline transcript card on the launch — by watching the `wf_*.json` sidecar files Claude writes to disk.

**Architecture:** A server-side `WorkflowRegistry` (mirrors `PtyInstanceRegistry`) `fs.watch`es each active PTY chat's `<projectDir>/<sessionToken>/workflows/` dir, parses each `wf_*.json` through one defensive parser, and serves a light per-chat snapshot over a new `workflows` subscription topic (heavy detail via a `workflows.getRun` command). It is an **independent read-model** — never folded into the transcript/turn event pipeline (preserves the c3-225 sole-source invariant). The client renders a `WorkflowsSection` panel (mirrors `SubagentsSection`) + a `WorkflowMessage` transcript card.

**Tech Stack:** TypeScript (strict, no `any`), Bun test, React 19, Zustand, `node:fs` watch (server adapter layer only), the existing WS subscription protocol.

**Spec:** `docs/superpowers/specs/2026-06-03-workflow-status-integration-design.md`

---

## Hard constraints (document, do not "fix")

1. **PTY transcript has NO workflow lifecycle events.** Verified 2026-06-03: the on-disk CC transcript JSONL the PTY driver tails contains the `Workflow` tool_use (launch) but zero `task_started`/`task_updated`/`tool_progress` lines. Live progress on PTY is available ONLY from `wf_*.json`. Do not attempt to parse lifecycle events from the transcript.
2. **`wf_*.json` is a CC-internal, undocumented format.** All reads go through ONE defensive parser (`parseWorkflowRunFile`); unknown/missing/partial fields degrade gracefully, never throw.
3. **Disk IO is sealed** outside `*.adapter.ts` / test / `adapters/` globs (CLAUDE.md side-effect seal). All `node:fs` access lives in `workflow-watch-io.adapter.ts`.
4. **Scope:** PTY driver only, read-only, per active-PTY chat. SDK driver, global cross-chat view, stop/relaunch, and browsing a closed chat's historical runs are OUT.

## Confirmed file map (anchors verified 2026-06-03 @ HEAD 1e429b6)

| Concern | File | Anchor |
|---|---|---|
| Path helpers | `src/server/claude-pty/jsonl-path.adapter.ts` | `encodeCwd` :31, `computeProjectDir` :41, `computeJsonlPath` :48 |
| PTY driver (resolve dir + sessionId) | `src/server/claude-pty/driver.ts` | `sessionId` :199/:388, `computeProjectDir(...)` :656, cleanup `:480-489` |
| Tool normalize / hydrate | `src/shared/tools.ts` | `asRecord` :18, `normalizeToolCall` :23, `unknown_tool` return :229, `hydrateToolResult` :337 |
| Tool types | `src/shared/types.ts` | `ToolCallBase` :885, tool-call interfaces :895-925, `NormalizedToolCall` union (after last `…ToolCall`) |
| Subscription topic | `src/shared/protocol.ts` | `SubscriptionTopic` union :37-47, `ServerSnapshot` :298-309, `WsEvent` :78, `ClientCommand`/ack flow :295 |
| Live-subscription template | `src/server/ws-router.ts` | serve snapshot `pty-instances` :911-919, push delta :1207-1222, deps :151/:418, dispose :2179 |
| PTY registry template | search | `grep -rln "class PtyInstanceRegistry\|PtyInstanceRegistry" src/server` |
| Tool card dispatch | `src/client/components/messages/ToolCallMessage.tsx` | `toolKind ===` branches :91-133, icon switch :178 |
| Panel template | `src/client/app/SubagentsSection.tsx` (+ `.test.tsx`) | mirror whole file |
| Render-loop test helper | `src/client/lib/testing/renderForLoopCheck.tsx` | `renderForLoopCheck` |

## File structure (new + modified)

**New:**
- `src/shared/workflow-types.ts` — pure types + `parseWorkflowRunFile` + `toRunSummary` (no IO).
- `src/shared/workflow-types.test.ts`
- `src/server/workflow-watch-io.adapter.ts` — fs list/read/watch (the only IO).
- `src/server/workflow-watch-io.adapter.test.ts`
- `src/server/workflow-registry.ts` — per-chat watch + debounce + `snapshot(chatId)` + `subscribe(cb)` (mirrors `PtyInstanceRegistry`).
- `src/server/workflow-registry.test.ts`
- `src/client/stores/workflowsStore.ts` — zustand, WS-fed, stable EMPTY ref.
- `src/client/stores/workflowsStore.test.ts`
- `src/client/app/WorkflowsSection.tsx` (+ `.test.tsx`) — panel (mirrors SubagentsSection).
- `src/client/components/messages/WorkflowMessage.tsx` (+ `.test.tsx`) — inline card.
- `docs/adr/NNNN-workflow-disk-watch-read-model.md`

**Modified:**
- `src/shared/protocol.ts` — `workflows` topic, `WorkflowsSnapshot` ServerSnapshot, `workflows.getRun` command + ack.
- `src/shared/tools.ts` + `src/shared/types.ts` — `workflow` toolKind + normalize/hydrate.
- `src/server/ws-router.ts` — serve + push the `workflows` topic; handle `workflows.getRun`.
- `src/server/claude-pty/driver.ts` — register/unregister the chat's workflows dir with the registry.
- `src/server/agent.ts` (or wherever ws-router deps are assembled) — construct + inject `WorkflowRegistry`.
- `src/client/components/messages/ToolCallMessage.tsx` — dispatch `workflow` toolKind + icon.
- `src/client/app/*` — mount `WorkflowsSection` next to `SubagentsSection`; subscribe to the topic.
- `CLAUDE.md` — new "Workflow Status Panel" section.

---

# Phase 0 — ADR + C3 seed (no code)

### Task 0.1: ADR for the disk-watch read-model exception

**Files:** Create `docs/adr/NNNN-workflow-disk-watch-read-model.md` (run `ls docs/adr/` for the next number).

- [ ] **Step 1:** Write the ADR capturing: (a) decision = disk-watch `wf_*.json` as an **independent sibling read-model**, not transcript-fed; (b) the verified fact that PTY transcript lacks lifecycle events; (c) why this does NOT violate c3-225 (workflow telemetry ≠ conversation/turn events); (d) PTY-only/read-only scope; (e) prior plan `2026-06-01-workflow-integration.md` event-stream path superseded for PTY.
- [ ] **Step 2: Commit**

```bash
git add docs/adr/NNNN-workflow-disk-watch-read-model.md
git commit -m "docs(adr): workflow disk-watch read-model"
```

### Task 0.2: Seed C3 component

- [ ] **Step 1:** Run `/c3 query workflow orchestration` to load nearest context, then `/c3 ref` to scaffold a `workflow-status` component doc listing the File Map files. (Mandatory per project CLAUDE.md; final `/c3 change` is Phase 7.)
- [ ] **Step 2: Commit**

```bash
git add .c3/
git commit -m "docs(c3): seed workflow-status component"
```

---

# Phase 1 — Shared types + defensive parser (pure, TDD)

### Task 1.1: Workflow types + `parseWorkflowRunFile` — failing test

**Files:** Create `src/shared/workflow-types.test.ts`, `src/shared/workflow-types.ts` (stub).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test"
import { parseWorkflowRunFile, toRunSummary } from "./workflow-types"

const RAW = {
  runId: "wf_abc",
  taskId: "tsk1",
  workflowName: "sonar-fix",
  status: "running",
  startTime: 1000,
  durationMs: 5000,
  agentCount: 2,
  totalTokens: 1234,
  totalToolCalls: 9,
  phases: [{ title: "Fix", detail: "one agent per dir" }],
  workflowProgress: [
    { type: "workflow_phase", index: 1, title: "Fix" },
    {
      type: "workflow_agent", index: 1, label: "fix:a", phaseIndex: 1,
      agentId: "a1", model: "claude-sonnet-4-6", state: "progress",
      lastToolName: "Read", lastToolSummary: "/x", promptPreview: "do x",
      tokens: 100, toolCalls: 3,
    },
  ],
  result: null, error: null, summary: "wip", script: "export const meta…",
  scriptPath: "/p/.wf.mjs", args: "[]",
}

describe("parseWorkflowRunFile", () => {
  test("parses a well-formed run", () => {
    const run = parseWorkflowRunFile(RAW)
    expect(run).not.toBeNull()
    expect(run!.runId).toBe("wf_abc")
    expect(run!.status).toBe("running")
    expect(run!.agents).toHaveLength(1)
    expect(run!.agents[0].label).toBe("fix:a")
    expect(run!.phases[0].title).toBe("Fix")
  })

  test("returns null for non-object / missing runId", () => {
    expect(parseWorkflowRunFile(null)).toBeNull()
    expect(parseWorkflowRunFile({ taskId: "x" })).toBeNull()
  })

  test("tolerates unknown status and missing optional fields", () => {
    const run = parseWorkflowRunFile({ runId: "wf_x", status: "weird" })
    expect(run).not.toBeNull()
    expect(run!.status).toBe("unknown")
    expect(run!.agents).toEqual([])
    expect(run!.phases).toEqual([])
  })

  test("toRunSummary drops heavy fields", () => {
    const sum = toRunSummary(parseWorkflowRunFile(RAW)!)
    expect(sum.runId).toBe("wf_abc")
    expect(sum.agentCount).toBe(2)
    expect("script" in sum).toBe(false)
    expect("args" in sum).toBe(false)
    // agents in summary carry state but not promptPreview
    expect(sum.agents[0].state).toBe("progress")
    expect("promptPreview" in sum.agents[0]).toBe(false)
  })
})
```

- [ ] **Step 2: Stub so import resolves, test fails**

```ts
// src/shared/workflow-types.ts
export type WorkflowStatus = "running" | "completed" | "failed" | "killed" | "unknown"
export interface WorkflowPhase { title: string; detail?: string }
export interface WorkflowAgentProgress {
  index: number
  label: string
  phaseIndex?: number
  phaseTitle?: string
  agentId?: string
  model?: string
  state: string
  lastToolName?: string
  lastToolSummary?: string
  promptPreview?: string
  tokens?: number
  toolCalls?: number
  startedAt?: number
  lastProgressAt?: number
}
export interface WorkflowRun {
  runId: string
  taskId?: string
  workflowName?: string
  status: WorkflowStatus
  startTime?: number
  durationMs?: number
  agentCount?: number
  totalTokens?: number
  totalToolCalls?: number
  phases: WorkflowPhase[]
  agents: WorkflowAgentProgress[]
  result?: string | null
  error?: string | null
  summary?: string | null
  script?: string
  scriptPath?: string
  args?: string
}
export type WorkflowAgentSummary = Omit<WorkflowAgentProgress, "promptPreview" | "lastToolSummary">
export interface WorkflowRunSummary {
  runId: string
  taskId?: string
  workflowName?: string
  status: WorkflowStatus
  startTime?: number
  durationMs?: number
  agentCount?: number
  totalTokens?: number
  totalToolCalls?: number
  phases: WorkflowPhase[]
  agents: WorkflowAgentSummary[]
}
export function parseWorkflowRunFile(_raw: unknown): WorkflowRun | null { return null }
export function toRunSummary(_run: WorkflowRun): WorkflowRunSummary { throw new Error("not impl") }
```

- [ ] **Step 3: Run → FAIL**

Run: `bun test src/shared/workflow-types.test.ts`
Expected: FAIL (parse returns null / toRunSummary throws).

- [ ] **Step 4: Commit the failing test**

```bash
git add src/shared/workflow-types.ts src/shared/workflow-types.test.ts
git commit -m "test(workflow): failing parseWorkflowRunFile spec"
```

### Task 1.2: Implement the parser

**Files:** Modify `src/shared/workflow-types.ts`.

- [ ] **Step 1: Implement** (replace the two stub functions; keep the types):

```ts
const KNOWN_STATUS: ReadonlySet<string> = new Set(["running", "completed", "failed", "killed"])

function rec(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}
function str(v: unknown): string | undefined { return typeof v === "string" ? v : undefined }
function num(v: unknown): number | undefined { return typeof v === "number" ? v : undefined }

function parseAgents(progress: unknown): WorkflowAgentProgress[] {
  if (!Array.isArray(progress)) return []
  const out: WorkflowAgentProgress[] = []
  for (const item of progress) {
    const r = rec(item)
    if (!r || r.type !== "workflow_agent") continue
    out.push({
      index: num(r.index) ?? out.length + 1,
      label: str(r.label) ?? "agent",
      phaseIndex: num(r.phaseIndex),
      phaseTitle: str(r.phaseTitle),
      agentId: str(r.agentId),
      model: str(r.model),
      state: str(r.state) ?? "unknown",
      lastToolName: str(r.lastToolName),
      lastToolSummary: str(r.lastToolSummary),
      promptPreview: str(r.promptPreview),
      tokens: num(r.tokens),
      toolCalls: num(r.toolCalls),
      startedAt: num(r.startedAt),
      lastProgressAt: num(r.lastProgressAt),
    })
  }
  return out
}

function parsePhases(phases: unknown): WorkflowPhase[] {
  if (!Array.isArray(phases)) return []
  const out: WorkflowPhase[] = []
  for (const item of phases) {
    const r = rec(item)
    if (!r) continue
    const title = str(r.title)
    if (!title) continue
    out.push({ title, detail: str(r.detail) })
  }
  return out
}

export function parseWorkflowRunFile(raw: unknown): WorkflowRun | null {
  const r = rec(raw)
  if (!r) return null
  const runId = str(r.runId)
  if (!runId) return null
  const rawStatus = str(r.status)
  const status: WorkflowStatus = rawStatus && KNOWN_STATUS.has(rawStatus) ? (rawStatus as WorkflowStatus) : "unknown"
  const resultVal = r.result
  return {
    runId,
    taskId: str(r.taskId),
    workflowName: str(r.workflowName),
    status,
    startTime: num(r.startTime),
    durationMs: num(r.durationMs),
    agentCount: num(r.agentCount),
    totalTokens: num(r.totalTokens),
    totalToolCalls: num(r.totalToolCalls),
    phases: parsePhases(r.phases),
    agents: parseAgents(r.workflowProgress),
    result: typeof resultVal === "string" ? resultVal : resultVal == null ? null : JSON.stringify(resultVal),
    error: str(r.error) ?? (r.error == null ? null : String(r.error)),
    summary: str(r.summary) ?? null,
    script: str(r.script),
    scriptPath: str(r.scriptPath),
    args: typeof r.args === "string" ? r.args : r.args == null ? undefined : JSON.stringify(r.args),
  }
}

export function toRunSummary(run: WorkflowRun): WorkflowRunSummary {
  return {
    runId: run.runId,
    taskId: run.taskId,
    workflowName: run.workflowName,
    status: run.status,
    startTime: run.startTime,
    durationMs: run.durationMs,
    agentCount: run.agentCount,
    totalTokens: run.totalTokens,
    totalToolCalls: run.totalToolCalls,
    phases: run.phases,
    agents: run.agents.map(({ promptPreview, lastToolSummary, ...keep }) => keep),
  }
}
```

- [ ] **Step 2: Run → PASS**

Run: `bun test src/shared/workflow-types.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 3: Commit**

```bash
git add src/shared/workflow-types.ts
git commit -m "feat(workflow): defensive wf_*.json parser + summary projection"
```

---

# Phase 2 — Server: watch adapter + registry (TDD)

### Task 2.1: `workflow-watch-io.adapter.ts` — failing test

**Files:** Create `src/server/workflow-watch-io.adapter.test.ts`, `src/server/workflow-watch-io.adapter.ts` (stub).

The adapter is the only file allowed `node:fs`. It exposes: list+read all `wf_*.json` in a dir (returns `{ runId, raw }[]`), and a `watch(dir, onChange)` that debounces and calls back. Tests use a real tmpdir.

- [ ] **Step 1: Write the failing test**

```ts
import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { readWorkflowDir, watchWorkflowDir } from "./workflow-watch-io.adapter"

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

  test("watchWorkflowDir fires (debounced) on a new file, dispose stops it", async () => {
    const d = tmp()
    let calls = 0
    const dispose = watchWorkflowDir(d, () => { calls += 1 }, { debounceMs: 30 })
    writeFileSync(join(d, "wf_a.json"), "{}")
    writeFileSync(join(d, "wf_a.json"), "{}")
    await new Promise((r) => setTimeout(r, 80))
    expect(calls).toBe(1) // two rapid writes coalesced
    dispose()
    writeFileSync(join(d, "wf_b.json"), "{}")
    await new Promise((r) => setTimeout(r, 80))
    expect(calls).toBe(1) // no fire after dispose
  }, 5000)
})
```

- [ ] **Step 2: Stub**

```ts
// src/server/workflow-watch-io.adapter.ts
export interface WorkflowRawFile { runId: string; raw: unknown }
export function readWorkflowDir(_dir: string): WorkflowRawFile[] { return [] }
export function watchWorkflowDir(
  _dir: string, _onChange: () => void, _opts?: { debounceMs?: number },
): () => void { return () => {} }
```

- [ ] **Step 3: Run → FAIL**

Run: `bun test src/server/workflow-watch-io.adapter.test.ts`

- [ ] **Step 4: Commit failing test**

```bash
git add src/server/workflow-watch-io.adapter.ts src/server/workflow-watch-io.adapter.test.ts
git commit -m "test(workflow): failing watch adapter spec"
```

### Task 2.2: Implement the adapter

**Files:** Modify `src/server/workflow-watch-io.adapter.ts`.

- [ ] **Step 1: Implement**

```ts
import { existsSync, readdirSync, readFileSync, watch } from "node:fs"
import { join } from "node:path"

export interface WorkflowRawFile { runId: string; raw: unknown }

function isWfFile(name: string): boolean { return name.startsWith("wf_") && name.endsWith(".json") }

export function readWorkflowDir(dir: string): WorkflowRawFile[] {
  if (!existsSync(dir)) return []
  let names: string[]
  try { names = readdirSync(dir) } catch { return [] }
  const out: WorkflowRawFile[] = []
  for (const name of names) {
    if (!isWfFile(name)) continue
    try {
      const raw: unknown = JSON.parse(readFileSync(join(dir, name), "utf8"))
      out.push({ runId: name.slice(0, -".json".length), raw })
    } catch {
      // partial write / corrupt file — skip this tick; next write re-fires the watch
    }
  }
  return out
}

export function watchWorkflowDir(
  dir: string, onChange: () => void, opts?: { debounceMs?: number },
): () => void {
  const debounceMs = opts?.debounceMs ?? 250
  let timer: ReturnType<typeof setTimeout> | null = null
  let disposed = false
  const fire = () => {
    if (disposed) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => { timer = null; if (!disposed) onChange() }, debounceMs)
  }
  let watcher: ReturnType<typeof watch> | null = null
  try {
    if (existsSync(dir)) watcher = watch(dir, { persistent: false }, fire)
  } catch {
    watcher = null
  }
  return () => {
    disposed = true
    if (timer) clearTimeout(timer)
    try { watcher?.close() } catch { /* already closed */ }
  }
}
```

> **NOTE for executor:** the `workflows/` dir may not exist when the chat first registers (created lazily by CC on the first `Workflow` call). Task 2.4 handles "watch the parent and re-arm" — this adapter just no-ops if the dir is absent at watch time. Keep it that simple here.

- [ ] **Step 2: Run → PASS**

Run: `bun test src/server/workflow-watch-io.adapter.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 3: Lint (side-effect seal — confirm `.adapter.ts` is exempt)**

Run: `bun run lint`
Expected: 0 errors (the `node:fs` import is allowed only because the filename ends `.adapter.ts`). If it errors, the filename is wrong — do NOT add `eslint-disable`.

- [ ] **Step 4: Commit**

```bash
git add src/server/workflow-watch-io.adapter.ts
git commit -m "feat(workflow): fs watch adapter for wf_*.json"
```

### Task 2.3: `WorkflowRegistry` — failing test

**Files:** Create `src/server/workflow-registry.test.ts`, `src/server/workflow-registry.ts` (stub).

The registry holds per-chat watches and a subscriber list (mirrors `PtyInstanceRegistry`). Inject the two adapter functions so the test can fake them (no real fs). Public API:

```
register(chatId, workflowsDir): void   // start watching; immediate refresh
unregister(chatId): void               // stop watch, drop snapshot
snapshot(chatId): WorkflowRunSummary[]  // sorted newest-first
getRun(chatId, runId): WorkflowRun | null
subscribe(cb: (chatId) => void): () => void
```

- [ ] **Step 1: Write the failing test**

```ts
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
})
```

- [ ] **Step 2: Stub**

```ts
// src/server/workflow-registry.ts
import type { WorkflowRawFile } from "./workflow-watch-io.adapter"
import type { WorkflowRun, WorkflowRunSummary } from "../shared/workflow-types"

export interface WorkflowRegistryDeps {
  read: (dir: string) => WorkflowRawFile[]
  watch: (dir: string, onChange: () => void) => () => void
}
export interface WorkflowRegistry {
  register(chatId: string, workflowsDir: string): void
  unregister(chatId: string): void
  snapshot(chatId: string): WorkflowRunSummary[]
  getRun(chatId: string, runId: string): WorkflowRun | null
  subscribe(cb: (chatId: string) => void): () => void
}
export function createWorkflowRegistry(_deps: WorkflowRegistryDeps): WorkflowRegistry {
  return {
    register() {}, unregister() {}, snapshot() { return [] },
    getRun() { return null }, subscribe() { return () => {} },
  }
}
```

- [ ] **Step 3: Run → FAIL**

Run: `bun test src/server/workflow-registry.test.ts`

- [ ] **Step 4: Commit failing test**

```bash
git add src/server/workflow-registry.ts src/server/workflow-registry.test.ts
git commit -m "test(workflow): failing registry spec"
```

### Task 2.4: Implement `WorkflowRegistry`

**Files:** Modify `src/server/workflow-registry.ts`.

- [ ] **Step 1: Implement**

```ts
import type { WorkflowRawFile } from "./workflow-watch-io.adapter"
import { parseWorkflowRunFile, toRunSummary } from "../shared/workflow-types"
import type { WorkflowRun, WorkflowRunSummary } from "../shared/workflow-types"

export interface WorkflowRegistryDeps {
  read: (dir: string) => WorkflowRawFile[]
  watch: (dir: string, onChange: () => void) => () => void
}
export interface WorkflowRegistry {
  register(chatId: string, workflowsDir: string): void
  unregister(chatId: string): void
  snapshot(chatId: string): WorkflowRunSummary[]
  getRun(chatId: string, runId: string): WorkflowRun | null
  subscribe(cb: (chatId: string) => void): () => void
}

interface Entry { dir: string; dispose: () => void; runs: Map<string, WorkflowRun> }

function byNewest(a: WorkflowRun, b: WorkflowRun): number {
  return (b.startTime ?? 0) - (a.startTime ?? 0)
}

export function createWorkflowRegistry(deps: WorkflowRegistryDeps): WorkflowRegistry {
  const entries = new Map<string, Entry>()
  const subs = new Set<(chatId: string) => void>()

  function refresh(chatId: string): void {
    const entry = entries.get(chatId)
    if (!entry) return
    const next = new Map<string, WorkflowRun>()
    for (const { raw } of deps.read(entry.dir)) {
      const run = parseWorkflowRunFile(raw)
      if (run) next.set(run.runId, run)
    }
    entry.runs = next
    for (const cb of subs) cb(chatId)
  }

  return {
    register(chatId, workflowsDir) {
      entries.get(chatId)?.dispose()
      const dispose = deps.watch(workflowsDir, () => refresh(chatId))
      entries.set(chatId, { dir: workflowsDir, dispose, runs: new Map() })
      refresh(chatId)
    },
    unregister(chatId) {
      const entry = entries.get(chatId)
      if (!entry) return
      entry.dispose()
      entries.delete(chatId)
    },
    snapshot(chatId) {
      const entry = entries.get(chatId)
      if (!entry) return []
      return [...entry.runs.values()].sort(byNewest).map(toRunSummary)
    },
    getRun(chatId, runId) {
      return entries.get(chatId)?.runs.get(runId) ?? null
    },
    subscribe(cb) { subs.add(cb); return () => subs.delete(cb) },
  }
}
```

- [ ] **Step 2: Run → PASS**

Run: `bun test src/server/workflow-registry.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 3: Commit**

```bash
git add src/server/workflow-registry.ts
git commit -m "feat(workflow): per-chat workflow registry"
```

---

# Phase 3 — Protocol + ws-router + driver wiring

### Task 3.1: Protocol additions

**Files:** Modify `src/shared/protocol.ts`.

- [ ] **Step 1: Add the topic** to the `SubscriptionTopic` union (`:47`, after `| { type: "pty-instances" }`):

```ts
  | { type: "workflows"; chatId: string }
```

- [ ] **Step 2: Add the snapshot import + ServerSnapshot variant.** Near the other shared-type imports add:

```ts
import type { WorkflowRunSummary, WorkflowRun } from "./workflow-types"
```

and in `ServerSnapshot` (`:298`), after `| { type: "pty-instances"; data: PtyInstancesSnapshot }`:

```ts
  | { type: "workflows"; data: WorkflowsSnapshot }
```

and define the snapshot type near the other `*Snapshot` interfaces:

```ts
export interface WorkflowsSnapshot { chatId: string; runs: WorkflowRunSummary[] }
```

- [ ] **Step 3: Add the drill-in command + ack.** In the `ClientCommand` union add:

```ts
  | { type: "workflows.getRun"; chatId: string; runId: string }
```

(The ack already carries `result?: unknown` — the handler returns `WorkflowRun | null` as the ack `result`. Find the `ClientCommand` union via `grep -n "ClientCommand" src/shared/protocol.ts` and place the variant alongside siblings like `chat.cancelSubagentRun` at `:245`.)

- [ ] **Step 4: Typecheck**

Run: `bunx tsc --noEmit`
Expected: PASS (ws-router not yet handling the new topic/command compiles because switches have implicit fallthrough — if a switch is exhaustive and errors, that's Task 3.2's job; if tsc errors here, proceed to 3.2 then re-run).

- [ ] **Step 5: Commit**

```bash
git add src/shared/protocol.ts
git commit -m "feat(protocol): workflows topic + getRun command"
```

### Task 3.2: ws-router serves + pushes the topic, handles the command

**Files:** Modify `src/server/ws-router.ts`. **Read `:911-919` (serve), `:1207-1222` (push delta), `:151`/`:418` (deps), `:2179` (dispose), and the command-handling switch (`grep -n "command.type ===\|case \"chat\." src/server/ws-router.ts`) first — mirror the `pty-instances` topic and an existing command exactly.**

- [ ] **Step 1: Add the dep.** In the ws-router deps interface (near `:151` `ptyInstances?: PtyInstanceRegistry`):

```ts
  workflowRegistry?: WorkflowRegistry
```

and destructure it where `ptyInstances` is destructured (`:418`). Add the import at the top:

```ts
import type { WorkflowRegistry } from "./workflow-registry"
```

- [ ] **Step 2: Serve the snapshot on subscribe.** In the snapshot-serving switch (mirror `:911`), add:

```ts
    if (topic.type === "workflows") {
      return {
        type: "workflows",
        data: { chatId: topic.chatId, runs: workflowRegistry?.snapshot(topic.chatId) ?? [] },
      }
    }
```

- [ ] **Step 3: Push on registry change.** Mirror the `disposePtyInstances` subscribe block (`:1216`). After it add:

```ts
  const disposeWorkflows: () => void = workflowRegistry?.subscribe((chatId: string) => {
    for (const ws of sockets) {
      for (const [id, topic] of ws.data.subscriptions) {
        if (topic.type !== "workflows" || topic.chatId !== chatId) continue
        sendSnapshot(ws, id, {
          type: "workflows",
          data: { chatId, runs: workflowRegistry.snapshot(chatId) },
        })
      }
    }
  }) ?? (() => {})
```

> **NOTE for executor:** match the exact broadcast primitive the file already uses. `pushPtyInstancesEvent` (`:1207`) iterates sockets/subscriptions — reuse that iteration shape and the same `sendSnapshot`/envelope helper the `pty-instances` path uses. Do not invent a new send path.

- [ ] **Step 4: Dispose** alongside `disposePtyInstances()` (`:2179`): add `disposeWorkflows()`.

- [ ] **Step 5: Handle the command.** In the `command` switch add:

```ts
    case "workflows.getRun":
      return workflowRegistry?.getRun(command.chatId, command.runId) ?? null
```

(Return value becomes the ack `result`. Mirror how a sibling command returns its ack.)

- [ ] **Step 6: Typecheck + existing ws-router tests**

Run: `bunx tsc --noEmit && bun test src/server/ws-router.test.ts`
Expected: PASS. If a test snapshots the topic/command set, update it here.

- [ ] **Step 7: Commit**

```bash
git add src/server/ws-router.ts
git commit -m "feat(ws): serve + push workflows topic, getRun command"
```

### Task 3.3: Construct + inject the registry; register from the PTY driver

**Files:** Modify the ws-router dep assembly (`grep -rn "ptyInstances:" src/server | grep -v test` to find where deps are built — likely `agent.ts` or `index.ts`) and `src/server/claude-pty/driver.ts`.

- [ ] **Step 1: Construct** the registry once where `ptyInstances` is constructed, wiring the real adapter:

```ts
import { createWorkflowRegistry } from "./workflow-registry"
import { readWorkflowDir, watchWorkflowDir } from "./workflow-watch-io.adapter"

const workflowRegistry = createWorkflowRegistry({
  read: readWorkflowDir,
  watch: (dir, onChange) => watchWorkflowDir(dir, onChange),
})
```

and pass `workflowRegistry` into the ws-router deps.

- [ ] **Step 2: Register on PTY spawn.** In `driver.ts`, where `projectDir` is computed (`:656`) and `sessionId` is known, compute the workflows dir and register. The workflows dir is `<projectDir>/<sessionId>/workflows`:

```ts
import { join } from "node:path"
// after: const projectDir = computeProjectDir({ homeDir: home, cwd: args.localPath })
const workflowsDir = join(projectDir, sessionId, "workflows")
args.workflowRegistry?.register(args.chatId, workflowsDir)
```

> **NOTE for executor:** `sessionId` here must be the SAME uuid CC uses for the session subdir. Confirm against a live run: `ls ~/.claude/projects/<encoded-cwd>/` shows a `<uuid>/` dir whose name equals the value the driver tails in `computeJsonlPath`. The jsonl file is `<projectDir>/<sessionId>.jsonl` and the workflows live in `<projectDir>/<sessionId>/workflows/` — same `sessionId`. If `args.sessionToken` (not `sessionId`) is the resume uuid that names the dir, use that instead — verify by listing the dir during a manual run. `path.join` import must satisfy the side-effect seal: `node:path` is pure (not in the restricted list), so it is allowed in `driver.ts`.

- [ ] **Step 3: Unregister on close.** In the driver cleanup path (`:480-489`, where `ptyRegistry.unregister` is called):

```ts
args.workflowRegistry?.unregister(args.chatId)
```

- [ ] **Step 4:** Add `workflowRegistry?: WorkflowRegistry` to the driver's args/deps type (find the `StartClaudeSessionPtyArgs`-adjacent type carrying `ptyRegistry`), threaded from the coordinator.

- [ ] **Step 5: Typecheck + driver tests**

Run: `bunx tsc --noEmit && bun test src/server/claude-pty/driver.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/claude-pty/driver.ts src/server/agent.ts
git commit -m "feat(workflow): register PTY chat workflows dir with registry"
```

---

# Phase 4 — Tool-call card normalization (reused from prior plan)

### Task 4.1: `workflow` toolKind type

**Files:** Modify `src/shared/types.ts`.

- [ ] **Step 1: Add the interface** after the last `…ToolCall` interface (near `:920`):

```ts
export interface WorkflowToolCall
  extends ToolCallBase<"workflow", { name?: string; description?: string; scriptPath?: string }> { }
```

- [ ] **Step 2: Add to the `NormalizedToolCall` union** (find via `grep -n "NormalizedToolCall =" src/shared/types.ts`), after the last member:

```ts
  | WorkflowToolCall
```

- [ ] **Step 3: Typecheck**

Run: `bunx tsc --noEmit`
Expected: PASS (`ToolCallMessage` switch has a default branch, so widening is safe).

- [ ] **Step 4: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat(types): add workflow toolKind"
```

### Task 4.2: Normalize the `Workflow` tool call — failing test

**Files:** Modify `src/shared/tools.ts`, `src/shared/tools.test.ts`.

- [ ] **Step 1: Failing test** (append to `tools.test.ts`):

```ts
test("normalizes Workflow tool call to workflow toolKind (inline script meta)", () => {
  const r = normalizeToolCall({
    toolName: "Workflow", toolId: "t1",
    input: { script: "export const meta = {\n  name: 'sonar-fix',\n  description: 'fix sonar',\n}" },
  })
  expect(r.toolKind).toBe("workflow")
  if (r.toolKind === "workflow") {
    expect(r.input.name).toBe("sonar-fix")
    expect(r.input.description).toBe("fix sonar")
  }
})

test("normalizes Workflow tool call with scriptPath only", () => {
  const r = normalizeToolCall({ toolName: "Workflow", toolId: "t2", input: { scriptPath: "/p/.wf.mjs" } })
  expect(r.toolKind).toBe("workflow")
  if (r.toolKind === "workflow") expect(r.input.scriptPath).toBe("/p/.wf.mjs")
})
```

- [ ] **Step 2: Run → FAIL**

Run: `bun test src/shared/tools.test.ts -t "Workflow tool call"`
Expected: FAIL (toolKind `unknown_tool`).

- [ ] **Step 3: Implement.** Add a helper after `asRecord` (`:18`):

```ts
function parseWorkflowMeta(script: string): { name?: string; description?: string } {
  const name = script.match(/name\s*:\s*['"]([^'"]+)['"]/)?.[1]
  const description = script.match(/description\s*:\s*['"]([^'"]+)['"]/)?.[1]
  return { name, description }
}
```

and a `case` before the final `unknown_tool` return (`:229`):

```ts
    case "Workflow": {
      const script = typeof input.script === "string" ? input.script : ""
      const meta = parseWorkflowMeta(script)
      return {
        toolKind: "workflow",
        toolName,
        toolId,
        input: {
          name: meta.name,
          description: meta.description,
          scriptPath: typeof input.scriptPath === "string" ? input.scriptPath : undefined,
        },
      }
    }
```

> **NOTE for executor:** match the exact object shape the other `case` returns (e.g. whether they include `kind: "tool"`, `rawInput`, etc — copy a sibling like `case "Skill"` :87 verbatim and adapt fields). Do not invent fields not on the sibling returns.

- [ ] **Step 4: Run → PASS**

Run: `bun test src/shared/tools.test.ts -t "Workflow tool call"`

- [ ] **Step 5: Commit**

```bash
git add src/shared/tools.ts src/shared/tools.test.ts
git commit -m "feat(tools): normalize Workflow tool call"
```

### Task 4.3: Recognize the tool name in the toolset (if gated)

**Files:** Modify `src/server/agent.ts` (`CLAUDE_TOOLSET`, near `:111` per prior plan).

- [ ] **Step 1:** Check whether the PTY/SDK toolset allowlist filters tool NAMES before normalization (`grep -n "CLAUDE_TOOLSET" src/server/agent.ts`). If `Workflow` calls already render (PTY tails the transcript verbatim, so they likely do), **SKIP this task** and note it. If an allowlist drops unknown tools, add `"Workflow"` to `CLAUDE_TOOLSET`.
- [ ] **Step 2:** If changed, run `bun test src/server/agent.test.ts` (update any toolset snapshot), then commit:

```bash
git add src/server/agent.ts
git commit -m "feat(agent): allow Workflow tool name"
```

---

# Phase 5 — Client store + transcript card

### Task 5.1: `workflowsStore` — failing test

**Files:** Create `src/client/stores/workflowsStore.test.ts`, `src/client/stores/workflowsStore.ts` (stub). Read an existing store (e.g. `src/client/stores/slashCommandsStore.ts`) for the project's zustand pattern first.

- [ ] **Step 1: Failing test**

```ts
import { describe, expect, test } from "bun:test"
import { useWorkflowsStore, selectRuns } from "./workflowsStore"
import type { WorkflowRunSummary } from "../../shared/workflow-types"

const run = (runId: string): WorkflowRunSummary => ({
  runId, status: "running", phases: [], agents: [],
})

describe("workflowsStore", () => {
  test("setRuns stores per chat; selectRuns returns stable EMPTY for unknown chat", () => {
    useWorkflowsStore.getState().setRuns("c1", [run("wf_a")])
    expect(selectRuns("c1")(useWorkflowsStore.getState()).map((r) => r.runId)).toEqual(["wf_a"])
    const a = selectRuns("nope")(useWorkflowsStore.getState())
    const b = selectRuns("nope")(useWorkflowsStore.getState())
    expect(a).toBe(b) // same EMPTY reference — no render loop
  })
})
```

- [ ] **Step 2: Stub**

```ts
// src/client/stores/workflowsStore.ts
import { create } from "zustand"
import type { WorkflowRunSummary } from "../../shared/workflow-types"

const EMPTY: WorkflowRunSummary[] = []
interface WorkflowsState {
  byChat: Record<string, WorkflowRunSummary[]>
  setRuns(chatId: string, runs: WorkflowRunSummary[]): void
}
export const useWorkflowsStore = create<WorkflowsState>(() => ({ byChat: {}, setRuns() {} }))
export function selectRuns(_chatId: string) {
  return (_s: WorkflowsState): WorkflowRunSummary[] => EMPTY
}
```

- [ ] **Step 3: Run → FAIL** — `bun test src/client/stores/workflowsStore.test.ts`

- [ ] **Step 4: Commit failing test**

```bash
git add src/client/stores/workflowsStore.ts src/client/stores/workflowsStore.test.ts
git commit -m "test(workflow): failing workflowsStore spec"
```

### Task 5.2: Implement `workflowsStore`

**Files:** Modify `src/client/stores/workflowsStore.ts`.

- [ ] **Step 1: Implement**

```ts
import { create } from "zustand"
import type { WorkflowRunSummary } from "../../shared/workflow-types"

const EMPTY: WorkflowRunSummary[] = []
interface WorkflowsState {
  byChat: Record<string, WorkflowRunSummary[]>
  setRuns(chatId: string, runs: WorkflowRunSummary[]): void
}
export const useWorkflowsStore = create<WorkflowsState>((set) => ({
  byChat: {},
  setRuns: (chatId, runs) => set((s) => ({ byChat: { ...s.byChat, [chatId]: runs } })),
}))
export function selectRuns(chatId: string) {
  return (s: WorkflowsState): WorkflowRunSummary[] => s.byChat[chatId] ?? EMPTY
}
```

- [ ] **Step 2: Run → PASS** — `bun test src/client/stores/workflowsStore.test.ts`

- [ ] **Step 3: Commit**

```bash
git add src/client/stores/workflowsStore.ts
git commit -m "feat(workflow): workflowsStore with stable empty ref"
```

### Task 5.3: Wire the subscription (client socket layer)

**Files:** Modify the client socket/subscription layer (find via `grep -rn "type: \"subscribe\"\|topic:" src/client | head` and the snapshot handler `grep -rn "snapshot.type\|case \"pty-instances\"" src/client`).

- [ ] **Step 1:** When a chat view mounts, subscribe to `{ type: "workflows", chatId }` (mirror how the chat/pty-instances subscription is opened). On a `{ type: "workflows" }` snapshot, call `useWorkflowsStore.getState().setRuns(data.chatId, data.runs)`.
- [ ] **Step 2:** Add a client test if the socket layer has a test harness (mirror an existing snapshot-handling test); otherwise assert via the store in the panel test (Task 6.1). Commit:

```bash
git commit -am "feat(workflow): subscribe to workflows topic on chat mount"
```

### Task 5.4: `WorkflowMessage` transcript card — failing test

**Files:** Create `src/client/components/messages/WorkflowMessage.test.tsx`, `WorkflowMessage.tsx`. Follow `kanna-react-style`; mirror `SubagentMessage.tsx` if present (`ls src/client/components/messages/ | grep -i subagent`).

- [ ] **Step 1: Failing test** (render the card with a hydrated `workflow` tool call + an optional run summary; assert name + status pill render; assert no render-loop via `renderForLoopCheck`):

```tsx
import { describe, expect, test } from "bun:test"
import { renderForLoopCheck } from "../../lib/testing/renderForLoopCheck"
import { WorkflowMessage } from "./WorkflowMessage"

describe("WorkflowMessage", () => {
  test("renders workflow name + status pill, no render loop", async () => {
    const { container, warnings, cleanup } = await renderForLoopCheck(
      <WorkflowMessage
        name="sonar-fix"
        description="fix sonar"
        run={{ runId: "wf_a", status: "running", phases: [], agents: [], agentCount: 3 }}
      />,
    )
    expect(container.textContent).toContain("sonar-fix")
    expect(container.textContent?.toLowerCase()).toContain("running")
    expect(warnings).toEqual([])
    cleanup()
  })
})
```

> **NOTE for executor:** confirm `renderForLoopCheck`'s actual return shape (`{ container, warnings, cleanup }` vs other) by reading `src/client/lib/testing/renderForLoopCheck.tsx` first; adapt the destructure.

- [ ] **Step 2: Run → FAIL** — `bun test src/client/components/messages/WorkflowMessage.test.tsx`

- [ ] **Step 3: Implement** `WorkflowMessage.tsx`. Props: `{ name?: string; description?: string; run?: WorkflowRunSummary; onOpenPanel?: () => void }`. Render name/description, a status pill (reuse the project's pill primitive — find via `grep -rn "StatusPill\|Badge" src/client/components | head`), and `agentCount`. If `run` absent → "Workflow started…". Project `Tooltip`, not native `title`.

- [ ] **Step 4: Run → PASS**, then **Commit**

```bash
git add src/client/components/messages/WorkflowMessage.tsx src/client/components/messages/WorkflowMessage.test.tsx
git commit -m "feat(client): WorkflowMessage transcript card"
```

### Task 5.5: Dispatch `workflow` toolKind in `ToolCallMessage`

**Files:** Modify `src/client/components/messages/ToolCallMessage.tsx` (branches `:91-133`, icon switch `:178`).

- [ ] **Step 1: Failing test** in `ToolCallMessage.test.tsx`: a `workflow` tool call renders `WorkflowMessage` (assert text only it emits, e.g. the workflow name). Read the existing test for the mount helper first.

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** a branch alongside the others (after `subagent_task` `:129`):

```tsx
    if (message.toolKind === "workflow") {
      const run = selectRuns(chatId)(useWorkflowsStore.getState()).find((r) => r.taskId === message.result?.taskId)
      return <WorkflowMessage name={message.input.name} description={message.input.description} run={run} />
    }
```

> **NOTE for executor:** the `taskId` join needs the result text parsed in `hydrateToolResult`. If wiring the live `run` here is awkward (store access inside the render switch), pass `run` down from the parent that already has chat context, OR use a `useWorkflowsStore(useShallow(selectRuns(chatId)))` hook at the top of the component (NOT inside the render switch — hooks rules). Prefer the hook-at-top approach; match how `subagent_task` obtains its run data (`:129-133`). Add a workflow icon case at `:178`.

- [ ] **Step 4: Run → PASS**, then **Commit**

```bash
git add src/client/components/messages/ToolCallMessage.tsx src/client/components/messages/ToolCallMessage.test.tsx
git commit -m "feat(client): route workflow toolKind to WorkflowMessage"
```

---

# Phase 6 — `/workflows` panel

### Task 6.1: `WorkflowsSection` panel — failing test

**Files:** Create `src/client/app/WorkflowsSection.tsx` + `.test.tsx`. **Read `src/client/app/SubagentsSection.tsx` + `.test.tsx` fully first and mirror its structure** (header, list, per-row expand, empty state, handlers interface).

- [ ] **Step 1: Failing test**: render `<WorkflowsSection runs={…} />`; assert a row per run (name + status + agent count), empty state with `runs: []`, no render-loop warning (`renderForLoopCheck`). Mirror `SubagentsSection.test.tsx`'s mount helper.

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** the panel mirroring `SubagentsSection` (props take `runs: WorkflowRunSummary[]` + an `onSelectRun(runId)` handler for drill-in). Each row: name, status pill, `agentCount`, `totalTokens`, duration, started-at. Apply the **impeccable** skill (project rule 3) — match `SubagentsSection` spacing/pills/Tooltip exactly.

- [ ] **Step 4: Run → PASS**, then **Commit**

```bash
git add src/client/app/WorkflowsSection.tsx src/client/app/WorkflowsSection.test.tsx
git commit -m "feat(client): WorkflowsSection panel"
```

### Task 6.2: Mount the panel + feed it from the store

**Files:** Modify wherever `SubagentsSection` is mounted (`grep -rn "SubagentsSection" src/client/app`).

- [ ] **Step 1:** Mount `<WorkflowsSection runs={useWorkflowsStore(useShallow(selectRuns(chatId)))} … />` next to `SubagentsSection`, gated to render only when `runs.length > 0` (match the subagents panel's disclosure pattern — do not invent new nav). Use `useShallow` per the render-loop rule.
- [ ] **Step 2:** Extend the parent test to assert the panel mounts when runs exist.
- [ ] **Step 3: Run → PASS**, then **Commit**

```bash
git commit -am "feat(client): mount WorkflowsSection in chat view"
```

### Task 6.3: Detail drill-in (heavy fields via `workflows.getRun`)

**Files:** Modify `src/client/app/WorkflowsSection.tsx` (+ a `WorkflowDetailDialog` if cleaner). Use the project Dialog primitive (`grep -rn "Dialog" src/client/components | head`).

- [ ] **Step 1: Failing test**: clicking a run row invokes the `onSelectRun(runId)` handler; given a fetched `WorkflowRun`, the dialog shows the phase → per-agent tree (label, state, model, lastTool, tokens, toolCalls) + `result`/`error`/`summary` for finished runs.

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement.** On select, send the `workflows.getRun` command (mirror how the client sends a `command` envelope + awaits its ack — `grep -rn "type: \"command\"" src/client | head`), render the returned `WorkflowRun` in the dialog. Apply **impeccable**.

- [ ] **Step 4: Run → PASS**, then **Commit**

```bash
git commit -am "feat(client): workflow run detail dialog via getRun"
```

---

# Phase 7 — Verify, lint, docs, C3, PR

### Task 7.1: Full suite + lint

- [ ] **Step 1:** `bun test` (whole suite — required green per CLAUDE.md). Expected: PASS.
- [ ] **Step 2:** `bun run lint` (`--max-warnings=0`). Expected: 0 errors. If warnings dropped, lower the cap in `eslint.config.js` (ratchet rule) in this commit. Any new IO outside `.adapter.ts` → fix per side-effect seal (no `eslint-disable`).
- [ ] **Step 3: Commit** any lint/cap adjustments.

### Task 7.2: Manual smoke (real PTY workflow)

- [ ] **Step 1:** With `KANNA_CLAUDE_DRIVER=pty`, run a chat that launches a `Workflow`. Confirm: (a) the transcript card shows name + a live status pill, (b) the panel lists the run and updates as agents progress, (c) drill-in shows the agent tree, (d) finished run shows result/summary. Confirm the `sessionId` → workflows-dir resolution is correct (Task 3.3 NOTE) — if the panel stays empty, `ls ~/.claude/projects/<encoded-cwd>/` and reconcile the subdir name with what the driver registers.
- [ ] **Step 2:** Document the result; if the dir name differs from `sessionId`, fix Task 3.3's join and re-test.

### Task 7.3: Docs sync

**Files:** `CLAUDE.md` (new "Workflow Status Panel" section).

- [ ] **Step 1:** Write the section: PTY-only disk-watch source, the `wf_*.json` contract + path, the independent read-model (not transcript-fed), read-only scope, the `workflows` topic + `workflows.getRun` command, the new `workflow` toolKind. Note the SDK/closed-chat out-of-scope items.
- [ ] **Step 2: Commit.**

### Task 7.4: C3 change + audit

- [ ] **Step 1:** `/c3 change` to update `.c3/` for the new `workflow-status` component + touched refs (mandatory; code-doc drift blocks PR).
- [ ] **Step 2:** `/c3 audit` to confirm no drift.
- [ ] **Step 3: Commit.**

### Task 7.5: Open PR (fork target)

- [ ] **Step 1:** Push the branch. Open PR targeting the fork:

```bash
gh pr create --repo cuongtranba/kanna --base main --head feat/workflow-status-panel \
  --title "feat: workflow status panel (PTY disk-watch)" \
  --body "<summary + the PTY-no-lifecycle-events finding + test/lint/smoke evidence>"
```

(Never target `jakemor/kanna`. Never merge directly — open PR per global rules.)

---

## Self-Review

**1. Spec coverage:**
- "live status of running workflow" → registry watch + snapshot (2.3/2.4), panel (6.1/6.2), drill-in tree (6.3). ✅
- "list all runs for the chat" → `snapshot` newest-first (2.4), panel list (6.1). ✅
- inline card (B) → tools normalize (4.2) + WorkflowMessage (5.4) + dispatch (5.5). ✅
- disk-watch source / PTY-only / read-only / separate read-model → adapter (2.2) + registry (2.4) + driver register (3.3) + ADR (0.1). ✅
- realtime fs.watch + debounce → adapter (2.2), 250ms default. ✅
- light projection (drop heavy fields) → `toRunSummary` (1.2), heavy via `getRun` (3.2/6.3). ✅
- defensive parse → `parseWorkflowRunFile` (1.2), adapter skips corrupt files (2.2). ✅

**2. Placeholder scan:** The "NOTE for executor" blocks point to concrete existing patterns (sibling `case`, `pty-instances` plumbing, `renderForLoopCheck` shape, `SubagentsSection`) — they resolve real ambiguities about matching existing code, not deferred design. All new types/parser/adapter/registry code is concrete. The one runtime unknown (does the session subdir name equal `sessionId` or `sessionToken`) is explicitly verified in Task 3.3 + 7.2 rather than assumed.

**3. Type consistency:** `WorkflowRun` / `WorkflowRunSummary` / `WorkflowAgentProgress` / `WorkflowAgentSummary` / `WorkflowPhase` / `WorkflowStatus` used consistently across shared types (1.1), registry (2.4), protocol (3.1), store (5.2), panel (6.1). `parseWorkflowRunFile` + `toRunSummary` are the two pure shared functions. `createWorkflowRegistry` / `WorkflowRegistry` / `register` / `unregister` / `snapshot` / `getRun` / `subscribe` names match across registry (2.4), ws-router (3.2), driver (3.3). Topic `"workflows"` + command `"workflows.getRun"` consistent across protocol (3.1), ws-router (3.2), client (5.3/6.3).

## Open risks (confirm at execution)
- **R1 (session subdir name):** Task 3.3 registers `<projectDir>/<sessionId>/workflows`. If CC names the subdir by `sessionToken` (resume uuid) not `sessionId`, the panel is empty. Verified by Task 3.3 NOTE + Task 7.2 smoke. Low effort to fix, high importance.
- **R2 (ws-router broadcast primitive):** Task 3.2 mirrors `pushPtyInstancesEvent` iteration; executor must reuse the file's exact `sendSnapshot`/socket-iteration helper, not invent one. NOTE covers it.
- **R3 (CC format drift):** `wf_*.json` is undocumented; `parseWorkflowRunFile` is the single defensive choke point. New CC versions may add/rename fields — additive parsing tolerates this; a renamed `workflowProgress`/`status` would need a parser update (cheap, one file).
- **R4 (watch dir created late):** `workflows/` doesn't exist until the first `Workflow` call. The adapter no-ops if absent at watch time. If runs never appear until re-subscribe, add a re-arm (watch the parent session dir for the `workflows/` subdir creation) — deferred unless R4 bites in Task 7.2.
