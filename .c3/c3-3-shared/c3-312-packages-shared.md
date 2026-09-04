---
id: c3-312
c3-seal: 7427f6b3ed44411daec95349371530860f877a682727ca1cc6c0790a6ae273a7
title: packages-shared
type: component
category: feature
parent: c3-3
goal: Own the pure package-domain types and parsers used by both the server update manager and the settings UI — lock-file parsing for skills, Claude plugins, and Codex plugins, plus update-availability classification.
uses:
    - rule-colocated-bun-test
    - rule-strong-typing
---

# packages-shared

## Goal

Own the pure package-domain types and parsers used by both the server update manager and the settings UI — lock-file parsing for skills, Claude plugins, and Codex plugins, plus update-availability classification.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-3 Shared |
| Runtime | Pure; no IO, no side effects. Used at parse boundaries in IO adapters. |
| Consumers | c3-237 (server update manager adapters), c3-116 (settings UI types) |
| Boundary | Types and pure parsers only; reading a lock file, calling an update CLI, and every network request belong to c3-237's adapters |

## Purpose

Houses the canonical types (`PackageKind`, `PackageId`, `InstalledPackage`, `PackageUpdateSnapshot`, etc.) and the parsers that turn raw lock-file JSON into typed domain objects. The parsers are pure functions and live here so they can be unit-tested without spinning up a server. Non-goals: reading or writing lock files, calling any update CLI, performing network requests.

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| rule-strong-typing | rule | Lock-file JSON is decoded through these parsers, never cast at the call site | must follow | A lock file is written by another tool and outlives the shape Kanna expected |
| rule-colocated-bun-test | rule | Every parser has a colocated *.test.ts | must follow | The parsers are pure so they need no server to test |
| adr-20260902-package-auto-update | adr | UpdateAvailability's four values, and that unknown is not up_to_date | must follow | The classification lives here; c3-237 consumes it |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| Package domain types | OUT | PackageKind, PackageId, InstalledPackage, UpdateAvailability, PackageUpdateSnapshot — one definition, imported by both server and client | c3-3 | src/shared/packages/types.ts |
| Lock-file parsers | IN/OUT | Raw JSON in, typed domain object out; a malformed file yields nothing rather than a partly-built object | c3-3 | src/shared/packages/parse-skill-lock.ts |
| skill-update-classifier | OUT | Lock hash versus upstream tree sha becomes an UpdateAvailability; a check that could not answer yields unknown, never up_to_date | c3-3 | src/shared/packages/skill-update-classifier.ts |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| src/server/package-inventory-io.adapter.ts | c3-312 Contract | File reading and path resolution | src/server/package-inventory-io.adapter.ts |
| src/server/package-update-manager.ts | c3-312 Contract | Scheduling and apply policy | src/server/package-update-manager.ts |
| src/client/app/PluginsSection.tsx | c3-312 Contract | Layout and copy | src/client/app/PluginsSection.tsx |

## Files

| File | Role |
| --- | --- |
| src/shared/packages/types.ts | Canonical type definitions for all package-domain shapes |
| src/shared/packages/parse-skill-lock.ts | Parses ~/.agents/.skill-lock.json |
| src/shared/packages/parse-skill-lock.test.ts | Colocated tests |
| src/shared/packages/parse-claude-plugins.ts | Parses installed_plugins.json |
| src/shared/packages/parse-claude-plugins.test.ts | Colocated tests |
| src/shared/packages/parse-claude-plugin-marketplace.ts | Parses known_marketplaces.json for source URLs |
| src/shared/packages/parse-claude-plugin-marketplace.test.ts | Colocated tests |
| src/shared/packages/parse-codex-plugins.ts | Parses ~/.codex/skills/ directory listing |
| src/shared/packages/parse-codex-plugins.test.ts | Colocated tests |
| src/shared/packages/skill-update-classifier.ts | Classifies skill update availability from lock hash vs tree sha |
| src/shared/packages/skill-update-classifier.test.ts | Colocated tests |

## Key Types

`PackageKind = "skill" | "claude-plugin" | "codex-plugin"` — the three managed package kinds. No dynamic extension; adding a fourth requires a union change here and new checker/applier adapters in c3-237.

`UpdateAvailability = "up_to_date" | "outdated" | "partial" | "unknown"` — `unknown` means the check failed (network error, rate-limit). It is NOT equivalent to `up_to_date`. Callers must render it distinctly.

`PackageId = string` — format `"${kind}:${name}"`. Opaque string; do not parse it outside this module.
