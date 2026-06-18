# Workflow Integration (Full /workflows) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface Claude Code's native `Workflow` tool (dynamic multi-agent orchestration) as a first-class, persisted domain in Kanna — a labeled tool card, live phase/progress, workflow-spawned subagent placement, and a dedicated `/workflows` panel + detail dialog — across both PTY and SDK drivers.

**Architecture:** Approach C (first-class workflow domain). New shared types + transcript-entry kinds for the workflow lifecycle (`task_started` / `task_updated` / `tool_progress`), parsed identically by both drivers (PTY `jsonl-to-event.ts`, SDK `normalizeClaudeStreamMessage`), folded into a `WorkflowRun` read-model aggregate, rendered by a new `WorkflowMessage` transcript card and a `WorkflowsSection` panel that mirrors the existing `SubagentsSection`.

**Tech Stack:** TypeScript, Bun test, React 19, Zustand stores, the Claude Agent SDK (`@anthropic-ai/claude-agent-sdk` 0.2.140), Claude CLI ant build 2.1.159 (PTY).

---

## Hard Constraint (document, do not try to "fix")

`Workflow` is an **Anthropic-internal, build-flag-gated tool** (`WORKFLOW_SCRIPTS`). It is DCE-stripped from public `claude` CLI and public Agent SDK. It only appears when the spawned binary is an **ant build**. The user's local `claude` 2.1.159 IS an ant build, so PTY works today. **SDK parity depends on the SDK package's bundled CLI also being an ant build — Task 2.1 verifies this at impl time; if it is public, the SDK path degrades gracefully (tool simply never emits) and that is expected, not a bug.** Every user-facing surface must treat "no workflow events" as normal.

## Confirmed File Map (refs verified 2026-06-01)

| Concern | File | Anchor |
|---|---|---|
| Tool normalization (`toolKind`) | `src/shared/tools.ts` | `normalizeToolCall` switch ends ~`:226`; `hydrateToolResult` switch `:340` |
| Tool/entry types | `src/shared/types.ts` | `NormalizedToolCall` union `:962`; `TranscriptEntry` union `:1250`; `ToolCallBase` `:885` |
| SDK driver toolset | `src/server/agent.ts` | `CLAUDE_TOOLSET` `:111`; `tools:[...CLAUDE_TOOLSET]` `:989`; `normalizeClaudeStreamMessage` `:528` |
| PTY parser | `src/server/claude-pty/jsonl-to-event.ts` | system-subtype handling `:224-231` |
| SDK workflow event shapes | `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` | `SDKTaskStartedMessage` `:3591`, `SDKTaskUpdatedMessage` `:3612`, `SDKToolProgressMessage` `:3631` |
| Read-model projections | `src/server/read-models.ts` | 365 lines; `deriveSidebarData` `:72` is the pattern to mirror |
| Subagent panel (mirror) | `src/client/app/SubagentsSection.tsx` | 662 lines |
| Subagent run placement (mirror) | `src/client/app/subagent-run-placement.ts` | 89 lines |
| Transcript renderer dispatch | `src/client/components/messages/ToolCallMessage.tsx` | `toolKind` branches `:91-133`, icon switch `:177` |

## Workflow Event Model (from SDK `.d.ts`)

- `system/task_started`: `{ task_id, tool_use_id?, description, task_type?, workflow_name?, prompt?, skip_transcript?, session_id }`. The workflow root has `task_type === "local_workflow"` and `workflow_name` set (`meta.name`). Child `agent()` spawns arrive as further `task_started` with a `tool_use_id` linking to a parent.
- `system/task_updated`: `{ task_id, patch: { status?: "pending"|"running"|"completed"|"failed"|"killed", description?, end_time?, total_paused_ms?, error?, is_backgrounded? } }`.
- `tool_progress` (top-level `type`): `{ tool_use_id, tool_name, parent_tool_use_id, elapsed_time_seconds, task_id? }`.
- `skip_transcript: true` ⇒ ambient/housekeeping task: hide from inline transcript, may still show in the panel.

---

## File Structure (new + modified)

**New files:**
- `src/shared/workflow.ts` — pure types + `foldWorkflowRuns()` aggregator (no IO).
- `src/shared/workflow.test.ts` — aggregator unit tests.
- `src/client/components/messages/WorkflowMessage.tsx` — inline transcript card for the `workflow` tool call + live phase/task tree.
- `src/client/components/messages/WorkflowMessage.test.tsx`
- `src/client/app/WorkflowsSection.tsx` — dedicated `/workflows` panel (mirrors `SubagentsSection`).
- `src/client/app/WorkflowsSection.test.tsx`
- `src/client/app/workflow-run-placement.ts` — places workflow child tasks under their `Workflow` tool call (mirrors `subagent-run-placement`).
- `src/client/app/workflow-run-placement.test.ts`
- `.c3/components/workflow-orchestration/` — C3 component doc + refs.
- `docs/adr/NNNN-workflow-integration.md` — ADR.

