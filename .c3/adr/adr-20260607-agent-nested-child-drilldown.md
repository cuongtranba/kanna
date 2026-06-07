---
id: adr-20260607-agent-nested-child-drilldown
c3-seal: c4600edd27f0e51178128c671732bc18f99b1a69fb0680b51bc337bc28e9c2c5
title: agent-nested-child-drilldown
type: adr
goal: 'Add Tier 2 of the native `Agent` (Task) subagent view: an expandable drill-in under the `SubagentTaskMessage` summary card that renders the subagent''s own child transcript (its `Read`/`Bash`/`Edit`/text steps — the nested tree in the screenshot). The child events are read on demand from Claude''s per-subagent transcript file `~/.claude/projects/<encoded-cwd>/<claude-uuid>/subagents/agent-<agentId>.jsonl`, parsed into transcript entries, and rendered with the existing `SubagentEntryRow`. PTY driver only, read-only.'
status: implemented
date: "2026-06-07"
---

## Goal

Add Tier 2 of the native `Agent` (Task) subagent view: an expandable drill-in under the `SubagentTaskMessage` summary card that renders the subagent's own child transcript (its `Read`/`Bash`/`Edit`/text steps — the nested tree in the screenshot). The child events are read on demand from Claude's per-subagent transcript file `~/.claude/projects/<encoded-cwd>/<claude-uuid>/subagents/agent-<agentId>.jsonl`, parsed into transcript entries, and rendered with the existing `SubagentEntryRow`. PTY driver only, read-only.

## Context

Tier 1 (shipped) renders the `Agent` tool result as a summary card from the `toolUseResult` sidecar, which carries `agentId`. Claude writes each subagent's full transcript to a sibling file `subagents/agent-<agentId>.jsonl` under the same `<projectDir>/<claude-uuid>/` that the workflow-status feature already resolves and registers (`driver.ts` derives `sessionUUID = basename(transcriptStream.filePath, ".jsonl")` and registers `…/workflows`). The subagent dir is its sibling `…/subagents`. Those agent files are `isSidechain:true`, so the live `createJsonlEventParser` deliberately drops them (and must keep doing so — a sidechain `result` would corrupt the main turn lifecycle, c3-225). They must therefore be read by an independent read-model, identical in spirit to the workflow disk-watch (`adr-20260603-workflow-disk-watch-read-model`): a sibling reader that never feeds the turn/event pipeline. The client already threads `chatId` into `ToolCallMessage`, and the durable command round-trip exists (`socket.command<T>({type,…})` ↔ ws-router `ack`), exactly as `workflows.getRun` uses.

## Decision

Add a `SubagentTranscriptRegistry` (per-chat `Map<chatId, subagentsDir>`, IO injected) with `register/unregister` and `getAgentTranscript(chatId, agentId): TranscriptEntry[]`. The driver registers `<projectDir>/<sessionUUID>/subagents` in the same `transcriptStream.filePath.then(...)` block that registers `…/workflows`, and unregisters on cleanup (guarded by the existing late-registration cancel flag). `getAgentTranscript` reads `agent-<agentId>.jsonl` via a leaf `subagent-transcript-io.adapter.ts`, then parses each line directly through `normalizeClaudeStreamMessage` (NOT `createJsonlEventParser` — the latter drops `isSidechain`), flattening to `TranscriptEntry[]`. A new WS command `subagents.getRun({chatId, agentId})` returns those entries; the client hydrates them via `processTranscriptMessages` and renders each through the existing `SubagentEntryRow`. `SubagentTaskMessage` gains an expand chevron that lazily fetches on first open via a `getSubagentTranscript` callback threaded from `ChatPage` (same drilling as `chatId`). On demand, read-only, no live watch/snapshot push — the summary card already shows status/stats, and the child file is complete once the Agent tool returns.

## Affected Topology

| Entity | Type | Why affected | Governance review |
| --- | --- | --- | --- |
| c3-225 | component | PTY driver registers the sibling …/subagents dir + unregisters on cleanup | Reads sibling files into an independent read-model; does NOT touch the turn/event pipeline (c3-225 invariant) |
| c3-2 | container | New subagent-transcript-io.adapter.ts (IO leaf) + subagent-transcript-registry.ts (per-chat reader) | New server modules; side-effect seal via .adapter.ts + injected IO |
| c3-208 | component | ws-router handles subagents.getRun → registry → entries | Mirrors workflows.getRun ack shape |
| c3-302 | component | protocol.ts adds the subagents.getRun command envelope | Typed wire envelope |
| c3-114 | component | SubagentTaskMessage becomes expandable; renders children via SubagentEntryRow | New render path on existing card |

## Compliance Refs

