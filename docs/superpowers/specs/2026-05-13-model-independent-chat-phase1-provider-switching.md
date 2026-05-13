# Phase 1 — Provider-Independent Primary Chats

Date: 2026-05-13
Status: Design (implementation-ready)
Parent: [Model-Independent Chat Sessions — Overview](./2026-05-13-model-independent-chat-sessions-design.md)

## Goal

Remove the first-turn provider lock. A chat may switch provider on any turn.
Each provider keeps its own resume token under the chat record so switching
back later resumes its prior session without re-injecting full history.

Phase 1 ships independent user value: chat-level model switching for
Claude ↔ Codex. Subagents (phases 2 + 3) build on this.

## Out of scope (deferred to later phases)

- Subagent CRUD, picker integration (phase 2).
- `@agent/<name>` parsing, orchestration, transcript projection (phase 3).
- Mid-turn interrupts.
- Auto-summarization on primer overflow (only hard cap + truncation marker
  here).

## Data model

### `ChatRecord` (persisted) — `src/server/events.ts:8`

Line 19 (`sessionToken: string | null`) and line 21
(`pendingForkSessionToken?: string | null`) become:

```ts
// after
sessionTokensByProvider: Partial<Record<AgentProvider, string | null>>
pendingForkSessionToken: {
  provider: AgentProvider
  token: string
} | null
```

`ChatRecord.provider` stays as the **last-used** provider (informational,
no longer a lock). `composerState.provider` is the source of truth for
the next turn's target provider.

### `ChatRuntime` (runtime mirror sent to client) — `src/shared/types.ts:1207`

Line 1216 (`sessionToken: string | null`) gets the same replacement.
`ChatRuntime` is the client-facing read-model; missing this change
breaks sidebar fork affordance and client state. `ChatSnapshot`
(`src/shared/types.ts:1240`) carries the new shape transitively via its
`runtime` field; no extra field added there.

`sessionToken` occurrences in `src/shared/types.ts`:

```
1216:  sessionToken: string | null   // ChatRuntime — the only direct occurrence
```

All other client-visible chat state reads through `ChatRuntime` /
`ChatSnapshot`, so updating these two types covers the read-model surface.

### Event shape additions (no version bump)

`src/server/events.ts:201-221` — add optional `provider` field to both
token events. **Keep `STORE_VERSION = 3`**. The store filters events by
exact version (`src/server/event-store.ts:276,400,468`); a bump would
reset every existing v3 chat log and wipe user history.

```ts
| {
    v: 3
    type: "session_token_set"
    timestamp: number
    chatId: string
    sessionToken: string | null
    provider?: AgentProvider  // new — set on all new writes; absent in legacy logs
  }
| {
    v: 3
    type: "pending_fork_session_token_set"
    timestamp: number
    chatId: string
    pendingForkSessionToken: string | null
    provider?: AgentProvider  // new — set on all new writes; absent in legacy logs
  }
```

Replay rules:

- **Event with `provider` set** — write to
  `sessionTokensByProvider[provider]`.
- **Event without `provider`** — attribute to the chat's `provider` as of
  that point in the replay, anchored by the most recent
  `chat_provider_set` seen so far. Legacy logs never observed a
  cross-provider switch, so attribution is unambiguous.
- Same rule for `pending_fork_session_token_set`.

`chat_provider_set` semantics relax: still fires on first turn (forward-
compat for old clients), but subsequent provider changes are allowed and
re-fire the event. No replay change needed beyond removing any guard that
rejected re-fires.

## Primer rule

```
function shouldInjectPrimer(chat, targetProvider, userClearedContext): boolean {
  if (userClearedContext) return true
  return chat.sessionTokensByProvider[targetProvider] == null
}
```

Notes:

- Switching Claude → Codex → Claude: on the third turn, Claude has a token
  → no primer.
- First-ever turn for the chat: any provider's token is null → primer
  injected, but see "first-turn primer skip" below.
- Explicit "Clear context" action sets the target provider's token to null,
  which naturally triggers a primer on the next turn.

### First-turn primer skip

If the chat has no prior assistant turns (transcript empty of assistant
messages), skip the primer entirely. Pass only the user text to the
provider. The primer needs at least one prior reply to be meaningful.

## History primer (server-side)

Used in phase 1 only for primary provider switches. Phase 3 reuses the
same builder for subagent `contextScope: "full-transcript"`.

### Shape

```
The following is the prior conversation in this chat. The first part is
context only; the actual request follows after the marker line.

--- BEGIN PRIOR CONVERSATION ---
[user, 2026-05-13 14:02:11]
<text>

[assistant (claude, claude-opus-4-7), 2026-05-13 14:02:18]
<text>
--- END PRIOR CONVERSATION ---

<actual user request goes here>
```

### Hard cap

- Char budget: `PRIMER_MAX_CHARS = 60_000` (constant, tunable later
  per-provider).
- Strategy: render newest entries first, walking backwards, until the next
  entry would overflow the budget. Then prepend
  `[... earlier conversation omitted ...]` as a truncation marker.
- Log `{ chatId, targetProvider, chars, entries, truncated }` to telemetry
  for tuning.
- Tool calls flatten via existing `parseTranscript.ts` summarizer.
  Binary attachments referenced by filename only.

## Migration (replay-time attribution)

No transient `sessionToken?: string | null` field. The type change is
clean — `ChatRecord` and `ChatRuntime` carry only
`sessionTokensByProvider` and provider-tagged `pendingForkSessionToken`
after this PR. Migration happens at replay time:

