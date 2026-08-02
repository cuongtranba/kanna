---
id: adr-20260802-retire-orchestration-core
c3-seal: d65dec7736dc7e01490975d721b0f804f2e7f7eb647117b72eb6490b7a016c44
title: retire-orchestration-core
type: adr
goal: Retire component `c3-232 orchestration-core` in full — the durable multi-task, multi-phase orchestration engine (`OrchestrationQueue`), its worktree pool, its 18-variant `OrchestrationEvent` union and `orch.jsonl` log, the three MCP tools (`orch_run`, `orch_run_status`, `orch_cancel_run`), the `orch.*` WS commands and the `orch-runs` topic, and the entire client Orchestration panel. Single-task subagent delegation (`c3-210` / `SubagentOrchestrator` / `delegate_subagent`) and the notification-driven autonomous loop (`setup_loop` / `stop_loop`) are explicitly out of scope and must survive unchanged.
status: proposed
date: "2026-08-02"
---

## Goal

Retire component `c3-232 orchestration-core` in full — the durable multi-task, multi-phase orchestration engine (`OrchestrationQueue`), its worktree pool, its 18-variant `OrchestrationEvent` union and `orch.jsonl` log, the three MCP tools (`orch_run`, `orch_run_status`, `orch_cancel_run`), the `orch.*` WS commands and the `orch-runs` topic, and the entire client Orchestration panel. Single-task subagent delegation (`c3-210` / `SubagentOrchestrator` / `delegate_subagent`) and the notification-driven autonomous loop (`setup_loop` / `stop_loop`) are explicitly out of scope and must survive unchanged.

## Context

The feature is **unreachable in production today**. The only user-facing trigger, the "New run" dialog, builds its command payload as `{ tasks, verify }` and never sends `subagentId` (`src/client/app/OrchNewRunDialog.tsx:55-56`). Server validation then requires either an explicit `subagentId` or the configured default (`src/server/orchestration-input.ts:103-110`). That default, `subagentRuntime.defaultOrchSubagentId`, has no write path anywhere: the settings UI exposes only the sibling loop selector (`src/client/app/SubagentsSection.tsx:703-776`), the patch appliers copy only `runTimeoutMs` and `defaultLoopSubagentId` (`src/server/app-settings.ts:1688-1693`, `src/server/ws-router-defaults.ts:139-143`), and `normalizeSubagentRuntime` strips the key on every load (`src/server/app-settings.ts:876`). Every click of "New run" therefore fails with `subagentId is required`. The declaring type comment concedes the gap — *"Full settings CRUD/UI is a later phase"* (`src/shared/app-settings-types.ts:280-282`).

Weighed against that zero delivered value, the carrying cost is large: 10 server engine modules, 9 client modules, 13 colocated test files, a second permit pool and git-worktree lifecycle with three IO adapters, an 18-variant event union threaded through `events.ts` / `event-store.ts` / `event-store-apply.ts` / `event-store-helpers.ts`, and a dedicated replay log at sourceIndex 8 that is deliberately excluded from snapshot truncation and so grows without bound.

The capability itself is redundant. Parallel agent work is already delivered by `c3-210` (`delegate_subagent` with `run_in_background`) and by the autonomous loop, both of which are reachable and in use.

There is also a standing comprehension hazard: the token `orch` names **two unrelated features**. `SubagentOrchestrator` / `subagent-orchestrator.ts` / `fakeOrch` belong to surviving `c3-210`; `OrchRun*` / `orch_*` / `OrchestrationQueue` belong to `c3-232`. Two module names encode the collision — `ws-router-orch.ts` actually routes `workflows.getRun`, `workflows.getAgentTranscript` and `subagents.getRun`, and `claude-loop-orch-commands.ts` owns `setupLoop`. Deleting by filename would break surviving features.

## Decision

Delete `c3-232` outright rather than finish its wiring, and land the removal as an ordered sequence whose ordering is load-bearing for data safety.

