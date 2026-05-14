# Phase 5 — Interactive Tools + Payload Cap

Date: 2026-05-14
Status: Design (approved, ready for implementation plan)
Depends on: Phase 4 (`docs/superpowers/plans/2026-05-14-model-independent-chat-phase4-real-provider-completion.md`, merged commit `52d22ce`)

## Goal

Two related infra slices shipped as a single atomic phase:

1. **Interactive-tool forwarding.** Replace phase 4's auto-deny stub
   (`agent.ts:1646-1681`) so `AskUserQuestion` and `ExitPlanMode` calls
   from inside a subagent route to the parent chat's UI, the user
   answers, and the answer flows back to the subagent's SDK process.
2. **Payload cap.** Stop `subagent_entry_appended` from inflating
   `turns.jsonl` by adopting claude-code's persist-to-disk pattern:
   tool_result content > 50 KB is written to a file alongside the chat
   log, and the durable event carries only a 2 KB preview + filepath.

Both touch the `subagent_entry_appended` event family and the
`SubagentRunSnapshot` read model, so they ship together in one PR.

## Non-goals

- Per-message aggregate cap (claude-code's
  `MAX_TOOL_RESULTS_PER_MESSAGE_CHARS = 200_000`). Subagent runs
  serialize entries through `drainHarnessTurn`'s `for await`, so the
  per-entry cap is sufficient for v1.
- Compaction pass (delete old `subagent_entry_appended` entries after
  N days). Disk-spill keeps `turns.jsonl` small forever; on-disk files
  age out via existing chat-delete cleanup.
- Retry button, per-row cancel, fan-out synthesis, depth=2,
  per-subagent credentials picker, session caching. All deferred to
  phase 6.

## Decisions (consolidated from brainstorming Q&A)

| # | Topic | Decision |
|---|-------|----------|
| 1 | UI placement | Pending card renders **inside** `SubagentMessage` envelope, per run. |
| 2 | Concurrent pending | Allow up to `MAX_PARALLEL=4` pending cards simultaneously. No queue. |
| 3 | Run timeout vs pending | Run wall-clock (default 600 s) **pauses** while `pendingTool != null`. |
| 4 | Server restart mid-pending | Run marked `failed` with new `SubagentErrorCode = "INTERRUPTED"`. |
| 5 | Payload cap | Match claude-code: 50 KB threshold, 2 KB preview, persist full content to disk. |
| 6 | Per-message aggregate cap | Deferred. Subagent entries serialized, not batched. |
| 7 | Atomic delivery | Single PR. Both slices share `subagent_entry_appended` and `SubagentRunSnapshot`. |

## Architecture

```
┌─ Interactive Forwarding ──────────────────┐  ┌─ Payload Cap ────────────────┐
│ Per-run pendingTool slot on               │  │ 50 KB threshold per entry    │
│ SubagentRunSnapshot (in-memory + replay   │  │ → write to disk              │
│ from durable event)                       │  │ → 2 KB preview + filepath    │
│                                            │  │ → entry.persisted flag       │
│ New events:                                │  │                              │
│  - subagent_tool_pending                   │  │ Applied in:                  │
│  - subagent_tool_resolved                  │  │  appendSubagentEvent before  │
│                                            │  │  reducer + durable write     │
│ New ws command:                            │  │                              │
│  - chat.respondSubagentTool                │  │ Disk path:                   │
│                                            │  │  <kannaRoot>/projects/       │
│ Promise resolver map in AgentCoordinator   │  │  <projectId>/chats/<chatId>/ │
│ keyed by chatId::runId::toolUseId          │  │  subagent-results/<runId>/   │
│                                            │  │  <toolUseId>.<txt|json>      │
│ Restart recovery: orphan pending →         │  │                              │
│ subagent_run_failed { INTERRUPTED }        │  │                              │
└────────────────────────────────────────────┘  └──────────────────────────────┘
```

### Invariants

1. Promise resolver lives only in memory. Durable
   `subagent_tool_pending` is the UI source of truth across reloads.
