---
id: adr-20260712-usestate-zustand-migration
c3-seal: fd1cf0dd20e637d4c345e31b4c8a7bda51496dd3564133dc7624e987180ee67b
title: usestate-zustand-migration
type: adr
goal: 'Migrate all 277 in-scope `React.useState` call sites (60 files) in `src/client/**` to Zustand stores and make the ban permanent: raw `useState` outside a frozen allowlist now fails the `no-react-usestate` ast-grep gate wired into CI (`bun run lint:usestate`). This ADR authorizes the doc updates that record the two resulting store forms — singleton feature stores under `src/client/stores/` and per-instance scoped stores colocated as `<Component>.store.ts` via the new `createScopedStore` factory — and the relocation of the WS server snapshot into `kannaStateStore`.'
status: accepted
date: "2026-07-12"
---

# usestate-zustand-migration

## Goal

Migrate all 277 in-scope `React.useState` call sites (60 files) in `src/client/**` to Zustand stores and make the ban permanent: raw `useState` outside a frozen allowlist now fails the `no-react-usestate` ast-grep gate wired into CI (`bun run lint:usestate`). This ADR authorizes the doc updates that record the two resulting store forms — singleton feature stores under `src/client/stores/` and per-instance scoped stores colocated as `<Component>.store.ts` via the new `createScopedStore` factory — and the relocation of the WS server snapshot into `kannaStateStore`.

## Context

Before this change, UI state was split between per-concern Zustand stores and ad-hoc `useState` scattered across 60 client files, with the WS server snapshot held in `useState` inside the `useKannaState` hook. rule-zustand-store froze that split: it required all stores to live in `src/client/stores/`, declared server snapshots must NOT live in a Zustand store, and blessed `useState` for component-local state. The migration (branch `zustand-migration`, 16 tasks T1–T16 executed by an autonomous loop) eliminated every in-scope `useState`: singleton feature state moved to `src/client/stores/<concern>Store.ts`, per-instance component state moved to colocated `<Component>.store.ts` files built with `createScopedStore` (`src/client/lib/createScopedStore.tsx`, Provider + scoped hook), and the WS snapshot moved to `src/client/stores/kannaStateStore.ts` written exclusively by the `useKannaState` socket pipeline. The rule and the state-stores component doc now contradict the code they govern.

## Decision

Adopt the two-form store contract and update the governing docs in this unit rather than widening the old single-directory rule ad hoc. (1) Singleton feature stores stay at `src/client/stores/<concern>(Store)?.ts` with a single `use<Concern>Store` hook. (2) Per-instance component state uses `createScopedStore(displayName, createState)` and is colocated as `<Component>.store.ts` next to its component, with the subtree wrapped in the returned `Provider` — a Context-carried Zustand store, chosen over module singletons because those components render N times concurrently. (3) Server-derived truth lives ONLY in the WS-fed `kannaStateStore`; the socket pipeline in `useKannaState` is its sole writer, so the old "no server state in stores" prohibition becomes a single-writer discipline. (4) The ast-grep rule `no-react-usestate` (frozen allowlist: client tests, `src/client/components/ui/**`, `useIsMobile`, `useNow`, `useStickyState`, `useTheme`, `useIsStandalone`) is the permanent enforcement surface; the migration-era ratchet tooling is deleted.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-1 | container | All 60 migrated files live in the client container; state relocations are internal, no boundary or membership change | c3-1#n5368@v1:sha256:e6ee951578f4d61705ac19fe636ff75594655216f900a12ae302ea0a1d8607a8 | Confirm no container-level section names useState as the state mechanism |
| c3-102 | component | Owns the store surface this ADR reshapes: gains createScopedStore factory, kannaStateStore server snapshot, scoped-store colocation | c3-102#n5446@v1:sha256:d67b854a4ec698edc79613ae615dc5d2002600efd31b355af5ab989c3d41fcbe | Purpose patched in this unit to name all three store forms |

## Compliance Rules

| Rule | Why required | Evidence | Action |
| --- | --- | --- | --- |
| rule-zustand-store | Its Goal/Rule/Not This/Scope sections mandate single-directory stores, forbid server snapshots in stores, and bless component-local useState — all three claims now contradict the migrated code | rule-zustand-store#n8565@v1:sha256:3b054bc631d2b68ac67524d88ede50ff91b29d2b4088dfbf27fde9a5c929c1b1 | update-rule (patched in this unit) |

## Verification

| Check | Result |
| --- | --- |
| bun run lint:usestate exits 0 (zero violations; allowlist frozen) | pass — 0 matches on branch zustand-migration |
| bun run test full suite green after migration | pass — 3134 pass / 0 fail |
| c3 change apply adr-20260712-usestate-zustand-migration lands all patches atomically | to run at apply |
| c3 check clean for rule-zustand-store and c3-102 after apply | to run after apply |
