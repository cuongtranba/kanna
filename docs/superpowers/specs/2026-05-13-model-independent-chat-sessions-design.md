# Model-Independent Chat Sessions

Date: 2026-05-13
Status: Design

## Goal

Let a chat freely switch between providers and models at any point in its
lifetime, and let the user invoke configurable subagents inline with `@`
mentions. Today the first turn locks a chat to one provider; this design
removes the lock and adds a subagent abstraction that supports cross-provider
delegation.

## Use cases

1. Start a chat with Claude, switch to Codex on turn 5 — Codex sees the full
   prior transcript and continues the conversation.
2. Define a `code-reviewer` subagent (Codex, gpt-5, custom system prompt) in
   Settings. While chatting with Claude, write
   `@agent/code-reviewer please review this diff` — Codex runs with the
   subagent's config in an isolated context, posts its reply inline, and Claude
   sees that reply on the next turn.
3. Mention two subagents in one message — both run in parallel, each posts a
   reply, and Claude sees both on its next turn.
4. A subagent's reply mentions another subagent — that mention is parsed and
   delegated (depth limit = 2, loop detection enabled).

## Non-goals

- Replacing Claude SDK's native `Agent` tool. Primary models can still
  self-delegate via the SDK's tool; that mechanism is untouched. This design
  only adds Kanna-orchestrated, user-driven `@` routing.
- Mid-turn interrupts. Switching models or sending a new `@` mention while a
  turn is streaming does not interrupt the active turn; the change applies to
  the next user-initiated turn.
- Auto-summarization of large transcripts on primary switch. Initial design
  injects raw history; summarization can be added later if token cost demands.

## Data model

### Chat

The chat record gains per-provider session token storage and loses provider
lock semantics.

```ts
type Chat = {
  // existing fields ...

  // last-used provider; informational, no longer a lock
  provider: AgentProvider | null

  // per-provider resume tokens; switching swaps which one is active
  sessionTokensByProvider: Partial<Record<AgentProvider, string | null>>

  // existing pendingForkSessionToken kept for fork-from-history flow
}
```

`chat.sessionToken` (legacy single field) is removed from the in-memory model
once migration completes. On load, if the legacy field is present it is moved
into `sessionTokensByProvider[chat.provider]` and dropped.

### Subagent

A new top-level entity stored in `app-settings.json`:

```ts
type Subagent = {
  id: string           // ULID, stable
  name: string         // user-visible, used in @agent/<name>; [a-z0-9_-]+
  description?: string // shown in picker
  provider: AgentProvider
  model: string
  modelOptions: ClaudeModelOptions | CodexModelOptions
  systemPrompt: string
  builtin?: boolean    // seeded by Kanna, not user-deletable
  contextScope: "previous-assistant-reply" | "full-transcript"
}
```

Seeded built-ins on first load:

- `claude` — provider=claude, default model, empty extra system prompt.
- `codex` — provider=codex, default model, empty extra system prompt.

Reserved name: `agent` (would collide with the `@agent/...` routing prefix).
Names must be unique across user-defined subagents.

### Per-turn message metadata

`SendMessageOptions` and `QueuedChatMessage` gain optional fields:

```ts
{
  // existing
  provider?: AgentProvider
  model?: string
  modelOptions?: ModelOptions
  planMode?: boolean

  // new
  subagentMentions?: Array<{ subagentId: string; chipText: string }>
  subagentRunContext?: {
    parentRunId: string | null  // null for user-triggered, set for chained
    depth: number               // 0 for user-triggered, increments on chain
    triggeringSubagentId: string | null
  }
}
```

A "subagent run" is a single execution of one subagent on one mention. It
gets its own `runId` and is event-sourced independently of the primary turn.

## Events

### Modified

- `chat_provider_set` — semantics relaxed. Still fires when chat first gets a
  provider; replays continue to set `chat.provider`. No longer prevents
  subsequent provider changes.
- `chat_session_token_set` — gains optional `provider` field. New writes
  always set it. During replay, an event without `provider` is attributed to
  the chat's current `provider` as of that point in the replay (the prior
  events have already set it). Legacy logs never observed a cross-provider
  switch, so this attribution is unambiguous.

### New

```ts
type SubagentRunStartedEvent = {
  v: number
  type: "subagent_run_started"
  timestamp: number
  chatId: string
  runId: string
  subagentId: string
  parentUserMessageId: string
  depth: number
  parentRunId: string | null
}

type SubagentMessageDeltaEvent = {
  v: number
  type: "subagent_message_delta"
  timestamp: number
  runId: string
  content: string  // appended
}

type SubagentRunCompletedEvent = {
  v: number
  type: "subagent_run_completed"
  timestamp: number
  runId: string
  finalContent: string
  usage?: ProviderUsage
}

type SubagentRunFailedEvent = {
  v: number
  type: "subagent_run_failed"
  timestamp: number
  runId: string
  error: { code: string; message: string }
}
```