**Modified:**
- `src/shared/types.ts` — add `WorkflowToolCall` to `NormalizedToolCall`; add workflow transcript entries to `TranscriptEntry`.
- `src/shared/tools.ts` — `normalizeToolCall` `Workflow` case; `hydrateToolResult` `workflow` case.
- `src/server/agent.ts` — add `"Workflow"` + `"WorkflowOutput"` to `CLAUDE_TOOLSET`; parse `task_started`/`task_updated`/`tool_progress` in `normalizeClaudeStreamMessage`.
- `src/server/claude-pty/jsonl-to-event.ts` — parse the same three message shapes.
- `src/server/read-models.ts` — `deriveWorkflowRuns()` projection.
- `src/client/components/messages/ToolCallMessage.tsx` — dispatch `workflow` toolKind to `WorkflowMessage`; icon case.
- `CLAUDE.md` + `wiki/**` — document the ant-build constraint + the new panel.

---

# Phase 0 — ADR + C3 ref (no code yet)

### Task 0.1: Write the ADR

**Files:**
- Create: `docs/adr/0001-workflow-integration.md` (use the next free ADR number; check `ls docs/adr/` first)

- [ ] **Step 1: Write the ADR** capturing: (a) decision = first-class workflow domain (Approach C), (b) the ant-build hard constraint, (c) PTY-already-works / SDK-needs-allowlist split, (d) reuse of transcript-entry + read-model patterns rather than a parallel store, (e) graceful no-op when the binary is public.

- [ ] **Step 2: Commit**

```bash
git add docs/adr/0001-workflow-integration.md
git commit -m "docs(adr): workflow integration as first-class domain"
```

### Task 0.2: Seed the C3 component

- [ ] **Step 1:** Run `/c3 query workflow orchestration` to load nearest-component context, then `/c3 ref` to scaffold a `workflow-orchestration` component doc listing the files in the File Map above. (C3 is mandatory per project CLAUDE.md; the final `/c3 change` runs in Phase 6.)

- [ ] **Step 2: Commit**

```bash
git add .c3/
git commit -m "docs(c3): seed workflow-orchestration component"
```

---

# Phase 1 — Shared types + pure aggregator (TDD)

### Task 1.1: Add the `workflow` toolKind type

**Files:**
- Modify: `src/shared/types.ts:930` (insert after `SubagentTaskToolCall`)
- Modify: `src/shared/types.ts:962` (`NormalizedToolCall` union)

- [ ] **Step 1: Add the interface** after `SubagentTaskToolCall` (`:931`):

```ts
export interface WorkflowToolCall
  extends ToolCallBase<"workflow", { name?: string; description?: string; scriptPath?: string }> { }
```

- [ ] **Step 2: Add to the union** at `:962`, after `| SubagentTaskToolCall`:

```ts
  | WorkflowToolCall
```

- [ ] **Step 3: Typecheck**

Run: `bunx tsc --noEmit`
Expected: PASS (union widened; no consumer breaks yet — `ToolCallMessage` switch has a default branch).

- [ ] **Step 4: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat(types): add workflow toolKind"
```

### Task 1.2: Add workflow transcript-entry types

**Files:**
- Modify: `src/shared/types.ts` (near other entry interfaces, before `TranscriptEntry` union `:1250`)

- [ ] **Step 1: Add entry interfaces** (place just above `export type TranscriptEntry`):

```ts
export type WorkflowTaskStatus = "pending" | "running" | "completed" | "failed" | "killed"

export interface WorkflowTaskStartedEntry extends TranscriptEntryBase {
  kind: "workflow_task_started"
  taskId: string
  toolUseId?: string
  description: string
  taskType?: string
  workflowName?: string
  prompt?: string
  skipTranscript?: boolean
}

export interface WorkflowTaskUpdatedEntry extends TranscriptEntryBase {
  kind: "workflow_task_updated"
  taskId: string
  status?: WorkflowTaskStatus
  description?: string
  endTime?: number
  error?: string
}

export interface WorkflowToolProgressEntry extends TranscriptEntryBase {
  kind: "workflow_tool_progress"
  toolUseId: string
  toolName: string
  parentToolUseId: string | null
  elapsedSeconds: number
  taskId?: string
}
```

- [ ] **Step 2: Add to the `TranscriptEntry` union** (`:1250`), after `| ToolRequestResolvedEntry`:

```ts
  | WorkflowTaskStartedEntry
  | WorkflowTaskUpdatedEntry
  | WorkflowToolProgressEntry