2. Cap applied **once** at event write time. Replay reads capped
   content; no re-cap.
3. Persisted files scoped per chat. Chat delete → directory delete.
4. Run timeout pauses on `subagent_tool_pending`, resumes on
   `subagent_tool_resolved`.

## Data model

### `SubagentRunSnapshot` (`src/shared/types.ts:1316`)

Add one field:

```ts
pendingTool: SubagentPendingTool | null
```

with:

```ts
type SubagentPendingTool = {
  toolUseId: string
  toolKind: "ask_user_question" | "exit_plan_mode"
  input: unknown          // HarnessToolRequest.tool.input passthrough
  requestedAt: number     // freezes timeout clock
}
```

### `TranscriptEntry` (tool_result kind)

Extend the existing `tool_result` variant in `src/shared/types.ts`:

```ts
{
  kind: "tool_result"
  toolId: string
  content: unknown        // preview string when persisted; original otherwise
  persisted?: {
    filepath: string      // absolute path
    originalSize: number  // bytes
    isJson: boolean
    truncated: true       // sentinel
  }
}
```

Client gates on `entry.persisted != null` to render the
"View full output" affordance. Server never sets `persisted` for
non-tool_result kinds.

### `SubagentErrorCode` (`src/shared/types.ts`)

Add `"INTERRUPTED"` to the enum.

## Events

Add two variants to `SubagentRunEvent` (`src/server/events.ts:281`).
No version bump — additive on `v: 3`.

```ts
| {
    v: 3
    type: "subagent_tool_pending"
    timestamp: number
    chatId: string
    runId: string
    toolUseId: string
    toolKind: "ask_user_question" | "exit_plan_mode"
    input: unknown
  }
| {
    v: 3
    type: "subagent_tool_resolved"
    timestamp: number
    chatId: string
    runId: string
    toolUseId: string
    result: unknown
    resolution: "user" | "auto_deny" | "interrupted"
  }
```

### Reducers (`src/server/event-store.ts`)

- `subagent_tool_pending`: set
  `run.pendingTool = { toolUseId, toolKind, input, requestedAt: timestamp }`.
- `subagent_tool_resolved`: clear `run.pendingTool = null`; push a
  synthetic `tool_result` `TranscriptEntry` into `run.entries` so the
  transcript projection shows the resolved answer.

### `subagent_entry_appended` cap pass

Existing reducer (events.ts:330) gets a pre-step in the appender:

```ts
async function appendSubagentEntryEvent(event) {
  if (event.entry.kind === "tool_result") {
    event.entry = await capTranscriptEntry({ entry: event.entry, ... })
  }
  writeDurable(event)
  applyReducer(event)
}
```

Replay reads the already-capped event. JSONL stays bounded.

## Server orchestration

### `onToolRequest` rewrite (`src/server/agent.ts:1646-1681`)

```ts
const onToolRequest = async (request: HarnessToolRequest): Promise<unknown> => {
  if (request.tool.toolKind !== "ask_user_question"
      && request.tool.toolKind !== "exit_plan_mode") {
    return null
  }

  await this.store.appendSubagentEvent({
    v: 3,
    type: "subagent_tool_pending",
    chatId: args.chatId,
    runId: args.runId,
    toolUseId: request.tool.toolId,
    toolKind: request.tool.toolKind,
    input: request.tool.input,
    timestamp: Date.now(),
  })
  this.emitStateChange(args.chatId)

  return await new Promise<unknown>((resolve, reject) => {
    this.subagentPendingResolvers.set(
      pendingKey(args.chatId, args.runId, request.tool.toolId),
      { resolve, reject },
    )
  })
}
```

New `AgentCoordinator` state:

```ts
private subagentPendingResolvers = new Map<
  string,
  { resolve: (v: unknown) => void; reject: (e: Error) => void }
>()
// key: `${chatId}::${runId}::${toolUseId}`
```

### New ws command

```ts
{
  type: "chat.respondSubagentTool"
  chatId: string
  runId: string
  toolUseId: string
  result: unknown
}
```

