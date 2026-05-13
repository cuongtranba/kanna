# Phase 3 — Subagent Orchestration & UI

Date: 2026-05-13
Status: Design (depends on phases 1 + 2; not implementation-ready until both ship)
Parent: [Model-Independent Chat Sessions — Overview](./2026-05-13-model-independent-chat-sessions-design.md)
Depends on: [Phase 1](./2026-05-13-model-independent-chat-phase1-provider-switching.md), [Phase 2](./2026-05-13-model-independent-chat-phase2-subagent-crud.md)

## Goal

Run subagents that were parsed in phase 2. Parallel fan-out on multi-mention,
depth-1 chained delegation, full error surface, transcript projection.
Native SDK `Agent` tool stays untouched as a separate primary-driven mechanism.

## Read model (consensus item 7)

```ts
type SubagentErrorCode =
  | "AUTH_REQUIRED"
  | "UNKNOWN_SUBAGENT"
  | "LOOP_DETECTED"
  | "DEPTH_EXCEEDED"
  | "TIMEOUT"
  | "PROVIDER_ERROR"

type SubagentRunSnapshot = {
  runId: string                    // ULID
  chatId: string
  subagentId: string               // route by id (consensus item 16)
  subagentName: string             // display only, snapshotted at start
  provider: AgentProvider
  model: string
  status: "running" | "completed" | "failed" | "cancelled"
  parentUserMessageId: string
  parentRunId: string | null       // null = user-triggered
  depth: number                    // 0 user-triggered, 1 chained
  startedAt: number
  finishedAt: number | null
  finalText: string | null
  error: { code: SubagentErrorCode; message: string } | null
  usage: ProviderUsage | null
}
```

Attached to the chat snapshot as `subagentRuns: Map<runId, SubagentRunSnapshot>`.

## Events

Durable events live in `turns.jsonl` (consensus item 7). Transcript JSONL
holds a derived projection only. All new event types stay at the current
`STORE_VERSION = 3` — no bump (see phase 1 §"Event shape additions").

```ts
type SubagentRunStartedEvent = {
  v: 3
  type: "subagent_run_started"
  timestamp: number
  chatId: string
  runId: string
  subagentId: string
  subagentName: string             // snapshotted to survive renames
  provider: AgentProvider
  model: string
  parentUserMessageId: string
  parentRunId: string | null
  depth: number
}

type SubagentMessageDeltaEvent = {
  v: 3
  type: "subagent_message_delta"
  timestamp: number
  chatId: string
  runId: string
  content: string                  // appended
}

type SubagentRunCompletedEvent = {
  v: 3
  type: "subagent_run_completed"
  timestamp: number
  chatId: string
  runId: string
  finalContent: string
  usage?: ProviderUsage
}

type SubagentRunFailedEvent = {
  v: 3
  type: "subagent_run_failed"
  timestamp: number
  chatId: string
  runId: string
  error: { code: SubagentErrorCode; message: string }
}

type SubagentRunCancelledEvent = {
  v: 3
  type: "subagent_run_cancelled"
  timestamp: number
  chatId: string
  runId: string
}
```

Reducer responsibilities:

- Build/update `subagentRuns` map.
- Derive transcript projection entries on completion (status terminal).
- Ordering tiebreak for siblings (consensus item 17): `startedAt` asc,
  then `runId` asc.

## Orchestrator

New module `src/server/subagent-orchestrator.ts`. Public surface:

```ts
runMentionsForUserMessage(args: {
  chatId: string
  userMessageId: string
  mentions: ParsedMention[]   // from phase 2
}): Promise<void>
```

Behavior:

```
runMentionsForUserMessage:
  resolved := mentions where kind === "subagent"
  unknown  := mentions where kind === "unknown-subagent"

  for each unknown:
    emit subagent_run_failed { code: "UNKNOWN_SUBAGENT" }

  Run resolved with concurrency = MAX_PARALLEL=4 (consensus item 14):
    queue overflow waits, never rejects.

  For each run:
    spawnRun({
      subagent,
      depth: 0,
      parentRunId: null,
      parentUserMessageId: userMessageId,
      input: primaryText,
      primer: subagent.contextScope === "full-transcript"
        ? buildHistoryPrimer(chatId, subagent.provider)
        : extractPreviousAssistantReply(chatId),
    })

  On run completion:
    chainedMentions := parseMentions(run.finalText, subagents)
    For each chained where kind === "subagent":
      if depth + 1 > MAX_CHAIN_DEPTH (=1):
        emit subagent_run_failed { code: "DEPTH_EXCEEDED" }
      else if subagentId in pathOf(run):
        emit subagent_run_failed { code: "LOOP_DETECTED" }
      else:
        spawnRun({ ..., parentRunId: run.runId, depth: run.depth + 1 })

  Primary turn does NOT auto-fire (consensus item 6).
```

### `previous-assistant-reply` extraction (consensus item 11)

```ts
function extractPreviousAssistantReply(chatId: string): string | null {
  // Walk primary turns backwards from current head.
  // Return the last `assistant_text` entry's combined text.
  // Exclude subagent messages.
  // Exclude tool-call summaries unless no text exists in that reply.
  // If no prior assistant reply exists, return null (caller skips primer).
}
```

