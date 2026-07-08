---
id: adr-20260709-advisor-tool
c3-seal: 72d01f2e518e3c9ae49c1d7650906ecd988f180861562bc7c408408d568e6cfb
title: advisor-tool
type: adr
goal: |-
    Surface Claude's server-side advisor tool in Kanna as a per-chat opt-in setting. A chat's
    selected Claude executor model may consult a higher-intelligence advisor model mid-generation.
    The advisor model id (`advisorModel`) is chosen per chat in the composer and threaded through
    the existing model/effort spawn plumbing into the Claude Agent SDK's `query()` via
    `options.settings.advisorModel`. Scope is the SDK driver only; the PTY driver ignores the field
    and the picker shows a driver hint.
status: accepted
date: "2026-07-09"
---

## Goal

Surface Claude's server-side advisor tool in Kanna as a per-chat opt-in setting. A chat's
selected Claude executor model may consult a higher-intelligence advisor model mid-generation.
The advisor model id (`advisorModel`) is chosen per chat in the composer and threaded through
the existing model/effort spawn plumbing into the Claude Agent SDK's `query()` via
`options.settings.advisorModel`. Scope is the SDK driver only; the PTY driver ignores the field
and the picker shows a driver hint.

## Context

Kanna spawns Claude sessions through `AgentCoordinator` (c3-210) which builds SDK `query()`
options from per-chat model/effort selections. Today there is no way to pair a faster executor
model with a stronger advisor model. The Agent SDK (`@anthropic-ai/claude-agent-sdk` ^0.3.204)
exposes `advisorModel?: string` on its `Settings` interface (`sdk.d.ts`), and passing it via the
`query()` `settings` field makes the CLI inject the `advisor_20260301` server-tool plus the
`advisor-tool-2026-03-01` beta header internally. The affected topology is the model-selection →
spawn path in `agent.ts` (c3-210) and the boundary types in `src/shared` (c3-301). Constraint:
the field must ride the existing model/effort plumbing (no new boundary), be claude-only, and
be dropped for the PTY driver. Invalid executor/advisor pairs are rejected by the API with a 400,
surfaced through the existing turn-error path.

## Decision

Add `advisorModel?: string` as a per-chat field parallel to `model` (NOT inside `ModelOptions`,
which is orthogonal reasoning-effort/context config). It flows: composer state →
`chat.send`/`message.enqueue` (c3-301 protocol) → `SendMessageOptions` → `getProviderSettings`
(claude branch only) → `startTurnForChat` → `startClaudeTurn` → SDK `startClaudeSession` →
`query({ options.settings: { advisorModel } })`. The PTY spawn branch never receives it. This
reuses existing plumbing (no new coordinator boundary) and matches the Agent-Teams precedent of
an SDK-only feature with a PTY UI hint. Chosen over a global setting (less flexible) and a
per-model-catalog-entry default (defers cleanly to a later change).

## Affected Topology

| Entity | Type | Why affected | Governance review |
| --- | --- | --- | --- |
| c3-210 | component | Adds an advisorModel spawn arg threaded into SDK query().settings; new claude-only session-reuse key | Verify provider-adapter normalization unaffected; confirm PTY branch excluded |
| c3-301 | component | New advisorModel?: string on protocol commands + QueuedChatMessage + composer prefs | Strong-typing rule review: named optional field, no any |

## Compliance Refs

| Ref | Why required | Action |
| --- | --- | --- |
| ref-provider-adapter | Advisor wiring lives in the Claude SDK adapter path; must not leak provider branching into the coordinator's normalized model | comply |
| ref-strong-typing | New boundary field crossing client↔server and coordinator↔adapter must be a named optional type | comply |
| ref-colocated-bun-test | New behavior test agent.advisor.test.ts sits next to agent.ts; client tests colocated | comply |
| ref-event-sourcing | Advisor rides the existing model/effort spawn plumbing; reviewed to confirm no new event type or event-sourced state is introduced by the change | review |
| ref-tool-hydration | Advisor is a server-side SDK tool wired via query().settings; reviewed to confirm it is not normalized into transcript tool entries by src/shared/tools.ts | review |

## Compliance Rules

| Rule | Why required | Action |
| --- | --- | --- |
| rule-strong-typing | advisorModel?: string crosses WS envelopes, queued-message store, and adapter args — must be explicitly typed, no untyped literals | comply |
| rule-colocated-bun-test | New behavior test sits next to agent.ts as agent.advisor.test.ts; client test colocated | comply |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| protocol | Add advisorModel? to chat.send, message.enqueue | src/shared/protocol.ts |
| types | Add advisorModel? to QueuedChatMessage + claude composer prefs | src/shared/types.ts, src/client/stores/chatPreferencesStore.ts |
| coordinator | Thread advisorModel getProviderSettings→startClaudeSession; set query().settings; session-reuse key | src/server/agent.ts |
| client | Advisor picker (claude-only, PTY hint); submit + WS send | ChatPreferenceControls.tsx, ChatInput.tsx, useKannaState.ts |
| tests | agent.advisor.test.ts, chatPreferencesStore.test.ts, ChatPreferenceControls.test.tsx | new/updated test files |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| N.A - no C3 CLI surface changed | This ADR changes application code only; no c3x command/validator/schema/template/test is modified | c3x check --include-adr passes with existing validators |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| src/server/agent.advisor.test.ts | Asserts advisorModel reaches SDK spawn (claude) and is absent for codex/unset | bun test --conditions production src/server/agent.advisor.test.ts |
| bun run lint | Strong-typing seal: no any/untyped field additions | CI lint gate --max-warnings=0 |
| API 400 turn-error path | Invalid executor/advisor pair surfaces as a visible turn error | existing detectFromResultText path |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Global advisor setting in Settings | Less flexible; user cannot vary advisor per chat, the primary use case |
| Per-model-catalog-entry default advisor | More catalog plumbing; cleanly deferrable to a later change (listed out-of-scope in spec) |
| Client-side compatibility matrix | Hardcoded model matrix drifts as models are added (repo already hit this with HARD_CODED_CODEX_MODELS); rely on API 400 instead |
| PTY parity now | PTY needs extra CLI-flag plumbing + smoke path; Agent-Teams precedent is SDK-only with a hint |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Advisor change mid-chat ignored by warm session | Add advisorModel to the session-reuse guard so it forces a respawn | agent.advisor.test.ts respawn case asserts two spawns |
| advisorModel leaks to codex/openrouter or PTY | Set only in getProviderSettings claude branch and SDK spawn branch; empty string normalized to undefined | unit test asserts absence for codex/unset |
| SDK does not auto-add beta header from settings | Optional env-gated live test confirms turn completes without 400 and advisor result appears | src/server/advisor.live.test.ts (optional) |

## Verification

| Check | Result |
| --- | --- |
| bun test --conditions production src/server/agent.advisor.test.ts | PASS (spawn threading, queued persistence, respawn) |
| bun run test | full suite PASS |
| bun run lint | 0 errors, warnings ≤ cap |
| c3x check --include-adr | no errors |
