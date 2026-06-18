# Workflow running run realtime detail — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drill-in dialog for a running workflow shows live per-agent state (running / completed, dir, fixed N, test status) parsed from `subagents/workflows/<runId>/journal.jsonl`, and refreshes automatically on each `workflows` topic push without flickering.

**Architecture:** Server `getRun` parses the small live `journal.jsonl` for runs that have no terminal sidecar yet, returning a synthesized `WorkflowRun` with derived `agents[]` + `agentCount`. Client `WorkflowsSectionWithDetail` adds a `useEffect` that re-calls `getRunDetail(runId)` whenever the `runs` prop changes AND the selected run is still `status:"running"`, swapping the detail in-place (no `"loading"` state) so the dialog never flickers. No new WS protocol; reuses the existing `watchRunDirs` watcher from PR #363.

**Tech Stack:** TypeScript, Bun, `node:fs` (in the existing `.adapter.ts` side-effect leaf), React 19, `bun:test`, happy-dom.

**Spec:** `docs/superpowers/specs/2026-06-03-workflow-running-realtime-detail-design.md`

**Branch / worktree:** create a worktree off `origin/main` named `feat/workflow-running-live-detail` before Task 1.

---

## File Structure

**Create:**
- (nothing — extend existing files)

**Modify:**
- `src/server/workflow-watch-io.adapter.ts` — add `WorkflowJournalEntry` type + `readWorkflowRunJournal` function
- `src/server/workflow-watch-io.adapter.test.ts` — adapter tests for journal parse
- `src/server/workflow-registry.ts` — add `readRunJournal?` dep, enrich `getRun` for running runs
- `src/server/workflow-registry.test.ts` — registry tests for enriched `getRun`
- `src/server/server.ts` — wire `readRunJournal: readWorkflowRunJournal`
- `src/client/app/WorkflowsSection.tsx` — add re-fetch effect in `WorkflowsSectionWithDetail`
- `src/client/app/WorkflowsSection.test.tsx` — client tests for re-fetch + no-flash
- `.c3/c3-2-server/c3-229-workflow-status.md` — Contract row for `readWorkflowRunJournal` + getRun behavior update (via `c3x write`, not direct edit)
- `.c3/adr/adr-20260603-workflow-running-realtime-detail.md` — ADR (via `c3x add adr`)

**Why this shape:** keep the journal parse in the existing `.adapter.ts` leaf (only file allowed `node:fs` IO under the side-effect lint seal). Registry stays a pure read-model; client effect reuses the existing `getRunDetail` plumbing.

---

## Task 1: Worktree off `origin/main`

**Files:** none

- [ ] **Step 1: Fetch + create worktree**

```bash
git -C /Users/cuongtran/Desktop/repo/kanna fetch origin main --quiet
git -C /Users/cuongtran/Desktop/repo/kanna worktree add -b feat/workflow-running-live-detail \
  /Users/cuongtran/Desktop/repo/kanna-wt-live-detail origin/main
```

- [ ] **Step 2: Symlink `node_modules`**

```bash
cd /Users/cuongtran/Desktop/repo/kanna-wt-live-detail
[ -L node_modules ] || ln -s /Users/cuongtran/Desktop/repo/kanna/node_modules node_modules
```

Expected: worktree at `kanna-wt-live-detail`, branch `feat/workflow-running-live-detail`, `node_modules` symlinked. Use this worktree for every subsequent task.

---

## Task 2: ADR + c3 Contract update (ADR-first per project rule)

**Files:**
- Create: `.c3/adr/adr-20260603-workflow-running-realtime-detail.md` (via `c3x add adr`)
- Modify: `.c3/c3-2-server/c3-229-workflow-status.md` (via `c3x write`)

- [ ] **Step 1: Author ADR body to a temp file**

Write `/tmp/adr-live-detail.md` with the required ADR sections per `c3x schema adr`. Body:

