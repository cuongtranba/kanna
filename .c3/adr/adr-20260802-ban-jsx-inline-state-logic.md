---
id: adr-20260802-ban-jsx-inline-state-logic
c3-seal: 6fae398ca7f3a6525b7fc9f2366a445e018b5f62d748afa83a81616053d1b195
title: ban-jsx-inline-state-logic
type: adr
goal: |-
    Make a Zustand store the single home for every client state transition, and make the
    alternative mechanically impossible. Concretely: add two `severity: error` ast-grep rules
    (`no-jsx-inline-state-updater`, `no-jsx-inline-state-logic`) that reject state-transition
    logic written inline inside a JSX attribute, then migrate all 38 existing violations so the
    gate ships with no pre-existing-debt allowlist.
status: accepted
date: "2026-08-02"
---

# ban-jsx-inline-state-logic

## Goal

Make a Zustand store the single home for every client state transition, and make the
alternative mechanically impossible. Concretely: add two `severity: error` ast-grep rules
(`no-jsx-inline-state-updater`, `no-jsx-inline-state-logic`) that reject state-transition
logic written inline inside a JSX attribute, then migrate all 38 existing violations so the
gate ships with no pre-existing-debt allowlist.

## Context

`rule-zustand-store` already forces client *state* into Zustand and the `no-react-usestate`
gate enforces it, so `src/client/**` has no raw `useState` outside the frozen allowlist.
But the gate only constrains where state is *stored*, not where its *transitions* are
written. Stores were therefore built as dumb passthrough setters, and the transition logic
leaked back into the render tree:

```
// src/client/app/KannaSidebar.tsx:704
onToggleExpanded={(stackId) => setExpandedStackIds((prev) => {
  const next = new Set(prev)
  if (next.has(stackId)) next.delete(stackId); else next.add(stackId)
  return next
})}
// src/client/app/KannaSidebar.tsx:711
onOpenStackMenu={(stackId) => { setStackEditId(stackId); setStackCreatePanelOpen(true) }}
```

`src/client/stores/kannaSidebarStore.ts` exposes 18 setters and not one named intent action;
four of them are updater-shaped (`setCollapsedSections`, `setExpandedGroups`,
`setSidebarWidth`, `setExpandedStackIds`), which forces every caller to re-derive previous
state in the component. An ast-grep census over `src/client/**` found 38 sites in 17 files,
concentrated in `KannaSidebar.tsx` (10) and `RightSidebar.tsx` (8). None of this logic is
reachable from a store test, and the same transition is re-implemented at each call site.

The affected topology is `c3-102` (state-stores) and the client components that consume it.

## Decision

Two tsx-only ast-grep rules in `rules/`, wired into CI through the existing
`bun run lint:usestate` (`ast-grep scan`) — no workflow edit needed, since `sgconfig.yml`
already globs `ruleDirs: [rules]`.

`no-jsx-inline-state-updater` rejects a functional updater passed to a `set*` call inside a
JSX attribute. `no-jsx-inline-state-logic` rejects an inline JSX-attribute arrow that calls
a mutation-shaped identifier and is more than a single call — either a block body with two
or more statements, or a block body whose one statement is an `if_statement`. That second
shape closes a real hole: `onOpenChange={(v) => { if (v) setOpen(true); else close() }}` is
syntactically one statement but is still branching logic in the view.

Two design choices are load-bearing and were verified empirically rather than assumed:

1. The callee search uses `stopBy: {any: [arrow_function, function_expression,
function_declaration]}`, not `stopBy: end`. With `stopBy: end` a pure render prop matches
merely because a nested handler mutates, so one fix would clear two reports and the
migration's progress count would stop being monotonic. The fixture case at
`rule-tests/no-jsx-inline-state-logic-test.yml` pins the primary match to the inner arrow.
2. The callee regex is `^(set|toggle|clear|reset|open|close|select|begin|finish|mark|
dismiss|apply)[A-Z]`, deliberately broader than `^set[A-Z]`, because the actions this
migration creates are named `toggleStackExpanded` / `openStackEditPanel` /
`closeStackPanel`. A `^set`-only regex would be blind to exactly the code the rule asks
for, and the pattern would regrow under new verbs.

Remedy is chosen by what the handler closes over, and the rule note states both: a pure
state transition becomes one named store action that derives previous state inside the
store; orchestration over props, refs, or async I/O becomes an extracted `useCallback`
handler. Stores must not absorb props, refs, or I/O — a `useRef` stays a `useRef`, because
making it reactive state changes render behavior.

The gate lands red on a branch, ahead of the migration, so the scan count is a
machine-checkable and monotonically decreasing stop condition for the chunk-by-chunk
migration that follows.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-102 | component | Owns the Zustand store surface; its stores gain named intent actions and lose updater-shaped setters, and it acquires a second enforcement gate alongside no-react-usestate | c3-102#n6028@v1:sha256:1f60e96d2b3fa7090bcab5cc4b66f1a605ea59b398a34da80587385d53bec943 | Confirm the Governance table still names every gate constraining store shape |
| rule-zustand-store | rule | Its Rule/Not This/Scope sections state where state lives but say nothing about where transitions live; this ADR extends all three | rule-zustand-store#n9061@v1:sha256:eddb1e4ed99a17547a630f5997a2ad234b79ac5be15bc1d151f3e09d9cb9df2c | Rule text must name both remedies and the tsx-only limitation |