```

- [ ] **Step 3: Typecheck**

Run: `bunx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat(types): add workflow transcript entries"
```

### Task 1.3: Pure `foldWorkflowRuns` aggregator — failing test

**Files:**
- Create: `src/shared/workflow.test.ts`
- Create: `src/shared/workflow.ts` (stub only this step)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test"
import { foldWorkflowRuns } from "./workflow"
import type { TranscriptEntry } from "./types"

function entry<T extends TranscriptEntry>(e: T): T { return e }

describe("foldWorkflowRuns", () => {
  test("groups child tasks under the local_workflow root and tracks status", () => {
    const entries: TranscriptEntry[] = [
      entry({ kind: "workflow_task_started", _id: "1", createdAt: 1, taskId: "root", description: "spec run", taskType: "local_workflow", workflowName: "spec" }),
      entry({ kind: "workflow_task_started", _id: "2", createdAt: 2, taskId: "a", toolUseId: "tu1", description: "agent: scan" }),
      entry({ kind: "workflow_task_updated", _id: "3", createdAt: 3, taskId: "a", status: "running" }),
      entry({ kind: "workflow_task_updated", _id: "4", createdAt: 4, taskId: "a", status: "completed", endTime: 10 }),
    ]
    const runs = foldWorkflowRuns(entries)
    expect(runs).toHaveLength(1)
    expect(runs[0].name).toBe("spec")
    expect(runs[0].status).toBe("running")
    expect(runs[0].tasks).toHaveLength(1)
    expect(runs[0].tasks[0].status).toBe("completed")
    expect(runs[0].tasks[0].description).toBe("agent: scan")
  })

  test("returns empty array when no workflow entries exist", () => {
    expect(foldWorkflowRuns([])).toEqual([])
  })

  test("hides skip_transcript tasks from tasks but keeps them counted in ambient", () => {
    const entries: TranscriptEntry[] = [
      entry({ kind: "workflow_task_started", _id: "1", createdAt: 1, taskId: "root", description: "r", taskType: "local_workflow", workflowName: "x" }),
      entry({ kind: "workflow_task_started", _id: "2", createdAt: 2, taskId: "amb", description: "housekeeping", skipTranscript: true }),
    ]
    const runs = foldWorkflowRuns(entries)
    expect(runs[0].tasks).toHaveLength(0)
    expect(runs[0].ambientCount).toBe(1)
  })
})
```

- [ ] **Step 2: Stub the module so import resolves but the test fails**

```ts
// src/shared/workflow.ts
import type { TranscriptEntry, WorkflowTaskStatus } from "./types"

export interface WorkflowTaskView {
  taskId: string
  toolUseId?: string
  description: string
  status: WorkflowTaskStatus
  endTime?: number
  error?: string
}

export interface WorkflowRunView {
  taskId: string
  name: string
  status: WorkflowTaskStatus
  tasks: WorkflowTaskView[]
  ambientCount: number
}

export function foldWorkflowRuns(_entries: TranscriptEntry[]): WorkflowRunView[] {
  return []
}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test src/shared/workflow.test.ts`
Expected: FAIL on the first test (expected length 1, got 0).

- [ ] **Step 4: Commit the failing test**

```bash
git add src/shared/workflow.ts src/shared/workflow.test.ts
git commit -m "test(workflow): failing foldWorkflowRuns spec"
```

### Task 1.4: Implement `foldWorkflowRuns`

**Files:**
- Modify: `src/shared/workflow.ts`

- [ ] **Step 1: Implement**

```ts
import type { TranscriptEntry, WorkflowTaskStatus } from "./types"

export interface WorkflowTaskView {
  taskId: string
  toolUseId?: string
  description: string
  status: WorkflowTaskStatus
  endTime?: number
  error?: string
}

export interface WorkflowRunView {
  taskId: string
  name: string
  status: WorkflowTaskStatus
  tasks: WorkflowTaskView[]
  ambientCount: number
}

function rollUp(tasks: WorkflowTaskView[]): WorkflowTaskStatus {
  if (tasks.some((t) => t.status === "failed")) return "failed"
  if (tasks.some((t) => t.status === "running" || t.status === "pending")) return "running"
  if (tasks.length > 0 && tasks.every((t) => t.status === "completed")) return "completed"
  return "running"
}

export function foldWorkflowRuns(entries: TranscriptEntry[]): WorkflowRunView[] {
  const runs = new Map<string, WorkflowRunView>()
  const taskIndex = new Map<string, { runId: string; task: WorkflowTaskView }>()
  let currentRunId: string | null = null

  for (const e of entries) {
    if (e.kind === "workflow_task_started") {
      if (e.taskType === "local_workflow") {
        currentRunId = e.taskId
        runs.set(e.taskId, {
          taskId: e.taskId,
          name: e.workflowName ?? e.description,
          status: "running",
          tasks: [],
          ambientCount: 0,
        })
        continue
      }
      const run = currentRunId ? runs.get(currentRunId) : undefined
      if (!run) continue
      if (e.skipTranscript) { run.ambientCount += 1; continue }
      const task: WorkflowTaskView = {
        taskId: e.taskId,
        toolUseId: e.toolUseId,
        description: e.description,
        status: "pending",
      }
      run.tasks.push(task)
      taskIndex.set(e.taskId, { runId: run.taskId, task })
    } else if (e.kind === "workflow_task_updated") {
      const found = taskIndex.get(e.taskId)
      if (!found) continue
      if (e.status) found.task.status = e.status
      if (e.endTime != null) found.task.endTime = e.endTime
      if (e.error != null) found.task.error = e.error
    }
  }

  for (const run of runs.values()) run.status = rollUp(run.tasks)
  return [...runs.values()]
}
```

