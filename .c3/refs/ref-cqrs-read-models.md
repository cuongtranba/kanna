---
id: ref-cqrs-read-models
c3-version: 4
c3-seal: 66e35556e038b69c2420a105b1b007f7779dccbceb5f14443e6abba157ae02c0
title: CQRS Read Models
type: ref
goal: Separate write path (event log) from read path (derived views) so subscribers consume fast snapshots without replaying the log.
---

# cqrs-read-models

## Goal

Separate write path (event log) from read path (derived views) so subscribers consume fast snapshots without replaying the log.

## Choice

read-models.ts projects events into sidebar / chat / project views; ws-router broadcasts those views to subscribers on every state change.

## Why

Keeps UI render paths off the log; allows per-view memoization; lets derived shapes evolve without touching event schema.

## How

| Guideline | Example |
| --- | --- |
| One read model per UI concern | sidebarView, chatView, projectsView |
| Pure projections — no I/O from derivation | read-models.ts functions are deterministic |
| Broadcast diffs on change, not on request | ws-router pushes on event append |

## Not This

| Alternative | Rejected Because |
| --- | --- |
| ... | ... |

## Scope

**Applies to:**

- <!-- containers/components where this ref governs behavior -->

**Does NOT apply to:**

- <!-- explicit exclusions -->

## Override

To override this ref:

1. Document justification in an ADR under "Pattern Overrides"
2. Cite this ref and explain why the override is necessary
3. Specify the scope of the override (which components deviate)

## Cited By

- c3-{N}{NN} ({component name})