| Ref | Why required | Action |
| --- | --- | --- |
| ref-strong-typing | Registry, adapter, command, and entry payload must be concretely typed | comply |
| ref-tool-hydration | Child entries hydrate through the existing processTranscriptMessages → SubagentEntryRow path | comply |
| ref-event-sourcing | Read-model is a sibling reader; it must NOT append to the JSONL event log or the turn pipeline | review |
| ref-local-first-data | Reads only local ~/.claude/projects/** files already on disk; no new network surface | review |
| ref-provider-adapter | Feature is claude-PTY only; SDK/codex have no agent files — the command returns [] gracefully | review |
| ref-colocated-bun-test | c3-225/c3-208 cite it; new adapter, registry, ws-router handling, and card need colocated *.test.ts(x) | comply |
| ref-cqrs-read-models | c3-208 cites it; the registry is a read-only sibling read-model serving a query command, never a writer | comply |
| ref-side-effect-adapter | The only IO (readAgentTranscriptLines) lives in a leaf *-io.adapter.ts; the registry takes it injected | comply |
| ref-ws-subscription | c3-208/c3-302 cite it; this uses the one-shot command→ack round-trip (like workflows.getRun), NOT a subscription topic | N.A - on-demand command, no subscription topic added |
| ref-zustand-store | c3-229 cites it for the workflow panel store; this drill-in is on-demand fetch with local component state, no new store | N.A - no client store introduced |

## Compliance Rules

| Rule | Why required | Action |
| --- | --- | --- |
| rule-strong-typing | No any/untyped shapes across the registry / command / render boundary | comply |
| rule-colocated-bun-test | New adapter, registry, and command-handling need colocated tests | comply |
| rule-zustand-store | c3-229 cites it; if any client store were added it would apply — this feature adds none (on-demand fetch + local state) | N.A - no zustand store introduced |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| io adapter | src/server/subagent-transcript-io.adapter.ts: readAgentTranscriptLines(subagentsDir, agentId): string[] ([] if missing) | mirrors workflow-watch-io.adapter.ts |
| registry | src/server/subagent-transcript-registry.ts: register/unregister, getAgentTranscript(chatId, agentId) → JSON.parse + normalizeClaudeStreamMessage per line → TranscriptEntry[] | parser must bypass sidechain-drop |
| driver | Register path.join(projectDir, sessionUUID, "subagents"); add subagentTranscriptRegistry? arg; unregister on cleanup | driver.ts:718-728 (workflow block), cleanup :524 |
| wiring | Construct registry, pass to driver (mirror workflowRegistry in agent.ts/server.ts) | workflow wiring |
| protocol | { type: "subagents.getRun"; chatId: string; agentId: string } | src/shared/protocol.ts:256 |
| ws-router | case "subagents.getRun": registry.getAgentTranscript → ack entries | src/server/ws-router.ts:2126 |
| client fetch | ChatPage handleGetSubagentTranscript(agentId) → socket.command<TranscriptEntry[]> ; thread to ToolCallMessage → SubagentTaskMessage | ChatPage/index.tsx:764 |
| card | SubagentTaskMessage expand chevron → lazy fetch → processTranscriptMessages → SubagentEntryRow list | SubagentTaskMessage.tsx, SubagentEntryRow.tsx |
| tests | adapter (read/missing), registry (parse sidechain lines → entries; unknown agent → []), card (expand fetches once, renders rows) | colocated |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| N.A - changes Kanna application code only; no c3x CLI command, validator, schema, template, hint, or test is touched | N.A | N.A |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| bun test src/server/subagent-transcript-registry.test.ts | Fails if sidechain agent lines stop parsing into entries, or unknown agent doesn't return [] | colocated registry test |
| bun test src/server/subagent-transcript-io.adapter.test.ts | Fails if missing file throws instead of [] | colocated adapter test |
| bun test src/client/components/messages/SubagentTaskMessage.test.tsx | Fails if expand doesn't fetch once / render children | colocated card test |
| bunx tsc --noEmit + bun run lint | typed command + registry; side-effect seal honored | tsc + eslint |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Reuse createJsonlEventParser to parse agent files | It drops isSidechain:true lines by design (c3-225) — would yield zero child entries |
| Un-drop sidechain in the live parser and feed the main pipeline | Breaks the c3-225 invariant (sidechain result shifts the parent turn lifecycle/seq) |
| Live watch + snapshot push (full workflow-status machinery) | Over-built for v1: the summary card already shows status/stats and the agent file is complete once the tool returns; on-demand read is sufficient and far smaller |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Agent file missing / mid-write | Adapter returns [] on missing; JSON.parse per line guarded (skip bad lines) | adapter + registry tests with missing / partial input |
| sessionUUID dir mismatch (claude mints its own UUID) | Derive from resolved transcriptStream.filePath basename, identical to the workflow registration | reuse the proven derivation |
| Large agent transcript payload over WS | On-demand (only on expand), one agent at a time; entries are the same shape the main transcript already ships | manual; bounded by single-agent file |
| SDK/codex chats (no agent files) | Registry returns [] for unregistered chats; card expand shows empty/"no detail" | registry returns [] for unknown chat |

## Verification

| Check | Result |
| --- | --- |
| bun test src/server/subagent-transcript-registry.test.ts src/server/subagent-transcript-io.adapter.test.ts src/client/components/messages/SubagentTaskMessage.test.tsx | all pass |
| bun run lint | 0 errors, warnings ≤ cap |
| bunx tsc --noEmit | clean |