```markdown
## Goal

Make the workflow drill-in dialog show live per-agent state for a still-running workflow by parsing the small `subagents/workflows/<runId>/journal.jsonl` server-side in `WorkflowRegistry.getRun`, and have the client re-fetch on each `workflows` snapshot push without a loading flash.

## Context

`getRun` already synthesizes a running `WorkflowRun` when no sidecar exists (PR #365) but with `agents:[]` and `agentCount` undefined, so the dialog body is blank. Claude writes per-agent events live to `journal.jsonl` (started + result lines, ~2KB at 10–20 agents); the heavy `agent-*.jsonl` files and the terminal sidecar carry token/toolcall counts and arrive only at termination. The existing `watchRunDirs` from PR #363 already pushes a `workflows` snapshot on each journal/agent write (debounced 250 ms), so a client effect is enough to keep the dialog live.

## Decision

Server: a new adapter `readWorkflowRunJournal(workflowsDir, runId)` returns parsed `WorkflowJournalEntry[]` (defensive: skips blank/unparseable lines, returns `[]` for missing file). `WorkflowRegistry` gains an optional `readRunJournal?` dep; when `getRun` falls into the synthetic-running path it uses the journal to derive `agents` + `agentCount`. Sidecar runs pass through unchanged.

Client: `WorkflowsSectionWithDetail` adds a `useEffect` keyed on the selected `runId` + `runs` prop. When the dialog is open and the matching run in `runs` is `status:"running"`, it calls `getRunDetail` and swaps the result into `selectedRun` WITHOUT setting `"loading"` first. Stop condition is implicit: when the sidecar lands the run flips to a terminal status and the predicate is false.

No new WS topic, no new store. Reuses the existing snapshot push and `workflows.getRun` command.

## Affected Topology

| Entity | Type | Why affected | Governance review |
| --- | --- | --- | --- |
| c3-229 | component | New adapter export + getRun running enrich + Contract rows | Comply with side-effect-adapter, strong-typing, ws-subscription, colocated-bun-test |

## Compliance Refs

| Ref | Why required | Action |
| --- | --- | --- |
| ref-side-effect-adapter | new node:fs read lives in `workflow-watch-io.adapter.ts`, the exempt leaf | comply |
| ref-strong-typing | `WorkflowJournalEntry` is a named type at the adapter↔registry boundary | comply |
| ref-cqrs-read-models | `getRun` enrich stays on the read path; no event emitted | comply |
| ref-ws-subscription | reuses existing `workflows` topic push, no new envelope | comply |
| ref-colocated-bun-test | adapter + registry + client tests colocated next to the file under test | comply |
| ref-provider-adapter | no provider transcript change | N.A - not touched |
| ref-tool-hydration | no tool_use hydration change | N.A - not touched |
| ref-event-sourcing | read-model only, no event path | N.A - read-model |
| ref-zustand-store | no client store change (effect is local to the component) | N.A - no store |

## Compliance Rules

| Rule | Why required | Action |
| --- | --- | --- |
| rule-colocated-bun-test | new behavior in c3-229 gets colocated tests next to each file under test | comply |
| rule-strong-typing | typed adapter signature + journal entry shape | comply |
| rule-zustand-store | no client Zustand store touched | N.A - server-only data + local component effect |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| Adapter | `WorkflowJournalEntry` type + `readWorkflowRunJournal(workflowsDir, runId)` | `src/server/workflow-watch-io.adapter.ts` |
| Registry | optional `readRunJournal?` dep; `getRun` enriches the synthetic running run with `agents[]` + `agentCount` derived from the journal | `src/server/workflow-registry.ts` |
| Wiring | `createWorkflowRegistry({ readRunJournal: readWorkflowRunJournal, ... })` | `src/server/server.ts` |
| Client | `WorkflowsSectionWithDetail` useEffect re-fetches `getRunDetail` on `runs` change while selected run is running; no `"loading"` swap | `src/client/app/WorkflowsSection.tsx` |
| Tests | adapter parse/skip/empty; registry getRun running-enrich + sidecar-wins + legacy fallback; client re-fetch + no-flash + stop-at-terminal + render-loop check | adapter.test, registry.test, WorkflowsSection.test |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| N.A - no C3 CLI underlay touched | runtime + read-model + client effect only | `c3x check` passes |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| `workflow-watch-io.adapter.test.ts` | Fails if journal parse mishandles started/result/blank/unparseable lines | `bun test` |
| `workflow-registry.test.ts` | Fails if getRun does not enrich running, or sidecar does not win, or dep absent regresses | `bun test` |
| `WorkflowsSection.test.tsx` | Fails if re-fetch does not fire on snapshot push, or sets "loading" mid-run, or keeps fetching past terminal | `bun test` |
| `bun run lint` | Fails on side-effect-seal or any-type violations | CI |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| New WS sub-topic pushing only the selected run's detail | More moving parts (envelope, store, subscription lifecycle) for the same effect the existing `workflows` push already triggers. |
| Parse agent-*.jsonl for live token/toolcall counts | Heavy (MB per agent, 10–40 agents per run); UI guards `!= null` and the sidecar fills these at termination — out of scope here. |
| Server-side stream of journal events | Couples the read-model to a write-path stream; the `watchRunDirs` push + lazy parse on `getRun` is enough. |
| Client polling on a timer | Burns bandwidth and lags vs the existing 250 ms debounced push. |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Re-fetch loop (snapshot push triggers re-fetch triggers …) | `getRun` is a read command and does not fire the watcher; pushes are bounded by Claude's per-agent file-write cadence | client test asserts bounded fetch count per push |
| Out-of-order re-fetch responses | useEffect cleanup discards stale promise resolutions | client test races two responses |
| Partial-write tail in journal.jsonl | Adapter skips unparseable lines; next write re-fires the watch | adapter test covers blank/unparseable rows |
| Token/toolcall still missing live | Out of scope; UI already guards missing fields, sidecar fills them on terminate | n/a |

## Verification

| Check | Result |
| --- | --- |
| `bun test src/server/workflow-watch-io.adapter.test.ts src/server/workflow-registry.test.ts src/client/app/WorkflowsSection.test.tsx` | all pass |
| `bun run lint` | 0 errors |
| `c3x check` | structural PASS |
```