1. Event-store replay processes every `session_token_set` and
   `pending_fork_session_token_set` event in order.
2. Each event without `provider` is attributed to the chat's then-current
   `provider`, anchored by the most recent `chat_provider_set` reached so
   far in the replay.
3. The resulting in-memory `ChatRecord` has `sessionTokensByProvider`
   populated correctly without any transient legacy field.
4. The next snapshot write emits the new shape; from that point on, all
   reads use `sessionTokensByProvider` directly.

Legacy snapshot files (`SnapshotFile` with `v: 3` in
`src/server/events.ts:55`) lose their `chat.sessionToken` /
`chat.pendingForkSessionToken` fields after this change — the loader must
read those legacy fields **only on a v3 snapshot file written before this
PR** and project them into `sessionTokensByProvider` keyed by
`chat.provider`. After the first new snapshot write, the legacy fields
are gone from disk.

Sidebar/fork:

- `canForkChat` in `src/server/read-models.ts:34` updated to read
  `Object.values(sessionTokensByProvider).some(Boolean) || pendingForkSessionToken != null`.
- Fork flow in `src/server/agent.ts:1229` copies only the active
  provider's token into the new chat's pending fork slot, with provider
  tag attached.

## Send flow (phase 1, no mentions)

```
User submits composer
  │
  ├─ targetProvider := composerState.provider
  ├─ Append `message_appended` (existing)
  ├─ Append `turn_started`
  │
  ├─ token := chat.sessionTokensByProvider[targetProvider]
  ├─ primer := shouldInjectPrimer(chat, targetProvider, userClearedContext)
  │              ? buildHistoryPrimer(chatId, targetProvider)
  │              : null
  │
  └─ startTurnForChat({
       provider: targetProvider,
       sessionToken: token,
       preamble: primer,
       userText: composerState.text,
     })
       └─ on session_token_set returned by provider:
            append `session_token_set { v: 3, provider: targetProvider, sessionToken }`
```

`startTurnForChat` (in `src/server/agent.ts`) reads/writes the per-provider
slot, keyed by the **turn's target provider**, not by `chat.provider`.

## Protocol changes

`src/shared/protocol.ts`:

- `chat_send` payload unchanged for v1 client compat; server uses
  `composerState.provider` already in the payload.
- `ChatSnapshot` (or equivalent read-model frame) exposes
  `sessionTokensByProvider` and provider-tagged `pendingForkSessionToken`
  so the client can render correct fork affordances.

## UI changes

`src/client/components/chat-ui/ChatInput.tsx`:

- Remove `providerLocked` prop and its callers.
- Model selector remains interactive during streaming; selection updates
  `composerState` only; in-flight turn unaffected.

`src/client/components/chat-ui/sidebar/ChatRow.tsx` +
`src/client/components/chat-ui/sidebar/Menus.tsx`:

- Read `canFork` from snapshot (no logic change beyond server-side
  derivation update).

`src/client/components/chat-ui/ChatPreferenceControls.tsx`:

- No structural change. Provider switch already wired through; lock
  removal happens upstream in `ChatInput`.

No transcript / settings changes in phase 1.

## Testing

Co-located per existing layout.

`src/server/event-store.test.ts`:

- Legacy `session_token_set` (no `provider`) replays into
  `sessionTokensByProvider[chat.provider]` via replay-time attribution.
- New `session_token_set` (with `provider`) writes to the named provider
  slot.
- `STORE_VERSION` stays at 3; events with the new optional field still
  match the version filter.
- Replay of Claude → Codex → Claude sequence ends with both slots
  populated.
- Legacy `pending_fork_session_token_set` migrates to provider-tagged
  shape.

`src/server/agent.test.ts`:

- Provider switch on existing chat with prior Claude turns generates a
  history primer when target provider has no token.
- Switching back to Claude after Codex turns does NOT regenerate a primer
  (Claude token still present).
- `userClearedContext` flag forces a primer regardless of token presence.
- First-ever turn on empty chat: no primer injected.
- Primer respects `PRIMER_MAX_CHARS`; oversize transcript shows truncation
  marker and logs telemetry.
- `session_token_set` emitted by the agent carries `provider` field.

`src/server/read-models.test.ts`:

- `canForkChat` returns true when ANY provider slot has a token.
- `canForkChat` returns true when `pendingForkSessionToken` set
  (provider-tagged).

`src/client/app/useKannaState.test.ts`:

- Composer provider switch updates `composerState.provider` without
  mutating chat record until next send.

`src/server/codex-app-server.test.ts` +
`src/server/claude-session-importer.test.ts`:

- Codex resume path uses provider-tagged token.
- Claude import writes `sessionTokensByProvider.claude`.

## Risk + rollback

- Token replay attribution is the highest-risk change. Legacy events
  (no `provider`) and new events (with `provider`) coexist in the same
  v3 log indefinitely; the reducer anchors missing-provider attribution
  to the most recent `chat_provider_set` reached so far in replay.
- Rollback: revert this PR. Because `STORE_VERSION` is unchanged, v3
  logs remain readable by the pre-change reducer — it will ignore the
  new optional `provider` field and treat events as legacy single-token
  writes, losing any alt-provider tokens that were captured after the
  switch was enabled. Document this in release notes.

## Open items resolved

All review items 1–19 from the parent overview that apply to phase 1 are
folded into this doc. Items specific to phases 2–3 (subagent CRUD,
`SubagentRunSnapshot`, mention parsing, orchestration) are deferred.
