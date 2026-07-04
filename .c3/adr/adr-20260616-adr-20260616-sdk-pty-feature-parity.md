---
id: adr-20260616-adr-20260616-sdk-pty-feature-parity
c3-seal: a174435134f616393df3a0d729fea14078e10023dcab81b6e3cd19c07ce5393e
title: adr-20260616-sdk-pty-feature-parity
type: adr
goal: |-
    Bring three Claude-driver features that were wired only for the PTY driver
    (`KANNA_CLAUDE_DRIVER=pty`) to parity on the default SDK driver:
    (1) keep-alive multi-turn subagents, (2) the workflow status panel, and
    (3) confirm the background-task keep-alive guard. The SDK gains keep-alive via
    its native streaming-input prompt queue, registers the existing disk-watch
    workflow read-model from its `session_token`, and is shown to already inherit
    the background-task guard through the shared consume loop.
status: accepted
date: "2026-06-16"
---

## Goal

Bring three Claude-driver features that were wired only for the PTY driver
(`KANNA_CLAUDE_DRIVER=pty`) to parity on the default SDK driver:
(1) keep-alive multi-turn subagents, (2) the workflow status panel, and
(3) confirm the background-task keep-alive guard. The SDK gains keep-alive via
its native streaming-input prompt queue, registers the existing disk-watch
workflow read-model from its `session_token`, and is shown to already inherit
the background-task guard through the shared consume loop.

## Context

The HarnessEvent consume loop (`runClaudeSession`) and the subagent run
plumbing are driver-agnostic, but three features had driver-specific edges that
only the PTY driver populated. Keep-alive's `keepAlive` flag was computed in
`runClaudeSubagent` but never threaded to `startClaudeSession`/driver, so
multi-turn keep-alive was non-functional for BOTH drivers. The workflow panel's
`workflowRegistry.register()` was called only by the PTY driver, so SDK chats
saw an empty panel and `hasLiveWorkflow` always returned false. The
background-task guard already lives in the shared loop but had no test proving
the SDK's normalized `tool_result` text triggers it. Affected topology:
c3-210 agent-coordinator and c3-229 workflow-status; c3-225 claude-pty-driver is
referenced (PTY keeps its own registration path) but not modified.

## Decision

Thread `keepAlive` end-to-end and, in the SDK `startClaudeSession`, keep the
prompt queue open when `keepAlive` and expose the existing `pushChannelPrompt`
handle field backed by a queue push (a shared `enqueueUserPrompt` helper unifies
it with `sendPrompt`). This reuses `runClaudeSubagent`'s existing keep-alive
drain unchanged and preserves PTY's fail-closed guard — chosen over inventing a
new handle capability field or a separate SDK transport. For the workflow panel,
reuse the disk-watch `WorkflowRegistry` (Claude writes `wf_*.json` sidecars
regardless of driver); register `<projectDir>/<session-uuid>/workflows` derived
from the SDK `session_token` via a new pure `computeWorkflowsDir` adapter helper,
once per session, guarded against the PTY path. This was chosen over parsing the
SDK message stream (lossy: no phases/tokens/per-agent results) because the
sidecars already carry the full model. The background-task guard needs only a
verification test.

## Affected Topology

| Entity | Type | Why affected | Governance review |
| --- | --- | --- | --- |
| c3-210 | component | Threads keepAlive, opens SDK prompt queue, registers/unregisters the SDK workflows dir, hosts the background-task guard test | Comply with ref-provider-adapter + rule-strong-typing |
| c3-229 | component | Now fed by SDK sessions via register() from session_token; read-model + transport unchanged | Comply with ref-cqrs-read-models |
| c3-225 | component | Reference only — PTY keeps its own transcript-path registration; computeWorkflowsDir added to its jsonl-path.adapter.ts | Comply with ref-side-effect-adapter (IO stays in .adapter.ts) |

## Compliance Refs

