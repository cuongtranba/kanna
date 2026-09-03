---
name: kanna-subagents
description: Subagent delegation — how the main agent hands work to a subagent and gets it back, covering delegate_subagent, send_subagent_message, close_subagent, the roster injected into the system prompt, the spawn gate that decides whether a run may start, keep-alive multi-turn sessions, and background runs that deliver back into the main chat. Use whenever a task involves delegating to a subagent, an @agent/<name> mention, a run that failed AUTH_REQUIRED / LOOP_DETECTED / DEPTH_EXCEEDED / CAP_EXCEEDED / MAX_TURNS / NO_LIVE_SESSION, keep_alive or run_in_background, the permit pool and its concurrency limits, KANNA_SUBAGENT_MAX_LIVE or KANNA_SUBAGENT_IDLE_TIMEOUT_MS, or a background subagent whose result never came back to the main chat. Read it before changing SubagentOrchestrator, subagent-provider-run.ts, or the delegation tools in kanna-mcp.ts.
---

# Subagent delegation (Anthropic Task-tool pattern)

The main agent is always in the loop. `@agent/<name>` in chat input is a
**hint**, not server-side routing — it no longer short-circuits the main
turn. The main model decides whether to delegate and calls
`mcp__kanna__delegate_subagent({ subagent_id, prompt })`. The tool blocks
until the run finishes and returns the subagent's final reply as text;
the main model then synthesizes it into its own response.

- **Roster injection:** `buildKannaSystemPromptAppend(subagents)` in
  `src/shared/kanna-system-prompt.ts` builds a dynamic system-prompt
  suffix listing every configured subagent's `name`, `id`, and
  `description`. Computed per-spawn in `agent.ts` and passed to both
  drivers (SDK via `systemPrompt.append`, PTY via
  `--append-system-prompt`). Truncated at 20 entries by `updatedAt`
  descending; remainder surfaced as "(N more subagents omitted ...)".
- **MCP tool:** registered in `kanna-mcp.ts` only when the spawn
  supplies both `subagentOrchestrator` AND `delegationContext`. Main
  spawns supply `depth: 0`, `ancestorSubagentIds: []`, `parentRunId:
  null`. Subagent spawns (sub-spawn-sub) supply the caller's own
  context so cycle / depth checks apply — `LOOP_DETECTED` when the
  target appears in the ancestor chain, `DEPTH_EXCEEDED` when
  `depth > maxChainDepth` (default 1, configurable on the orchestrator).
- **`SubagentOrchestrator.delegateRun(args)`:** public async API that
  awaits a single run and returns `DelegationOutcome` —
  `{status:"completed", text}` or `{status:"failed", errorCode, errorMessage}`.
  Used by the MCP tool; also exposed via
  `AgentCoordinator.getSubagentOrchestrator()` for tests.
- **Cancellation:** `cancelChat` / `cancelRun` cascade through delegated
  runs as before. Each `delegateRun` registers a `RunState` and obeys
  the same permit / timeout / abort wiring as the legacy
  mention-triggered path.
- **Backwards compat:** `parseMentions` still runs inside the normal
  `appendUserPrompt` path so `subagentMentions` metadata stays on
  `user_prompt` entries for UI badges and analytics. The assistant-text
  mention scan and the `chat_send` / dequeue short-circuits are removed.

## Subagent spawn gate — parity with the main chat (adr-20260805-subagent-spawn-gate-parity)

`SubagentOrchestrator` fails a run `AUTH_REQUIRED` when `ProviderRunStart.authReady()`
returns false. For claude that predicate is `claudeAuthReady(pool, chatId)`
(`provider-catalog.ts`), and it is the **single definition of the Claude spawn
gate**:

```ts
if (!pool || !pool.hasAnyToken()) return true  // local claude CLI credentials
return pool.hasUsable(reservedFor)
```

**An OAuth-pool token is required only once the user has configured one.** With
`claudeAuth.tokens: []` the driver falls through to the local `claude` CLI
credentials, exactly as `claude-session-spawner.ts` / `quick-response.ts` do
(their `hasAnyToken() && !picked` refusal is the same condition, kept in that
form because they also need the picked token — TOCTOU-closed per c3-224). A
subagent must never be refused where a main-chat turn would spawn: that
asymmetry gave a working main chat and `AUTH_REQUIRED` on every delegation,
which presents as "the loop won't set up" because the orchestrator disarms after
the failed `delegate_subagent`.