- [ ] **Step 2: Run test to verify it passes**

Run: `bun test src/shared/workflow.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 3: Commit**

```bash
git add src/shared/workflow.ts
git commit -m "feat(workflow): foldWorkflowRuns aggregator"
```

---

# Phase 2 — Driver wiring (both drivers parse the lifecycle)

### Task 2.1: Verify SDK bundled CLI is an ant build; add allowlist

**Files:**
- Modify: `src/server/agent.ts:111` (`CLAUDE_TOOLSET`)

- [ ] **Step 1: Probe the SDK's bundled CLI**

Run:
```bash
node -e "console.log(require.resolve('@anthropic-ai/claude-agent-sdk'))"
# then locate the bundled cli.js near that path and grep it:
grep -l "WorkflowTool\|local_workflow" $(dirname "$(node -e "console.log(require.resolve('@anthropic-ai/claude-agent-sdk'))")")/../**/cli*.js 2>/dev/null || echo "PUBLIC_BUILD"
```
Expected: either a matching file path (ant build → SDK parity real) or `PUBLIC_BUILD`. **Record the result in the ADR.** If `PUBLIC_BUILD`, the allowlist line is still added (harmless) and SDK parity is documented as inert until the package ships ant.

- [ ] **Step 2: Add to `CLAUDE_TOOLSET`** (`:111`), after `"ExitPlanMode",`:

```ts
  "Workflow",
  "WorkflowOutput",
