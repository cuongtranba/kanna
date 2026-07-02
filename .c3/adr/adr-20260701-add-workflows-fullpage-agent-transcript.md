---
id: adr-20260701-add-workflows-fullpage-agent-transcript
c3-seal: b9057f2f8067d3ccfb586c5304789523b99d3a28b72685e2f5cd36d248ce8abf
title: add-workflows-fullpage-agent-transcript
type: adr
goal: 'Promote the read-only per-chat workflow status panel into a dedicated full-page `/workflows/:chatId` route with deep per-agent transcript drill-in. This adds a new read path to the `workflow-status` component (c3-229): a `WorkflowRegistry.getAgentTranscript(chatId, runId, agentId)` method backed by a new leaf IO adapter and a new `workflows.getAgentTranscript` WebSocket command, plus three new client/server files. It does NOT change the disk-watch read-model design, the snapshot/getRun contracts, or the c3-225 sole-event-source invariant.'
status: implemented
date: "2026-07-01"
---

# workflows-fullpage-agent-transcript

## Goal

Promote the read-only per-chat workflow status panel into a dedicated full-page `/workflows/:chatId` route with deep per-agent transcript drill-in. This adds a new read path to the `workflow-status` component (c3-229): a `WorkflowRegistry.getAgentTranscript(chatId, runId, agentId)` method backed by a new leaf IO adapter and a new `workflows.getAgentTranscript` WebSocket command, plus three new client/server files. It does NOT change the disk-watch read-model design, the snapshot/getRun contracts, or the c3-225 sole-event-source invariant.

## Context

Today the workflow status surface (c3-229) renders as an inline `WorkflowsSection` panel inside the chat page, showing run summaries and a shallow run detail. Large real runs (observed: a 42-agent / 2.04M-token adversarial review) have no room in a side panel and no way to inspect an individual agent's tool-call + reasoning trace. Claude Code writes each workflow agent's full transcript to `subagents/workflows/<runId>/agent-<agentId>.jsonl` (the same `agent-<id>.jsonl` shape the native-subagent viewer reads), but nothing exposed it. Constraints: the read-model must stay disk-fed and independent of the Kanna turn/event pipeline (c3-225 invariant, documented in adr-20260603-workflow-disk-watch-read-model); all fs reads must live in a leaf `*.adapter.ts` (ref-side-effect-adapter / ESLint seal); every WS boundary type must be named (ref-strong-typing). Affected topology is centered on c3-229, which is cross-cutting (its code-map already spans both `src/server/workflow-registry.ts` and client files `WorkflowsSection.tsx` / `workflowsStore.ts`).

## Decision

Extend c3-229 with a per-agent transcript read path and a full-page view rather than a new component:

- Add `readWorkflowAgentTranscriptLines(workflowsDir, runId, agentId)` as a new leaf IO adapter (`workflow-agent-transcript-io.adapter.ts`) that only reads raw jsonl lines.
- Parse those lines in the registry via `normalizeClaudeStreamMessage` directly (NOT `createJsonlEventParser`, which drops the `isSidechain:true` lines the agent files are entirely made of), returning `TranscriptEntry[]`; the registry never feeds the turn/event pipeline.
- Expose it over the shared socket as a new `workflows.getAgentTranscript` pull command (ws-router → registry), typed in `protocol.ts`.
- Render a router-free `WorkflowsPageView` (run list ▸ run detail ▸ agent transcript) at `/workflows/:chatId`, with a `WorkflowAgentTranscriptPanel` drill-in and a `workflowGrouping` helper; reuse the existing `workflowsStore` WS subscription. This fits c3-229's cross-cutting ownership and preserves the disk-watch read-model spirit (same as the native-subagent viewer).

## Affected Topology

| Entity | Type | Why affected | Governance review |
| --- | --- | --- | --- |
| c3-229 | component | workflow-status: adds a per-agent transcript read path (new registry method + leaf adapter + WS command) and a full-page client view (3 new files); Goal, Contract, Derived Materials, and code-map all change | Update Goal, Contract, Business Flow, Governance, Derived Materials; append code-map; re-check refs/rules |
| c3-302 | component | protocol: new workflows.getAgentTranscript ClientCommand envelope added | no-delta review: defining a new WS command kind is c3-302's standing responsibility; ref-strong-typing preserved (named command + TranscriptEntry[] result) |
| c3-208 | component | ws-router: new command case routes workflows.getAgentTranscript to the registry | no-delta review: routing a new command is c3-208's standing responsibility; no contract change |
| c3-110 | component | app-shell: new /workflows/:chatId route registered in App | no-delta review: routing is c3-110's standing responsibility |
| c3-111 | component | sidebar: new "Workflows" nav entry (disabled without an active chat) | no-delta review: sidebar nav rendering is c3-111's standing responsibility |
| c3-2 | container | Server: hosts the extended c3-229 component | no-delta: no container boundary or responsibility change; workflow-status stays the owner |

## Compliance Refs

| Ref | Why required | Action |
| --- | --- | --- |
| ref-side-effect-adapter | The new fs read of agent-<id>.jsonl must live in a single leaf *.adapter.ts, not domain code | comply — readWorkflowAgentTranscriptLines isolated in workflow-agent-transcript-io.adapter.ts |
| ref-ws-subscription | The per-agent transcript is fetched via a pull command on the single typed socket envelope | comply — workflows.getAgentTranscript ClientCommand + ack path in ws-router |
| ref-strong-typing | New command input and TranscriptEntry[] result cross the client↔server boundary | comply — named ClientCommand in protocol.ts; return typed TranscriptEntry[] |
| ref-cqrs-read-models | The transcript is a read-path projection derived from disk; no write path | comply — registry reads + parses only, never writes |
| ref-tool-hydration | Agent transcript lines are normalized into unified TranscriptEntry before rendering | comply — parsed via normalizeClaudeStreamMessage, reusing the shared transcript model |
| ref-provider-adapter | Reads Claude workflow-agent jsonl; the PTY-only disk read-model is unchanged | review — no new provider branch introduced |
| ref-zustand-store | The full-page view consumes the existing workflowsStore via WS, not a new truth cache | comply — selectRuns reused; stable EMPTY ref preserved |
| ref-event-sourcing | SCOPED OVERRIDE (existing): workflow state is disk-fed, not event-sourced | review — override already recorded in adr-20260603; unchanged here |