Subagent runs live in the same per-chat event log as primary turns and are
reduced into a `subagentRuns: Map<runId, SubagentRun>` read model attached to
the chat snapshot. The transcript projection orders them by `parentUserMessageId`
+ start timestamp so the UI can group them under the triggering user message.

Subagent CRUD is **not** event-sourced. `app-settings.json` is a JSON
document persisted via the existing atomic-write helper
(`src/server/app-settings.ts`); subagents are a new top-level array within
that document. Reads return the full list; writes apply a CRUD operation
and re-persist atomically. This matches the existing pattern for other
app-settings fields.

## Send flow

```
User submits composer
  │
  ├─ parseMentions(text) → { primaryText, fileMentions, subagentMentions }
  │
  ├─ Append `chat_user_message_appended` (existing) with primaryText +
  │   subagentMentions metadata so it replays consistently.
  │
  ├─ If subagentMentions is empty:
  │     enqueuePrimaryTurn(chatId, composerState)
  │       └─ If composerState.provider !== chat.provider:
  │            buildHistoryPrimer(chatId, targetProvider) →
  │              one synthetic user message containing
  │              "Previous conversation (provider=X):\n<rendered history>"
  │            startTurnForChat({ ..., preamble: primer })
  │       Else: existing path.
  │
  └─ Else:
        For each mention (in mention order), in parallel up to MAX_PARALLEL=4:
          spawnSubagentRun({
            chatId,
            subagentId,
            parentUserMessageId: <appended user msg id>,
            depth: 0,
            parentRunId: null,
            input: primaryText,
            primer: subagent.contextScope === "full-transcript"
              ? buildHistoryPrimer(chatId, subagent.provider)
              : lastPrimaryAssistantReplyText(chatId)
          })
        Await all (with per-run timeouts).

        For each completed run:
          parseMentions(run.finalContent) →
            if subagentMentions.length > 0 AND depth < 2 AND no loop:
              For each chained mention:
                spawnSubagentRun({
                  ...,
                  parentRunId: run.runId,
                  depth: 1,
                  triggeringSubagentId: run.subagentId,
                  input: run.finalContent,
                })

        Primary turn does NOT auto-fire after subagent mentions. User decides
        whether to send a follow-up to primary; when they do, the primary turn
        sees the user message AND all completed subagent replies in its
        injected history.
```

### History primer

Used in two places: primary provider switch, and `contextScope: "full-transcript"`
subagents.

Rendered shape (single synthetic user message body):

```
The following is the prior conversation in this chat. The first part is
context only; the actual request follows after the marker line.

--- BEGIN PRIOR CONVERSATION ---
[user, 2026-05-13 14:02:11]
<text>

[assistant (claude, claude-opus-4-7), 2026-05-13 14:02:18]
<text>

[subagent code-reviewer (codex, gpt-5), 2026-05-13 14:03:01]
<text>
--- END PRIOR CONVERSATION ---

<actual user request goes here>
```

Tool calls are flattened to short textual summaries (existing
`parseTranscript.ts` already produces a human-readable form; reuse). Binary
attachments are referenced by filename, not embedded.

### Loop detection

A run's "path" is the list of `subagentId`s from the original user message
down through `parentRunId` chains. Before spawning a chained run, reject if
its `subagentId` already appears in the path. Reject silently (log + emit a
`subagent_run_failed` event with code `LOOP_DETECTED`).

Depth hard-capped at 2 (a user mention is depth 0; one level of chain is
depth 1; another level would be depth 2 and is blocked).

## Cross-provider session isolation

Each provider keeps its own resume token under
`chat.sessionTokensByProvider[provider]`. The agent layer reads/writes the
token keyed by the **provider used for this turn**, not by the chat's
last-used provider.

- Primary turn with Claude after Codex turns → reads
  `sessionTokensByProvider.claude`. If null, this is Claude's first turn in
  this chat from its perspective, so we pass the history primer as preamble.
- Subagent run → always isolated. The subagent's invocation never resumes a
  shared session token. (A future optimization could maintain a per-subagent
  session token; out of scope for v1.)

## Protocol additions