Handler steps:
1. Look up resolver by composite key.
2. Reject if missing (stale message) → throw `"No pending subagent tool"`.
3. Append `subagent_tool_resolved { resolution: "user", result }` to log.
4. Call `resolver.resolve(result)` → SDK gets `tool_result`, run continues.
5. Delete from map.

### Timeout pause

Orchestrator currently enforces `runTimeoutMs` via
`Promise.race([runPromise, timeout])`. Replace with sliding window:

- Start: schedule timeout for 600 s from `startedAt`.
- On `subagent_tool_pending`: clear timeout, capture
  `elapsedBeforePause = Date.now() - startedAt`.
- On `subagent_tool_resolved`: reschedule for
  `runTimeoutMs - elapsedBeforePause` from now (subtracting cumulative
  active time across multiple pause/resume cycles).

### Cancellation

Existing per-chat cancel: if a run has a pending tool, reject the
resolver with cancellation error → orchestrator catches → emits
`subagent_run_cancelled`. No new code path; the existing rejection
fans out through the same Promise chain.

### Restart recovery

Orchestrator constructor, after the event-store replay completes:

```ts
for (const run of store.allSubagentRuns()) {
  if (run.status === "running" && run.pendingTool != null) {
    await store.appendSubagentEvent({
      v: 3,
      type: "subagent_run_failed",
      chatId: run.chatId,
      runId: run.runId,
      error: {
        code: "INTERRUPTED",
        message: "Server restart while subagent awaited tool response",
      },
      timestamp: now(),
    })
  }
}
```

Guard: only acts when `pendingTool != null`, so v4 runs (which never
set `pendingTool`) are untouched.

## Payload cap

### New module `src/server/subagent-entry-cap.ts` (~80 LOC)

```ts
const SUBAGENT_RESULT_THRESHOLD = 50_000  // bytes
const PREVIEW_SIZE = 2000                 // bytes

export async function capTranscriptEntry(args: {
  entry: TranscriptEntry
  chatId: string
  runId: string
  projectId: string
  kannaRoot: string
}): Promise<TranscriptEntry>
```

Logic:

1. Only act on `kind === "tool_result"`. Passthrough other kinds.
2. Compute content size (string length, or sum of text-block lengths
   for structured content).
3. If size ≤ 50 KB → return entry unchanged.
4. Else:
   - `dir = <kannaRoot>/projects/<projectId>/chats/<chatId>/subagent-results/<runId>`
   - `mkdir -p dir`
   - `filepath = <dir>/<toolUseId>.<txt|json>` (`.json` if content is
     a structured array)
   - Write full content with flag `wx` (exclusive write). Swallow
     `EEXIST` — replay/restart can re-call with the same toolUseId.
   - Build preview: first 2000 bytes, cut at last newline if within
     the trailing 50 % of the limit (claude-code's `generatePreview`
     behavior).
   - Return entry with:
     ```
     content: "<persisted-output>\nOutput too large (51 KB). Full output saved to: <path>\n\nPreview (first 2 KB):\n<preview>\n...\n</persisted-output>"
     persisted: { filepath, originalSize, isJson, truncated: true }
     ```

### Disk path layout

```
<kannaRoot>/
  projects/
    <projectId>/
      chats/
        <chatId>/
          subagent-results/
            <runId>/
              <toolUseId>.txt   # or .json
```

`<kannaRoot>` is the project data dir resolver already used by
`event-store.ts`. Look up the exact accessor at implementation time.

### Cleanup

When a chat is deleted, also remove
`<projectId>/chats/<chatId>/subagent-results/`. Hook into the
existing chat-delete path in `event-store.ts` (locate via grep during
implementation). Best-effort: log on failure, don't block delete.

### Per-message aggregate cap

Deferred. Subagent entries flow one-at-a-time through
`drainHarnessTurn`'s `for await`, so N-parallel tool result blasts
don't happen at this layer. If future provider integrations batch
tool results, lift claude-code's `enforceToolResultBudget`.

