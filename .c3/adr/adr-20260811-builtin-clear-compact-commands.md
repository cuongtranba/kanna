---
id: adr-20260811-builtin-clear-compact-commands
c3-seal: e251fd382fe0c6885a447ac1f2f7be7ea4a4208802a0220841e3158127413b15
title: builtin-clear-compact-commands
type: adr
goal: Make `/clear` and `/compact [instructions]` real Kanna actions on all three providers instead of prompt text that happens to reach a CLI. Today the composer serializes them as ordinary content, so `/clear` never clears Kanna's persisted session token, a user-typed `/compact` hangs the chat under the PTY driver, and neither command appears in the `/` picker. This decision adds one pure parser, one dispatch site, one all-provider context-clear effect, and one named `CompactionTurnKind` on `ActiveTurn` — and, because a clear that only nulls the token is cosmetic, scopes the history primer to the last context reset.
status: accepted
date: "2026-08-11"
---

## Goal

Make `/clear` and `/compact [instructions]` real Kanna actions on all three providers instead of prompt text that happens to reach a CLI. Today the composer serializes them as ordinary content, so `/clear` never clears Kanna's persisted session token, a user-typed `/compact` hangs the chat under the PTY driver, and neither command appears in the `/` picker. This decision adds one pure parser, one dispatch site, one all-provider context-clear effect, and one named `CompactionTurnKind` on `ActiveTurn` — and, because a clear that only nulls the token is cosmetic, scopes the history primer to the last context reset.

## Context

`chat.send` carries `/clear` verbatim: `claude-turn-starter.ts` appends it as a `user_prompt` bubble and hands the string to the provider. The PTY driver types it into a live TUI (so the real CLI command runs), the SDK driver enqueues it as a `role:"user"` message, and Codex receives it as prose it answers conversationally. The only slash-aware server code is a negative guard in `shouldInjectProactiveCompact` that refuses to prefix Kanna's own `/compact` when the content already starts with `/`.

Three defects follow. First, `/clear` leaves `sessionTokensByProvider` intact, so the next turn resumes the same provider session and no `context_cleared` entry is written. Second, the PTY compact-boundary finalize added by adr-20260608-pty-compact-boundary-dequeue-finalize is gated on `proactiveCompactInjection`, which only Kanna's own injection sets — a user-typed `/compact` under PTY emits `compact_boundary` and no `result`, so the active turn lingers forever and `message.dequeue` wedges, reproducing exactly the bug that ADR fixed. Third, the `/` picker is fed exclusively by the disk-scanned catalog, which contains no builtins.

A fourth defect is pre-existing and blocks an honest fix of the first: `shouldInjectPrimer` returns true whenever the target provider's token is null, and `buildHistoryPrimer` then replays the WHOLE transcript (up to `PRIMER_MAX_CHARS` = 60000). Nulling a token therefore re-sends the conversation that was just cleared. This already defeats the loop `/clear` path — `setup_loop`, `deliverSubagentToMain`, and `disarmFailingLoop` all append `context_cleared` and all three get the prior conversation re-primed — despite adr-20260711-notification-driven-loop-orchestration resting entirely on main being stateless-in-context.

Codex constrains the design. Its app-server protocol exposes `initialize`, `initialized`, `thread/fork`, `thread/resume`, `thread/start`, `turn/start`, and `turn/interrupt` — there is no compaction request. Kanna can observe `thread/compacted` but cannot ask for it. Separately, `CodexAppServerManager.startSession` reuses a live session whenever the cwd matches and there is no pending fork; it never consults the session token, so a token wipe alone does not reset a Codex thread.

## Decision

One pure parser in `src/shared/builtin-commands.ts` owns both the dispatch shape and the picker catalog, with a colocated drift guard asserting every catalog entry parses. A builtin must be the whole message: `/clear now` does not match, because silently discarding what the user typed is worse than treating the line as an ordinary prompt.

