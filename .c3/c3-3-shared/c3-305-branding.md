---
id: c3-305
c3-version: 4
c3-seal: 6a2fde93f6ad55c885826dd8a4821fdfbbad295839823d2f16d7364b8bf21e14
title: branding
type: component
category: foundation
parent: c3-3
goal: Publish the product name and data-dir constants (kanna, ~/.kanna/data/...).
uses:
    - ref-local-first-data
---

# branding

## Goal

Publish the product name and data-dir constants (kanna, ~/.kanna/data/...).

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-3 (shared) |
| Parent Goal Slice | "Publish app name + data-dir constants used by both containers" |
| Category | foundation |
| Lifecycle | Static constants module |
| Replaceability | Replaceable provided constant names preserved |

## Purpose

Exposes the product name and the data-dir prefix as typed constants imported wherever app-name or `~/.kanna/data` would otherwise be hard-coded. Non-goals: filesystem I/O, theming.

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Precondition | TypeScript strict mode | c3-3 |
| Input — none | Module is self-contained | c3-305 |
| Internal state | None | c3-305 |
| Initialization | Imported by paths, app-shell, branding strings | c3-204 |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Outcome | Renaming the app touches one file | c3-3 |
| Primary path | Consumer imports APP_NAME/DATA_DIR | c3-204 |
| Alternate — UI title | Client reads constant for window title | c3-110 |
| Alternate — env var prefix | CLI uses constant for env-var keys | c3-201 |

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-local-first-data | ref | Anchors the local data path layout | must follow | Single canonical prefix |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| APP_NAME constant | OUT | String used in titles + env keys | c3-110 | src/shared/branding.ts |
| DATA_DIR constant | OUT | Path prefix for paths-config | c3-204 | src/shared/branding.ts |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| Hard-coded literal regression | New consumer hard-codes string | grep finds raw kanna literals | bun run check against src/shared/branding.ts |
| Path migration miss | Constant changed without paths update | Existing data inaccessible | Manual upgrade smoke pairing src/shared/branding.ts and src/server/paths.ts |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| src/shared/branding.ts | c3-305 Contract | Constant detail | src/shared/branding.ts |