### Path + loop detection (consensus item 8)

A run's path is `[subagentId₀, subagentId₁, ...]` walked via `parentRunId`.
Reject chained spawn if the new `subagentId` already appears in the path.
`MAX_CHAIN_DEPTH = 1` for v1: depth 0 + depth 1 allowed; depth 2 rejected.

### Auth / timeout / provider errors

- Pre-flight: check provider creds via existing auth gate. Miss →
  `AUTH_REQUIRED`, no provider call made.
- Per-run wall-clock cap (initial: 120s; configurable). Timeout →
  `TIMEOUT`, run cancelled, partial deltas retained as `finalText` for
  transcript.
- Provider-level errors (network, 5xx, malformed stream) →
  `PROVIDER_ERROR` with the underlying message.

### Session isolation

Per consensus, subagent runs are isolated: never read or write
`chat.sessionTokensByProvider`. Each run starts fresh with the subagent's
own provider config. A future optimization (per-subagent session token)
is out of scope.

## Send-flow integration

Phase 2 already stores `subagentMentions` on `message_appended`. Phase 3
wires the send handler:

```
On chat_send received:
  parsed := parseMentions(text, subagents, paths)
  append message_appended { ..., subagentMentions: parsed.subagents }

  if parsed.subagents.length > 0:
    orchestrator.runMentionsForUserMessage({ chatId, userMessageId, mentions: parsed })
    // primary does NOT fire
  else:
    enqueuePrimaryTurn(...)  // phase 1 path
```

History primer for primary turns (phase 1 builder) is reused for
`contextScope: "full-transcript"` subagents. Same `PRIMER_MAX_CHARS` cap.

## UI

`src/client/app/KannaTranscript.tsx`:

- New message kind `SubagentMessage` rendered as an assistant-shaped
  message with header `{providerIcon} {subagentName}` and a subtle
  accent-color left border.
- Multi-mention runs under the same user message render as a sibling
  group ordered by `startedAt` asc, `runId` asc (consensus item 17).
- Chained runs (`parentRunId` set) render indented one level under the
  parent run.
- Streaming indicator while `status === "running"`.
- Failed runs render an **inline error card** (consensus item 15 of the
  parent doc, or item 15-bis here) showing:
  - error code badge
  - human-friendly message
  - "Retry" action where applicable (`AUTH_REQUIRED` → opens settings;
    `TIMEOUT` / `PROVIDER_ERROR` → re-run button)
  - `LOOP_DETECTED` / `DEPTH_EXCEEDED` / `UNKNOWN_SUBAGENT` render as
    static error cards with no retry.

## Testing

`src/server/subagent-orchestrator.test.ts` (new):

- Parallel fan-out up to `MAX_PARALLEL=4` concurrently; 5th queues.
- History primer composition for `contextScope: "full-transcript"`.
- `previous-assistant-reply` extraction: skips subagent messages, picks
  last primary assistant text, falls back to tool summary, returns null
  on first turn.
- Parent/child wiring: `parentRunId`, `depth` set correctly.
- `MAX_CHAIN_DEPTH=1`: depth 2 attempt emits `DEPTH_EXCEEDED`.
- Loop detection: subagent whose reply mentions itself emits
  `LOOP_DETECTED`.
- Auth failure → `AUTH_REQUIRED`, no provider call.
- Timeout → `TIMEOUT`, partial deltas retained.
- Stale id → `UNKNOWN_SUBAGENT`.
- Renamed subagent mid-run: snapshot `subagentName` survives, run keeps
  rendering original name.

`src/server/event-store.test.ts` — extend:

- Replay with new `subagent_run_*` events produces the expected
  `subagentRuns` map.
- Sibling ordering: equal `startedAt` resolves by `runId` asc.

`src/client/app/KannaTranscript.test.tsx` — extend:

- Renders `SubagentMessage` grouped under triggering user message.
- Renders chained runs indented under parent.
- Renders inline error cards with correct affordance per error code.
- Status transitions (`running` → `completed` / `failed`) re-render
  correctly.

`src/client/components/chat-ui/ChatInput.test.tsx` — extend:

- Sending a message with `@agent/...` mentions does NOT trigger a primary
  turn.
- Sending plain text behaves as phase 1.

## Implementation order

1. Event types + reducer + `subagentRuns` map.
2. Orchestrator core (sequential spawn, no UI).
3. Parallel + chained + loop + depth tests.
4. Error code surface; auth/timeout/provider handling.
5. Transcript projection.
6. UI: `SubagentMessage` rendering.
7. UI: inline error cards.
8. UI: streaming indicator + chained indentation.

## Risk + rollback

- Orchestrator is additive — phase 1 and phase 2 ship without it. Disable
  by feature flag if needed; mentions become no-ops (parsed + recorded,
  never executed).
- New event types stay at the current `STORE_VERSION = 3`; older clients
  ignore unknown `type` values (existing unknown-event handling renders
  "Unsupported event"). Forward-compat preserved.
- Open follow-ups (not v1): per-subagent session token caching,
  fan-out + primary synthesis mode, `MAX_CHAIN_DEPTH=2`.