- [ ] **Step 2: Create ADR**

```bash
cd /Users/cuongtran/Desktop/repo/kanna-wt-live-detail
SK=/Users/cuongtran/.claude/plugins/marketplaces/c3-skill-marketplace/skills/c3
C3X_MODE=agent bash $SK/bin/c3x.sh add adr workflow-running-realtime-detail --file /tmp/adr-live-detail.md
```

Expected: `id: adr-20260603-workflow-running-realtime-detail` printed.

- [ ] **Step 3: Update c3-229 Contract to include `readWorkflowRunJournal` row**

Write `/tmp/c3-229-contract-live.md` with the full Contract table from main plus this new row near the adapter rows:

```
| readWorkflowRunJournal(workflowsDir, runId) | OUT | Adapter: parse subagents/workflows/<runId>/journal.jsonl into WorkflowJournalEntry[] (defensive; [] when missing/unreadable); the live per-agent signal getRun uses to enrich a running run | c3-208 | src/server/workflow-watch-io.adapter.ts |
```

Also update the existing `WorkflowRegistry.getRun(...)` row Contract column to add a clause: "Running runs (no sidecar yet) are enriched from `readRunJournal` (when wired): agents[] + agentCount derived from the live journal."

Apply:

```bash
C3X_MODE=agent bash $SK/bin/c3x.sh write c3-229 --section "Contract" --file /tmp/c3-229-contract-live.md
```

- [ ] **Step 4: Transition ADR to accepted**

```bash
C3X_MODE=agent bash $SK/bin/c3x.sh set adr-20260603-workflow-running-realtime-detail status accepted
```

- [ ] **Step 5: Verify c3 check passes**

```bash
C3X_MODE=agent bash $SK/bin/c3x.sh check
C3X_MODE=agent bash $SK/bin/c3x.sh check --include-adr --only adr-20260603-workflow-running-realtime-detail
```

Expected: both report `issues:` empty.

If a warning appears for a missing compliance ref (cited by c3-229 but not present in the ADR table), edit `/tmp/adr-live-detail.md` to add the missing row (as `N.A - <reason>` if not applicable), then `c3x write adr-... --section "Compliance Refs" --file /tmp/refs.md` and re-check.

- [ ] **Step 6: Commit ADR + Contract**

```bash
git add .c3/adr/adr-20260603-workflow-running-realtime-detail.md .c3/c3-2-server/c3-229-workflow-status.md
git commit -m "docs(c3): ADR for workflow running realtime detail + c3-229 Contract"
```

---

## Task 3: Adapter — `WorkflowJournalEntry` + `readWorkflowRunJournal` (TDD)

**Files:**
- Modify: `src/server/workflow-watch-io.adapter.ts`
- Test: `src/server/workflow-watch-io.adapter.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/server/workflow-watch-io.adapter.test.ts` (above the closing `})` of the `describe`):

```ts
describe("readWorkflowRunJournal", () => {
  test("parses started + result lines for a runId", () => {
    const session = tmp()
    const liveRoot = join(session, "subagents", "workflows")
    const runDir = join(liveRoot, "wf_a")
    mkdirSync(runDir, { recursive: true })
    writeFileSync(
      join(runDir, "journal.jsonl"),
      [
        JSON.stringify({ type: "started", agentId: "a1", key: "v2:x" }),
        JSON.stringify({
          type: "result",
          agentId: "a1",
          key: "v2:x",
          result: { dir: "/repo/pkg/x", fixed: 3, test_status: "pass", summary: "ok" },
        }),
      ].join("\n") + "\n",
    )

    const entries = readWorkflowRunJournal(join(session, "workflows"), "wf_a")
    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({ type: "started", agentId: "a1" })
    expect(entries[1]).toMatchObject({ type: "result", agentId: "a1" })
    expect(entries[1].result).toMatchObject({ dir: "/repo/pkg/x", fixed: 3, test_status: "pass" })
  })

  test("skips blank + unparseable lines; returns [] for missing file", () => {
    const session = tmp()
    const liveRoot = join(session, "subagents", "workflows")
    const runDir = join(liveRoot, "wf_b")
    mkdirSync(runDir, { recursive: true })
    writeFileSync(
      join(runDir, "journal.jsonl"),
      [
        "",
        "{not json",
        JSON.stringify({ type: "started", agentId: "b1" }),
        JSON.stringify({ type: "unrelated", agentId: "x" }), // wrong type, dropped
      ].join("\n") + "\n",
    )

    const entries = readWorkflowRunJournal(join(session, "workflows"), "wf_b")
    expect(entries.map((e) => e.agentId)).toEqual(["b1"])

    expect(readWorkflowRunJournal(join(session, "workflows"), "wf_missing")).toEqual([])
  })
})
```

