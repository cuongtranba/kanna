---
id: ref-tool-hydration
c3-version: 4
c3-seal: d55e81af5f34870fd9065aaca26c98695602b83763729a8f111b95efc72a577c
title: Tool Call Hydration
type: ref
goal: Provider tool calls (Read, Edit, Bash, plan, diff, ...) are normalized into unified transcript entries by src/shared/tools.ts before rendering.
---

# tool-hydration

## Goal

Provider tool calls (Read, Edit, Bash, plan, diff, ...) are normalized into unified transcript entries by src/shared/tools.ts before rendering.

## Choice

One hydration function per tool kind in shared/tools.ts; messages-renderer selects renderer by kind; agent-coordinator emits normalized entries before persisting.

## Why

Renderers stay simple and exhaustive; adding a tool is one shared normalization + one UI renderer; provider-agnostic by construction.

## How

| Guideline | Example |
| --- | --- |
| Hydration never throws — unknown tools map to generic entry | fallback branch in tools.ts |
| No provider branching in renderers | messages-renderer dispatches on kind only |
| Icons/labels live with hydration, not renderer | keeps hydration self-contained |

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
