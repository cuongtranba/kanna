---
id: ref-local-first-data
c3-version: 4
c3-seal: 6e3466e18f6f49b68ab8464d46a5e0f577a05f4c01131f4aaef6c690a52ffb1e
title: Local-First Data
type: ref
goal: All persistent state sits under ~/.kanna/data; the server binds to 127.0.0.1 by default and only exposes wider surfaces (LAN, tunnel) when the user opts in.
---

# local-first-data

## Goal

All persistent state sits under ~/.kanna/data; the server binds to 127.0.0.1 by default and only exposes wider surfaces (LAN, tunnel) when the user opts in.

## Choice

paths.ts centralizes data paths; cli.ts defaults to localhost; --host / --remote / --share are explicit opt-ins; --password gates all surfaces when set.

## Why

Zero cloud lock-in, zero hosting cost, user owns data on their disk, safe default for a developer tool.

## How

| Guideline | Example |
| --- | --- |
| All file paths flow through paths.ts | projects.jsonl, snapshot.json |
| Bind only what user asked for | default 127.0.0.1, --remote for 0.0.0.0 |
| Authenticated surfaces == all surfaces when --password set | API, /health, /ws |

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