The top of the file already imports `mkdtempSync, writeFileSync, mkdirSync` and `tmp()`. Add `readWorkflowRunJournal` to the import line at the top:

```ts
import { listWorkflowRunDirs, readWorkflowDir, readWorkflowRunJournal, watchWorkflowDir } from "./workflow-watch-io.adapter"
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/cuongtran/Desktop/repo/kanna-wt-live-detail
bun test src/server/workflow-watch-io.adapter.test.ts 2>&1 | tail -6
```

Expected: 2 new fails, "readWorkflowRunJournal is not defined" or similar.

- [ ] **Step 3: Implement the adapter function**

Add to `src/server/workflow-watch-io.adapter.ts` (below `listWorkflowRunDirs`):

```ts
export interface WorkflowJournalEntry {
  type: "started" | "result"
  agentId: string
  key?: string
  result?: {
    dir?: string
    fixed?: number
    test_status?: string
    summary?: string
  }
}

const KNOWN_KINDS: ReadonlySet<string> = new Set(["started", "result"])

function parseJournalLine(line: string): WorkflowJournalEntry | null {
  if (!line) return null
  let raw: unknown
  try { raw = JSON.parse(line) } catch { return null }
  if (!raw || typeof raw !== "object") return null
  const r = raw as Record<string, unknown>
  const type = r.type
  const agentId = r.agentId
  if (typeof type !== "string" || !KNOWN_KINDS.has(type)) return null
  if (typeof agentId !== "string") return null
  const out: WorkflowJournalEntry = { type: type as "started" | "result", agentId }
  if (typeof r.key === "string") out.key = r.key
  if (r.result && typeof r.result === "object" && !Array.isArray(r.result)) {
    const rr = r.result as Record<string, unknown>
    const res: WorkflowJournalEntry["result"] = {}
    if (typeof rr.dir === "string") res.dir = rr.dir
    if (typeof rr.fixed === "number") res.fixed = rr.fixed
    if (typeof rr.test_status === "string") res.test_status = rr.test_status
    if (typeof rr.summary === "string") res.summary = rr.summary
    out.result = res
  }
  return out
}

export function readWorkflowRunJournal(workflowsDir: string, runId: string): WorkflowJournalEntry[] {
  const path = join(liveRunRoot(workflowsDir), runId, "journal.jsonl")
  if (!existsSync(path)) return []
  let text: string
  try { text = readFileSync(path, "utf8") } catch { return [] }
  const out: WorkflowJournalEntry[] = []
  for (const line of text.split("\n")) {
    const entry = parseJournalLine(line)
    if (entry) out.push(entry)
  }
  return out
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test src/server/workflow-watch-io.adapter.test.ts 2>&1 | tail -3
```

Expected: all 2 new tests pass; total adapter tests up by 2 vs main.

- [ ] **Step 5: Lint**

```bash
bun run eslint src/server/workflow-watch-io.adapter.ts src/server/workflow-watch-io.adapter.test.ts --max-warnings=0
```

Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/server/workflow-watch-io.adapter.ts src/server/workflow-watch-io.adapter.test.ts
git commit -m "feat(workflow-adapter): readWorkflowRunJournal parses live per-agent events"
```

---

## Task 4: Registry — enrich `getRun` for running runs (TDD)

**Files:**
- Modify: `src/server/workflow-registry.ts`
- Test: `src/server/workflow-registry.test.ts`

- [ ] **Step 1: Write the failing tests**

In `src/server/workflow-registry.test.ts`, inside the existing `describe("snapshot surfaces in-flight runs (no sidecar yet)", ...)` block, ABOVE the existing `getRun returns a synthetic running run...` test, add:

```ts
test("getRun running enrich: derives agents + agentCount from the journal", () => {
  const io = fakeIo(new Map([["/d", []]]))
  const journal: import("./workflow-watch-io.adapter").WorkflowJournalEntry[] = [
    { type: "started", agentId: "a1" },
    { type: "started", agentId: "a2" },
    { type: "result", agentId: "a1", result: { dir: "/repo/pkg/x", fixed: 3, test_status: "pass" } },
  ]
  const reg = createWorkflowRegistry({
    read: io.read, watch: io.watch,
    listRunDirs: () => [{ runId: "wf_live", newestMtimeMs: Date.now() }],
    readRunJournal: () => journal,
  })
  reg.register("chat1", "/d")
  const run = reg.getRun("chat1", "wf_live")
  expect(run?.status).toBe("running")
  expect(run?.agentCount).toBe(2)
  expect(run?.agents).toHaveLength(2)
  expect(run?.agents[0]).toMatchObject({ agentId: "a1", state: "completed", label: "x" })
  expect(run?.agents[0].lastToolSummary).toBe("fixed 3, test:pass")
  expect(run?.agents[1]).toMatchObject({ agentId: "a2", state: "running", label: "agent" })
})

