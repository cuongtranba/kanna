---
id: adr-20260804-cancel-during-turn-boot
c3-seal: ec71f0aac18df06a20837fc8a314fbfeb7abac1ed52d3026a992f028ff4ed533
title: cancel-during-turn-boot
type: adr
goal: |-
    Make Stop take effect on the first click by giving a turn a server-side record
    from the moment it is requested, not from the moment its provider session
    finishes spawning.
status: accepted
date: "2026-08-04"
---

# ADR — Cancel during the turn-boot window

## Goal

Make Stop take effect on the first click by giving a turn a server-side record
from the moment it is requested, not from the moment its provider session
finishes spawning.

## Context — "Stop needs two clicks"

Reported on the SDK driver with a single turn and nothing queued: the first
click on Stop did nothing, the second worked.

`startTurnForChat` registered the `ActiveTurn` only AFTER the provider boot:

- `claude-turn-starter.ts` — `turn = await deps.startClaudeTurn(...)`
- …then, many lines later — `deps.activeTurns.set(chatId, active)`

Between those two points the chat had **no server-side record at all**. On a
cold chat that gap is a full SDK/PTY session spawn — seconds.

The composer nevertheless showed a live Stop button for that entire window,
because the client fakes the status: `handleSend` sets `optimisticProcessing`
synchronously (`useKannaState.ts`), which renders as `starting` while the
server still reports `idle`. Its 300 ms auto-clear is gated on the `chat.send`
ack, and `chat.send` awaits `startTurnForChat` — so the clear could not fire
during the boot either.

WS messages are not serialized (`ws-router.ts` `handleMessage` is async and not
awaited before the next frame), so the click's `chat.cancel` landed mid-boot
and hit the bare early return in `cancelChat`:

```ts
const active = deps.activeTurns.get(chatId)
if (!active) return   // silent: no interrupted entry, no state change, no error
```

The ack still came back `{ok}`, so nothing surfaced. The boot then completed,
the turn registered and ran, and the second click — now finding an
`ActiveTurn` — worked.

The same late registration caused two further symptoms:

- `sendCommand` gated queueing on `activeTurns.has(chatId)` only, so a second
`chat.send` during the boot started a **concurrent** turn whose
`activeTurns.set` clobbered the first.
- Snapshots reported `idle` mid-boot, which is the reason the client needs the
optimistic lie in the first place.

## Decision

Introduce `StartingTurn` (`claude-session-state.ts`) and a
`startingTurns: Map<chatId, StartingTurn>` owned by `AgentCoordinator`,
registered **synchronously in `startTurnForChat` before the first `await`** and
removed in a `finally`.

This is the same shape as the existing `slashCommandsInFlight` in-flight marker
(add → emit → `finally` delete), and it plugs into the same `if (!active)`
fallback ladder in `cancelChat` that `selfWakeActive` already uses.

Three consumers:

1. **`cancelChat`** — when there is no `ActiveTurn` but there is a
`StartingTurn`, set `cancelRequested`, drop the marker (so the chat reports
idle on the very next snapshot), write the `interrupted` entry and
`recordTurnCancelled`, and return. The user gets feedback immediately
instead of waiting out the boot.
2. **`startTurnForChat`** — once the provider session resolves, if
`cancelRequested` is set it tears the fresh turn down *silently*
(`interrupt()` best-effort with the same 5 s race, then `close()`, plus
`closeClaudeSession` for claude-under-PTY where the handle is a ghost facade
and SIGINT has already killed the CLI) and returns without registering or
running it. No transcript writes here — `cancelChat` already made them.
3. **`getActiveStatuses`** — booting chats surface as `starting`, as a pure
overlay alongside the existing `selfWakeActive` → `running` overlay. An
`ActiveTurn` always wins.

`sendCommand` and `maybeStartNextQueuedMessage` now ask
`activeTurns.has() || startingTurns.has()`, closing the concurrent-turn race.

### Cleanup is identity-guarded

`startTurnForChat`'s `finally` deletes the map entry **only if it is still the
same object** it registered. A cancel removes the marker eagerly, so without
this guard a slow boot finishing after a cancel-then-restart would delete the
*new* turn's marker and re-open the whole gap.

### Stop no longer drains the queue

`cancelChat` used to call `maybeStartNextQueuedMessage` on the way out, so with
anything queued the chat went back to `running` in the same tick and Stop again
appeared to need a second press. That contradicted `claude-turn-runner.ts`,
which deliberately skips the drain when `cancelRequested` is set, and it meant
`chat.delete` (which calls `agent.cancel`) started a turn on a chat being
deleted.

The call, the `maybeStartNextQueuedMessage` dep and the now-meaningless
`skipQueueDrain` option are removed. Queued messages stay parked and keep their
existing "Send now" / "Remove" actions; a turn that ends normally still drains
them.

## Consequences

- One click stops a turn at any point in its lifecycle.
- The server no longer reports `idle` for a booting chat. `deriveTimings` is
unaffected (it consults `activeStatus` only for `waiting_for_user`, and
`cumulativeMs` already carries a `starting` key); `canForkChat` now correctly
refuses to fork mid-boot.
- The client's `optimisticProcessing` shim is left in place — it still covers
the pre-ack network hop — but it is no longer the only thing keeping the
chat visibly busy during a spawn.
- Stop leaves the queue parked. A user who wants the queued message to run
presses "Send now" on it.

## Alternatives considered

- **A per-chat cancel epoch counter.** Less code, but it fixes only the cancel
race — the `idle` status lie and the concurrent-turn-on-double-send bug both
remain, and all three are the same root cause.
- **Registering a real `ActiveTurn` up front.** `ActiveTurn.turn` is a
non-optional `HarnessTurn` that does not exist until the boot resolves;
making it nullable would ripple through every consumer.