```

- [ ] **Step 3: Run the SDK driver test suite for regressions**

Run: `bun test src/server/agent.test.ts`
Expected: PASS (allowlist widening must not break existing assertions; if a test snapshots the exact toolset array, update it in this step).

- [ ] **Step 4: Commit**

```bash
git add src/server/agent.ts
git commit -m "feat(agent): allow Workflow tool in SDK driver toolset"
```

### Task 2.2: Normalize the `Workflow` tool call — failing test

**Files:**
- Test: `src/shared/tools.test.ts` (append; confirm filename via `ls src/shared/tools.test.ts`)
- Modify: `src/shared/tools.ts`

- [ ] **Step 1: Write the failing test**

```ts
test("normalizes Workflow tool call to workflow toolKind", () => {
  const result = normalizeToolCall({
    toolName: "Workflow",
    toolId: "t1",
    input: { script: "export const meta = { name: 'spec', description: 'd' }\n..." },
  })
  expect(result.toolKind).toBe("workflow")
  expect(result.toolName).toBe("Workflow")
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test src/shared/tools.test.ts -t "Workflow"`
Expected: FAIL (toolKind is `unknown_tool`).

- [ ] **Step 3: Implement the case** in `normalizeToolCall`, before the final `unknown_tool` return (`:227`):

```ts
    case "Workflow": {
      const meta = parseWorkflowMeta(typeof input.script === "string" ? input.script : "")
      return {
        kind: "tool",
        toolKind: "workflow",
        toolName,
        toolId,
        input: {
          name: meta?.name,
          description: meta?.description,
          scriptPath: typeof input.scriptPath === "string" ? input.scriptPath : undefined,
        },
        rawInput: input,
      }
    }
```

And add the tiny helper near the top of `tools.ts` (after `asRecord`):

```ts
function parseWorkflowMeta(script: string): { name?: string; description?: string } | null {
  // meta is a pure literal `export const meta = { name: '...', description: '...' }`
  const name = script.match(/name\s*:\s*['"]([^'"]+)['"]/)?.[1]
  const description = script.match(/description\s*:\s*['"]([^'"]+)['"]/)?.[1]
  if (!name && !description) return null
  return { name, description }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test src/shared/tools.test.ts -t "Workflow"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/tools.ts src/shared/tools.test.ts
git commit -m "feat(tools): normalize Workflow tool call"
```

### Task 2.3: `hydrateToolResult` workflow case

**Files:**
- Modify: `src/shared/tools.ts:340` (`hydrateToolResult` switch)
- Test: `src/shared/tools.test.ts`

- [ ] **Step 1: Failing test**

```ts
test("hydrates Workflow result as passthrough text", () => {
  const tool = normalizeToolCall({ toolName: "Workflow", toolId: "t1", input: { script: "export const meta={name:'x',description:'y'}" } })
  const result = hydrateToolResult(tool, "{\"confirmed\":3}")
  expect(result).toBeDefined()
})
```

- [ ] **Step 2: Run → FAIL** (no `workflow` case; falls to default which may return raw — assert the explicit shape you implement).

Run: `bun test src/shared/tools.test.ts -t "Workflow result"`

- [ ] **Step 3: Implement** a `case "workflow":` in the `hydrateToolResult` switch returning the parsed JSON passthrough (mirror the `mcp_generic` default behavior already in the file at the switch tail).

- [ ] **Step 4: Run → PASS**, then **Commit**

```bash
git add src/shared/tools.ts src/shared/tools.test.ts
git commit -m "feat(tools): hydrate Workflow tool result"
```

### Task 2.4: PTY parser — workflow lifecycle → entries (failing test)

**Files:**
- Test: `src/server/claude-pty/jsonl-to-event.test.ts` (confirm name via `ls`)
- Modify: `src/server/claude-pty/jsonl-to-event.ts:224`

- [ ] **Step 1: Failing test** — feed the parser the three message shapes and assert it emits `workflow_task_started`, `workflow_task_updated`, `workflow_tool_progress` entries:

```ts
test("parses workflow task_started/task_updated/tool_progress", () => {
  const started = parseJsonlLine(JSON.stringify({
    type: "system", subtype: "task_started", task_id: "root",
    description: "spec", task_type: "local_workflow", workflow_name: "spec", session_id: "s",
  }))
  expect(started.some((e) => e.kind === "workflow_task_started")).toBe(true)

  const updated = parseJsonlLine(JSON.stringify({
    type: "system", subtype: "task_updated", task_id: "root",
    patch: { status: "completed", end_time: 5 }, session_id: "s",
  }))
  expect(updated.some((e) => e.kind === "workflow_task_updated")).toBe(true)

  const progress = parseJsonlLine(JSON.stringify({
    type: "tool_progress", tool_use_id: "tu", tool_name: "agent",
    parent_tool_use_id: null, elapsed_time_seconds: 2, session_id: "s",
  }))
  expect(progress.some((e) => e.kind === "workflow_tool_progress")).toBe(true)
})
```

(Use whatever the existing exported parse entrypoint is — read the test file's existing imports first; do NOT invent `parseJsonlLine` if the real export differs.)

- [ ] **Step 2: Run → FAIL**

Run: `bun test src/server/claude-pty/jsonl-to-event.test.ts -t "workflow"`

- [ ] **Step 3: Implement** in the system-subtype block near `:224`, plus a new top-level `tool_progress` branch:

```ts
if (message.type === "system" && message.subtype === "task_started" && typeof message.task_id === "string") {
  events.push({
    type: "transcript_entry",
    entry: {
      kind: "workflow_task_started",
      taskId: message.task_id,
      toolUseId: typeof message.tool_use_id === "string" ? message.tool_use_id : undefined,
      description: typeof message.description === "string" ? message.description : "",
      taskType: typeof message.task_type === "string" ? message.task_type : undefined,
      workflowName: typeof message.workflow_name === "string" ? message.workflow_name : undefined,
      prompt: typeof message.prompt === "string" ? message.prompt : undefined,
      skipTranscript: message.skip_transcript === true,
    },
  })
}
if (message.type === "system" && message.subtype === "task_updated" && typeof message.task_id === "string") {
  const patch = (message.patch ?? {}) as Record<string, unknown>
  events.push({
    type: "transcript_entry",
    entry: {
      kind: "workflow_task_updated",
      taskId: message.task_id,
      status: typeof patch.status === "string" ? patch.status as WorkflowTaskStatus : undefined,
      description: typeof patch.description === "string" ? patch.description : undefined,
      endTime: typeof patch.end_time === "number" ? patch.end_time : undefined,
      error: typeof patch.error === "string" ? patch.error : undefined,
    },
  })
}
if (message.type === "tool_progress" && typeof message.tool_use_id === "string") {
  events.push({
    type: "transcript_entry",
    entry: {
      kind: "workflow_tool_progress",
      toolUseId: message.tool_use_id,
      toolName: typeof message.tool_name === "string" ? message.tool_name : "",
      parentToolUseId: typeof message.parent_tool_use_id === "string" ? message.parent_tool_use_id : null,
      elapsedSeconds: typeof message.elapsed_time_seconds === "number" ? message.elapsed_time_seconds : 0,
      taskId: typeof message.task_id === "string" ? message.task_id : undefined,
    },
  })
}
```

**NOTE for executor:** match the parser's actual emit shape. The snippet assumes events carry `{ type:"transcript_entry", entry }`; if the file instead pushes bare `TranscriptEntry` objects or uses a different `_id`/`createdAt` injection step, adapt to that convention (read `:88-137` and `:224-231` first). Add `_id`/`createdAt` exactly the way sibling entries get them.

- [ ] **Step 4: Run → PASS**, then **Commit**

```bash
git add src/server/claude-pty/jsonl-to-event.ts src/server/claude-pty/jsonl-to-event.test.ts
git commit -m "feat(pty): parse workflow lifecycle into transcript entries"
```

### Task 2.5: SDK normalizer — same three shapes

**Files:**
- Test: `src/server/agent.test.ts`
- Modify: `src/server/agent.ts:528` (`normalizeClaudeStreamMessage`)

- [ ] **Step 1: Failing test** — pass `SDKTaskStartedMessage` / `SDKTaskUpdatedMessage` / `SDKToolProgressMessage` fixtures to `normalizeClaudeStreamMessage` and assert the same three entry kinds come back. (Reuse the fixture shapes from Task 2.4.)

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** the identical mapping inside `normalizeClaudeStreamMessage` returning `TranscriptEntry[]`. Factor the mapping into a shared helper `mapWorkflowMessage(message): TranscriptEntry[]` in `src/shared/workflow.ts` and call it from BOTH `agent.ts` and `jsonl-to-event.ts` so the two drivers cannot drift (refactor Task 2.4 to use it too — re-run 2.4's test after).

- [ ] **Step 4: Run → PASS** (`bun test src/server/agent.test.ts src/server/claude-pty/jsonl-to-event.test.ts`), then **Commit**

```bash
git add src/server/agent.ts src/shared/workflow.ts src/server/claude-pty/jsonl-to-event.ts
git commit -m "feat(agent): SDK driver parses workflow lifecycle (shared mapper)"
```

### Task 2.6: Parity test (SDK ↔ PTY equivalence)

**Files:**
- Modify: `src/server/claude-pty/parity-matrix.test.ts` (existing equivalence harness — see CLAUDE.md "SDK ↔ PTY equivalence")

- [ ] **Step 1:** Add a workflow fixture case to the parity matrix asserting both drivers emit identical `HarnessEvent` sequences for the three workflow message shapes.

- [ ] **Step 2: Run → PASS**

Run: `bun test src/server/claude-pty/parity-matrix.test.ts`

- [ ] **Step 3: Commit**

```bash
git add src/server/claude-pty/parity-matrix.test.ts
git commit -m "test(parity): workflow lifecycle SDK/PTY equivalence"
```

---

# Phase 3 — Read-model projection

### Task 3.1: `deriveWorkflowRuns` — failing test

**Files:**
- Test: `src/server/read-models.test.ts`
- Modify: `src/server/read-models.ts`

- [ ] **Step 1: Failing test** — build a `ChatState`/entry list containing workflow entries (read `read-models.test.ts` for the existing state-builder helper first) and assert `deriveWorkflowRuns(state, chatId)` returns the `WorkflowRunView[]` from `foldWorkflowRuns`, scoped to that chat.

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** `deriveWorkflowRuns` in `read-models.ts` that pulls the chat's transcript entries and delegates to `foldWorkflowRuns` (the projection layer stays thin; aggregation logic lives in the pure `shared/workflow.ts`). Mirror how `deriveSidebarData` (`:72`) reads from state.

- [ ] **Step 4: Run → PASS**, then **Commit**

```bash
git add src/server/read-models.ts src/server/read-models.test.ts
git commit -m "feat(read-models): deriveWorkflowRuns projection"
```

### Task 3.2: Expose runs to the client

**Files:**
- Modify: wherever read-models reach the client (find via `grep -rn "deriveSidebarData\|deriveStatus" src/server | grep -v test` to locate the snapshot/RPC assembly), and the matching client store.

- [ ] **Step 1:** Add `workflowRuns` to the chat snapshot the server already pushes (mirror how subagent runs reach the client — `grep -rn "subagentRuns\|SubagentRun" src/server src/shared | head`). Add a stable-reference selector on the client store per the render-loop rule in CLAUDE.md:

```ts
const EMPTY: WorkflowRunView[] = []
useChatStore((s) => s.workflowRuns ?? EMPTY)
```

- [ ] **Step 2:** Add/extend a server test asserting the snapshot includes `workflowRuns`.

- [ ] **Step 3: Run → PASS**, then **Commit**

```bash
git commit -am "feat: expose workflowRuns in chat snapshot"
```

---

# Phase 4 — Inline transcript card

### Task 4.1: `WorkflowMessage` component — failing test

**Files:**
- Create: `src/client/components/messages/WorkflowMessage.test.tsx`
- Create: `src/client/components/messages/WorkflowMessage.tsx`

- [ ] **Step 1: Failing test** (follow `kanna-react-style` skill — read it first; mirror `SubagentMessage.test.tsx`): render `<WorkflowMessage>` with a hydrated `workflow` tool call + a `WorkflowRunView`, assert the workflow name, a phase/task list, and per-task status pills render; assert it mounts without React error #185 using `renderForLoopCheck` (`src/client/lib/testing/`).

- [ ] **Step 2: Run → FAIL** (`bun test src/client/components/messages/WorkflowMessage.test.tsx`).

- [ ] **Step 3: Implement** `WorkflowMessage.tsx`. Props: `{ message: Extract<ProcessedToolCall, { toolKind: "workflow" }>; run?: WorkflowRunView }`. Render the workflow name + description, then the task tree (description + status pill + duration). Reuse existing status-pill / Tooltip primitives (per `kanna-react-style`, use the project `Tooltip`, not native `title`). Hide `skipTranscript` tasks. Empty/absent run ⇒ render just the labeled card ("Workflow started…").

- [ ] **Step 4: Run → PASS**, then **Commit**

```bash
git add src/client/components/messages/WorkflowMessage.tsx src/client/components/messages/WorkflowMessage.test.tsx
git commit -m "feat(client): WorkflowMessage transcript card"
```

### Task 4.2: Dispatch `workflow` toolKind in `ToolCallMessage`

**Files:**
- Modify: `src/client/components/messages/ToolCallMessage.tsx:91-133` (branch list), `:177` (icon switch)

- [ ] **Step 1: Failing test** in `ToolCallMessage.test.tsx`: a `workflow` tool call renders `WorkflowMessage` (assert a testid/text only `WorkflowMessage` emits).

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** a branch `if (message.toolKind === "workflow") return <WorkflowMessage message={message} run={...} />` (wire `run` from the store selector added in Task 3.2), and add a workflow icon case to the `:177` switch.

- [ ] **Step 4: Run → PASS**, then **Commit**

```bash
git add src/client/components/messages/ToolCallMessage.tsx src/client/components/messages/ToolCallMessage.test.tsx
git commit -m "feat(client): route workflow toolKind to WorkflowMessage"
```

### Task 4.3: Child-task placement under the Workflow call

**Files:**
- Create: `src/client/app/workflow-run-placement.ts` + test (mirror `subagent-run-placement.ts`, 89 lines)

- [ ] **Step 1: Failing test** mirroring `subagent-run-placement.test.ts`: given a transcript with a `Workflow` tool call and child `workflow_task_started` entries carrying `toolUseId`, assert placement anchors child tasks under their parent `Workflow` tool call (same anchoring contract as the recent commit `8e5e445 anchor subagent runs under their delegate_subagent call`).

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** the placement function.

- [ ] **Step 4: Run → PASS**, then **Commit**

```bash
git add src/client/app/workflow-run-placement.ts src/client/app/workflow-run-placement.test.ts
git commit -m "feat(client): anchor workflow tasks under their Workflow call"
```

---

# Phase 5 — `/workflows` panel

### Task 5.1: `WorkflowsSection` panel — failing test

**Files:**
- Create: `src/client/app/WorkflowsSection.tsx` + `WorkflowsSection.test.tsx` (mirror `SubagentsSection.tsx`, 662 lines — read it fully first)

- [ ] **Step 1: Failing test**: render `<WorkflowsSection>` fed `WorkflowRunView[]`, assert: a row per run (name + rolled-up status + task count), expand shows the task tree, empty state renders when no runs, no render-loop warning (`renderForLoopCheck`).

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** the panel mirroring `SubagentsSection` structure (header, list, per-row expand, empty state). Use the stable-reference selector from Task 3.2. Apply the `impeccable` skill for UI/UX consistency (per project rule 3) — match `SubagentsSection`'s spacing, pills, and Tooltip usage exactly.

- [ ] **Step 4: Run → PASS**, then **Commit**

```bash
git add src/client/app/WorkflowsSection.tsx src/client/app/WorkflowsSection.test.tsx
git commit -m "feat(client): WorkflowsSection panel"
```

### Task 5.2: Mount the panel + nav entry

**Files:**
- Modify: wherever `SubagentsSection` is mounted (find via `grep -rn "SubagentsSection" src/client/app`)

- [ ] **Step 1:** Mount `WorkflowsSection` next to `SubagentsSection` (same parent), gated to render only when `workflowRuns.length > 0` OR behind the same disclosure the subagents panel uses — match the existing pattern, do not invent a new nav paradigm.

- [ ] **Step 2:** Extend the parent's test to assert the panel mounts when runs exist.

- [ ] **Step 3: Run → PASS**, then **Commit**

```bash
git commit -am "feat(client): mount WorkflowsSection in app shell"
```

### Task 5.3: Detail dialog

**Files:**
- Modify: `src/client/app/WorkflowsSection.tsx` (add a row → dialog), or a small `WorkflowDetailDialog.tsx`

- [ ] **Step 1: Failing test**: clicking a run row opens a dialog showing the full task tree + per-task duration/error.

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** using the project's existing Dialog primitive (find via `grep -rn "Dialog" src/client/components | head`). Apply `impeccable`.

- [ ] **Step 4: Run → PASS**, then **Commit**

```bash
git commit -am "feat(client): workflow run detail dialog"
```

---

# Phase 6 — Verification, lint, docs, C3

### Task 6.1: Full suite + lint

- [ ] **Step 1:** Run `bun test` (whole suite — required green before PR per CLAUDE.md). Expected: PASS.
- [ ] **Step 2:** Run `bun run lint` (`--max-warnings=0`). Expected: 0 errors, warnings ≤ cap. If warnings dropped, lower the cap in `eslint.config.js` in this commit (ratchet rule). If any new IO crept into a sealed layer, fix per the side-effect-seal rules (no `eslint-disable`).
- [ ] **Step 3: Commit** any lint/cap adjustments.

### Task 6.2: Docs sync

**Files:**
- Modify: `CLAUDE.md` (new section: "Workflow Integration" — the ant-build constraint, the new toolKind/entries, the panel), `wiki/**` if it documents the transcript/panel surface.

- [ ] **Step 1:** Write the `CLAUDE.md` section. Capture: ant-build gate, both-driver parity (with the Task 2.1 result), graceful no-op on public binaries, the new `workflow` toolKind + three entry kinds + read-model.
- [ ] **Step 2:** If `wiki/**` changed, regenerate screenshots per CLAUDE.md (`bash wiki/scripts/capture-all.sh`) only if the panel is in a screenshotted view.
- [ ] **Step 3: Commit.**

### Task 6.3: C3 change + sweep

- [ ] **Step 1:** Run `/c3 change` to update `.c3/` for the new `workflow-orchestration` component, refs, and any touched contracts (mandatory per project CLAUDE.md — code-doc drift blocks the PR).
- [ ] **Step 2:** Run `/c3 audit` (or `/c3 sweep`) to confirm no drift.
- [ ] **Step 3: Commit.**

### Task 6.4: Open PR

- [ ] **Step 1:** Push the branch. Open PR targeting the fork:

```bash
gh pr create --repo cuongtranba/kanna --base main --head <branch> \
  --title "feat: integrate Claude Workflow tool (full /workflows)" \
  --body "<summary + ant-build constraint note + test/lint evidence>"
```

(Never target `jakemor/kanna`. Never merge directly. Per global rules: open PR, don't merge.)

---

## Self-Review (run before handing off)

1. **Spec coverage:** scope 4 = expose tool (Task 2.1–2.3) + progress (Task 2.4–2.5, 4.1) + subagent fan-out placement (Task 4.3) + dedicated panel & dialog (Task 5.1–5.3), both drivers (Task 2.5, 2.6). ✅
2. **Placeholder scan:** the three "read the sibling file first / match the actual emit shape" notes are pointers to *concrete existing patterns*, not deferred design — acceptable. All new types and parser code are concrete.
3. **Type consistency:** `WorkflowToolCall` / `WorkflowTaskStartedEntry` / `WorkflowTaskUpdatedEntry` / `WorkflowToolProgressEntry` / `WorkflowRunView` / `WorkflowTaskView` / `WorkflowTaskStatus` names are used consistently across Phases 1–5. `foldWorkflowRuns` and `mapWorkflowMessage` are the two pure shared functions; `deriveWorkflowRuns` is the projection.

## Open Risks (confirm at execution)
- **R1:** SDK bundled CLI may be a public build (Task 2.1) → SDK parity inert. Documented, not blocking.
- **R2:** Exact event-emit shape in `jsonl-to-event.ts` (bare entry vs wrapped) — Task 2.4 note covers it; executor reads the file first.
- **R3:** Snapshot/RPC plumbing for `workflowRuns` (Task 3.2) depends on how subagent runs are already shipped — mirror that path; do not add a new transport.