test("getRun: legacy/no-readRunJournal dep still works (agents:[] for running)", () => {
  const io = fakeIo(new Map([["/d", []]]))
  const reg = createWorkflowRegistry({
    read: io.read, watch: io.watch,
    listRunDirs: () => [{ runId: "wf_live", newestMtimeMs: Date.now() }],
  })
  reg.register("chat1", "/d")
  const run = reg.getRun("chat1", "wf_live")
  expect(run?.status).toBe("running")
  expect(run?.agents).toEqual([])
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test src/server/workflow-registry.test.ts 2>&1 | tail -4
```

Expected: 2 new fails, complaining about `agentCount` undefined / `agents.length === 0`.

- [ ] **Step 3: Implement the registry enrich**

Modify `src/server/workflow-registry.ts`. Replace the imports + interface + helpers + `getRun` block as follows.

Top of file — extend imports:

```ts
import type { WorkflowJournalEntry, WorkflowRawFile, WorkflowRunDirInfo } from "./workflow-watch-io.adapter"
```

Extend `WorkflowRegistryDeps`:

```ts
export interface WorkflowRegistryDeps {
  read: (dir: string) => WorkflowRawFile[]
  watch: (dir: string, onChange: () => void) => () => void
  listRunDirs?: (workflowsDir: string) => WorkflowRunDirInfo[]
  watchRunDirs?: (workflowsDir: string, onChange: () => void) => () => void
  /**
   * Read the live `journal.jsonl` for a running run. Used by `getRun` to
   * derive per-agent state for a synthesized running `WorkflowRun`. Absent in
   * legacy callers (running run keeps `agents:[]`, preserving prior behavior).
   */
  readRunJournal?: (workflowsDir: string, runId: string) => WorkflowJournalEntry[]
}
```

Add a helper above `createWorkflowRegistry`:

```ts
function basenameAfterSlash(p: string | undefined): string | undefined {
  if (!p) return undefined
  const i = p.lastIndexOf("/")
  return i < 0 ? p : p.slice(i + 1) || undefined
}

function buildAgentsFromJournal(entries: import("./workflow-watch-io.adapter").WorkflowJournalEntry[]): import("../shared/workflow-types").WorkflowAgentProgress[] {
  const out = new Map<string, import("../shared/workflow-types").WorkflowAgentProgress>()
  for (const e of entries) {
    if (!out.has(e.agentId)) {
      out.set(e.agentId, { index: out.size + 1, label: "agent", agentId: e.agentId, state: "running" })
    }
    if (e.type === "result") {
      const cur = out.get(e.agentId)
      if (!cur) continue
      cur.state = "completed"
      const dirBase = basenameAfterSlash(e.result?.dir)
      if (dirBase) cur.label = dirBase
      const parts: string[] = []
      if (typeof e.result?.fixed === "number") parts.push(`fixed ${e.result.fixed}`)
      if (e.result?.test_status) parts.push(`test:${e.result.test_status}`)
      if (parts.length > 0) cur.lastToolSummary = parts.join(", ")
    }
  }
  return [...out.values()]
}
```

Replace the `getRun` body with:

```ts
getRun(chatId, runId) {
  const entry = entries.get(chatId)
  if (!entry) return null
  const sidecar = entry.runs.get(runId)
  if (sidecar) return sidecar
  // Synthesize a running run from the live dir, enriched from the journal.
  if (deps.listRunDirs) {
    const floor = Date.now() - SNAPSHOT_LIVE_WINDOW_MS
    const live = deps.listRunDirs(entry.dir).find((r) => r.runId === runId && r.newestMtimeMs >= floor)
    if (live) {
      const base = synthRunningRun(runId, live.newestMtimeMs)
      if (deps.readRunJournal) {
        const agents = buildAgentsFromJournal(deps.readRunJournal(entry.dir, runId))
        return { ...base, agentCount: agents.length, agents }
      }
      return base
    }
  }
  return null
},
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test src/server/workflow-registry.test.ts 2>&1 | tail -3
```

Expected: full registry suite passes (15 prior + 2 new = 17).

- [ ] **Step 5: Lint**

```bash
bun run eslint src/server/workflow-registry.ts src/server/workflow-registry.test.ts --max-warnings=0
```

Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/server/workflow-registry.ts src/server/workflow-registry.test.ts
git commit -m "feat(workflow-registry): enrich running getRun with live agents from journal"
```

---

## Task 5: Wire `readRunJournal` in `server.ts`

**Files:**
- Modify: `src/server/server.ts`

- [ ] **Step 1: Update the import**

Find the line `import { listWorkflowRunDirs, readWorkflowDir, watchWorkflowDir, watchWorkflowRunDirs } from "./workflow-watch-io.adapter"` and add `readWorkflowRunJournal`:

```ts
import { listWorkflowRunDirs, readWorkflowDir, readWorkflowRunJournal, watchWorkflowDir, watchWorkflowRunDirs } from "./workflow-watch-io.adapter"
```

- [ ] **Step 2: Wire the dep**

Update the `createWorkflowRegistry` call:

```ts
const workflowRegistry = createWorkflowRegistry({
  read: readWorkflowDir,
  watch: (dir, onChange) => watchWorkflowDir(dir, onChange),
  listRunDirs: listWorkflowRunDirs,
  watchRunDirs: (dir, onChange) => watchWorkflowRunDirs(dir, onChange),
  readRunJournal: readWorkflowRunJournal,
})
```

- [ ] **Step 3: Lint**

```bash
bun run eslint src/server/server.ts --max-warnings=0
```

Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/server/server.ts
git commit -m "feat(server): wire readWorkflowRunJournal into WorkflowRegistry"
```

---

## Task 6: Client — re-fetch on snapshot push without flash (TDD)

**Files:**
- Modify: `src/client/app/WorkflowsSection.tsx`
- Test: `src/client/app/WorkflowsSection.test.tsx`

- [ ] **Step 1: Add the failing client tests**

Append to `src/client/app/WorkflowsSection.test.tsx` (above the closing `})` of the outermost `describe`):

```ts
async function mountWithDetail(props: {
  runs: WorkflowRunSummary[]
  getRunDetail: (runId: string) => Promise<WorkflowRun | null>
}): Promise<{ container: HTMLDivElement; rerender: (next: WorkflowRunSummary[]) => Promise<void>; cleanup: () => void }> {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(<WorkflowsSectionWithDetail runs={props.runs} getRunDetail={props.getRunDetail} />)
  })
  const rerender = async (next: WorkflowRunSummary[]) => {
    await act(async () => {
      root.render(<WorkflowsSectionWithDetail runs={next} getRunDetail={props.getRunDetail} />)
    })
  }
  return { container, rerender, cleanup: () => container.remove() }
}

