---
id: adr-20260812-boards-verification-evidence
c3-seal: c93fc6d4c0cc5fe67d81ad10e6b6cf33bb75b3a4a5b0ef8c899a9990204f5242
title: boards-verification-evidence
type: adr
goal: Replace the two ungrounded `Required Verification` cells introduced with the new board components — `c3-310` "Routing split-brain" and `c3-119` "Unmounted root leak" — with a single executable command each, so `c3x check` reports no warning against either fact.
status: accepted
date: "2026-08-12"
---

## Goal

Replace the two ungrounded `Required Verification` cells introduced with the new board components — `c3-310` "Routing split-brain" and `c3-119` "Unmounted root leak" — with a single executable command each, so `c3x check` reports no warning against either fact.

## Context

`c3-310` (boards-domain), `c3-232` (boards) and `c3-119` (boards-ui) were authored in one pass to close the missing component coverage for the boards feature. `c3x check` accepted all three, but flagged two cells as ungrounded evidence:

- `c3-310` Change Safety row "Routing split-brain" carries `grep -rn 'semantic ===' src/ and bun run test` — two commands joined by prose, which the evidence check cannot read as one command, path, or entity id.
- `c3-119` Change Safety row "Unmounted root leak" carries a bare `bun run test`, which names the whole suite rather than the thing that would catch the regression.

Both are the same authoring mistake: the row's Detection column already describes how the drift shows up, and the Required Verification column was written as a sentence about verification rather than the command that performs it. Every other row in both facts already names one `bun test --conditions production <path>` invocation, so the correction is to match the rows around them, not to invent a new convention.

Neither cell is a behaviour claim — the code is unchanged by this ADR. The facts are frozen, so a change-unit is the only path to editing them.

## Decision

Rewrite exactly two table rows, one per fact, changing only the `Required Verification` cell:

- `c3-310` "Routing split-brain" → `bun test --conditions production src/server/board-sync.test.ts`. That suite drives `columnForRemoteState` / `remoteStateOfColumn` end to end, so a caller that reimplements a semantic lookup locally instead of calling the shared finder diverges there. It is preferred over the grep because a grep proves only that a string is absent, while the suite proves the routing still agrees with the one definition.
- `c3-119` "Unmounted root leak" → `bun test --conditions production src/client/components/boards/CardDrawer.test.tsx`. `CardDrawer` is the board component that opens a portal, so it is the board test the `scripts/test-preload.ts` sweep would fail on a leaked React root. It is preferred over `bun run test` because the full suite passing says nothing about which file leaked; this one names the file the guard would blame.

The `Risk`, `Trigger` and `Detection` cells of both rows are left exactly as authored — the rows were correct about what can go wrong and how it surfaces. The third board component, `c3-232`, is deliberately untouched: every one of its Change Safety rows already names a single command and `c3x check` reports no warning against it.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-310 | component | Its Change Safety "Routing split-brain" row names two commands joined by prose instead of one executable check | c3-310#n10738@v1:sha256:f91bf288bc19f25c4c013c1f36bd5399641769d73401ac9ebca3123318f9ec23 | Confirm the replacement suite actually exercises the shared routing finders, so the row still detects what it claims |
| c3-119 | component | Its Change Safety "Unmounted root leak" row names the whole suite instead of the board test the preload sweep would fail | c3-119#n8523@v1:sha256:e458090f6799757de3a3481c6f3303948729815c8fb9e71bb3522c059e06cddf | Confirm the named test mounts a portal-opening board component, so the sweep is the thing being verified |

## Verification

| Check | Result |
| --- | --- |
| c3x check --only c3-310 | ok: true with no warning naming c3-310 |
| c3x check --only c3-119 | ok: true with no warning naming c3-119 |
| c3x check | The only remaining warning is the pre-existing c3-210 ungrounded reference; content_mismatch on c3-104, c3-115, c3-210, c3-211, c3-231 is unchanged pre-existing drift |
| bun test --conditions production src/server/board-sync.test.ts | Passes — the command the c3-310 row now names is real and green |
| bun test --conditions production src/client/components/boards/CardDrawer.test.tsx | Passes — the command the c3-119 row now names is real and green |
| git diff --name-only -- .c3/ | Only .c3/c3-3-shared/c3-310-boards-domain.md, .c3/c3-1-client/c3-119-boards-ui.md, the ADR, and its change folder |
