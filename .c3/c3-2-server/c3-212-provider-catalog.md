---
id: c3-212
c3-version: 4
c3-seal: d03adc55365c80a728f70050664d85ab40701eceb874119fdadd8981b4f87cb8
title: provider-catalog
type: component
category: feature
parent: c3-2
goal: Normalize providers, models, reasoning effort levels, and Codex fast-mode flags into a single catalog.
uses:
    - ref-provider-adapter
---

# provider-catalog

## Goal

Normalize providers, models, reasoning effort levels, and Codex fast-mode flags into a single catalog.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-2 (server) |
| Parent Goal Slice | "Expose a single normalized provider/model catalog server-side" |
| Category | feature |
| Lifecycle | Static module, evaluated on import |
| Replaceability | Replaceable provided typed catalog shape preserved |

## Purpose

Holds the typed catalog of providers, models, reasoning effort levels, and provider-specific flags. Downstream code (coordinator, quick-response, client picker) reads from one place. Non-goals: actual model invocation, transport.

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Precondition | Shared types defined | c3-301 |
| Input — adapter conventions | Catalog shape derives from adapter | c3-210 |
| Internal state | Static export | c3-212 |
| Initialization | Imported at first lookup | c3-210 |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Outcome | Coordinator and UI agree on provider/model identity | c3-115 |
| Primary path | Lookup by id → returns typed entry | c3-210 |
| Alternate — quick-response | Reads catalog to select Haiku/Codex fallback | c3-213 |
| Alternate — UI picker | Re-exported catalog types feed picker | c3-301 |

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-provider-adapter | ref | Catalog is adapter vocabulary | must follow | All providers conform |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| catalog export | OUT | Typed list of providers + models | c3-210 | src/server/provider-catalog.ts |
| Catalog types | OUT | Re-exported to client picker | c3-301 | src/server/provider-catalog.ts |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| Picker desync | Catalog entry added without client release | UI shows wrong options | bun run check against src/server/provider-catalog.ts |
| Type drift | Effort enum widened without consumers | tsc fails downstream | bun run check plus grep src/client/ for stale enum branches |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| src/server/provider-catalog.ts | c3-212 Contract | Catalog detail | src/server/provider-catalog.ts |