`reservedFor` is the **parent** chat id, so a token already reserved by the
parent counts as usable — subagent runs are sequential under the parent's paused
turn (see `oauth-token-pool` `isEligible`).

**There is no `claudeAuth.authenticated` setting.** `ClaudeAuthSettings` is
`{tokens, concurrencyDefault}`; the flag never existed and was never written, so
a gate that consulted it read every user as unauthenticated. `AppSettingsSnapshot`
deliberately omits `claudeAuth` so re-reading it is a compile error — do not
re-add it.

## Keep-alive multi-turn subagents (claude SDK + PTY)

`delegate_subagent({ subagent_id, prompt, keep_alive: true })` keeps the
subagent's claude session open after the first `result` instead of tearing it
down. The main agent then drives further turns into the SAME warm session — no
re-spawn, no re-trust, warm cache. Star topology preserved: the main agent is
always the one calling these tools.

- **SDK transport (`adr-20260616-adr-20260616-sdk-pty-feature-parity`):** the SDK
  driver uses its native streaming-input prompt queue —
  `startClaudeSession({ keepAlive })` leaves the `AsyncMessageQueue` open after
  the initial prompt and exposes the handle's `pushChannelPrompt` field backed
  by a queue push (shared with `sendPrompt` via `enqueueUserPrompt`). No
  channel/dev-channels flag is needed.
- **PTY transport:** as below — a kanna channel push.