**Data migration — the load-bearing constraint.** Existing `~/.kanna/data/orch.jsonl` files are left on disk, unread and byte-unmodified. `getReplayEventPriority` (`src/server/event-store-helpers.ts:137-140`) terminates in an exhaustive `default` that throws at runtime, and it is invoked from inside the `.sort()` comparator of `loadAndReplayLogs` (`src/server/event-store-snapshot.ts:360-367`). The `try/catch` in `loadReplayEventsFromFile` guards only `JSON.parse` and has already returned by then. Consequently the replay wiring must be removed **before** the `case "orch_*"` labels; the reverse order makes every install that ever used the feature throw `Unhandled replay event type: orch_run_created` out of `initializeEventStore` and refuse to boot. `clearStorage` must also stop truncating the file (`src/server/event-store-init.ts:141`), or a single storage reset destroys the data this ADR promises to preserve. sourceIndex 8 is retired, not renumbered, so tie-break ordering for logs 0-7 is bit-for-bit unchanged.

**No settings migration.** `defaultOrchSubagentId` was never persisted (`normalizeSubagentRuntime` returns only `{ runTimeoutMs, defaultLoopSubagentId }`), so removing the type field is inert and stray keys in user JSON stay ignored.

**Two renames ride along**, in a separate rename-only commit: `ws-router-orch.ts` → `ws-router-observability.ts` (it becomes purely workflow/subagent read queries once the three `orch.*` cases and the now-dead `agent` dep are gone) and `claude-loop-orch-commands.ts` → `claude-loop-commands.ts` with `LoopOrchCommandDeps` → `LoopCommandDeps`. Leaving `orch` in the filename that owns `setupLoop` would preserve exactly the trap described above.

**`cwdOverride` is removed as a consequence** (`src/server/claude-subagent-wiring.ts:134,207,274-280`). Its sole producer was `buildOrchWorker`. It is not a mere unused parameter: it suppresses the subagent `workingDir`/`allowedPaths` restriction, zeroes `additionalDirectories`, and drops stack labelling — a path-confinement bypass whose only test asserted `typeof result.start === "function"`.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-232 | component | Retired in full — engine, adapters, types, events, MCP tools, WS surface, client panel | c3-232#n8218@v1:sha256:28d2401f759d9e42c3dfac348af32b23ee726ca7e6bc24e8c596d057ca34691d | Retire patch; retire-safety gate confirms no children and no reverse citers |
| c3-2 | container | Loses one member component; membership table re-synthesized by the tool | c3-2#n6495@v1:sha256:87984e312939cc03eed326c220cafc5c1bc82c40e789678100477a162a4901ce | Parent Delta: none — Server responsibilities are unchanged, the retired capability was additive |
| c3-206 | component | Sheds the OrchestrationEvent union, orchRunsById read model, the orch.jsonl log at sourceIndex 8, and nine public EventStore methods | c3-206#n6787@v1:sha256:e04d56e73404382bba111d31d12fd30ce75cd0fa5acbb6ba5811a68709533460 | Replay-order review: stop reading the log before deleting the event labels |
| c3-208 | component | Sheds three orch.* client commands, the orch-runs topic snapshot branch, and its broadcast pusher | c3-208#n6897@v1:sha256:3b682e08c742ff6ed2ec0fe7e93f9508e535bd265f8c630d292aa17868013d79 | Confirm workflows.* and subagents.getRun still route after the file is trimmed and renamed |
| c3-210 | component | Not retired — must be proven intact; loses only the cwdOverride confinement bypass whose sole producer was the orch worker | c3-210#n6998@v1:sha256:ca6753652cc74facb772fe9c0b2c181c8ccf8285292b29d8bde2240ded58671b | Positive guard tests asserting delegate_subagent and setup_loop still register |

## Compliance Rules

| Rule | Why required | Evidence | Action |
| --- | --- | --- | --- |
| rule-colocated-bun-test | Every step is test-first; deletions land beside colocated tests that assert the absence, and the surviving-feature guards are colocated too | rule-colocated-bun-test#n8976@v1:sha256:ce58e026c1076cb18ede38f3a4bd73793f28bf1392d299399571ba446985623f | comply |
| rule-strong-typing | Removing a StoreEvent union member must keep the exhaustive-switch contract intact — the never check stays and the throw remains reachable for genuinely unknown types | rule-strong-typing#n9037@v1:sha256:7e110467821b764c655f13db69c1331592e23c71af38ac5825037c97b15ea180 | comply |

