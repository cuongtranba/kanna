---
id: adr-20260713-poisoned-session-token-selfheal
c3-seal: af97aec976a1fce8655d2bd29622cfd319f37002acd6a2eae34f2cdd1f613dcf
title: poisoned-session-token-selfheal
type: adr
goal: 'Stop a Kanna chat from being permanently wedged by a "poisoned" Claude session token — a stored `session_token` that points at a conversation the Claude CLI never persisted to disk. Three concrete behavior changes in `AgentCoordinator` (c3-210): (1) self-heal when a `--resume` fails with `No conversation found with session ID`, (2) never persist a `session_token` emitted by a cancelled/stale/suppressed spawn, (3) make the loop-orchestration /clear (setup_loop, background delivery) stick against the in-flight session re-persisting the old token and against warm-session in-band reuse.'
status: proposed
date: "2026-07-13"
---

# Poisoned Claude session token: self-heal + persist gating

## Goal

Stop a Kanna chat from being permanently wedged by a "poisoned" Claude session token — a stored `session_token` that points at a conversation the Claude CLI never persisted to disk. Three concrete behavior changes in `AgentCoordinator` (c3-210): (1) self-heal when a `--resume` fails with `No conversation found with session ID`, (2) never persist a `session_token` emitted by a cancelled/stale/suppressed spawn, (3) make the loop-orchestration /clear (setup_loop, background delivery) stick against the in-flight session re-persisting the old token and against warm-session in-band reuse.

## Context

Incident (chat `78c5407d-5212-4f11-a709-81d3357b2014`, 2026-07-13): the user armed a loop via `mcp__kanna__setup_loop`, then interrupted the auto-fired orchestrator turn twice. Observed event chain:

1. `setupLoop` wiped the token (`session_token_set null`), but the still-streaming turn re-persisted the old token 121 ms later — `runClaudeSession`'s `session_token` handler persisted unconditionally, so the documented /clear never stuck.
2. The cancelled auto-continue spawn emitted its init `session_token` 12 s AFTER `turn_cancelled`; the SDK-driver `cancel()` keeps the session alive, so the token was persisted — but the CLI never wrote that conversation file (interrupted before first persist).
3. Every subsequent send spawned with `resume: <poisoned>` and failed in ~2 s with SDK result `subtype: error_during_execution`, `result: ""`, `debugRaw.errors: ["No conversation found with session ID: …"]`. Before failing, the doomed spawn's own fresh session id was persisted — renewing the poison. The chat fails forever; verified on disk that none of the poisoned ids have a conversation JSONL.

Constraint: the existing `isPromptTooLongMessage` error path already models the correct remediation (recordTurnFailed + closeClaudeSession + clear token); the fix must ride the same machinery, not invent a new one. The `exit_plan_mode` clearContext branch shares the re-persist race but has different mid-turn semantics — explicitly out of scope here (follow-up).

## Decision

Three targeted changes inside `src/server/agent.ts`, no public contract change:

1. **Self-heal (`isNoConversationFoundMessage`)**: the error-result branch and the thrown-error catch branch of `runClaudeSession` treat `No conversation found with session ID` (checked against `result` text AND `debugRaw`, since the SDK puts it only in `errors[]`) exactly like prompt-too-long: fail the turn, close the session, clear the stored token. The next send spawns fresh instead of looping forever.
2. **Persist gating**: the `session_token` handler persists to the store only when the emitting session is still the chat's current session, `cancelledResultPending === 0`, and `suppressSessionTokenPersist` is false. In-memory `session.sessionToken` still updates (workflow-dir registration, fork bookkeeping). Any later real activity re-emits the token per SDK message, so a legitimately reused session re-persists naturally.
3. **`clearClaudeSessionContext(chatId)` helper**: the /clear used by `setupLoop` and `deliverSubagentToMain` now (a) wipes the store token, (b) sets `suppressSessionTokenPersist = true` on the live session so the old conversation's late token events cannot resurrect the wipe, and (c) when no turn is active (idle warm SDK session), closes the session so the next turn is a genuinely fresh spawn rather than in-band reuse — making the documented "fresh spawn per delivery" true on the SDK driver.