## Client

### `SubagentPendingToolCard.tsx` (new, ~60 LOC)

Renders the pending UI inside the subagent envelope:

```tsx
type Props = {
  chatId: string
  runId: string
  pendingTool: SubagentPendingTool
  onRespond: (result: unknown) => void
}

// switch (pendingTool.toolKind):
//   "ask_user_question" → <AskUserQuestionMessage>
//   "exit_plan_mode"   → <ExitPlanModeMessage>
```

Reuse existing `AskUserQuestionMessage.tsx` and
`ExitPlanModeMessage.tsx`. If their submit handler is hard-wired to
the primary `chat.respondTool` command, refactor: lift the submit
callback to a prop so both primary chat and subagent envelope can
inject their own dispatch.

### `SubagentMessage.tsx`

After the existing entry render loop, if `run.pendingTool != null`,
append a `SubagentPendingToolCard` whose `onRespond` dispatches:

```ts
sendCommand({
  type: "chat.respondSubagentTool",
  chatId,
  runId: run.runId,
  toolUseId: run.pendingTool!.toolUseId,
  result,
})
```

### Persisted tool_result rendering

`SubagentEntryRow.tsx` (added in phase 4): when
`entry.persisted != null`, render the preview content plus a
"View full output" button. The button calls
`mcp__kanna__offer_download` (or reuses the existing
markdown-link download path from commit `67fb665`) with
`entry.persisted.filepath`. The preview itself contains the
`<persisted-output>` tag verbatim; client can strip the tags for
display.

### State plumbing

`pendingTool` rides existing `ChatSnapshot.runtime.subagentRuns`. No
new store slice. Render-loop check: ensure the `useStore` selector
that exposes `subagentRuns` returns a stable reference (per
CLAUDE.md). Existing phase 3 selector likely already uses
`useShallow`; verify and reuse.

### Visual treatment

Pending card: subtle left-border accent + "awaiting your response"
pill, distinct from completed entries. Match primary-chat pending
tool style for consistency.

## Tests

### Server

1. `src/server/subagent-entry-cap.test.ts` (new)
   - String content < 50 KB → passthrough, no file written.
   - String content > 50 KB → file exists, content == preview,
     `persisted.originalSize` matches.
   - Structured JSON content > 50 KB → `.json` extension, valid JSON
     on disk.
   - Idempotent: re-call with same toolUseId → `EEXIST` swallowed,
     preview still returned.
   - Preview cuts at newline boundary if within last 50 % of limit.

2. `src/server/event-store.test.ts` (extend)
   - Append `subagent_entry_appended` with 100 KB content → JSONL
     line is ≤ ~3 KB (preview + framing).
   - Replay → `run.entries[0].content` is preview,
     `entry.persisted.truncated === true`.

3. `src/server/subagent-orchestrator.test.ts` (extend)
   - Mock `ProviderRunStart.start` to call `onToolRequest` with
     `ask_user_question` → assert `subagent_tool_pending` event
     written; resolve via `respondSubagentTool` → assert
     `subagent_tool_resolved` written and Promise resolved with the
     given result.
   - Restart mid-pending: replay log → construct orchestrator →
     assert `subagent_run_failed { code: "INTERRUPTED" }` emitted.
   - Timeout pause: pending tool held for > 600 s wall clock; assert
     run not timed out; resolve; assert clock resumes for remainder.

4. `src/server/agent.test.ts` (extend mention-gating test at
   3264-3291) — end-to-end: subagent calls `AskUserQuestion` →
   snapshot has `pendingTool` → ws respond → run completes.

### Client

5. `src/client/components/messages/SubagentMessage.test.tsx`
   (extend)
   - Snapshot with `pendingTool: { toolKind: "ask_user_question" }`
     → renders `AskUserQuestionMessage`.
   - Submit answer → fires `chat.respondSubagentTool` command with
     correct payload (chatId, runId, toolUseId, result).
   - Entry with `persisted.truncated` → renders preview +
     "View full output" affordance.