## Compliance Rules

| Rule | Why required | Action |
| --- | --- | --- |
| rule-colocated-bun-test | Every new impl file needs a colocated *.test.ts(x) | comply — WorkflowsPage.test.tsx, WorkflowAgentTranscriptPanel.test.tsx, workflowGrouping.test.ts, workflow-agent-transcript-io.adapter.test.ts all present |
| rule-strong-typing | New WS command + return types must be named exports, no any at the boundary | comply — command union member + TranscriptEntry[] |
| rule-zustand-store | Full-page workflow state must come from the WS-backed store, not a direct server import | comply — WorkflowsPage reads workflowsStore populated by the workflows topic subscription |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| Server adapter | readWorkflowAgentTranscriptLines leaf IO reads subagents/workflows/<runId>/agent-<id>.jsonl raw lines | src/server/workflow-agent-transcript-io.adapter.ts(.test.ts) |
| Registry | getAgentTranscript(chatId, runId, agentId) parses lines via normalizeClaudeStreamMessage; new injected readAgentTranscriptLines dep | src/server/workflow-registry.ts(.test.ts) |
| Protocol | Add workflows.getAgentTranscript ClientCommand | src/shared/protocol.ts |
| WS router | Route the command to registry.getAgentTranscript, ack with TranscriptEntry[] | src/server/ws-router.ts |
| Server wiring | Inject readWorkflowAgentTranscriptLines into the registry deps | src/server/server.ts |
| Client page | Router-free WorkflowsPageView (list ▸ detail ▸ agent transcript) + WorkflowsPage route wrapper | src/client/app/WorkflowsPage.tsx(.test.tsx) |
| Client drill-in | WorkflowAgentTranscriptPanel per-agent transcript view | src/client/app/WorkflowAgentTranscriptPanel.tsx(.test.tsx) |
| Client helper | workflowGrouping phase/agent grouping | src/client/lib/workflowGrouping.ts(.test.ts) |
| Routing + nav | /workflows/:chatId route + "Workflows" sidebar entry | src/client/app/App.tsx, src/client/app/KannaSidebar.tsx |
| Docs | Update c3-229 Goal/Contract/Business Flow/Governance/Derived Materials + append code-map | .c3 via c3x set/write |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| N.A - no C3 CLI/validator/schema/template/hint/test surface is changed by this decision | This is a product feature ADR; enforcement rides entirely on the c3-229 component contract + code-map coverage and the standard bun test / bun run lint / c3x check gates (see Enforcement Surfaces) | N.A |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| c3x lookup <new file> | Each new file resolves to c3-229 once code-map is appended; a miss = uncharted coverage gap | c3x lookup src/client/app/WorkflowsPage.tsx → c3-229 |
| c3x check | Fails if c3-229 docs drift from code | clean after doc update |
| bun test (workflow suites) | Per-surface behavior incl. getAgentTranscript, page render, grouping, adapter | 86 workflow tests pass |
| bun run lint | Side-effect seal: fs read only inside *.adapter.ts; render-loop stable-ref selectors | 0 warnings (--max-warnings=0) |
| bunx tsc --noEmit | Strong-typing at the new WS boundary | no boundary type errors |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Fetch per-agent transcript from the SDK live stream lifecycle events | The PTY transcript carries no task lifecycle lines; the disk sidecar + agent-<id>.jsonl is the only PTY-available source (same rationale as adr-20260603) |
| Parse agent files with createJsonlEventParser | That parser drops isSidechain:true lines, which the agent files are entirely composed of; normalizeClaudeStreamMessage per-line is required |
| Feed the agent transcript through the turn/event pipeline | Breaches the c3-225 sole-event-source invariant; kept as an independent read-model, same spirit as the native-subagent viewer |
| Keep workflows as an inline chat-page panel only | Deep drill-in for large runs (42 agents) needs full-page real estate the side panel cannot give |
| Create a new client-side component for the full-page view | c3-229 is already cross-cutting (owns client + server workflow files); a second component would split one feature slice across two owners |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Coupling to the HarnessEvent stream breaks the c3-225 invariant | getAgentTranscript parses disk lines directly and never imports the event pipeline | bun test src/server/workflow-registry.test.ts |
| fs read leaks outside the adapter (seal breach) | The only fs call lives in workflow-agent-transcript-io.adapter.ts | bun run lint |
| A corrupt/partial jsonl line aborts the whole read | try/catch per line; skip unparseable lines | src/server/workflow-registry.test.ts |
| Unstable store selector triggers a React render loop (#185) | selectRuns returns a stable EMPTY reference | src/client/app/WorkflowsPage.test.tsx |

## Verification

| Check | Result |
| --- | --- |
| bun test (workflowGrouping, WorkflowsPage, WorkflowAgentTranscriptPanel, workflow-registry, workflow-agent-transcript-io.adapter, workflow-types, WorkflowsSection) | 86 pass |
| bun run lint | 0 warnings |
| c3x check | no issues |
| c3x lookup src/server/workflow-agent-transcript-io.adapter.ts | resolves to c3-229 |