Alternatives like auto-retrying the failed resume turn were rejected: retry loops on a persistent failure are worse than one visible failed turn followed by a clean send, and the prompt-too-long precedent already sets the fail-then-heal semantics.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-210 | component | All three fixes live in AgentCoordinator (runClaudeSession session_token/error handling, cancel() interplay, setupLoop / deliverSubagentToMain /clear path) — the component that owns turn lifecycle and session-token persistence. | c3-210#n6585@v1:sha256:588b3966e9ff5b225b83ffadc7d415b18ed72d7e6c335864e521f7729832ec17 | Behavior-internal fix; no boundary or contract change, colocated bun tests updated in the same PR. |

## Compliance Refs

| Ref | Why required | Evidence | Action |
| --- | --- | --- | --- |
| ref-colocated-bun-test | New regression tests must sit next to agent.ts as agent.test.ts cases and run under bun test. | ref-colocated-bun-test#n8216@v1:sha256:9490f9305f79ff29d492d099b81c1227c5d277e4a16bf251c1779ddc338f4be8 | comply |
| ref-event-sourcing | Token wipes/persists ride the existing session_token_set event through the event store; the fix changes WHEN the event is emitted, never bypasses the store. | ref-event-sourcing#n8282@v1:sha256:1ff5f5fcbeeb85e1ccfe24b3e3e63babaec81436d2a50381b8e0b560132fd0aa | comply |
| ref-provider-adapter | The fix stays in the coordinator layer; no driver (SDK/PTY adapter) contract changes — both drivers keep emitting session_token HarnessEvents unchanged. | ref-provider-adapter#n8348@v1:sha256:6c354267518fab769e6ba895dc71c3d27f8216ea10e1cb84a52a488e8ff7e972 | review |
| ref-tool-hydration | c3-210 cites this ref, so it was reviewed: the fix changes session-token bookkeeping only and never touches tool-entry normalization, so no hydration behavior changes. | ref-tool-hydration#n8452@v1:sha256:376e5fee261bd3b463633f19523020439854d9bd11ddc28ff5cffe12d8ed485e | review |

## Compliance Rules

| Rule | Why required | Evidence | Action |
| --- | --- | --- | --- |
| rule-colocated-bun-test | The four new regression tests are colocated in src/server/agent.test.ts and run via bun test --conditions production. | rule-colocated-bun-test#n8551@v1:sha256:ce58e026c1076cb18ede38f3a4bd73793f28bf1392d299399571ba446985623f | comply |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Auto-retry the turn after clearing the poisoned token | A resume failure that recurs (e.g. FS permissions) would loop invisibly; the repo's prompt-too-long precedent is fail-the-turn-then-heal, and the user's next send succeeds. |
| Guard only at spawn (validate the conversation file exists before --resume) | Requires FS IO in the pure layer (side-effect seal) and duplicates knowledge of the CLI's project-dir encoding; gating persistence at the source is smaller and driver-agnostic. |
| Close the live session inside setupLoop too (not just suppress) | setup_loop runs from INSIDE the streaming turn that called the MCP tool; killing it would corrupt the in-flight tool result. The armed-flip respawn already forces a fresh session at the next turn boundary. |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Persist gating drops a legitimate token (SDK session reused after cancel) | The SDK re-emits session_token on every message; the next real turn re-persists. Gate only skips the cancel window (cancelledResultPending > 0, reset on new turn). | New test "does not persist a session token that arrives after cancel()" plus existing reuse/idle-resume tests stay green. |
| Closing the warm session on background delivery breaks an in-flight turn | clearClaudeSessionContext closes only when activeTurns has no entry for the chat; mid-turn callers get suppression only. | New test "closes the warm claude session so the /clear yields a truly fresh spawn"; loop-scenario suite green. |
| False-positive match of the error string | Regex anchored to the CLI's exact No conversation found with session ID phrase; worst case is a cleared token → fresh spawn (safe). | Test drives the exact debugRaw payload observed in the incident transcript. |

## Verification

| Check | Result |
| --- | --- |
| bun test --conditions production src/server/agent.test.ts | 4 new tests (self-heal, cancel-gate, setup_loop /clear survival, warm-session close) + all existing pass |
| bun run test | Full suite green before push |
| bun run lint && bun run typecheck | Clean |
| Incident replay: poisoned chat sends once → token cleared → second send spawns fresh conversation | Manual smoke after deploy on chat 78c5407d |
