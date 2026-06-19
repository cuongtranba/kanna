---
id: adr-20260619-openrouter-model-passthrough
c3-seal: 74e5b4954e9f1427e2b179589d599c856f1dee2d22b3c20c9ac8e8361239a985
title: openrouter-model-passthrough
type: adr
goal: |-
    When a chat runs on the OpenRouter provider, the server must spawn the model the
    user selected (e.g. `qwen/qwen3.7-plus`) instead of collapsing every selection
    to the catalog default (`moonshotai/kimi-k2.5:nitro`). This changes how
    `AgentCoordinator.getProviderSettings` resolves the model id for OpenRouter
    turns in `src/server/agent.ts`.
status: implemented
date: "2026-06-19"
---

## Goal

When a chat runs on the OpenRouter provider, the server must spawn the model the
user selected (e.g. `qwen/qwen3.7-plus`) instead of collapsing every selection
to the catalog default (`moonshotai/kimi-k2.5:nitro`). This changes how
`AgentCoordinator.getProviderSettings` resolves the model id for OpenRouter
turns in `src/server/agent.ts`.

## Context

OpenRouter's model list is dynamic — fetched at runtime via
`settings.listOpenRouterModels` and cached (c3-230 openrouter-models). The
static server catalog entry (`PROVIDERS`/`SERVER_PROVIDERS`) therefore carries
`models: []`. `getProviderSettings` runs OpenRouter through the non-claude
branch which calls `normalizeServerModel(provider, options.model)`;
`normalizeServerModel` only returns the requested id when it is a member of
`catalog.models`, otherwise it returns `catalog.defaultModel`. With an empty
list, every OpenRouter selection collapses to the default. The UI shows the
picked model (e.g. Qwen) while the server runs Kimi. Affected topology is c3-210
(agent-coordinator). Claude/Codex are unaffected — their model lists are static
so the membership check passes.

## Decision

Add an explicit `provider === "openrouter"` branch to `getProviderSettings`
that passes the client-selected model id straight through (trimmed), falling
back to `catalog.defaultModel` only when blank. OpenRouter validates model ids
at its API, so a bad id surfaces as a normal API error rather than a silent
substitution. This is the correct shape for a dynamic-catalog provider whose
valid set cannot be enumerated server-side, and it is contained to the
coordinator (does not touch the shared `normalizeServerModel` used by
claude/codex).

## Affected Topology

| Entity | Type | Why affected | Governance review |
| --- | --- | --- | --- |
| c3-210 | component | Owns getProviderSettings model resolution; adds the openrouter passthrough branch | ref-provider-adapter compliance |

## Compliance Refs

| Ref | Why required | Action |
| --- | --- | --- |
| ref-provider-adapter | Each provider's model resolution must match its catalog shape; OpenRouter's is dynamic | comply |
| ref-colocated-bun-test | New behavior needs a colocated test next to agent.ts | comply |
| ref-strong-typing | The branch returns the existing typed provider-settings shape, no any | comply |
| ref-event-sourcing | Model resolution is a pure read of send options; it appends no new events and reuses the existing turn event path | N.A - no new events |
| ref-tool-hydration | Tool hydration normalizes tool calls; model id resolution is not a tool call and never passes through hydration | N.A - not a tool call |

## Compliance Rules

| Rule | Why required | Action |
| --- | --- | --- |
| rule-colocated-bun-test | Test sits next to the file under test as *.test.ts | comply |
| rule-strong-typing | No weak/escape types introduced | comply |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| Model resolution | Add openrouter passthrough branch in getProviderSettings | src/server/agent.ts |
| Test | Assert an openrouter turn spawns with the selected model id, not the default | src/server/agent.openrouter-model.test.ts |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| N.A - no C3 CLI/validator/schema surface changes | Runtime behavior fix; no c3x command, validator, hint, or template change | c3x check passes unchanged |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| bun test src/server/agent.openrouter-model.test.ts | Fails if an openrouter turn spawns with the default instead of the selected model | colocated test |
| bun run lint | Fails on side-effect/type violations in the edited code | eslint config |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Populate SERVER_PROVIDERS openrouter models from the cache | Pulls an async cache dependency into a synchronous resolution path |
| Make normalizeServerModel passthrough when catalog.models is empty | Touches shared normalize used by claude/codex; wider blast radius for a provider-specific quirk |
| Leave as-is | Silent model substitution: UI shows Qwen, server runs Kimi — wrong + invisible |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Invalid/typo'd model id reaches the API | OpenRouter returns a clear API error surfaced through the existing failure path; blank falls back to default | test asserts blank → default |
| Future provider added with same empty-list quirk | Branch is openrouter-specific; a new dynamic provider needs its own explicit branch (documented in ADR) | code review |

## Verification

| Check | Result |
| --- | --- |
| bun test src/server/agent.openrouter-model.test.ts | pass |
| bun run lint | pass (no new warnings) |