`runBuiltinCommand` in `claude-send-command.ts` is the single dispatch site, called from both `sendCommand` and `dequeueAndStartQueuedMessage`. In `sendCommand` it sits AFTER the `isChatBusy` enqueue branch, so a `/clear` typed mid-turn queues like any other message and runs when the turn drains — every `startingTurns` / `PendingToolSlots` / `isChatBusy` invariant is left alone. A steered message falls through as text: it is an injection into a live session, not a fresh turn.

`/clear` is pure Kanna state and starts no turn. `clearChatContext` nulls every provider's token, applies the existing claude suppress-persist and idle-session teardown, stops the Codex process, appends `context_cleared`, and emits a state change. `clearClaudeSessionContext` MOVES out of `claude-loop-commands.ts` into the new `claude-context-commands.ts` and is re-exported, so the loop path and the user command share one definition and cannot drift.

`/compact` is a turn on every provider, shaped by what the provider can do. On claude and openrouter the CLI command passes through verbatim with `appendUserPrompt: false`; openrouter is included because it runs the same claude binary with a different `ANTHROPIC_BASE_URL`, and Kanna's exclusion of openrouter from PROACTIVE compaction is a policy about spending unprompted, not a claim the command fails. On Codex, Kanna performs the compaction itself: it asks the model to summarize, then `claude-turn-runner.ts` accumulates the reply, writes `compact_boundary` followed by `compact_summary`, nulls the codex token, and stops the session. The boundary precedes the summary because the primer resumes at the last boundary and replays what follows; the other order would cut the summary out and hand Codex an empty context. Error, cancel, or an empty summary commits nothing — dropping the thread without a replacement is strictly worse than not compacting.

`ActiveTurn.proactiveCompactInjection` (boolean) becomes `compactionTurn: CompactionTurnKind` (`proactive` | `user` | `codex_summary`) with two predicates. `isCliCompactTurn` gates the PTY boundary finalize, so a user-typed compact finalizes too. `isProactiveCompactTurn` gates the `compactFailureCount` circuit breaker and the `message.dequeue` refusal, both of which exist to bound Kanna's own automatic injection and must not fire for a command the user typed. A named union rather than two parallel booleans is what keeps those two questions from being conflated again.

`buildHistoryPrimer` starts at the most recent `context_cleared` / `compact_boundary`, counts `compact_summary` as assistant content, and hoists a summary that sits on the older side of its own boundary so emission order does not matter. `shouldInjectPrimer` is unchanged: "token null implies prime" was always right; the bug was what got primed.

The builtins are prepended to the picker catalog in `localCommandsForCwd`, the projection that already feeds the `project-commands` topic — `LocalCatalogService.list` still returns disk entries only. This narrowly reverses the built-ins risk row in adr-20260724-slash-picker-local-only ("these are CLI REPL commands, not Kanna actions"), which no longer holds for these two. That ADR's load-bearing half is preserved intact: no CLI spawn, no `getSupportedCommands()`, no async load, no timeout — `BUILTIN_SLASH_COMMANDS` is a static constant.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-210 | component | Owns the send pipeline and turn lifecycle: gains the builtin dispatch site, the all-provider context clear, the CompactionTurnKind split, the codex summarize turn, and the primer scope fix | c3-210#n10851@v1:sha256:f278cbcdac23ca0944ff3afd3cd69d141bac97340c950d2d9ef9539e2e9b2132 | Confirm the busy/cancel invariants are untouched and that the breaker stays proactive-only; colocated tests added |
| c3-231 | component | Its consumer now prepends static builtins to the catalog; the service contract list(cwd) is unchanged, but the scan-failure degradation improves from empty to builtins-only | c3-231#n9919@v1:sha256:b41b22145a5d97c0d27683d7ce105465b959236caa11ab865205a94250b36205 | Confirm no disk scan, no CLI spawn, and no change to LocalCatalogService.list |
| c3-115 | component | The composer picker is now provider-scoped instead of claude-only: builtins on every provider, disk-scanned Claude Code skills only where the claude CLI runs | c3-115#n8033@v1:sha256:07cf833fd0aea7648d46053f730df07e554c9e3757b02a4226ab5560f684e22c | Confirm reference stability of the memoized option list; ast-grep + lint:usestate gates |
| c3-211 | component | Its protocol has no compaction request, which is the reason Codex compaction is a Kanna-side summarize turn plus stopSession plus token wipe | c3-211#n10852@v1:sha256:5fdf460b9aca2bad6188f1d79f9079334f69ca967603edeb1ab34c745142bfc1 | Confirm the documented method list matches codex-app-server-protocol.ts |
| c3-2 | container | N.A - ancestor named only to complete the top-down descent | N.A - ancestor escape | N.A - ancestor escape |
| c3-0 | system | N.A - ancestor named only to complete the top-down descent | N.A - ancestor escape | N.A - ancestor escape |
| c3-1 | container | N.A - ancestor named only to complete the top-down descent | N.A - ancestor escape | N.A - ancestor escape |