WebSocket messages (Kanna's existing JSON-over-WS protocol):

- `subagent_list` (server → client) — full list, pushed on app-settings
  reactive snapshot.
- `subagent_create` (client → server) — `{ name, description?, provider,
  model, modelOptions, systemPrompt, contextScope }`.
- `subagent_update` (client → server) — `{ id, …same fields }`.
- `subagent_delete` (client → server) — `{ id }`. Refused if `builtin: true`.
- `chat_send` — extended with optional `subagentMentions` array (parsed
  client-side, validated server-side against subagent ids).

## UI

### Composer (`ChatInput.tsx`)

- Drop `providerLocked` constraint. `selectedProvider` always reflects
  `composerState.provider`.
- Active turn streaming: model selector remains interactive. Selection change
  updates `composerState`; in-flight turn unaffected.
- Below the textarea, render small chips for each parsed `@agent/<name>`
  mention so the user sees which subagents will run before send. Chips are
  read-only summaries computed from textarea content.

### Picker (`MentionPicker.tsx` + `useMentionSuggestions`)

- Hook returns `{ agents: Subagent[]; paths: ProjectPath[] }` filtered by the
  current query (the text after `@`).
- Picker renders two sections, **Agents** first when any match, **Files**
  below. Section headers shown when both have results.
- Selecting an agent inserts `@agent/<name> ` (trailing space). Selecting a
  file keeps existing behavior.
- Picker still triggers on the same `@` token rule defined by
  `shouldShowMentionPicker`; no new sigil.

### Settings (`SettingsPage.tsx`)

New "Subagents" section between provider settings and existing sections.

- List view: each subagent shows name, description, provider icon, model.
- Built-in subagents marked with a lock icon and an "Edit copy" affordance.
- Editor form:
  - `name` (text, validated)
  - `description` (text)
  - `provider` (selector, reuses `ChatPreferenceControls` provider switch)
  - `model` + `modelOptions` (reuses `ChatPreferenceControls`)
  - `systemPrompt` (multiline)
  - `contextScope` (radio: "Previous assistant reply only" /
    "Full conversation transcript")

### Transcript (`KannaTranscript.tsx`)

- New message kind `SubagentMessage` rendered as an assistant-shaped message
  with a header `{providerIcon} {subagentName}` and a subtle left border in
  an accent color.
- Multi-mention runs spawned by the same user message render as a sibling
  group beneath that user message, ordered by start time.
- Chained runs (parentRunId set) render indented one level under the
  triggering subagent message.
- Streaming indicator while a run is active. Failed runs render an inline
  error card with the failure code.

## Migration

- On event-store load, for each chat:
  - If legacy `sessionToken` exists and `sessionTokensByProvider` is empty,
    set `sessionTokensByProvider[chat.provider] = sessionToken`.
  - `chat.provider` retained as last-used hint.
- On app-settings load:
  - If `subagents` key absent, initialize with seeded built-ins.
- Existing chats: switching provider works immediately after upgrade.
  The first cross-provider turn after upgrade triggers a history primer.
- Old client builds: server keeps emitting `chat_provider_set` on first turn
  for forward-compat. Old clients ignore `subagent_*` events and render
  unknown event kinds as "Unsupported event" (matching existing
  unknown-event handling).

## Testing

Each item below maps to one or more co-located test files.

- `event-store.test.ts` —
  - Replay with new `subagent_run_*` events produces the expected
    `subagentRuns` map and ordering.
  - Legacy `chat_session_token_set` (no provider) migrates to the
    chat's last-known provider.
  - Provider switch after `chat_provider_set` does not throw and updates
    `chat.provider`.
- `agent.test.ts` —
  - Primary turn after provider switch generates a history primer matching
    snapshot.
  - Subagent run uses subagent's provider/model/systemPrompt; does not
    consume the chat's primary session token.
  - Multi-mention spawns up to `MAX_PARALLEL` concurrently and queues the
    rest.
  - Loop detection: a subagent whose reply mentions itself does not
    re-spawn; emits `subagent_run_failed` with code `LOOP_DETECTED`.
  - Depth limit: a chain of depth 2 is rejected.
- `mention-suggestions.test.ts` (rename or extend) —
  - Query "code" returns both matching subagents and matching paths.
  - Selecting an agent inserts `@agent/<name>` correctly into textarea.
  - Subagent named `agent` rejected by settings validation; covered in
    `subagent-validation.test.ts` (new).
- `chatPreferencesStore.test.ts` —
  - Provider switch on an existing chat updates `composerState.provider`
    without losing per-provider model options.
- `KannaTranscript.test.tsx` —
  - Renders `SubagentMessage` grouped under the triggering user message.
  - Renders chained runs indented under the parent run.
- New `subagent-orchestrator.test.ts` —
  - Parallel fan-out, history primer composition, parent/child wiring,
    failure propagation.

## Open questions

1. Should subagent `modelOptions` include `planMode`? Current thinking: no
   for v1 — subagents are short-lived helpers, plan mode adds review-loop
   friction. Revisit if a user explicitly asks.
2. Token budget warnings: should the composer warn when a history primer is
   estimated to exceed the target provider's context window? Punt to a
   follow-up; for v1 we trust providers' own truncation.
3. Subagent cost accounting: emit usage per-run for the Settings page
   accounting view? Yes — `SubagentRunCompletedEvent.usage` already carries
   it; UI work is small but tracked as a follow-up.
