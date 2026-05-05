---
id: ref-strong-typing
c3-version: 4
c3-seal: 59a714df85f6e12a0975f6b69f001467c0f9f5736c9c84a7383176f4e1df0cf9
title: Strong Typing Policy
type: ref
goal: No any / untyped shapes at boundaries — everything that crosses client↔server, provider↔coordinator, or log↔read-model is a named type in src/shared or the owning module.
---

# strong-typing

## Goal

No any / untyped shapes at boundaries — everything that crosses client↔server, provider↔coordinator, or log↔read-model is a named type in src/shared or the owning module.

## Choice

TypeScript strict mode; shared types in src/shared/types.ts; protocol envelopes in src/shared/protocol.ts; events in src/server/events.ts.

## Why

Refactors stay safe, tool hydration logic can exhaustively switch on kinds, and client/server drift is caught at build time (bun run check).

## How

| Guideline | Example |
| --- | --- |
| Discriminated unions over flags | TranscriptEntry kinds |
| Shared types win over local duplicates | import from shared/types.ts |
| bun run check must stay green | tsc --noEmit + vite build |

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
