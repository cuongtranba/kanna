---
id: adr-20260805-replay-tolerate-unknown-events
c3-seal: 3a33504958646989c5eb191cb2f2f536241994f6e58e933fcbcc1ff9d9e752d7
title: replay-tolerate-unknown-events
type: adr
goal: |-
    Make boot replay survive an event type that is not in this binary's `StoreEvent`
    union. `getReplayEventPriority` priced unknown types with a runtime-strict
    `switch` whose `default` threw; one such row in a replayed log killed the server
    on startup. Replace the throw with a warn + a defined sort bucket
    (`UNKNOWN_EVENT_PRIORITY`), while keeping the compile-time exhaustiveness check
    that catches a developer adding a union member without pricing it.
status: proposed
date: "2026-08-05"
---

# Replay tolerates unknown event types instead of throwing

## Goal

Make boot replay survive an event type that is not in this binary's `StoreEvent`
union. `getReplayEventPriority` priced unknown types with a runtime-strict
`switch` whose `default` threw; one such row in a replayed log killed the server
on startup. Replace the throw with a warn + a defined sort bucket
(`UNKNOWN_EVENT_PRIORITY`), while keeping the compile-time exhaustiveness check
that catches a developer adding a union member without pricing it.

## Context

A dev install crash-looped on every boot with `Unhandled replay event type:
turn_resume_attempted`. That event shipped in PR #493 (v0.108.0) on a branch that
never merged to `main`; two of its rows sat in `~/.kanna-dev/data/turns.jsonl`
from 2026-07-09. Running current `main` over that log made the server exit 1
before it could serve, with no in-product way to recover.

The throw sat inside the `.sort()` comparator in `loadAndReplayLogs`
(`event-store-snapshot.ts`), which no `try`/`catch` guards, so it propagated
through `initializeEventStore` → `startKannaServer` and out of the CLI.

The strictness protected nothing. `applyStoreEvent` (`event-store-apply.ts`) has
no `default` case at all — an unknown type is already a silent no-op on apply.
So the throw could not prevent bad state from being applied; it only converted an
event the system would have ignored into a dead server. The real integrity gate
is the compile-time `const _exhaustive: never = discriminator`, which fires when
the union grows without a matching case — and that is unaffected by what the
runtime branch does.

This is not a one-off. Any replayed log can carry a type from a different code
version: a branch run locally, a downgrade after a newer build wrote the log, or
an event retired without a `STORE_VERSION` bump (deliberate — a version mismatch
is fail-closed and wipes the user's whole history). The existing
`RETIRED_EVENT_TYPES` allowlist handled exactly one such case by hand and could
only ever cover types someone remembered to add.

## Decision

The `default` branch keeps `const _exhaustive: never = discriminator` — so the
compile-time exhaustiveness gate is unchanged — then `log.warn`s and returns the
exported constant `UNKNOWN_EVENT_PRIORITY` (99) instead of throwing. Priced last
so an unknown event never displaces a known one at the same timestamp, and the
comparator stays a total order.

Fail-open is correct here specifically because apply is already a no-op for these
types: tolerating an unknown type changes no derived state, while throwing
changes availability from "works" to "cannot boot". An unknown type is also not
evidence of a corrupt log, so it must not trigger `clearStorage` — that would
destroy user history over a row this binary simply does not recognize.

`RETIRED_EVENT_TYPES` stays, with a narrowed purpose: it pins known-retired types
to their historical bucket and keeps them out of the warning, which is now
reserved for genuine version drift.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-206 | component | Owns boot replay; getReplayEventPriority and the loadAndReplayLogs sort comparator both live here, and the documented "Alternate — replay" behavior changes | c3-206#n6444@v1:sha256:e04d56e73404382bba111d31d12fd30ce75cd0fa5acbb6ba5811a68709533460 | Replay must stay ordered and must not wipe history on an unrecognized row |

## Compliance Refs

| Ref | Why required | Evidence | Action |
| --- | --- | --- | --- |
| ref-event-sourcing | Replay-derived state is the ref's core claim; this changes what replay does with a row it cannot interpret, and preserves "never rewrite history" by refusing to treat an unknown type as corruption | ref-event-sourcing#n8352@v1:sha256:1ff5f5fcbeeb85e1ccfe24b3e3e63babaec81436d2a50381b8e0b560132fd0aa | comply |
| ref-local-first-data | The failing artifact is a local-first log under the kanna data dir; the decision turns on never destroying that user-owned history (no clearStorage, no STORE_VERSION bump) over an unrecognized row | ref-local-first-data#n9483@v1:sha256:6b71d8a9c2f48d47b9acda0a867f9936d76727141dc2efbbdfead90101e7fd49 | comply |
| ref-colocated-bun-test | The new coverage is the enforcement surface for this decision and must sit beside the source it guards | ref-colocated-bun-test#n9384@v1:sha256:9490f9305f79ff29d492d099b81c1227c5d277e4a16bf251c1779ddc338f4be8 | comply |

## Compliance Rules

| Rule | Why required | Evidence | Action |
| --- | --- | --- | --- |
| rule-colocated-bun-test | Both changed behaviors are covered by tests colocated with their source: event-store-helpers.test.ts pins the unknown-type pricing, event-store-snapshot.test.ts pins that a full replay survives such a row without clearing storage | rule-colocated-bun-test#n9719@v1:sha256:ce58e026c1076cb18ede38f3a4bd73793f28bf1392d299399571ba446985623f | comply |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Add turn_resume_attempted to RETIRED_EVENT_TYPES | Treats the symptom. The type is not retired — it never shipped on main. A hand-maintained allowlist cannot cover types this binary has never seen, which is the whole failure class. |
| Delete the offending rows from the user's turns.jsonl | Edits user history to work around a code defect, leaves the crash-on-unknown behavior in place, and does not survive the next branch switch or downgrade. |
| Bump STORE_VERSION so old logs are discarded | Version mismatch is fail-closed and wipes the user's entire chat history — catastrophically disproportionate to an ignorable row. |
| Wrap the .sort() comparator in try/catch | Hides the diagnostic entirely and leaves a comparator that can throw, which is an unstable sort contract rather than a fixed one. |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| A genuinely missing case is silently skipped instead of loudly failing | The compile-time never assignment still fails the type check when a union member is added without a case; only types outside the union reach the runtime branch | Removing case "turn_started" was confirmed to produce a TS7 error in event-store-helpers.ts |
| Unknown events sort unpredictably and reorder known events | Priced at a single fixed constant (99), above every known bucket, keeping the comparator a total order | event-store-helpers.test.ts asserts the value is finite and identical across different unknown types |
| A drifted log is silently ignored with no operator signal | log.warn names the skipped type on every occurrence | Warning output observed in the test run |

## Verification

| Check | Result |
| --- | --- |
| bun test --conditions production src/server/event-store-helpers.test.ts src/server/event-store-snapshot.test.ts | 66 pass, 0 fail |
| bun run test (full suite) | 4869 pass, 2 skip, 0 fail across 405 files |
| bun run lint | exit 0, no warnings |
| node node_modules/typescript-7/bin/tsc --noEmit -p tsconfig.json | clean |
| Exhaustiveness gate still fires: delete a known case and typecheck | 1 error reported in event-store-helpers.ts; file restored, git diff --stat confirms no residue |
| Boot against the real log that crashed (~/.kanna-dev/data/turns.jsonl, 2 turn_resume_attempted rows) | Server starts and serves; rows warned and skipped |
