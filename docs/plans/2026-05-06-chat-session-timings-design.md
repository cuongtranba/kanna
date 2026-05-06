# Chat Session Timings — Design

Date: 2026-05-06
Status: Draft (brainstorm complete, awaiting plan + implementation)

## Goal

Surface session and per-state timing information in the chat UI so the user can see, at a glance, how long the agent has been in its current state, how long the active working session has lasted, and how long the last turn took. Cover three surfaces: chat header, inline per-turn badge, sidebar row.

## Why

Today there is no visible timing anywhere. A user cannot tell how long a `running` state has been active, how long the chat has been worked on this session, or how long any individual turn took. This makes long agent runs feel opaque and makes it hard to reason about chat history at a glance.

## Scope (combo)

All three placements:
- **Header** — current state + duration, active-session age, last-turn duration.
- **Inline per-turn** — small duration badge on each completed turn (uses existing `result.durationMs`).
- **Sidebar row** — compact relative stamp (`2m`); replaced by state badge (`running 0:12`) when chat is not idle.

Format: compact (`42s`, `2m`, `1h 5m`, `1d 2h`); live state uses `M:SS`. Tooltip carries verbose / chat-lifetime breakdown.

Update model: snapshot only — refresh on event, no client-side ticking. Snapshot includes `derivedAtMs` so format stays stable across rerenders.

## Definitions

### Active session

A burst of work, terminated by any idle gap longer than `ACTIVE_SESSION_IDLE_GAP_MS = 30 * 60 * 1000` (30 minutes). The active session begins at the timestamp of the first event after the most recent such gap, or at `chat.createdAt` if there is no qualifying gap. Cumulative state durations are scoped to this window.

### State transitions

`KannaStatus = "idle" | "starting" | "running" | "waiting_for_user" | "failed"`.

Source mapping:
- `chat_created` → enter `idle`
- `turn_started` → enter `running`
- `turn_finished` / `turn_cancelled` → enter `idle`
- `turn_failed` → enter `failed`
- `waiting_for_user` → not eventized; tracked in-memory in `AgentManager` (hybrid model — see "Waiting-for-user").

`starting` is briefly set during turn boot before `turn_started` is recorded; treated as part of the upcoming `running` segment for cumulative purposes.

### Waiting-for-user (hybrid c)

`waiting_for_user` is set imperatively in `agent.ts` when a tool permission request is pending. It is not in the event log. Two consequences:

1. `idle/running/starting/failed` cumulative numbers are derived from the durable event log and survive server restart.
2. `waiting_for_user` cumulative is tracked in-memory by `AgentManager` (`waitStartedAt` per active turn). It resets on server restart. The read-model merges this in-memory map at derivation time.

This keeps the event log clean (no permission lifecycle events added) while still surfacing wait time correctly while the server is running.

## Data model

In `src/shared/types.ts`:

```ts
export interface ChatStateTimings {
  activeSessionStartedAt: number      // start of current burst
  chatCreatedAt: number               // for tooltip / lifetime view
  stateEnteredAt: number              // when current state began
  lastTurnDurationMs: number | null   // most recent completed turn
  derivedAtMs: number                 // server-side timestamp of derivation
  cumulativeMs: {
    idle: number
    starting: number
    running: number
    waiting_for_user: number
    failed: number
  }
}

export interface ChatRuntime {
  // ...existing fields
  timings: ChatStateTimings
}

export interface SidebarChatRow {
  // ...existing fields
  stateEnteredAt?: number             // for live state badge in sidebar
}
```

The full `ChatStateTimings` lives only on `ChatRuntime` (single chat at a time on screen). Sidebar gets only `stateEnteredAt` to keep payload small.

## Computation

New function in `src/server/read-models.ts`:

```ts
export function deriveTimings(
  chat: ChatRecord,
  events: StoreEvent[],         // chat-scoped events, ordered ascending
  activeStatus: KannaStatus | undefined,
  waitStartedAt: number | undefined,
  nowMs: number,
): ChatStateTimings
```

Algorithm — single linear pass:

1. Walk events newest→oldest to find `activeSessionStartedAt`. Track gaps between consecutive events; the first gap that exceeds `ACTIVE_SESSION_IDLE_GAP_MS` between the *end* of an idle segment and the next event terminates the burst. `activeSessionStartedAt` = timestamp of the event after the gap. If no gap qualifies, fall back to `chat.createdAt`.

2. Walk events oldest→newest from `activeSessionStartedAt`, tracking `(currentState, enteredAt)`. On each transition, accumulate `currentState`'s elapsed time into `cumulativeMs[currentState]` and update `(currentState, enteredAt)`.

3. Close the final segment at `nowMs`. If `activeStatus === "waiting_for_user"` and `waitStartedAt` is set, also add `nowMs - waitStartedAt` to `cumulativeMs.waiting_for_user` and override the current-state entry to that value. Else current state is the last derived state.

4. `lastTurnDurationMs` = `(turn_finished.timestamp - turn_started.timestamp)` for the most recent completed pair, or `result.durationMs` from the latest result message if richer signal preferred.

5. `derivedAtMs = nowMs`.

Wired into `deriveChatSnapshot` so every snapshot carries fresh timings. Sidebar row builder reads only `stateEnteredAt` (last transition timestamp) to keep cost low.

Cost: O(events_per_chat) per derivation, folded into the existing read-model pass.

## UI

### Header (`src/client/app/PageHeader.tsx` or chat header equivalent)

Layout, dot-separated:

```
running 0:12 · session 12m · last turn 3.2s
```

