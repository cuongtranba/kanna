# Model-Independent Chat Sessions — Overview

Date: 2026-05-13
Status: Design (revised after Claude + Codex review)

This is the **overview** doc for removing the chat-provider lock and adding
configurable subagents. Implementation is split into three phase specs;
each ships independently:

1. [Phase 1 — Provider-Independent Primary Chats](./2026-05-13-model-independent-chat-phase1-provider-switching.md)
   Per-provider resume tokens, history primer rule, migration. Highest-risk
   shared-state change. Ships value alone (Claude ↔ Codex switching mid-chat).
2. [Phase 2 — Subagent CRUD & Mentions](./2026-05-13-model-independent-chat-phase2-subagent-crud.md)
   `app-settings.json` storage, server-authoritative `@agent/<name>` parsing,
   picker integration. Depends on phase 1.
3. [Phase 3 — Subagent Orchestration & UI](./2026-05-13-model-independent-chat-phase3-subagent-orchestration.md)
   `SubagentRunSnapshot` read model, parallel/chained execution, transcript
   projection, error UI. Depends on phase 2.

Only phase 1 is implementation-ready. Phases 2 and 3 stay as design docs
until phase 1 ships.

## Goal

Let a chat freely switch between providers and models at any turn, and let
users invoke configurable subagents inline via `@agent/<name>` mentions.

## Use cases

1. Start a chat with Claude, switch to Codex on turn 5 — Codex sees the full
   prior transcript via a synthetic history primer.
2. Switch back to Claude on turn 7 — Claude resumes its prior session token
   without re-injecting the primer.
3. Define a `code-reviewer` subagent (Codex, gpt-5, custom system prompt) in
   Settings. While chatting with Claude, write
   `@agent/code-reviewer please review this diff` — Codex runs in an
   isolated context, posts its reply inline.
4. Mention two subagents in one message — both run in parallel.
5. A subagent's reply mentions another subagent — depth-1 chain runs once.
   Depth 2+ rejected with `DEPTH_EXCEEDED`.

## Non-goals

- Replacing Claude SDK's native `Agent` tool. Primary models can still
  self-delegate via that tool; untouched by this design.
- Mid-turn interrupts. Switching models mid-stream applies to the **next**
  user-initiated turn.
- Auto-summarization of large transcripts. Phase 1 uses a hard char/token
  cap with a truncation marker; smarter summarization is future work.

## Consensus decisions (from review aggregation)

These decisions apply across all phases and override any conflicting prose
in earlier revisions of this doc.

### 1. Primer rule is token-based, not provider-difference-based

For a primary turn, pick `targetProvider`, read
`chat.sessionTokensByProvider[targetProvider]`, and inject a history primer
only when that token is **absent** OR when the user explicitly cleared
context for that provider. Switching back to a provider with an existing
token resumes without re-injecting history.

### 2. Real event names

- `session_token_set` (in `TurnEvent`, written to `turnsLogPath`) — NOT
  `chat_session_token_set`. Gains optional `provider` field.
- `message_appended` (in `MessageEvent`) — NOT `chat_user_message_appended`.
- `pending_fork_session_token_set` — gains optional `provider` field.

Source: `src/server/events.ts:175-221`.

### 3. Real file paths

- `src/client/components/chat-ui/ChatInput.tsx`
- `src/client/components/chat-ui/MentionPicker.tsx`
- `src/client/components/chat-ui/ChatPreferenceControls.tsx`
- `src/client/app/SettingsPage.tsx`
- `src/client/app/KannaTranscript.tsx`

### 4. No seeded built-in subagents

If primary provider is freely switchable, built-in `@agent/claude` /
`@agent/codex` are redundant with primary switching. Drop seeded built-ins.
Subagents start empty until the user creates one.

### 5. Mention parsing is server-authoritative

Client chips + picker are UX hints only. The server parses `@agent/<name>`
from submitted content AND from chained subagent replies, validates against
current app-settings, and reserves the `@agent/` namespace **before** file
mention path resolution. Stale ids rejected with `UNKNOWN_SUBAGENT`.

### 6. Mention + primary coexistence rule

If a message contains `@agent/...`, subagents run; the primary turn does
**not** auto-fire in v1. Reasons: deterministic ordering, prevents primary
from answering before delegated review results exist. A "fan-out + primary
synthesis" mode is a future flag, not v1.

### 7. `SubagentRunSnapshot` is the single read model

```ts
type SubagentRunSnapshot = {
  runId: string
  chatId: string
  subagentId: string         // route by id, never by mutable name
  subagentName: string       // display only, snapshot at run time
  provider: AgentProvider
  model: string
  status: "running" | "completed" | "failed" | "cancelled"
  parentUserMessageId: string
  parentRunId: string | null
  depth: number              // 0 user-triggered, 1 chained
  startedAt: number
  finishedAt: number | null
  finalText: string | null
  error: { code: SubagentErrorCode; message: string } | null
  usage: ProviderUsage | null
}
```

Durable events live in `turns.jsonl` (same log family as session token
events). Transcript JSONL holds a **derived projection** for display.
Events own lifecycle; transcript projection owns display text. No
dual-writing of authoritative state.

