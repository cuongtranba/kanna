---
title: Architecture (C3)
description: How Kanna's component documentation works.
---

Kanna uses C3 component docs at `.c3/`.

## Before coding

Run `/c3 query <topic>` (or `c3x lookup <file>`) to load component context, refs, and rules. **Do not skip this** — even for small edits. Skipping leads to stale assumptions and wrong patches.

## After coding

If a change touches component boundaries, refs, public contracts, or rules, run `/c3 change` (or `/c3 sweep` for audit) to update `.c3/` docs in the same PR. Code-doc drift is a blocker.

## Operations

| Op | Purpose |
|---|---|
| `query` | Look up component context, refs, rules for a topic |
| `audit` | Check a component against its docs |
| `change` | Update docs after a code change |
| `ref` | Add or fix a ref between components |
| `sweep` | Bulk audit across all components |

## File lookup

`c3x lookup <file-or-glob>` maps files/directories to components + refs.

## Skill

`c3-skill:c3` auto-triggers on `/c3` or architecture phrases.
