---
id: adr-20260708-agent-teams-sdk-native
c3-seal: ecb476fd7cb3f3acd8843a3cee0664207471d2179ae84716ee35d9b64618059a
title: agent-teams-sdk-native
type: adr
goal: Surface the Agent SDK's native teams multi-agent capability in Kanna. The SDK driver upgrades to claude-agent-sdk 0.3.x, injects configured claude-provider subagents as options.agents (spawnable as teammates via the Agent tool), taps task_started/task_progress/task_updated/task_notification system messages into both transcript status entries and a new in-memory teams registry, exposes per-chat team snapshots over a new "teams" WS topic to a TeamsSection panel, and attributes teammate-originated approval requests with the teammate's name. Replaces the abandoned hosted Managed Agents API direction (control plane rejects subscription OAuth tokens; API-key billing not authorized).
status: proposed
date: "2026-07-08"
---

# adr: agent-teams-sdk-native

## Goal

Surface the Agent SDK's native teams multi-agent capability in Kanna. The SDK driver upgrades to claude-agent-sdk 0.3.x, injects configured claude-provider subagents as options.agents (spawnable as teammates via the Agent tool), taps task_started/task_progress/task_updated/task_notification system messages into both transcript status entries and a new in-memory teams registry, exposes per-chat team snapshots over a new "teams" WS topic to a TeamsSection panel, and attributes teammate-originated approval requests with the teammate's name. Replaces the abandoned hosted Managed Agents API direction (control plane rejects subscription OAuth tokens; API-key billing not authorized).

## Context

Kanna already surfaces two multi-agent mechanisms: mcp__kanna__delegate_subagent (Kanna-orchestrated, cross-provider) and the Workflow tool disk-watch panel (c3-229). Claude Code's native Agent-tool teams (parallel, named, background teammates with task_* lifecycle events) were invisible: claude-agent-sdk 0.2.140 predated the teams surface, the SDK driver dropped task_* messages on the floor, and configured subagents could not be spawned as native teammates. A live probe proved the hosted Managed Agents API requires API-key billing (401 for sk-ant-oat01 subscription tokens), killing the original hosted-provider plan; the same probe proved native teams work locally on subscription billing under Bun/macOS. Constraints: SDK driver only (PTY transcripts carry no task_* rows), side-effect seal, render-loop stable refs, suite+lint green every commit.

## Decision

Build teams on the existing SDK driver rather than a new provider: upgrade @anthropic-ai/claude-agent-sdk to ^0.3.204; map settings subagents (provider claude) into options.agents via a pure buildAgentDefinitions; add NATIVE_TEAM_GUIDANCE to the system-prompt append so the model knows Agent-tool teammates vs delegate_subagent; tap task_* messages in createClaudeHarnessStream into new {type:"task"} HarnessEvents consumed by an in-memory createTeamsRegistry (c3-232) that ws-router publishes on a "teams" topic mirroring the workflows topic; client mirrors workflowsStore/WorkflowsSection with teamsStore/TeamsSection; canUseTool reads options.agentID and resolves a teammate byline for pending_tool_request cards. This wins because it reuses proven Kanna patterns end to end (registry/topic/panel/store), keeps subscription billing, and adds zero new credentials or processes.

## Affected Topology

| Entity | Type | Why affected | Governance review |
| --- | --- | --- | --- |
| c3-210 | component | SDK driver gains agents injection, task tap, agentID attribution, registry clear on session close | ref-provider-adapter conformance; parity tests stay green |
| c3-232 | component | New teams registry (created by this ADR) | component contract authored with this change |
| c3-208 | component | ws-router gains teams topic envelope/push/dispose | mirrors workflows topic pattern |
| c3-301 | component | shared types gain TeamTaskSummary; protocol gains TeamsSnapshot + teams topic | rule-strong-typing |
| c3-112 | component | chat page mounts TeamsSection beside workflows; approval cards gain byline | render-loop stable refs |

## Compliance Refs