- **Transport:** each turn is a kanna channel push (`pushChannelPrompt`, the
  same MCP-notification transport shipped in PR #333) followed by draining
  the persistent `HarnessEvent` stream until the next synthesized
  `kind:"result"` event. Interactive TUI claude never writes a
  `type:"result"` row; the turn-end signal depends on CLI version (see
  **PTY turn-end detection** in `.claude/skills/kanna-pty/SKILL.md`).
  `createJsonlEventParser` (`jsonl-to-event.ts`) synthesizes one
  `kind:"result"` per turn either way, so a per-turn drain (`drainOneTurn` in
  `subagent-provider-run.ts`) returns once per turn and leaves the iterator open.
- **Auto-wake filter exemption (do NOT remove):** a channel push lands in the
  transcript as a `user isMeta:true` line at a turn boundary, which the
  `jsonl-to-event.ts` auto-wake filter (added in 216392b to drop CC's own
  `<task-notification>` background wakes) would otherwise eat — dropping the
  synthesized `result` and hanging `drainOneTurn` forever. The parser detects
  the `<channel source="kanna">` tag (`userMessageContainsKannaChannel`) and
  treats those lines as real turns. Genuine `<task-notification>` wakes stay
  filtered. Unit fakes emit `kind:"result"` directly and bypass this path, so
  this invariant is only covered by the parser tests + the real-OAuth e2e.
- **Driver:** `StartClaudeSessionPtyArgs.keepAlive` suppresses
  `oneShotClose()` on the first result and exposes
  `pushChannelPrompt` on the handle (`claude-pty/driver.ts`). Keep-alive
  REQUIRES channel delivery — a keep-alive run with no `pushChannelPrompt`
  fails closed. The subagent system prompt gets the plural channel framing
  (`buildChannelPromptFraming(true)`) so the model expects multiple channel
  messages over the session and does not treat turn 2+ as a suspicious
  interrupt.
- **Provider run:** `runClaudeSubagent` drains turn 1, then returns a
  `LiveTurnSource` (`runTurn(prompt, onChunk, onEntry)` + `close()`) via the
  widened `ProviderRunStart.start(onChunk, onEntry, { keepAlive })`. Codex is
  out of scope — keep-alive is claude-PTY only; the MCP layer rejects
  `keep_alive` for non-claude subagents.
- **Orchestrator:** a `liveSessions` registry (keyed by `runId`) holds each
  warm session. Turn 1 runs through the normal `spawnRun` plumbing (permit,
  RunState, timeout, abort, events) but on completion registers a
  `LiveSession` instead of cleaning up; the RunState stays registered so
  cancel can reach it. Follow-up turns: `sendToLiveRun(runId, prompt)`.
  Teardown: `closeLiveRun(chatId, runId, reason)`.
- **Permit model:** an idle live session holds NO parallel permit. Each
  active turn (`spawnRun` turn 1, and each `sendToLiveRun`) acquires a permit
  for its drain and releases it after. Two orthogonal limits — permits =
  concurrent active turns; `KANNA_SUBAGENT_MAX_LIVE` = live processes.
- **Lifecycle bounds:** idle sessions are auto-closed after
  `KANNA_SUBAGENT_IDLE_TIMEOUT_MS` (default 300000), reset on each turn. Live
  process count is capped per chat by `KANNA_SUBAGENT_MAX_LIVE` (default 5) —
  over cap, `delegate_subagent({keep_alive:true})` fails `CAP_EXCEEDED`
  (no LRU eviction; an LRU session might be in use). `cancelChat` /
  `cancelRun` cascade-close all live sessions for the chat/run.
- **MCP tools** (registered under the same `subagentOrchestrator &&
  delegationContext` guard as `delegate_subagent`):
  - `delegate_subagent({ ..., keep_alive })` — turn 1; on completion appends
    `[run_id: ...]` to the reply so the model learns the handle.
  - `send_subagent_message({ run_id, prompt })` — drives a follow-up turn;
    blocks until that turn finishes; `NO_LIVE_SESSION` if unknown.
  - `close_subagent({ run_id })` — tears down + frees the process.
- **Env vars:** `KANNA_SUBAGENT_MAX_LIVE` (default 5),
  `KANNA_SUBAGENT_IDLE_TIMEOUT_MS` (default 300000) — both wired into the
  orchestrator deps at `AgentCoordinator` construction (`agent.ts`); the
  orchestrator itself reads only its deps (side-effect seal).

## Background subagents (`delegate_subagent run_in_background`)

`delegate_subagent({ subagent_id, prompt, run_in_background: true })` launches a
subagent WITHOUT blocking the main turn. The MCP tool returns immediately with
`{status:"async_launched", run_id}`; the subagent's final reply is delivered
back into the main chat as a fresh turn when it finishes. Mutually exclusive
with `keep_alive` (the MCP host rejects both set). Works for any provider
(Claude + Codex) — delivery is provider-agnostic. See
`adr-20260616-subagent-run-in-background`.

- **Orchestrator:** `delegateRun({background:true})` runs the subagent through
  the normal `spawnRun` plumbing (permit, RunState, timeout, abort,
  event-sourcing) but does NOT await it — it generates the runId up front,
  returns `{status:"async_launched", runId}`, and on terminal fires the
  `onBackgroundRunComplete(chatId, runId, BackgroundRunOutcome)` dep. The active
  background run holds a permit while in flight, so concurrency is bounded by
  the existing permit pool (default 4) + run timeout. No live-session registry
  (background runs are one-shot, not keep-alive).
- **Re-entry (driver-agnostic, always /clears main).** `AgentCoordinator.deliverSubagentToMain`
  is wired as `onBackgroundRunComplete`. On every delivery it (1) wipes the
  chat's Claude `session_token` (main /clear equivalent — same machinery
  `exit_plan_mode`'s clearContext branch uses), (2) appends a `context_cleared`
  transcript entry, (3) emits `auto_continue_accepted { source:
  "subagent_background", delayMs: 0 }` whose prompt is the structured
  `<task-notification>` XML (`buildTaskNotification` in `agent.ts` — same
  format Claude Code's LocalAgentTask uses, so the model parses task
  identity/status natively). Un-armed ad-hoc deliveries include the subagent's
  `<result>` body (truncated at 4k chars) — the /clear per delivery means the
  result rides exactly one fresh prompt, context never accumulates. ARMED loop
  deliveries omit `<result>` (PROGRESS.md stays the loop's only durability
  contract) and append the full loop discipline prompt after the notification.
  `fireAutoContinue` → `enqueueMessage` delivers to both drivers; because
  session_token is null, the next main turn is a FRESH Claude spawn.
- **No wake cap.** Concurrency is bounded by the subagent permit pool + run
  timeout. Every delivery is a real event, never a self-poll — no runaway
  budget is meaningful here.

The un-armed delivery prompt's filename discipline, and what an ARMED delivery
does differently, are in `.claude/skills/kanna-loop/SKILL.md`.
