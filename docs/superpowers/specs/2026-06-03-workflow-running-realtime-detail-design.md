# Workflow running run realtime detail — design

## Problem

Clicking a `running` row in the workflow status panel opens the detail dialog, but the dialog only shows the status "Running" with no live data. The dialog body is empty for the whole run because:

- The `wf_<runId>.json` sidecar that carries `phases` + `workflowProgress[]` (per-agent state, tokens, tool calls) is only flushed by Claude at/near termination.
- `WorkflowRegistry.getRun` for a running run returns a synthesized `WorkflowRun` with `phases:[]` and `agents:[]` (PR #365), which is enough to stop the dialog from flickering but leaves the body blank.

What the user wants: a live view of which agents are running and which have finished, while the workflow is still going.

## Available live signal

Each running run has a live transcript dir `<session>/subagents/workflows/wf_<runId>/` containing:

- `journal.jsonl` — small (~2KB at 10–20 agents), one line per agent event:
  ```
  {"type":"started", "agentId":"...", "key":"v2:..."}
  {"type":"result",  "agentId":"...", "key":"v2:...", "result":{"dir":"...","fixed":N,"test_status":"pass|fail|no-tests","summary":"..."}}
  ```
  Verified shape on a live run (`wf_4f86f2c4`): 10 lines = 8 `started` + 2 `result`.
- `agent-<agentId>.jsonl` — full per-agent transcript, hundreds of KB → MB.
- `agent-<agentId>.meta.json` — small metadata stub.

The `journal.jsonl` lines give: agentCount, per-agent state (started → running, started+result → completed), and for completed agents a result with `dir`, `fixed`, `test_status`, `summary`. That is the smallest file with enough signal for a useful live detail view. Token + tool-call counts live only in `agent-*.jsonl` (too heavy to parse per refresh) and in the terminal sidecar.

## Decision

Parse `journal.jsonl` in `getRun` on the server, and have the client re-fetch `getRun` whenever the snapshot for a chat pushes (the same `watchRunDirs` watcher PR #363 added already fires on each journal/agent write, debounced at 250 ms). No new WS topic, no protocol change.

This minimises wire traffic (drill-in dialog is the only consumer), keeps the panel row light, and dies naturally: once the sidecar lands with `status:"completed"|"killed"|"failed"`, sidecar runs win over the synthetic running run, the client's "re-fetch while running" effect stops firing, and the dialog renders the authoritative terminal state.

## Components

### Adapter — `readWorkflowRunJournal`

`src/server/workflow-watch-io.adapter.ts`:

```ts
export interface WorkflowJournalEntry {
  type: "started" | "result"
  agentId: string
  result?: {
    dir?: string
    fixed?: number
    test_status?: string
    summary?: string
  }
}

export function readWorkflowRunJournal(
  workflowsDir: string, runId: string,
): WorkflowJournalEntry[]
```

Reads `liveRunRoot(workflowsDir)/<runId>/journal.jsonl`, parses each line defensively (skip blanks / unparseable / wrong-shape rows — Claude appends, so a partial-write at the tail is normal). Returns `[]` when the file is missing or unreadable. Leaf adapter, side-effect-sealed.

### Shared types

`src/shared/workflow-types.ts`:

- Reuse existing `WorkflowAgentProgress` from PR #358 (`index`, `label`, `agentId`, `state`, `lastToolSummary`, `startedAt`).
- Add `state` values used here: `"running"`, `"completed"`. No new exports for the journal entry itself — it lives in the adapter (server-only).

### Registry — `getRun` enrich for running runs

`src/server/workflow-registry.ts`:

- Add optional dep `readRunJournal?: (workflowsDir: string, runId: string) => WorkflowJournalEntry[]`.
- When `getRun` returns the synthetic running run (no sidecar) AND the dep is wired, derive `agents` + `agentCount` from the journal:
  - One `WorkflowAgentProgress` per unique `agentId` (insertion order = `index`).
  - `state`: `"running"` if only `started` seen, `"completed"` if a `result` line is present.
  - `label`: basename of `result.dir` if available, else `agent`.
  - `lastToolSummary`: for completed agents, `fixed N, test:<status>` (omit when missing).
- `phases` stays `[]` — journal has no phase data. The client already handles empty `phases`.
- Sidecar runs (terminal) pass through unchanged.

### Wiring

`src/server/server.ts`:

```ts
const workflowRegistry = createWorkflowRegistry({
  read: readWorkflowDir,
  watch: (dir, onChange) => watchWorkflowDir(dir, onChange),
  listRunDirs: listWorkflowRunDirs,
  watchRunDirs: (dir, onChange) => watchWorkflowRunDirs(dir, onChange),
  readRunJournal: readWorkflowRunJournal, // new
})
```

### Client — `WorkflowsSectionWithDetail` re-fetch on snapshot push

`src/client/app/WorkflowsSection.tsx`:

- `useEffect` keyed on the selected `runId` + the `runs` prop reference: if the dialog is open AND the matching run in `runs` has `status:"running"`, call `getRunDetail(runId)` and swap the result into `selectedRun` **without** setting `"loading"`. The dialog keeps showing the previous detail until the new one arrives — no flash.
- Stop condition is implicit: when the sidecar lands, the run in `runs` flips to `"completed"|"killed"|"failed"`, the effect's predicate is false, and no more re-fetches fire. The dialog now reflects the terminal sidecar.

No new WS message, no new store, no polling.

## Data flow

```
file write in subagents/workflows/<runId>/ (journal or agent jsonl)
  → fs.watch on liveRunRoot (debounce 250ms)
  → registry.refresh(chatId)
  → snapshot() push to subscribers
  → WS workflows topic → client workflowsStore update
  → WorkflowsSectionWithDetail effect (dialog open + status===running) fires
  → workflows.getRun(chatId, runId) command
  → server getRun → parse journal → WorkflowRun with live agents[]
  → setSelectedRun(detail) (no "loading") → dialog re-renders
```

Loop continues until the sidecar lands; then the snapshot for that runId switches to the terminal sidecar, the effect predicate is false, and the dialog shows the final state.

## Error handling

- Journal missing / unreadable / 0 lines → adapter returns `[]` → registry returns `agents:[]`, run still `status:"running"`. Dialog shows the pill with no agent list (same as before this PR for the launch boot window).
- Partial line at the tail → adapter skips that line; next write triggers another refresh which picks it up.
- Stale live dir (no activity within 10 min, no sidecar) → already dropped by the 10-min window in `snapshot()` / `getRun()` (PR #365). No live-detail change needed.
- WS command failure → existing `getRunDetail` error path unchanged; dialog closes if it returns null.

## Testing

- `workflow-watch-io.adapter.test.ts` — `readWorkflowRunJournal`:
  - parses started + result lines
  - skips blank / unparseable / wrong-shape lines
  - returns `[]` for missing file
- `workflow-registry.test.ts` — `getRun` running enrich:
  - running run with N `started` returns `agentCount:N`, all agents `state:"running"`
  - running run with `started`+`result` for the same agent returns `state:"completed"` with `label` from `dir` basename and `lastToolSummary:"fixed N, test:..."`
  - sidecar (terminal) still wins over the synthetic running run
  - dep absent → falls back to `phases:[]`, `agents:[]` (current behavior)
- `WorkflowsSection` client test — re-fetch on push:
  - dialog open on a running row; mock `getRunDetail` to return a different agents[] on the second call; new `runs` prop triggers re-fetch; dialog renders the new agents[] WITHOUT a "loading" flash (no `selectedRun === "loading"` between the two states)
  - terminal sidecar arriving in `runs` stops further `getRunDetail` calls
  - render-loop check (`renderForLoopCheck`) confirms no React error #185

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Journal-parse cost per push (panel has many chats) | Parse only in `getRun` (dialog), not in `snapshot()`. Panel row stays light. | Registry test for snapshot does not call `readRunJournal`. |
| Hot loop: snapshot push → re-fetch → snapshot push | `getRun` is a server command, not a write — does not fire the watcher. Watcher only fires on file writes, which are bounded by Claude's agent cadence. | Manual smoke + client effect test that asserts a bounded number of fetches per snapshot. |
| Re-fetch races (out-of-order responses) | `useEffect` cleanup discards stale promise resolutions; only the latest fetch's `setSelectedRun` lands. | Client test races two `getRunDetail` returns. |
| Token / tool-call still missing live | Out of scope: those numbers only live in the heavy `agent-*.jsonl` files. They appear when the sidecar lands. UI already guards `!= null` per field. | n/a |

## Out of scope

- Live `totalTokens` / `totalToolCalls` (requires parsing `agent-*.jsonl` — too heavy).
- Live phase data (not in journal — sidecar only).
- Showing live runs in the panel row counts (`agentCount` in the row, not the dialog).
- A new "agents" WS sub-topic.

## c3 impact

- `c3-229 workflow-status`: Contract gains `readWorkflowRunJournal` (adapter) row + `getRun` row updated to mention running enrich.
- ADR: `adr-YYYYMMDD-workflow-running-realtime-detail`.

## Verification (definition of done)

- `bun test src/server/workflow-watch-io.adapter.test.ts src/server/workflow-registry.test.ts src/client/app/WorkflowsSection.test.tsx` — all pass.
- `bun run lint` — 0 errors.
- `c3x check` — structural PASS, ADR clean.
- Manual on live run: open dialog on a running row, observe agents[] populate and update as the journal grows; observe no flicker.