## Compliance Refs

| Ref | Why required | Evidence | Action |
| --- | --- | --- | --- |
| ref-provider-adapter | /clear and /compact must present one transcript model across providers: all three emit the same context_cleared / compact_boundary / compact_summary kinds, so the UI never branches on provider even though Codex compaction is Kanna-driven | ref-provider-adapter#n10435@v1:sha256:3bcf82b74f0f034db61a050837c7182691d29b77181e6f6c7805be1f2e00e180 | comply |
| ref-event-sourcing | The clear and the compaction go through existing store writes (setSessionTokenForProvider, appendMessage) and existing transcript kinds; no history is rewritten and no new event type is introduced | ref-event-sourcing#n10369@v1:sha256:ee0316401639d91b6d6f6b1c3615cf7eab1abbd5cbf9cef319474a29c2567775 | comply |
| ref-side-effect-adapter | builtin-commands.ts, claude-context-commands.ts, and claude-send-command.ts stay IO-free; the codex teardown arrives as an injected stopCodexSession dep wired in agent-deps-builders.ts | ref-side-effect-adapter#n10468@v1:sha256:cdbf6975e8a35b0d03558be6822dfae166482c24fb86b0433f60e8167f5c91e4 | comply |
| ref-colocated-bun-test | Every new module ships its colocated suite, and the cross-module compaction seam gets claude-turn-runner.integration.test.ts | ref-colocated-bun-test#n10303@v1:sha256:2bc20e87f7c1e3aabe46c42732cca6d91bf2f72516544a2924fe9870e8df4385 | comply |
| ref-zustand-store | The picker's provider scoping folds into the existing useMemo; no new client state and no new unstable reference | ref-zustand-store#n10605@v1:sha256:dbc70d01ac1d611dc6a09e8e8e32d43b2566e4f95364435024f241e5109d3498 | comply |
| ref-strong-typing | Cited by c3-211; the codex compaction path adds CompactionTurnKind and a named stopCodexSession dep, both typed at the boundary with no any | ref-strong-typing#n10506@v1:sha256:eaa7509d80f8a56b00105ed5d46af5a604bfae2e81889e9dac7d7a095fbf5009 | comply |
| ref-local-first-data | Cited by c3-231; the builtins are a static in-process constant, so the catalog gains no network call and no new data location | ref-local-first-data#n10402@v1:sha256:6c1744cb29d49192d5bb3ac1662201087df01c9ee04f38fb3f53d04844e79485 | comply |
| ref-tool-hydration | Cited by c3-210, and the codex summarize turn is the one place this change intercepts the transcript stream mid-turn: it must divert assistant_text only, leaving tool_call / tool_result entries to hydrate and persist exactly as on a normal turn | ref-tool-hydration#n10539@v1:sha256:1cda574e5908fc3b6c85e5bbb9432e5edeee3a0c7d0d11e0230c45ac05c8a718 | review |