| Ref | Why required | Action |
| --- | --- | --- |
| ref-provider-adapter | Task events normalize into the shared HarnessEvent model; UI never branches on provider | comply |
| ref-event-sourcing | Teams registry is a sibling in-memory read-model, NOT written into the event log | comply |
| ref-colocated-bun-test | Every new module ships a colocated test | comply |

## Compliance Rules

| Rule | Why required | Action |
| --- | --- | --- |
| rule-strong-typing | New boundary types TeamTaskEvent/TeamTaskSummary/TeamsSnapshot cross server-client | comply |
| rule-colocated-bun-test | agent-definitions, teams-registry, teamsStore, TeamsSection, live e2e all colocated | comply |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| SDK upgrade | package.json claude-agent-sdk ^0.3.204 + canUseTool requestId fixes | commit 7332b69 |
| Agent definitions | src/server/teams/agent-definitions.ts + injection at startClaudeTurn | commits f3ca109, a8c4c05 |
| Prompt guidance | NATIVE_TEAM_GUIDANCE in src/shared/kanna-system-prompt.ts | commit 86668e4 |
| Task tap | TeamTaskEvent + toTeamTaskEvent + normalize branches in src/server/agent.ts | commit 4feaa6c |
| Registry | src/server/teams/teams-registry.ts (c3-232) | commits b34cf88, a97d3f7, 0f34965 |
| Transport | teams topic in src/shared/protocol.ts + src/server/ws-router.ts + coordinator feed | commits cb940c9, bbbb800 |
| Client | teamsStore, TeamsSection, ChatPage wiring, approval byline | commits db4683a, 4b1f0cf, b4460a4 |
| Docs + live e2e | CLAUDE.md section + src/server/teams/teams.live.test.ts + runner | commits f9b3009, c1cbe84 |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| N.A - no C3 CLI/underlay surface changed by this feature | N.A - instance docs only (new component c3-232 + this ADR) | c3x check |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| bun run test | Full suite gates every commit (parity matrix guards SDK/PTY HarnessEvent equivalence) | 3055 tests green |
| bun run lint | Side-effect seal + max-warnings=0 | eslint green |
| Live e2e | KANNA_TEAMS_LIVE_OAUTH_TOKEN gated round-trip asserts 2 parallel teammates + synthesis | src/server/teams/teams.live.test.ts |
| renderForLoopCheck | Teams panel/store cannot introduce render loops | src/client/app/TeamsSection.test.tsx |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Hosted Managed Agents API as a new claude-managed provider | Control plane 401s subscription OAuth tokens (probe req_011CcozA4z8goT7jSoRhNH9W); API-key billing not authorized for this repo |
| Disk-watch read-model like the Workflow panel | Teams task_* events flow on the SDK live stream Kanna already reads; no sidecar files exist to watch |
| Extending SubagentOrchestrator to fake teams | Would duplicate the SDK's native parallel scheduling and lose task lifecycle events; native path is strictly richer |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| SDK 0.2->0.3 behavior drift in existing driver | Upgrade landed as an isolated commit gated on the FULL suite + parity matrix | bun run test green at commit 7332b69 |
| task_* shapes are SDK-internal, not a stable contract | Shapes pinned as fixtures from a live probe; parser ignores unknown subtypes | src/server/agent.test.ts task lifecycle cases |
| Stale teammate rows after session rotation | Registry cleared on session close; tap guarded against rotated sessions | commit bbbb800 + agent.test.ts |

## Verification

| Check | Result |
| --- | --- |
| bun run test | 3055 pass / 0 fail (one pre-existing EFAULT tmpdir flake in claude-pty/driver.test.ts under full-suite load, 3x green isolated) |
| bun run lint | clean, --max-warnings=0 |
| KANNA_TEAMS_LIVE_OAUTH_TOKEN=... bun test --conditions production src/server/teams/teams.live.test.ts | 1 pass — 2 parallel teammates, local bash, synthesis contains 42 + kanna-team-ok |
