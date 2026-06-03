# Workflow Status Integration (PTY disk-watch) — Design

**Date:** 2026-06-03
**Status:** Approved (brainstorm) — ready for implementation plan
**Driver scope:** PTY only (`KANNA_CLAUDE_DRIVER=pty`)
**Mode:** Read-only

## Goal

Surface Claude Code's native **`Workflow`** tool (dynamic multi-agent
orchestration) in Kanna's web UI so the user can:

1. See the **live status** of a running workflow (phases + per-agent progress).
2. **List** every workflow run for the current chat (running / completed /
   failed / killed), with post-mortem detail for finished runs.

Display only — no stop/relaunch in v1.

## Key empirical finding (drives the whole design)

Two candidate data sources exist; they are **split by driver**:

| Source | Workflow launch (card) | Live progress + list |
|---|---|---|
| **Event stream** (`system/task_started` / `task_updated` / `tool_progress`) | ✅ tool_use is in the transcript | ✅ **SDK only** — ❌ **absent on PTY** |
| **Disk sidecar** (`wf_*.json`) | n/a | ✅ **works on PTY and SDK** |

**Verified 2026-06-03:** the on-disk CC transcript JSONL that the PTY driver
tails (`~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl`) contains the
`Workflow` **tool_use** (launch) but **zero** `task_started` / `task_updated` /
`tool_progress` / `local_workflow` lines. Those lifecycle events flow only
through the SDK live stream-json control channel, which PTY never reads (PTY's
sole event source is the file). Therefore the prior plan
(`docs/superpowers/plans/2026-06-01-workflow-integration.md`, "Approach C",
event-stream parsing) **cannot deliver live progress on PTY**. It is superseded
for the PTY scope.

Meanwhile Claude Code writes a complete, self-updating read-model to disk, one
file per run, regardless of driver:

```
~/.claude/projects/<encoded-cwd>/<session-uuid>/workflows/wf_<runId>.json
```

Confirmed top-level fields: `runId`, `taskId`, `workflowName`, `status`
(`running` | `completed` | `failed` | `killed`), `startTime`, `timestamp`,
`durationMs`, `agentCount`, `totalTokens`, `totalToolCalls`, `phases[]`,
`workflowProgress[]` (the live tree — per-agent `state`, `model`,
`lastToolName`, `lastToolSummary`, `promptPreview`, `tokens`, `toolCalls`,
timestamps), `result`, `error`, `summary`, `script`, `scriptPath`, `args`,
`logs`. `taskId` (e.g. `wcxjintdj`) is the **join key** — the same string the
transcript's `Workflow` result text prints as `Task ID: X`.

## Architecture

Kanna **watches the per-chat `workflows/` directory**, parses each `wf_*.json`
through one defensive parser, projects it to typed shapes, and serves it as a
**separate read-model** (a workflow telemetry view) over the existing WS
subscription. The client renders a per-chat Workflows panel plus an inline
transcript card on the `Workflow` tool call.

### Architectural invariant (c3-225)

PTY's "transcript JSONL is the **sole event source**" rule is about the
*conversation / turn* record. Workflow telemetry is **not** folded into that
pipeline. The disk watcher feeds an **independent sibling read-model** (same
spirit as reading subagent files) and never injects transcript/turn events.
This preserves the c3-225 invariant. The exception is documented in an ADR
(see Phase 0).

### Path resolution

Reuse `encodeCwd` / `computeProjectDir` from
`src/server/claude-pty/jsonl-path.ts` + the session uuid the PTY driver already
holds → resolve `<projectDir>/<sessionUuid>/workflows/`. No new path logic.

### Refresh cadence

`fs.watch` on the `workflows/` dir with a **~250 ms debounce** (near-live).
Mirror the existing `KANNA_PTY_TRANSCRIPT_WATCH=fs|poll` convention so a poll
fallback (`~1 s`) is available for unreliable filesystems. The 40-agent run's
file reached 685 KB and is rewritten on every agent tick, so the debounce +
the light list projection (below) are required, not optional.

### Read-model projection (cost control)

The list payload **drops the heavy fields** (`script`, `args`, full
`workflowProgress.promptPreview`) — those reach the client only on a drill-in
pull (`workflows:getRun`). List rows carry just: `runId`, `taskId`,
`workflowName`, `status`, `startTime`, `durationMs`, `agentCount`,
`totalTokens`, `totalToolCalls`, plus a compact phase/agent-state summary.

## Components

### Server

1. **`src/server/workflow-watch-io.adapter.ts`** (NEW; `.adapter.ts` →
   side-effect-seal exempt). Leaf module, no domain logic: list `wf_*.json`,
   read, `fs.watch` (poll fallback), debounce, emit raw file contents on
   change.
2. **`src/server/workflow-read-model.ts`** (NEW). Per active PTY chat: resolve
   cwd + session → wire the adapter → parse via the single choke-point
   `parseWorkflowRunFile(u: unknown): WorkflowRun | null` (tolerates CC format
   drift; bad/partial/unknown-status → skipped + logged, never crashes the
   watch) → project to the light list shape. CQRS read-model
   (`ref-cqrs-read-models`). Watch starts on first `workflows:subscribe`, torn
   down on chat close.