6. `useKannaState` selector test — `pendingTool` flows through
   snapshot unchanged; selector returns stable ref across renders
   with identical input.

### Manual smoke (PR test plan)

- Create a Claude subagent whose system prompt forces an
  `AskUserQuestion` call; trigger via `@agent/<name>`; verify card
  appears inside the envelope; answer; run completes.
- Same for `ExitPlanMode` with a Codex subagent in plan mode.
- Force a large bash output (`find /` style) inside a subagent;
  verify "Output too large" preview card with working
  "View full output" button.
- Kill server mid-pending → restart → verify run shows
  `INTERRUPTED` error card.

## Migration & rollout

### Backward compat

1. **Existing `subagent_entry_appended` events from phase 4** have
   full content and no `persisted` field. Reducer reads them
   unchanged; client renders content as-is. No backfill. Old logs
   stay big; new events get capped. Acceptable.
2. **In-flight runs at deploy:** phase 4 auto-deny still works if
   rolled back. Forward direction: restart-recovery guard
   (`pendingTool != null`) only fires on v5+ runs.
3. **No `STORE_VERSION` bump.** New events additive on `v: 3`. Old
   clients can't render `pendingTool` but won't crash — field is
   optional on snapshot.

### Feature flag

None. Phase 5 ships atomically. Rollback = revert PR.

### Telemetry

- `subagent_tool_pending` count per chat (UI engagement signal)
- `subagent_tool_persisted` size histogram (cap effectiveness)
- `subagent_run_interrupted` count (restart frequency)

All via existing `console.warn(LOG_PREFIX, ...)`. No new analytics
infra.

## File touch list

**Server (modify):**
- `src/server/agent.ts` — replace auto-deny in
  `buildSubagentProviderRunForChat`; add `subagentPendingResolvers`
  map; add `chat.respondSubagentTool` handler.
- `src/server/events.ts` — add two event variants to
  `SubagentRunEvent`.
- `src/server/event-store.ts` — add reducers; wire
  `capTranscriptEntry` into `subagent_entry_appended` append path;
  add restart-recovery loop.
- `src/server/subagent-orchestrator.ts` — sliding-window timeout
  pause logic.
- `src/server/subagent-provider-run.ts` — no functional change; the
  existing `onToolRequest` plumbing already forwards to the
  coordinator-supplied callback.
- `src/shared/types.ts` — `SubagentPendingTool`, extend
  `SubagentRunSnapshot`, extend `tool_result` `TranscriptEntry`,
  extend `SubagentErrorCode`.
- `src/shared/protocol.ts` — add `chat.respondSubagentTool` command
  shape.

**Server (new):**
- `src/server/subagent-entry-cap.ts` — disk-spill module.

**Client (modify):**
- `src/client/components/messages/SubagentMessage.tsx` — render
  pending card; render persisted tool_result entries.
- `src/client/components/messages/SubagentEntryRow.tsx` — branch on
  `entry.persisted` for "View full output" affordance.
- `src/client/components/messages/AskUserQuestionMessage.tsx` and
  `ExitPlanModeMessage.tsx` — only if submit handler refactor needed
  (lift dispatch to prop).
- `src/client/app/useKannaState.ts` — verify selector stability for
  `subagentRuns` carrying `pendingTool`.

**Client (new):**
- `src/client/components/messages/SubagentPendingToolCard.tsx`.

**Tests:** 4 new/extend (see Tests section).

Approx delta: ~12 files, ~800–1000 LOC.

## Out of scope (deferred to phase 6)

- Per-message aggregate cap (`MAX_TOOL_RESULTS_PER_MESSAGE_CHARS`).
- Retry button wiring on `SubagentErrorCard`.
- Per-row cancel button per `SubagentMessage`.
- Fan-out + primary synthesis (combine sibling outputs back into a
  primary reply).
- `MAX_CHAIN_DEPTH = 2` opt-in.
- Per-subagent credentials picker.
- Subagent session token caching across runs.
- Compaction pass for old `subagent_entry_appended` entries.
