---
id: adr-20260925-client-pending-action-state
c3-seal: b933b2bcd82aab646c3814fcd1f4c58e05a04580b76670f032670c24f3dbe109
title: client-pending-action-state
type: adr
goal: 'Every client side effect a user triggers (a WebSocket command or an HTTP request) renders a pending state on its trigger until it settles, is protected against a double trigger, and surfaces its failure. One primitive owns in-flight state: `runPendingAction` / `usePendingAction` / `pendingActionKey` in `src/client/stores/pendingActionsStore.ts`, rendered through `Button pending` and `Spinner`. Background work nobody waits on goes through `runDetached` in `src/client/lib/runDetached.ts`. Type-aware ESLint on `src/client/**` makes an unsettled promise a lint error, so the launch side cannot regress.'
status: proposed
date: "2026-09-25"
---

## Goal

Every client side effect a user triggers (a WebSocket command or an HTTP request) renders a pending state on its trigger until it settles, is protected against a double trigger, and surfaces its failure. One primitive owns in-flight state: `runPendingAction` / `usePendingAction` / `pendingActionKey` in `src/client/stores/pendingActionsStore.ts`, rendered through `Button pending` and `Spinner`. Background work nobody waits on goes through `runDetached` in `src/client/lib/runDetached.ts`. Type-aware ESLint on `src/client/**` makes an unsettled promise a lint error, so the launch side cannot regress.

## Context

The client launched side effects with no feedback: `onClick={() => void handleX()}`, `socket.command(x).catch(() => {})`, and async handlers passed to props typed to return void. A click appeared to do nothing until the server answered, a double click sent the command twice, and a failure was swallowed. A pass with type-aware lint found 235 such sites across about 55 files (archive, delete, fork, cron remove, auto-continue accept, git sync, settings writes, board actions, share links, and more). The pending flags that did exist were per-component booleans (`saving`, `submitting`, `busy`) added ad hoc; because `useState` is banned (rule-zustand-store), every new flag cost a store edit, so most actions simply had none. No lint rule could see the defect: the promise was discarded with `void`, which the untyped ESLint config cannot distinguish from a sync call.

## Decision

Add one singleton Zustand store keyed by action (`pendingActionsStore`) instead of per-component flags. `runPendingAction(key, action)` returns void so it is legal in any handler, marks the key in flight, ignores a repeat trigger while in flight, clears on settle, and logs a rejection. Triggers read `usePendingAction(key)`; `Button` gains a `pending` prop that disables it, sets `aria-busy`, and shows a `Spinner`. Enable type-aware linting for `src/client/**` production files (`parserOptions.projectService`) with `@typescript-eslint/no-floating-promises` (`ignoreVoid: false`, react-router `NavigateFunction` allowlisted) and `@typescript-eslint/no-misused-promises` (`checksVoidReturn.attributes` only), and ban empty `.catch` handlers in shared and client through `no-restricted-syntax` (`SILENT_CATCH_BAN`), because they satisfy the promise rules while hiding both the wait and the failure. The gate is type-aware because the defect is a Promise being dropped, which a syntax rule can only approximate by one spelling. Measured cost: about 5 s added to `bun run lint`. `src/ops/testing/pending-state-gate.test.ts` lints snippets through the real config so the gate cannot be weakened silently.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-102 | component | Gains pendingActionsStore, the single owner of in-flight action state for the client | c3-102#n9609@v1:sha256:d67b854a4ec698edc79613ae615dc5d2002600efd31b355af5ab989c3d41fcbe | Store follows rule-zustand-store: singleton under src/client/stores, colocated test, named actions |
| c3-103 | component | Button gains the pending prop and a new Spinner primitive ships beside it | c3-103#n9665@v1:sha256:932472baef6005812e5d9295fcb97478152b3ecd52cd47e2d6e4e6e452264118 | Primitive stays presentational; the design-contract test pins pending as disabled plus aria-busy |
| c3-110 | component | runDetached lands in src/client/lib and every app-shell handler that launched a side effect now goes through the pending primitive | c3-110#n9782@v1:sha256:8d467214a2dbc5cf341cd31b54660de18b2f9baef295c94a728736a1b1c49b29 | Call sites reviewed for rendering the pending flag |

## Compliance Rules

| Rule | Why required | Evidence | Action |
| --- | --- | --- | --- |
| rule-zustand-store | Pending state is client state, so it must live in a Zustand store rather than useState or useTransition | rule-zustand-store#n13623@v1:sha256:f4987b0b2521426050c0c2a5307760c102f3ed1e0a9334b074ed1913fe818f64 | comply |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| eslint.config.js pending-state block | no-floating-promises with ignoreVoid false and no-misused-promises on JSX attributes, src/client production files | bun run lint |
| eslint.config.js SILENT_CATCH_BAN | Rejects .catch handlers that return nothing, undefined, or null | bun run lint |
| src/ops/testing/pending-state-gate.test.ts | Lints four snippets through the real config and asserts each rule fires, plus a passing control | bun run test src/ops/testing/pending-state-gate.test.ts |
| src/client/stores/pendingActionsStore.test.ts | Pending until settle, cleared on rejection, second trigger ignored | bun run test src/client/stores/pendingActionsStore.test.ts |
| CLAUDE.md and kanna-react-style / kanna-test skills | Soft rules the gate cannot check: the flag must be rendered, runDetached is not for clicks, failures are shown | Pending state for side effects section |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| React 19 useTransition per component | Pending lives in the component, cannot be keyed per row or read by a row after its menu closes, and an async transition rethrows into the error boundary |
| React Query useMutation | The ADR for client effects scopes React Query to HTTP caching; most of these effects are WebSocket commands issued through Zustand actions |
| ast-grep rule banning void inside JSX attributes | Counts one spelling; an async handler passed directly to onClick or a void inside a useCallback passes it |
| Per-component saving booleans | The status quo; each costs a store edit, so most actions shipped without one |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| runDetached used for a user action to evade the gate | Named for background work; soft rule in CLAUDE.md and the react-style skill | Review |
| A pending flag is set but never rendered | Soft rule; Button pending makes rendering one prop | Review and browser check |
| Type-aware lint slows the lint gate | Scoped to src/client production files; measured about 5 s | bun run lint timing |

## Verification

| Check | Result |
| --- | --- |
| bun run lint | exits 0 with the pending-state block enabled |
| bun run typecheck | exits 0 |
| bun run test | passes, including pending-state-gate and pendingActionsStore suites |
