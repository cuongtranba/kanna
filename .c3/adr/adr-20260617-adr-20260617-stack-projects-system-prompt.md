---
id: adr-20260617-adr-20260617-stack-projects-system-prompt
c3-seal: 0ea29214a8355ad6ceee3955aea46d9661a20e0395c2fdaa121c16414c86ae09
title: adr-20260617-stack-projects-system-prompt
type: adr
goal: |-
    Inject a `## Stack projects` block into the Kanna Claude system-prompt suffix so the
    main agent is told which project each stack worktree path belongs to (project
    title + role + path), instead of only seeing bare worktree paths via Claude
    Code's built-in working-directory env block. This makes cross-project work on a
    multi-binding stack chat legible to the model. Scope is the main Claude turn
    only; both SDK and PTY drivers inherit it because they share the one builder
    `buildKannaSystemPromptAppend`.
status: implemented
date: "2026-06-17"
---

## Goal

Inject a `## Stack projects` block into the Kanna Claude system-prompt suffix so the
main agent is told which project each stack worktree path belongs to (project
title + role + path), instead of only seeing bare worktree paths via Claude
Code's built-in working-directory env block. This makes cross-project work on a
multi-binding stack chat legible to the model. Scope is the main Claude turn
only; both SDK and PTY drivers inherit it because they share the one builder
`buildKannaSystemPromptAppend`.

## Context

A Kanna chat can span multiple project worktrees via `chat.stackBindings` (one
`primary` + N `additional`). Both drivers already grant filesystem access to
every root — SDK passes `additionalDirectories` to `query()` (agent.ts:1040),
PTY emits `--add-dir <dir>` (claude-pty/driver.ts:276). `resolveSpawnPaths`
(agent.ts:94) maps the primary binding to `cwd` and the rest to
`additionalDirectories`, discarding `projectId` — so project names never reach
the prompt. The model receives raw worktree paths and must infer each root's
purpose. The Kanna suffix (`src/shared/kanna-system-prompt.ts`) already injects
refusal policy, project instructions, and a subagent roster, but nothing about
the stack. Affected topology: the shared prompt builder (c3-3 / c3-301) and the
agent-coordinator turn-start path (c3-210).

## Decision

Keep the builder pure (it lives in `src/shared`, no store access): add an
optional `stackProjects?: ResolvedStackBinding[]` to `KannaSystemPromptOptions`
and format a `## Stack projects` section when non-empty, placed after the
project-instructions block and before the subagent roster (BASE stays first per
the existing safety-ordering comment). Resolve the binding titles at the call
site in `KannaAgent.send` (agent.ts:2088) where `chat.stackBindings`,
`project`, and `this.store` are all in scope — mirror the existing resolver in
read-models.ts:309 (`store.getProject(id)?.title`, status active/missing).
Thread the resolved list through `startClaudeTurn` (agent.ts:2280) into the
build call (agent.ts:2317). Reuse the existing `ResolvedStackBinding` type
(types.ts:1478) rather than minting a new shape. Chosen over threading raw
`stackBindings` into the builder (would couple the pure shared module to the
store for name lookup) and over a client-only display change (would not reach
the model at all).

## Affected Topology

| Entity | Type | Why affected | Governance review |
| --- | --- | --- | --- |
| c3-301 | component | Reuses ResolvedStackBinding; builder gains a typed option | Confirm no any; named boundary type |
| c3-210 | component | send resolves binding titles + threads stackProjects through startClaudeTurn | Confirm turn-start contract + colocated test |
| c3-3 | container | Owns the shared prompt builder both drivers consume | Confirm SDK/PTY parity (one builder, no per-driver fork) |

## Compliance Refs

| Ref | Why required | Action |
| --- | --- | --- |
| ref-strong-typing | New builder option + resolved list cross the shared↔server boundary; must be a named type | comply (reuse ResolvedStackBinding) |
| ref-provider-adapter | Prompt suffix feeds both Claude drivers identically; the block must not diverge per driver | comply (single builder, no driver branch) |
| ref-colocated-bun-test | New behavior needs colocated tests | comply |
| ref-event-sourcing | Cited by c3-210; this change adds no event type and uses no replay path — it reads existing chat.stackBindings at spawn time | N.A - no event-sourced state added |
| ref-tool-hydration | Cited by c3-210 and c3-303; this change emits system-prompt text only and normalizes no tool calls | N.A - no tool-call hydration touched |
| ref-ws-subscription | Cited by c3-302; this change adds no WS envelope or subscription topic — the prompt is built server-side at spawn | N.A - no WS surface changed |
| ref-local-first-data | Cited by c3-305; this change persists nothing — stack titles resolve in-memory from the existing store at spawn | N.A - no persisted local state added |

## Compliance Rules

| Rule | Why required | Action |
| --- | --- | --- |
| rule-strong-typing | Builder option + agent arg must be named types, no any/untyped literals | comply |
| rule-colocated-bun-test | Tests sit next to the file under test, share basename, run under bun test | comply |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| Builder | Add stackProjects?: ResolvedStackBinding[] option; render ## Stack projects block; widen fast-path guard | src/shared/kanna-system-prompt.ts |
| Agent resolve | Build ResolvedStackBinding[] from chat.stackBindings via this.store.getProject in send | src/server/agent.ts:2088 |
| Agent thread | Add stackProjects to startClaudeTurn args; pass into build call | src/server/agent.ts:2280, 2089, 2317 |
| Tests | Builder render/omit/order/missing-suffix; agent resolves + threads | src/shared/kanna-system-prompt.test.ts, src/server/agent.stack-spawn.test.ts |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| N.A - no C3 CLI/validator/schema surface changed | This is a product code change; C3 docs updated via /c3 change + c3x check only | c3x check passes after edits |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| src/shared/kanna-system-prompt.test.ts | Asserts block content, ordering, omission, missing-suffix | bun test src/shared/kanna-system-prompt.test.ts |
| src/server/agent.stack-spawn.test.ts | Asserts send resolves titles + threads stackProjects | bun test src/server/agent.stack-spawn.test.ts |
| bun run lint | Strong-typing / side-effect seal enforced | bun run lint exits 0 |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Thread raw stackBindings into the builder | Couples the pure shared prompt module to the project store for name lookup; breaks layer boundary |
| Mint a new prompt-only stack type | ResolvedStackBinding (types.ts:1478) already carries title+role+path+status; duplication adds drift |
| Client-only display of project labels | Does not reach the model; the goal is model legibility for cross-project work |
| Inject in each driver separately | Violates ref-provider-adapter; the two drivers already diverged once on prompt content |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Solo (non-stack) chats get an unwanted block | Render only when stackProjects non-empty; empty bindings → [] | Test: empty stackProjects returns no block / BASE fast-path |
| Missing project (deleted) yields blank label | Fall back to (missing) title + missing status suffix | Test: missing-status row renders (missing) |
| SDK/PTY prompt divergence | Single builder consumed by both; no per-driver branch | parity covered by shared builder + existing driver tests |

## Verification

| Check | Result |
| --- | --- |
| bun test src/shared/kanna-system-prompt.test.ts | pass |
| bun test src/server/agent.stack-spawn.test.ts | pass |
| bun run lint | exit 0, no warnings |