3. **`src/shared/protocol.ts`**: subscription `workflows:subscribe {chatId}` →
   push `workflowRunsUpdated {chatId, runs}`; drill-in pull
   `workflows:getRun {chatId, runId}` → heavy fields. (`ref-ws-subscription`)
4. **`src/shared/workflow-types.ts`** (NEW): `WorkflowRun`,
   `WorkflowRunSummary` (list shape), `WorkflowStatus`, `WorkflowPhase`,
   `WorkflowAgentProgress` — all named types, no `any`
   (`rule-strong-typing`).

### Tools — inline card (reused from prior plan, `src/shared/tools.ts`, c3-303)

5. Normalize the `Workflow` tool call → `workflow` toolKind carrying
   `{ name?, description?, scriptPath? }` (parse `meta.name`/`description` from
   the inline `script`, or use `scriptPath`). `hydrateToolResult` extracts
   `taskId`/`runId` from the result text (`Task ID: X`). Fits
   `ref-tool-hydration`. (Prior plan Tasks 2.2–2.3 carry over unchanged; its
   `CLAUDE_TOOLSET` allowlist widening — Task 2.1 — still applies so the tool
   name is recognized.)

### Client (c3-110)

6. **`workflowsStore.ts`** (NEW, zustand) — WS-fed, keyed by chatId, **stable
   `EMPTY` ref** (render-loop rule, React #185).
7. **`WorkflowsSection.tsx`** (NEW) — per-chat panel mirroring
   `SubagentsSection.tsx`: one row per run (name, status pill, agentCount,
   tokens, duration, started) → expand / detail dialog shows the phase →
   per-agent tree (label, state, model, lastTool, tokens, toolCalls), and for
   finished runs the `result` / `error` / `summary`. Drill-in triggers
   `workflows:getRun`. Tabular numerics, project `Tooltip` (kanna-react-style).
   UI polish via the **impeccable** skill (project rule 3) — match
   `SubagentsSection` spacing/pills exactly.
8. **`WorkflowMessage.tsx`** (NEW) — inline transcript card on the `Workflow`
   tool call: launch summary (name/description/scriptPath) + **live status
   pill** joined to the store by `taskId` + "Open in panel". Mirrors prior plan
   Task 4.1, fed from the disk read-model store instead of folded events.

## Data flow

PTY chat active → client `workflows:subscribe {chatId}` → read-model wires the
adapter → `wf_*.json` changes → debounce → re-parse + project →
`workflowRunsUpdated` push → store → panel + card re-render. Card status pill
joins by `taskId`. Drill-in → `workflows:getRun` → heavy fields. Watch torn
down on chat close.

## Error handling

- `parseWorkflowRunFile` is the single defensive boundary; malformed / partial
  / unknown-`status` JSON → skipped + logged, watch survives.
- Missing `workflows/` dir (SDK driver, or no runs yet) → empty list, panel
  shows empty state. "No workflows" is normal, never an error.
- Heavy fields never shipped in list payloads.

## Testing (colocated bun, `rule-colocated-bun-test`)

- `workflow-watch-io.adapter.test.ts` — fixture `workflows/` dir; watch emits
  on change; debounce coalesces bursts; poll fallback.
- `workflow-read-model.test.ts` / parser unit tests — malformed, partial,
  unknown status, projection drops heavy fields, `taskId` join.
- `tools.test.ts` — `Workflow` normalization + `taskId` extraction.
- Client — `renderForLoopCheck` on the store + `WorkflowsSection` /
  `WorkflowMessage` render tests.

## Out of scope (v1)

- Global cross-chat workflows view.
- Stop / relaunch / resume actions.
- SDK driver (event-stream path). If SDK support is later wanted, add the
  prior plan's event-stream parsing as a *second source* feeding the same
  read-model — the read-model + UI built here are source-agnostic.

## Relationship to the prior plan

`docs/superpowers/plans/2026-06-01-workflow-integration.md` is **partially
superseded**:

- **Reused:** `Workflow` tool-call normalization (the card), the
  `CLAUDE_TOOLSET` allowlist, the `SubagentsSection`-mirrored panel + detail
  dialog + run-placement UI patterns.
- **Superseded:** its event-stream progress parsing
  (`task_started`/`task_updated`/`tool_progress` in `jsonl-to-event.ts` /
  `normalizeClaudeStreamMessage`) — verified absent from the PTY transcript;
  replaced by the disk-watch read-model.

## C3 / docs obligations (implementation phase)

- ADR for the disk-watch sibling-read-model exception to c3-225.
- `/c3 change` for a new `workflow-status` component + refs touched.
- `CLAUDE.md` section: PTY disk-watch source, the `wf_*.json` contract, the
  read-only/PTY-only scope, the new `workflow` toolKind + read-model.