function makeFullRun(over: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    runId: "run-1", workflowName: "wf", status: "running", startTime: 1, phases: [], agents: [], ...over,
  }
}

describe("WorkflowsSectionWithDetail re-fetch on snapshot push", () => {
  test("running row: snapshot push triggers a re-fetch and swaps detail without flashing 'loading'", async () => {
    const runRow = makeRun({ runId: "run-1", status: "running" })
    const detailV1 = makeFullRun({ agentCount: 2, agents: [{ index: 1, label: "a", agentId: "a1", state: "running" }] })
    const detailV2 = makeFullRun({ agentCount: 3, agents: [
      { index: 1, label: "a", agentId: "a1", state: "completed" },
      { index: 2, label: "b", agentId: "a2", state: "running" },
      { index: 3, label: "c", agentId: "a3", state: "running" },
    ] })
    const calls: string[] = []
    let n = 0
    const getRunDetail = mock(async (runId: string) => { calls.push(runId); return n++ === 0 ? detailV1 : detailV2 })

    const { container, rerender, cleanup } = await mountWithDetail({ runs: [runRow], getRunDetail })

    // Open dialog
    const btn = container.querySelector<HTMLButtonElement>(`[data-testid="workflow-row:run-1"]`)!
    await act(async () => { btn.click() })
    // initial fetch happened; v1 rendered
    expect(calls).toEqual(["run-1"])
    expect(document.body.textContent ?? "").toContain("a1")

    // Snapshot push (runs prop new reference, same status)
    await rerender([{ ...runRow }])
    expect(calls).toEqual(["run-1", "run-1"])
    // v2 visible (a2/a3 present); never showed "loading" placeholder text from `selectedRun === "loading"`
    expect(document.body.textContent ?? "").toContain("a3")

    cleanup()
  })

  test("terminal sidecar arriving stops further fetches", async () => {
    const runRow = makeRun({ runId: "run-1", status: "running" })
    const detail = makeFullRun({ agentCount: 1, agents: [{ index: 1, label: "a", agentId: "a1", state: "running" }] })
    const calls: string[] = []
    const getRunDetail = mock(async (runId: string) => { calls.push(runId); return detail })

    const { container, rerender, cleanup } = await mountWithDetail({ runs: [runRow], getRunDetail })
    const btn = container.querySelector<HTMLButtonElement>(`[data-testid="workflow-row:run-1"]`)!
    await act(async () => { btn.click() })
    expect(calls).toHaveLength(1)

    // sidecar landed -> status flips terminal -> no more fetches on next push
    await rerender([{ ...runRow, status: "completed" }])
    expect(calls).toHaveLength(1)
    await rerender([{ ...runRow, status: "completed" }])
    expect(calls).toHaveLength(1)

    cleanup()
  })

  test("no React error #185 across many pushes (renderForLoopCheck)", async () => {
    const runRow = makeRun({ runId: "run-1", status: "running" })
    const detail = makeFullRun({ agents: [] })
    const getRunDetail = mock(async () => detail)
    const result = await renderForLoopCheck(<WorkflowsSectionWithDetail runs={[runRow]} getRunDetail={getRunDetail} />)
    expect(result.loopWarnings).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test src/client/app/WorkflowsSection.test.tsx 2>&1 | tail -6
```

Expected: 2-3 new fails (no re-fetch on push; or "loading" flashes; or fetches keep firing after terminal).

- [ ] **Step 3: Implement the client effect**

In `src/client/app/WorkflowsSection.tsx`, modify `WorkflowsSectionWithDetail`. Replace its body with:

```tsx
export function WorkflowsSectionWithDetail({ runs, getRunDetail }: WorkflowsSectionWithDetailProps) {
  const [selectedRun, setSelectedRun] = useState<WorkflowRun | null | "loading">(null)
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const isOpen = selectedRun !== null

  const handleSelectRun = useCallback(async (runId: string) => {
    setSelectedRunId(runId)
    setSelectedRun("loading")
    const detail = await getRunDetail(runId)
    setSelectedRun(detail)
  }, [getRunDetail])

  const handleClose = useCallback(() => {
    setSelectedRunId(null)
    setSelectedRun(null)
  }, [])

  // Re-fetch the selected run's detail in-place (no "loading" swap) whenever
  // the snapshot push delivers a new `runs` reference AND the selected run is
  // still running. Stops naturally once the sidecar lands (status flips).
  useEffect(() => {
    if (selectedRunId === null) return
    const row = runs.find((r) => r.runId === selectedRunId)
    if (!row || row.status !== "running") return
    let stale = false
    void getRunDetail(selectedRunId).then((detail) => {
      if (stale) return
      // Only swap in successful detail; preserve previous render on null.
      if (detail) setSelectedRun(detail)
    })
    return () => { stale = true }
  }, [runs, selectedRunId, getRunDetail])

  return (
    <>
      <WorkflowsSection
        runs={runs}
        onSelectRun={(runId) => { void handleSelectRun(runId) }}
      />
      <WorkflowRunDetailDialog
        run={selectedRun === "loading" ? null : selectedRun}
        open={isOpen}
        onClose={handleClose}
      />
    </>
  )
}
```

Imports at the top of the file should already include `useState` and `useCallback`; ensure `useEffect` is also imported from `react`.

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test src/client/app/WorkflowsSection.test.tsx 2>&1 | tail -4
```

Expected: all client tests pass.

- [ ] **Step 5: Lint**

```bash
bun run eslint src/client/app/WorkflowsSection.tsx src/client/app/WorkflowsSection.test.tsx --max-warnings=0
```

Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/client/app/WorkflowsSection.tsx src/client/app/WorkflowsSection.test.tsx
git commit -m "feat(workflow-panel): re-fetch running run detail on snapshot push without flash"
```

---

## Task 7: Mark ADR implemented + final verify

**Files:** none modified at this step.

- [ ] **Step 1: Mark ADR implemented**

```bash
cd /Users/cuongtran/Desktop/repo/kanna-wt-live-detail
SK=/Users/cuongtran/.claude/plugins/marketplaces/c3-skill-marketplace/skills/c3
C3X_MODE=agent bash $SK/bin/c3x.sh set adr-20260603-workflow-running-realtime-detail status implemented
```

- [ ] **Step 2: Targeted tests**

```bash
bun test src/server/workflow-watch-io.adapter.test.ts src/server/workflow-registry.test.ts src/client/app/WorkflowsSection.test.tsx 2>&1 | grep -E "pass|fail|Ran" | tail -4
```

Expected: all pass, total = prior baseline + new tests from Tasks 3, 4, 6.

- [ ] **Step 3: Lint changed files**

```bash
bun run eslint src/server/workflow-watch-io.adapter.ts src/server/workflow-registry.ts src/server/server.ts src/client/app/WorkflowsSection.tsx --max-warnings=0
```

Expected: exit 0.

- [ ] **Step 4: c3 check**

```bash
C3X_MODE=agent bash $SK/bin/c3x.sh check
C3X_MODE=agent bash $SK/bin/c3x.sh check --include-adr --only adr-20260603-workflow-running-realtime-detail
```

Expected: both report empty `issues:`.

- [ ] **Step 5: Commit the ADR status flip if c3.db tracked it (usually no-op since c3.db is gitignored)**

```bash
git status --porcelain | grep -v node_modules
```

If `.c3/adr/adr-20260603-workflow-running-realtime-detail.md` is modified, commit:

```bash
git add .c3/adr/adr-20260603-workflow-running-realtime-detail.md
git commit -m "docs(c3): mark workflow-running-realtime-detail ADR implemented"
```

---

## Task 8: PR + CI watch + merge

**Files:** none.

- [ ] **Step 1: Push branch**

```bash
cd /Users/cuongtran/Desktop/repo/kanna-wt-live-detail
git push -u origin feat/workflow-running-live-detail
```

- [ ] **Step 2: Create PR**

```bash
gh pr create --repo cuongtranba/kanna --base main --head feat/workflow-running-live-detail \
  --title "feat(workflow): live per-agent detail for running runs (journal.jsonl)" \
  --body "$(cat <<'EOF'
## What

A running workflow's drill-in dialog now shows live per-agent state (running / completed, dir basename, fixed N, test status) instead of an empty body. The data comes from the small live `subagents/workflows/<runId>/journal.jsonl` file Claude appends to from second one of the run. The dialog re-fetches the detail on each `workflows` snapshot push without flashing a "loading" state, and stops on its own when the terminal sidecar lands.

## How

- Adapter: `readWorkflowRunJournal(workflowsDir, runId)` parses the journal defensively (skip blanks / unparseable lines, `[]` for missing file).
- Registry: optional `readRunJournal?` dep; `getRun` for a running run derives `agents[]` + `agentCount` from the journal. Sidecar runs are unchanged.
- Server: wires `readRunJournal: readWorkflowRunJournal`.
- Client: `WorkflowsSectionWithDetail` adds a `useEffect` that re-fetches `getRunDetail` on `runs` change while the selected row is `status:"running"`, swapping the detail in-place (no "loading" flash). Cleanup discards stale responses. Stops when the sidecar lands and the row flips terminal.

No new WS protocol; reuses the existing `workflows` topic push and `watchRunDirs` from PR #363.

## Tests

`bun test` for the three affected files passes. `eslint` clean. `c3x check` structural + ADR clean.

## Docs

ADR `adr-20260603-workflow-running-realtime-detail`. c3-229 Contract gains `readWorkflowRunJournal` row + getRun row updated.
EOF
)"
```

- [ ] **Step 3: Watch CI**

```bash
gh pr checks $(gh pr view feat/workflow-running-live-detail --repo cuongtranba/kanna --json number -q .number) --repo cuongtranba/kanna --watch --interval 15
```

Expected: `test pass`.

- [ ] **Step 4: Merge squash + delete branch**

```bash
PR=$(gh pr view feat/workflow-running-live-detail --repo cuongtranba/kanna --json number -q .number)
gh pr merge "$PR" --repo cuongtranba/kanna --squash --delete-branch
```

- [ ] **Step 5: Verify on main**

```bash
cd /Users/cuongtran/Desktop/repo/kanna
git fetch origin main --quiet
git log --oneline origin/main -2 | cat
git show origin/main:src/server/workflow-watch-io.adapter.ts | grep -c readWorkflowRunJournal
git show origin/main:src/server/workflow-registry.ts | grep -c readRunJournal
```

Expected: top commit is the squash; both grep counts ≥ 1.

- [ ] **Step 6: Worktree cleanup (only after merge)**

```bash
git worktree remove /Users/cuongtran/Desktop/repo/kanna-wt-live-detail
```

---

## Definition of done

- All tasks above complete and committed.
- ADR `adr-20260603-workflow-running-realtime-detail` status `implemented`; c3-229 Contract has `readWorkflowRunJournal` row and getRun row mentions the enrich.
- PR merged to `main`; CI green.
- Manual smoke (post-deploy): open the dialog on a running row — see "X agents" and a per-agent list with state + dir; observe the list grow / agents transition to completed without the dialog closing.
