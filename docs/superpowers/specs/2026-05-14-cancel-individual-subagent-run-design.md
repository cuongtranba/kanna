# Cancel Individual Subagent Run — Design

**Goal:** Allow a user to cancel a single running subagent without
cancelling the parent chat. Cancellation cascades to running
descendant runs and tears down the underlying provider stream
immediately.

**Baseline:** Phase 5 (interactive tools + payload cap) and the
follow-up audit fixes (PR #93, #94) are merged. The orchestrator
already tracks `timeoutsByRun: Map<runId, PausableTimeout>` and
exposes `cancelChat(chatId)` for chat-wide cancel.

## Decisions captured during brainstorming

| Question | Answer |
|---|---|
| UI affordance | X button on the `SubagentMessage` envelope, while `status === "running"` (covers queued + active + pendingTool states — all stored as `running` in the reducer). |
| Children of cancelled run | Cascade — running children get cancelled too. With current `DEFAULT_MAX_CHAIN_DEPTH = 1`, chained children are spawned only after the parent's `subagent_run_completed` event, so at any given moment a running parent has no running children. The cascade implementation is kept for forward-compat with higher chain depths but is a noop on today's defaults. |
| Event / error code | `subagent_run_failed { code: "USER_CANCELLED" }` (new code added to `SubagentErrorCode`). |
| Provider session lifecycle | Hard abort: `AbortController.abort()` on the SDK stream. |

## Architecture

### Server

#### `src/shared/types.ts`

Extend the error code union — keep all existing values:

```ts
export type SubagentErrorCode =
  | "AUTH_REQUIRED"
  | "UNKNOWN_SUBAGENT"
  | "LOOP_DETECTED"
  | "DEPTH_EXCEEDED"
  | "TIMEOUT"
  | "PROVIDER_ERROR"
  | "INTERRUPTED"
  | "USER_CANCELLED"
```

#### `src/shared/protocol.ts`

New client command:

```ts
| {
    type: "chat.cancelSubagentRun"
    chatId: string
    runId: string
  }
```

#### `src/server/subagent-orchestrator.ts`

Replace `timeoutsByRun: Map<string, PausableTimeout>` with a single
per-run state map:

```ts
interface RunState {
  chatId: string
  parentRunId: string | null
  childRunIds: Set<string>
  abortController: AbortController
  timeout: PausableTimeout
  cancelled: boolean
}

private readonly runStateByRunId = new Map<string, RunState>()
```

`spawnRun` changes:

- Construct a `RunState` for the new `runId` **before** calling
  `acquire()`, immediately after the `subagent_run_started` event is
  appended. This is required because the reducer marks the run as
  `status: "running"` from the moment of `subagent_run_started`, and
  the UI exposes a cancel button for that state — so the orchestrator
  must accept `cancelRun` even while the run is still waiting for a
  permit. The `RunState` is registered with a `pendingAcquire: true`
  flag and a `permitWaiterReject` slot wired into `acquire()`.
- Modify `acquire()` to register a per-call `reject` handle on the
  `RunState` so `cancelRun` can fire it. When a queued run is
  cancelled, the `acquire()` Promise rejects with
  `new Error("USER_CANCELLED")`, the existing catch in `spawnRun`
  routes it through `failRun` with the new `USER_CANCELLED` code, and
  the permit is never acquired (so no `releaseSlot` mismatch). The
  `acquire()` reject path is the **only** way `subagent_run_started`
  events for cancelled-while-queued runs become `subagent_run_failed`
  events.
- If `args.parentRunId != null`, look up the parent's `RunState` and
  add this `runId` to its `childRunIds`.
- Plumb `runState.abortController.signal` into `startProviderRun` via
  a new field on `SubagentOrchestratorDeps.startProviderRun` args
  (`abortSignal: AbortSignal`).
- Race the existing `Promise.race([runStart.start(...), timeoutRejection.promise])`
  with `abortPromise` derived from the signal, which rejects with
  `new Error("USER_CANCELLED")`.
- After `Promise.race` resolves successfully, check
  `runState.cancelled` before appending `subagent_run_completed`. If
  cancelled, route through `failRun(..., "USER_CANCELLED", ...)`
  instead. Some providers (Codex via app-server) finish the stream
  on `stopSession()` rather than rejecting, so a cancelled run can
  otherwise sneak into the completed path.
- On any terminal path (completed, failed, cancelled, timeout), remove
  the entry from `runStateByRunId` and from the parent's `childRunIds`.

New public method:

```ts
cancelRun(chatId: string, runId: string): void {
  const state = this.runStateByRunId.get(runId)
  if (!state || state.cancelled) return
  if (state.chatId !== chatId) return // sanity guard
  state.cancelled = true
  for (const childRunId of [...state.childRunIds]) {
    this.cancelRun(chatId, childRunId)
  }
  if (state.pendingAcquire && state.permitWaiterReject) {
    state.permitWaiterReject(new Error("USER_CANCELLED"))
  } else {
    state.abortController.abort()
  }
  // Either path lands in spawnRun's catch block with message
  // === "USER_CANCELLED", which routes through failRun → onRunTerminal.
}
```

The failRun catch block in `spawnRun` distinguishes the three
error messages: `"TIMEOUT"`, `"USER_CANCELLED"`, anything else.

`notifySubagentToolPending` / `notifySubagentToolResolved` are
updated to access the timeout via `runStateByRunId.get(runId)?.timeout`.

#### `src/server/subagent-orchestrator.ts` — `cancelChat`

`cancelChat(chatId)` keeps its current semantics (rejects waiters
for permits, adds chatId to `cancelledChats`) but ALSO iterates
`runStateByRunId` and calls `cancelRun(chatId, runId)` on every
match. Eliminates the previous behaviour where chat-cancel left
already-acquired runs to finish on their own.

#### `src/server/agent.ts` and `src/server/subagent-provider-run.ts`

- `buildSubagentProviderRunForChat` accepts the orchestrator-supplied
  `abortSignal` and passes it into the provider session factory.
- For Claude: forward via the SDK's `signal` option on `query()`
  (verify the option name in the currently pinned
  `@anthropic-ai/claude-agent-sdk` version; if absent, fall back to
  racing the stream consumer with the abort signal so the consumer
  exits cleanly).
- For Codex: subagent sessions are scoped as `` `sub:${runId}` ``
  (see `CodexSessionScope` in `src/server/codex-app-server.ts`). On
  `signal.aborted`, call
  `codexManager.stopSession(chatId, \`sub:${runId}\`)` — the existing
  `subagent-provider-run.ts` already constructs that scope when
  starting the run, so the matching scope must be used to stop it.
- The Codex `stopSession` impl finishes the pending stream queue
  rather than rejecting it. To prevent a cancelled run leaking into
  the completed path, the orchestrator's post-`Promise.race` block
  re-checks `runState.cancelled` (see `spawnRun` changes above).
- New public method:

  ```ts
  async cancelSubagentRun(
    command: Extract<ClientCommand, { type: "chat.cancelSubagentRun" }>,
  ) {
    this.subagentOrchestrator.cancelRun(command.chatId, command.runId)
    // failRun already calls onRunTerminal → rejectPendingResolversForRun,
    // but state-change broadcasts in the multi-subagent fan-out path
    // wait for Promise.all to finish. Emit immediately so the UI
    // reflects the terminal status without waiting on siblings.
    this.emitStateChange(command.chatId)
  }
  ```

  `cancelRun` is synchronous and idempotent. The actual event append
  + resolver rejection happens via the orchestrator's existing
  `failRun` and `onRunTerminal` plumbing; the explicit
  `emitStateChange` covers the case where cancellation happens during
  the `Promise.all` over multiple subagent runs in
  `runMentionsForUserMessage`, which only emits after the whole
  batch resolves.

#### `src/server/ws-router.ts`

Route the new command to `coordinator.cancelSubagentRun`.

### Client

#### `src/client/components/messages/SubagentMessage.tsx`

When `run.status === "running"`, render a small X icon button in the
envelope header (left of the existing "streaming…" indicator). New
prop:

```ts
onCancelSubagentRun?: (chatId: string, runId: string) => void
```

Clicking dispatches via the prop. The button is hidden once
`run.status !== "running"`. While `run.pendingTool != null`, the
button is still shown — user may want to cancel rather than answer.

#### `src/client/app/KannaTranscript.tsx` and `src/client/app/ChatPage/ChatTranscriptViewport.tsx`

Active chat rendering goes through `ChatTranscriptViewport`
(rendered from `src/client/app/ChatPage/index.tsx`), and exported
transcripts / standalone history use `KannaTranscript`. Both
surfaces render `SubagentMessage` and both must thread the new
`onCancelSubagentRun(chatId, runId)` callback. Only the
`ChatTranscriptViewport` path actually dispatches a WS command — the
exported viewer can pass a noop so the X button is hidden in
export mode (or the callback can be optional and the button only
renders when the callback is present, which is preferred).

## Data flow

```
User clicks X on SubagentMessage(run-A in chat-1)
  → WS client: send { type: "chat.cancelSubagentRun", chatId: "chat-1", runId: A }
  → ws-router: coordinator.cancelSubagentRun(command)
  → AgentCoordinator.cancelSubagentRun
  → SubagentOrchestrator.cancelRun("chat-1", A):
      1. lookup runState[A]; if missing or cancelled → noop
      2. mark state.cancelled = true
      3. for each runId in state.childRunIds: cancelRun(chatId, child) (recursive)
      4. state.abortController.abort()
  → spawnRun(A)'s Promise.race rejects with Error("USER_CANCELLED")
  → catch block matches "USER_CANCELLED" → failRun(..., "USER_CANCELLED", ...)
  → failRun appends subagent_run_failed { code: "USER_CANCELLED" }
  → failRun invokes deps.onRunTerminal(chatId, A, "failed")
  → AgentCoordinator.rejectPendingResolversForRun(chatId, A)
       rejects any canUseTool Promise so SDK unwinds
  → finally block in spawnRun: clear timeout, remove from runStateByRunId,
    drop from parent's childRunIds, releaseSlot()
```

## Error handling

| Scenario | Behaviour |
|---|---|
| Cancel runId not in `runStateByRunId` | No-op. Run already terminal or never existed. |
| Cancel runId already cancelled | No-op (`state.cancelled` guard). |
| `command.chatId` does not match `state.chatId` | No-op. Sanity guard against accidental cross-chat cancel. |
| Cancel during `pendingTool` wait | Abort fires; pending tool Promise rejects via existing `onRunTerminal` → `rejectPendingResolversForRun`. |
| Cancel of grandparent that has children already completed | Children whose state was removed are not in the parent's `childRunIds` anymore — cascade is naturally bounded. |
| Cancel during `acquire()` permit wait | `cancelRun` cannot reach `runStateByRunId` entry (not yet created). Use existing `cancelChat`-style permit-waiter rejection: not applicable since the user is cancelling a specific run that hasn't acquired yet. Cancel becomes a no-op until acquire completes. Acceptable — the run is queued, not actually running. |

## Provider-specific abort semantics

**Claude SDK:** The Claude Agent SDK `query()` call accepts an
`AbortSignal` via its options. Plumb `runState.abortController.signal`
in. Abort throws `AbortError` synchronously into the stream consumer,
which surfaces as a rejection from `runStart.start(...)`.

**Codex:** No native abort. On `signal.aborted` (subscribed via
`signal.addEventListener("abort", ...)` inside
`buildSubagentProviderRunForChat`), call
`codexManager.stopSession(chatId, runId-scoped)` to kill the underlying
process. Existing teardown path closes the stream and the
`runStart.start(...)` Promise resolves/rejects depending on what was
buffered. The orchestrator catch block treats anything-not-completed
as `USER_CANCELLED` because `state.cancelled` is already true.

## Testing

### Unit — orchestrator

- `cancelRun` marks state, aborts, and appends
  `subagent_run_failed { code: "USER_CANCELLED" }`.
- `cancelRun` cascades through a 2-level chain (A → B → C). Cancelling
  A produces `USER_CANCELLED` events for B and C in order.
- `cancelRun` on a completed run is a no-op (no extra event).
- `cancelRun` on a run that has not yet acquired its permit is a no-op.
- `cancelRun` during `pendingTool` rejects the canUseTool Promise via
  the existing `onRunTerminal` hook (covered by adding a test mode
  that registers a fake resolver).

### Unit — agent

- `AgentCoordinator.cancelSubagentRun` routes to orchestrator.
- Cancelling a subagent in a chat with an active main turn does not
  affect the main turn's state.

### Unit — ws-router

- `chat.cancelSubagentRun` command is dispatched to the coordinator.

### Client

- `SubagentMessage` renders the X button only while
  `run.status === "running"`.
- Clicking the X button calls `onCancelSubagentRun(chatId, runId)`.
- `SubagentMessage` does not render the X button on `completed` /
  `failed` / `cancelled` runs.

## Migration / compatibility

- New `SubagentErrorCode` value: `SubagentErrorCard.badgeText`
  (`src/client/components/messages/SubagentErrorCard.tsx`) currently
  has no default case and explicitly handles each code, so adding a
  new code WITHOUT a matching `badgeText` entry would render an
  undefined badge. The plan must add a `USER_CANCELLED` case to
  `badgeText` (and any other per-code copy switches) — confirmed
  required, not optional. Copy: "Cancelled by you".
- New event payload: none — reuses existing
  `subagent_run_failed` shape.
- No `STORE_VERSION` bump required.

## Out of scope

- Retry after cancel.
- Cancel from any UI surface other than the subagent envelope.
- Status filter for cancelled runs in sidebar / history.
- Telemetry / analytics for cancel events (can be added later).