## Compliance Refs

| Ref | Why required | Evidence | Action |
| --- | --- | --- | --- |
| ref-event-sourcing | Retiring a persisted event family touches the replay contract: log-set membership, sourceIndex assignment, and forward-compatibility of old logs | ref-event-sourcing#n8707@v1:sha256:1ff5f5fcbeeb85e1ccfe24b3e3e63babaec81436d2a50381b8e0b560132fd0aa | comply — retire sourceIndex 8 without renumbering 0-7; leave legacy logs inert and unmodified |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Finish the wiring (add a subagent picker to the dialog + a settings selector) | Delivers a capability already covered by delegate_subagent and the loop, and permanently keeps an 18-variant event union, a second permit pool, and a git-worktree lifecycle in the maintenance surface |
| Feature-flag it off, keep the code | Retains the entire maintenance and comprehension cost, including the two-features-named-orch trap, while buying nothing — the feature is already effectively off |
| Keep the orch_* event variants as inert types for forward-compatibility | Dead union members drift and re-arm the exhaustive-switch trap the moment a nineteenth variant is added; the legacy log is safe once unreferenced regardless |
| Delete ~/.kanna/data/orch.jsonl during upgrade | Destroys user data for no benefit; once removed from the replay set and from clearStorage, the file is inert |
| Delete by filename (ws-router-orch.ts, claude-loop-orch-commands.ts) | Both files are misnamed: they own workflows.* / subagents.getRun and setupLoop respectively; deleting them breaks surviving features |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Existing install fails to boot because a legacy orch.jsonl reaches the exhaustive throw | Remove orchLogPath from SnapshotLogPaths and loadAndReplayLogs in a commit that lands strictly before the case "orch_*" labels are deleted | Regression test replays a legacy log fixture and asserts no orch_* event is applied and no storage clear is triggered; manual boot against a seeded orch.jsonl |
| A storage reset silently truncates the preserved legacy log | Delete the writeText(orchLogPath, "") line from clearStorage | Manual smoke: corrupt chats.jsonl to force clearStorage, reboot, re-checksum orch.jsonl |
| Over-deletion removes the surviving SubagentOrchestrator / loop feature | Positive guard tests naming the survivors; module export-shape assertion on the loop command module; renames isolated to their own commit | kanna-mcp test asserts delegate_subagent/setup_loop still register; Object.keys(mod) equality test on the loop module |
| Fresh installs still create an empty orch.jsonl | Remove orchLogPath from ensureFile and from both path bundles in event-store-init.ts | Manual smoke: fresh KANNA_HOME boot, assert the file is never created |

## Verification

| Check | Result |
| --- | --- |
| bun run test | Green; only the pre-existing unrelated ws-router.test.ts > startMcpOAuth failure present on origin/main remains; test-file count drops by 11 |
| bun run check (typecheck + lint --max-warnings=0 + build:client) | Clean |
| bunx ast-grep scan | Clean |
| rg 'OrchRun|orch_|orch\.|orch-runs|OrchestrationQueue|orchestration-' src/ CLAUDE.md | Zero hits; residual case-insensitive orch hits are only SubagentOrchestrator / subagent-orchestrator / fakeOrch |
| Replay regression test in event-store-snapshot.test.ts | Legacy orch.jsonl fixture yields zero applied orch_* events, no clearStorage call, byte-identical file |
| getReplayEventPriority throw test in event-store-helpers.test.ts | Throws Unhandled replay event type: orch_run_created — exhaustive contract preserved for unknown types |
| Export-shape test on the loop command module | Object.keys equals exactly the six surviving loop/delivery handlers |
| Manual smoke: boot with seeded legacy orch.jsonl | Server listens; no Unhandled replay event type in the log; shasum unchanged |
| Manual smoke: delegate_subagent, setup_loop/stop_loop, workflows page | All still function end to end |
| c3x check | Clean with c3-232 retired |