- State + live-format duration on the left. State label colored per existing status palette.
- `session Nm` middle = `derivedAtMs - activeSessionStartedAt` formatted compact.
- `last turn 3.2s` right, hidden when `lastTurnDurationMs == null`.
- Tooltip on session segment: chat lifetime + per-state breakdown:

```
chat created 2d ago
this session: active 8m / idle 4m / waiting 30s
```

### Inline per-turn (`src/client/components/messages/`)

Append a muted compact duration on the result message renderer: `· 3.2s`. Source: existing `result.durationMs` event field. No protocol change.

### Sidebar row (`src/client/app/KannaSidebar.tsx`)

Right-aligned compact stamp:
- Default: `formatCompact(derivedAtMs - lastMessageAt)` → `2m`, `5h`, etc.
- If `status === "running" | "waiting_for_user"` and `stateEnteredAt` set, replace stamp with state badge: `running 0:12` / `waiting 30s`.

### Format helper

New `src/client/lib/formatDuration.ts`:

- `formatCompact(ms)`: `<60s → Ns`, `<60m → Mm`, `<24h → Hh Mm`, `≥24h → Dd Hh`.
- `formatLive(ms)`: `M:SS` for current state badges; switches to `Mm` after 60m.

Both pure, snapshot-safe (operate on a fixed `ms` value supplied by caller).

## Update model

Q3 chose snapshot-only. No `setInterval` ticking. Numbers refresh exactly when a server event arrives.

To prevent visual drift across React rerenders between events, the server includes `derivedAtMs` in the snapshot. The client formats every duration as `derivedAtMs - <anchor>`, not `Date.now() - <anchor>`. This guarantees a state with no new events shows the same number on every rerender.

Trade-off: a `running` segment with no intervening tool/message events for 30 seconds will display `running 0:00` (snapshot taken at `turn_started`) until the next event. Accepted because most chats have frequent message/tool events.

If this proves jarring in practice, escalation path: emit a synthetic `state_heartbeat` event every 10s while `running`, or move to Q3=c (adaptive client tick). Out of scope for v1.

## Testing

### Unit — `src/server/read-models.test.ts`

`deriveTimings`:
- empty event log → all zero, `stateEnteredAt = chatCreatedAt`, `activeSessionStartedAt = chatCreatedAt`
- single `turn_started`, no finish → open `running` segment; `cumulativeMs.idle` = gap before turn
- `turn_started` + `turn_finished` → `lastTurnDurationMs` = diff; both `running` and `idle` populated
- `turn_failed` → final state `failed`, segment closed at failure timestamp
- idle gap > 30 min → `activeSessionStartedAt` set after gap; cumulative scoped to post-gap window
- back-to-back idle gaps → only most recent splits
- `nowMs` advances current segment correctly
- `waitStartedAt` provided → adds to `cumulativeMs.waiting_for_user`; current-state duration uses `nowMs - waitStartedAt`

### Unit — `src/client/lib/formatDuration.test.ts`

- `formatCompact`: `42_000 → "42s"`, `120_000 → "2m"`, `3_660_000 → "1h 1m"`, `90_061_000 → "1d 1h"`
- `formatLive`: `12_000 → "0:12"`, `125_000 → "2:05"`, `>3_600_000 → "Mm"` form

### Component

- Header renders state + live duration + session + last-turn.
- Header tooltip shows chat-lifetime breakdown.
- Sidebar row swaps stamp ↔ badge based on `status`.
- Snapshot stale: rerender does not advance time (uses `derivedAtMs`, not `Date.now`).

### Integration — `read-models.test.ts`

- Replay fixture event sequence → assert `runtime.timings` shape and values end-to-end through `deriveChatSnapshot`.

## File change list

Shared (c3-3):
- `src/shared/types.ts` — add `ChatStateTimings`; extend `ChatRuntime`; extend `SidebarChatRow.stateEnteredAt`.

Server (c3-2):
- `src/server/read-models.ts` — add `deriveTimings`; wire into `deriveChatSnapshot` and sidebar row builder; thread `nowMs` and `waitStartedAt` map.
- `src/server/agent.ts` — track `waitStartedAt` per active turn alongside `active.status = "waiting_for_user"`; expose getter.
- `src/server/ws-router.ts` — pass wait-state map into derivation, mirroring existing `activeStatuses` plumbing.
- `src/server/read-models.test.ts` — new tests.

Client (c3-1):
- `src/client/lib/formatDuration.ts` — new.
- `src/client/lib/formatDuration.test.ts` — new.
- `src/client/app/PageHeader.tsx` (or chat header host) — render state/session/last-turn + tooltip.
- `src/client/app/KannaSidebar.tsx` — render compact stamp / state badge per row.
- `src/client/components/messages/` (result renderer) — append `· 3.2s` from `durationMs`.

Docs:
- `.c3/refs/` — ref entry for timings model if c3 conventions require.
- `docs/plans/2026-05-06-chat-session-timings-design.md` — this document.

Estimated: ~10 files, ~400 LOC including tests.

## Open questions / deferred

- Whether to also add a status-line micro-renderer for terminal mode. Out of v1.
- Whether to eventize permission lifecycle later (option a from Section 2) so `waiting_for_user` cumulative survives restart. Defer until evidence shows demand.
- Configurable `ACTIVE_SESSION_IDLE_GAP_MS`. Hardcoded for v1; revisit if 30 min proves wrong.

## Next steps

1. Use `superpowers:writing-plans` to break this design into bite-sized implementation tasks.
2. Use `superpowers:using-git-worktrees` to isolate the implementation branch.
3. Implement under TDD per `superpowers:test-driven-development`.