| Ref | Why required | Action |
| --- | --- | --- |
| ref-provider-adapter | The keep-alive + workflow wiring must keep SDK and PTY producing one normalized model so the UI never branches on provider | comply |
| ref-cqrs-read-models | SDK feeds the same derived workflow read-model (no new write path) | comply |
| ref-side-effect-adapter | computeWorkflowsDir uses node:path + realpathSync; it lives in jsonl-path.adapter.ts, an existing leaf adapter | comply |
| ref-strong-typing | New keepAlive?: boolean and workflowsDirRegistered?: boolean cross coordinator↔provider boundaries and must be named types | comply |

## Compliance Rules

| Rule | Why required | Action |
| --- | --- | --- |
| rule-strong-typing | All new boundary values are typed boolean/string; no any/unknown introduced | comply |
| rule-colocated-bun-test | New tests sit beside their units (subagent-provider-run.test.ts, jsonl-path.test.ts, agent.sdk-workflow-register.test.ts, agent.background-task-sdk.test.ts) | comply |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| keep-alive thread | Add keepAlive? to BuildSubagentProviderRunArgs.startClaudeSession, startClaudeSession, and AgentCoordinatorArgs.startClaudeSession; forward in runClaudeSubagent + buildClaudeSubagentStarter | commit 6088815 |
| SDK keep-alive transport | Conditional promptQueue.close(); pushChannelPrompt spread on keepAlive; shared enqueueUserPrompt | commits 6088815, 21f25b9 |
| path helper | computeWorkflowsDir in claude-pty/jsonl-path.adapter.ts | commit f786c8f |
| SDK workflow register | maybeRegisterSdkWorkflowsDir on session_token; workflowsDirRegistered? flag; unregister in closeClaudeSession | commit db1f662 |
| background-task verify | Export backgroundTaskIdsFromToolResult; SDK-shape detection test | commit 89b5692 |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| N.A - no C3 CLI/validator/schema/template change | This ADR only updates component scope docs (CLAUDE.md) + records the decision; no c3x command, validator, hint, or schema is modified | c3x check --include-adr passes |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| subagent-provider-run.test.ts | Asserts keepAlive forwarded and turn-2 driven via pushChannelPrompt | bun test src/server/subagent-provider-run.test.ts → 29 pass |
| agent.sdk-workflow-register.test.ts | Asserts SDK registers the correct dir once and PTY path does not | bun test → 3 pass |
| agent.background-task-sdk.test.ts | Asserts SDK-shaped tool_result text triggers detection | bun test → 4 pass |
| jsonl-path.test.ts | Pins computeWorkflowsDir path shape | bun test → pass |
| bun run lint | Side-effect seal + strong-typing enforced at error | CI gate |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| New multiTurnViaPrompt handle capability field for SDK keep-alive | Adds a second sentinel when the existing pushChannelPrompt field already signals keep-alive; would force a branch in runClaudeSubagent |
| Channel-delivery transport for SDK (port PTY's pushChannelPrompt infra) | SDK has native streaming input; a channel transport is pure overhead and needs the dev-channels flag |
| Parse the SDK message stream for workflow lifecycle instead of disk-watch | Lossy — the stream lacks phases/totalTokens/per-agent results that the wf_*.json sidecar already carries |
| Make workflowsDirRegistered a required field | Would force edits at every ClaudeSessionState init site for no benefit; optional is sufficient |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| SDK keep-alive leaves the prompt queue open forever, leaking the session | Orchestrator liveSessions idle-timeout + close() closes the queue and q | subagent-provider-run.test.ts keep-alive close test |
| computeWorkflowsDir throws ENOENT if cwd missing, breaking the consume loop | cwd is the active project localPath the session already runs in; registration is guarded + once-only | agent.sdk-workflow-register.test.ts exercises the real path |
| Double registration / double unregister between SDK and PTY | resolveClaudeDriverPreference() guards both register and unregister; register disposes any prior entry | guard asserted in the PTY-path test |

## Verification

| Check | Result |
| --- | --- |
| bun test src/server/subagent-provider-run.test.ts | 29 pass, 0 fail |
| bun test src/server/agent.sdk-workflow-register.test.ts | 3 pass, 0 fail |
| bun test src/server/agent.background-task-sdk.test.ts | 4 pass, 0 fail |
| bun test src/server/claude-pty/jsonl-path.test.ts | pass (incl. new helper) |
| bun run lint | 0 errors, warnings at/under cap |
| c3x check --include-adr | no errors |