### 8. `MAX_CHAIN_DEPTH = 1` for v1

User-triggered runs are depth 0; one chained run at depth 1 is allowed;
depth 2+ is rejected with `subagent_run_failed { code: "DEPTH_EXCEEDED" }`.
Raise to 2 in a follow-up after observing real orchestration.

### 9. Migration touch points (full enumeration)

Phase 1 migration touches:

- `src/shared/types.ts:1216` — `ChatRecord.sessionToken` → `sessionTokensByProvider`.
- `src/shared/types.ts:459` — `ChatSidebarItem.canFork` derivation.
- `src/server/read-models.ts:34` — `canForkChat` reads token presence.
- `src/server/agent.ts:1229,1251,1567,1609,1737` — every read/write of
  `chat.sessionToken` / `chat.pendingForkSessionToken`.
- `src/server/event-store.ts` — `session_token_set` /
  `pending_fork_session_token_set` reducers; replay-time provider attribution.
- `src/server/events.ts:201-221` — add optional `provider` field to both
  token events.
- `src/server/codex-app-server.ts:124,754,809` — Codex resume path with
  provider tag.
- `src/server/claude-session-importer.ts` — Claude import path sets
  `sessionTokensByProvider.claude`.
- `src/server/auth.ts`, `src/client/app/useKannaState.ts` — any caller that
  passes `chat.sessionToken` to a provider.
- `src/client/components/chat-ui/sidebar/Menus.tsx`,
  `src/client/components/chat-ui/sidebar/ChatRow.tsx` — sidebar fork
  affordance reads provider-aware token state.

`pendingForkSessionToken` itself becomes provider-tagged so a fork carries
the right backend session per provider.

### 10. Error code enum

```ts
type SubagentErrorCode =
  | "AUTH_REQUIRED"     // provider creds missing / expired
  | "UNKNOWN_SUBAGENT"  // mention references stale or missing id
  | "LOOP_DETECTED"     // subagent id already in path
  | "DEPTH_EXCEEDED"    // depth > MAX_CHAIN_DEPTH
  | "TIMEOUT"           // per-run wall-clock cap exceeded
  | "PROVIDER_ERROR"    // underlying provider call failed
```

All failures surface as `subagent_run_failed` events AND inline error
cards in the transcript (never silent).

### 11. `previous-assistant-reply` extraction

Last assistant text from primary turns only. Excludes subagent messages
and excludes tool-call summaries unless no text exists in that reply.
First-turn case (no prior assistant): **skip the primer**, pass user text
only.

### 12. App-settings name validation

- Trim before validation.
- Case-insensitive uniqueness across user-defined subagents.
- Reject empty string, leading dot, `/`, and reserved names: `agent`,
  `agents`.
- Reject `[a-z0-9_-]` pattern violations.

### 13. History primer hard cap (v1, server-side)

Render newest transcript entries first up to a char budget (initial
proposal: 60_000 chars, tunable per-provider). Include an explicit
truncation marker `[... earlier conversation omitted ...]`. Log rendered
size and truncation status to telemetry for tuning. UI warning is a
follow-up.

### 14. `MAX_PARALLEL = 4` overflow rule

Mentions 5+ in one message queue and run after the first batch completes.
Never reject.

### 15. `useMentionSuggestions` is split, not changed

Current return type stays `{ items: ProjectPath[]; loading; error }`.
Add a separate `useSubagentSuggestions` hook returning
`{ items: Subagent[]; loading; error }`. `MentionPicker` merges results
locally. No breaking change to existing callers.

### 16. Route by id, not mutable name

`@agent/<name>` is user-facing; the server resolves name → id at parse
time. All stored references (events, queued messages, run snapshots) use
`subagentId`. Renaming a subagent does not break in-flight or queued runs.

### 17. Ordering tiebreak

Sibling subagent runs under one user message order by
`startedAt` ascending, then `runId` ascending. Equal `startedAt` is real
on fast hardware.

### 18. App-settings work items

Touch the following in `src/server/app-settings.ts`:

- `AppSettingsFile` interface — add `subagents` array.
- `normalizeAppSettings` — new per-entry normalizer + validation.
- `toFilePayload`, `toSnapshot`, `toComparablePayload`, `applyPatch`.
- `AppSettingsPatch` / `AppSettingsSnapshot` types in `src/shared/types.ts`.
- New CRUD: `createSubagent`, `updateSubagent`, `deleteSubagent`.
- Protocol additions in `src/shared/protocol.ts`.

## Phase-by-phase summary

| Phase | Scope | Ships independent value? |
|-------|-------|---|
| 1 | `sessionTokensByProvider`, primer rule, migration, fork-provider-tag | Yes — chat-level model switching |
| 2 | Subagent CRUD in app-settings, server-authoritative mention parsing, picker | No — requires phase 1 for cross-provider subagents |
| 3 | Orchestrator, `SubagentRunSnapshot`, parallel + chained runs, transcript UI | No — requires phase 2 |

See phase docs for detailed contracts, data shapes, events, tests, and
implementation order.