## Compliance Rules

| Rule | Why required | Evidence | Action |
| --- | --- | --- | --- |
| rule-zustand-store | This ADR extends the rule that already governs client state placement; transitions are the same concern and belong in the same fact rather than a competing one | rule-zustand-store#n9061@v1:sha256:eddb1e4ed99a17547a630f5997a2ad234b79ac5be15bc1d151f3e09d9cb9df2c | update-rule |
| rule-colocated-bun-test | New store actions require colocated tests; kannaSidebarStore.ts and all four scoped .store.ts files currently have none | rule-colocated-bun-test#n8968@v1:sha256:6c733a6bc908ab2c89a563a0429d06eb34d56731aaa4a18067213c18dbdf6c8f | comply |
| rule-strong-typing | New action signatures are part of each store's state interface and must be named types, never any | rule-strong-typing#n9029@v1:sha256:ab9d03265e99a9527350c213d779cbb270675fd943f331a80652bf0b80e692f8 | comply |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| Gate | Add rules/no-jsx-inline-state-updater.yml and rules/no-jsx-inline-state-logic.yml | rules/ |
| Gate fixtures | Add rule-tests/no-jsx-inline-state-{updater,logic}-test.yml plus generated snapshots; CLAUDE.md requires a fixture in the same PR | rule-tests/ |
| Docs | CLAUDE.md "Hard AST gate" section gains both rules and the tsx-only note | CLAUDE.md |
| Store actions | kannaSidebarStore, rightSidebarStore, diffCommitStore, settingsPageStore gain named intent actions; kannaSidebarStore loses its four updater-shaped setters | src/client/stores/ |
| Scoped stores | MermaidZoomModal, ExitPlanModeMessage, AskUserQuestionMessage, StackChatCreateRow gain intent actions and first tests | src/client/components/ |
| Component migration | 38 call sites across 17 files rewritten to a bare reference, a single call, or an extracted useCallback | src/client/ |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| bun run lint:usestate | ast-grep scan loads rules/ via sgconfig.yml and exits non-zero on any violation; already run by CI | .github/workflows/test.yml |
| bunx ast-grep test | Fixture suite pins valid/invalid boundaries and the inner-arrow primary match; 14 rule suites pass | rule-tests/snapshots/ |
| bun run typecheck | Deleting the updater-shaped setters from KannaSidebarState proves no caller remains, including the useCallback bodies the JSX-scoped gate cannot see | tsconfig.json |
| bun run verify:client-arch | ast-grep scan + eslint + typecheck + bun test, run once end-to-end before merge | package.json |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Ban every multi-statement inline JSX arrow regardless of state | 99 sites in this repo, most of them pure DOM work like preventDefault + analytics. That is a style preference, not the defect being fixed, and the migration cost would bury the real signal. |
| Keep the narrow ^set[A-Z] callee regex | Only 23 sites, and structurally blind to the toggleX/openY/closeZ actions this very migration introduces, so the pattern regrows the moment the gate lands. |
| Land at severity: warning and flip to error after migrating | ast-grep scan exits 0 on warnings, so the migration's verify command would report success immediately with all 38 violations intact. |
| Add file-level ignores for the 5 known false positives | An allowlist of pre-existing violations becomes permanent. All five are fixed by a useCallback extraction that improves the code anyway; the escape hatch for a genuinely unfixable case is a not: clause plus a pinning fixture, never an ignores entry. |
| Skip the gate and fix KannaSidebar.tsx only | The pattern already recurred once, after no-react-usestate closed the storage hole. Without a mechanical gate it recurs again. |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| The verb regex is the whole gate; a new action verb such as stage/enable/expand escapes silently | The rule note requires extending the regex plus adding a fixture case in the same PR that introduces a new verb | After migration, re-scan with the callee regex dropped entirely and review the delta |
| Moving a useRef into store state to satisfy the rule breaks a non-reactive guard, notably ChatPage/index.tsx:1203 | Rule note states refs stay refs and the remedy there is useCallback; migration briefs repeat it per chunk | Reject any diff that adds a ref-derived value to a store state interface |
| Deleting updater-shaped setters from KannaSidebarState breaks 12+ non-JSX callers at once | Schedule KannaSidebar last, after the pattern is established by smaller chunks | bun run typecheck is the completeness proof for that chunk, not the ast-grep count |
| Non-monotonic violation count would break the migration's progress signal | Function-boundary stopBy instead of stopBy: end, pinned by a fixture whose snapshot records the inner arrow as the primary match | Global count must drop by exactly the number of sites a chunk touched |
| CI is red on the branch until the last chunk lands | Keep the PR in draft until bunx ast-grep scan is clean | bun run verify:client-arch green before marking ready |

## Verification

| Check | Result |
| --- | --- |
| bunx ast-grep test | 14 passed; 0 failed — includes both new suites |
| bunx ast-grep scan | 0 violations repo-wide, with no ignores beyond test files and components/ui/** |
| bun run typecheck | Clean, proving the deleted updater-shaped setters have no remaining callers |
| bun test --conditions production | Green, including new colocated tests for kannaSidebarStore and the four scoped stores |
| bun run verify:client-arch | Green end-to-end before merge |
| Manual browser smoke | Expand/collapse a stack, open and cancel the stack edit panel, delete a stack, keyboard-resize the sidebar |