## Compliance Rules

| Rule | Why required | Evidence | Action |
| --- | --- | --- | --- |
| rule-colocated-bun-test | New suites sit beside their subjects with matching basenames and run under bun test --conditions production | rule-colocated-bun-test#n10638@v1:sha256:2bc20e87f7c1e3aabe46c42732cca6d91bf2f72516544a2924fe9870e8df4385 | comply |
| rule-strong-typing | BuiltinCommand and CompactionTurnKind are named discriminated unions, getProviderSettings gains a named ProviderSettings return type, and AgentProvider is derived from the new AGENT_PROVIDERS tuple so the list and the type cannot drift | rule-strong-typing#n10699@v1:sha256:eaa7509d80f8a56b00105ed5d46af5a604bfae2e81889e9dac7d7a095fbf5009 | comply |
| rule-zustand-store | The typeahead plugin's prop change (enabled to provider) introduces no useState and no JSX-inline state logic | rule-zustand-store#n10731@v1:sha256:dbc70d01ac1d611dc6a09e8e8e32d43b2566e4f95364435024f241e5109d3498 | comply |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| src/shared/builtin-commands.ts | New: parseBuiltinCommand, BUILTIN_SLASH_COMMANDS, buildCodexCompactPrompt | src/shared/builtin-commands.test.ts |
| src/server/claude-context-commands.ts | New: clearChatContext plus clearClaudeSessionContext moved from claude-loop-commands.ts and re-exported there | src/server/claude-context-commands.test.ts |
| src/server/claude-send-command.ts | runBuiltinCommand dispatched from sendCommand (after the busy check) and dequeueAndStartQueuedMessage (non-steered only) | src/server/claude-send-command.test.ts |
| src/server/claude-session-state.ts | CompactionTurnKind replaces proactiveCompactInjection; adds isCliCompactTurn / isProactiveCompactTurn | src/server/claude-session-runner.test.ts |
| src/server/claude-session-runner.ts | PTY boundary finalize gates on isCliCompactTurn; breaker writes gate on isProactiveCompactTurn | src/server/claude-session-runner.test.ts |
| src/server/claude-turn-runner.ts | finalizeCodexSummary: accumulate assistant text, write boundary then summary, null the codex token, stop the session | src/server/claude-turn-runner.test.ts |
| src/server/history-primer.ts | selectPrimerEntries scopes the primer to the last context reset; compact_summary renders and counts as assistant content | src/server/history-primer.test.ts |
| src/server/claude-slash-commands.ts | localCommandsForCwd prepends the builtins and degrades to them on scan failure | src/server/claude-slash-commands.test.ts |
| src/client/lib/slash-commands.ts | commandsForProvider narrows the catalog for codex | src/client/lib/slash-commands.test.ts |
| src/client/components/lexical/plugins/SlashCommandTypeaheadPlugin.tsx | provider prop replaces enabled; ChatInput passes selectedProvider | src/client/components/lexical/plugins/SlashCommandTypeaheadPlugin.test.tsx |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| src/shared/builtin-commands.test.ts | Asserts every BUILTIN_SLASH_COMMANDS entry parses, so the picker cannot advertise a command dispatch does not handle | bun test --conditions production src/shared/builtin-commands.test.ts |
| src/server/claude-session-runner.test.ts | Asserts a user compact finalizes under PTY, does NOT finalize under SDK, and never touches setCompactFailureCount on success or error | bun test --conditions production src/server/claude-session-runner.test.ts |
| src/server/claude-turn-runner.test.ts | Pins boundary-before-summary ordering and that a failed, cancelled, or empty summarize turn commits nothing | bun test --conditions production src/server/claude-turn-runner.test.ts |
| src/server/claude-turn-runner.integration.test.ts | Runs the real runTurn and feeds its transcript to the real buildHistoryPrimer: the next turn carries the summary and not the compacted history | bun test --conditions production src/server/claude-turn-runner.integration.test.ts |
| src/server/history-primer.test.ts | Asserts a chat ending at context_cleared primes to null — the regression test for /clear being cosmetic | bun test --conditions production src/server/history-primer.test.ts |
| src/server/ws-router.test.ts | Pins the exact project-commands wire payload, so a change to the builtin catalog cannot ship unnoticed | bun test --conditions production src/server/ws-router.test.ts |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Keep passing /clear through to the provider | It cannot work: Kanna's persisted sessionTokensByProvider is what the next turn resumes from, and the CLI has no way to reach it. The chat would show a cleared REPL and then resume the old session anyway |
| Refuse /compact on Codex with a "not supported" notice | Codex has no compaction request, but it does have a model that can summarize; a refusal leaves the one provider whose context Kanna cannot bound without any manual remedy |
| Reuse proactiveCompactInjection for the user-typed compact | It would finalize correctly under PTY but also feed the compactFailureCount breaker and wedge message.dequeue — both bound Kanna's own injection, and a user command must not consume that budget |
| Null the codex token without stopSession | startSession reuses a live session on a cwd match and never reads the token, so the clear would be a no-op on the very next turn |
| Write compact_summary before compact_boundary | The primer resumes at the last boundary, so the summary would fall on the discarded side and the compaction would spend a turn to produce nothing |
| Merge the builtins inside LocalCatalogService.list | That service's contract is the disk catalog; a static constant has no business in the scan path, and the projection that feeds the picker is already the right seam |
| Leave the history primer unscoped and ship /clear anyway | /clear would be theatre: the divider renders, then up to 60000 chars of the cleared conversation ride the next prompt. The same defeat already applies to the loop /clear path |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Widening the PTY boundary finalize double-finalizes an SDK compact and corrupts the trailing result's seq accounting | The resolveClaudeDriverPreference() === "pty" condition is kept verbatim; an explicit SDK-driver case asserts no finalize on the boundary | bun test --conditions production src/server/claude-session-runner.test.ts |
| Scoping the primer changes behavior for chats carrying a provider-driven compact_boundary, beyond this feature's own paths | That is the correct behavior — the provider already dropped that history and re-priming it was Kanna re-inflating a context the provider deliberately shrank. The loop /clear path is fixed by the same change | bun test --conditions production src/server/history-primer.test.ts |
| A Codex /compact spends a full turn and can be interrupted mid-flight | All-or-nothing: boundary, summary, token wipe, and session stop happen only on a successful result with non-empty prose | bun test --conditions production src/server/claude-turn-runner.test.ts |
| /compact on openrouter is unverified against a third-party endpoint | It is the same claude binary with a different ANTHROPIC_BASE_URL; a failure surfaces as an ordinary errored turn, not a wedged one | bun test --conditions production src/server/claude-send-command.test.ts |
| A project-authored .claude/commands/clear.md is dropped from the picker and intercepted before the CLI sees it | The dedupe is by lowercased name and the ADR records the consequence; the mitigation is to rename the project command | bun test --conditions production src/server/claude-slash-commands.test.ts |

## Verification

| Check | Result |
| --- | --- |
| bun run test | pass — 5583 pass, 2 skip, 0 fail across 461 files |
| bun run lint | pass — eslint src/ --max-warnings=0, no new warnings |
| bun run typecheck | pass — TS7 via node_modules/typescript-7/bin/tsc --noEmit |
| bunx ast-grep test && bun run lint:usestate | pass — 14 rule tests, no new violations |
| Manual: /clear on a claude chat, then ask the model what was just said | It has no recollection; before this change it answers correctly |
| Manual: /compact focus on X on a codex chat | Renders a Summarized row then a COMPACTED divider; the next message is answered from the summary |
