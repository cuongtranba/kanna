---
id: c3-312
c3-seal: ebbfa12fa5de2252ee71c9b50d19ad32e47fb76f96b8b7c9d530e392dc7573ba
title: packages-shared
type: component
category: feature
parent: c3-3
goal: Own the pure package-domain types and parsers used by both the server update manager and the settings UI — lock-file parsing for skills, Claude plugins, and Codex plugins, plus update-availability classification.
uses:
    - ref-side-effect-adapter
    - ref-strong-typing
    - rule-colocated-bun-test
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
| Ownership | The PackageKind union and every lock-file parser; adding a fourth kind starts here |
| Stability | Types cross the server/client boundary, so a shape change is a protocol change |

## Purpose

Houses the canonical types (`PackageKind`, `PackageId`, `InstalledPackage`, `PackageUpdateSnapshot`, etc.) and the parsers that turn raw lock-file JSON into typed domain objects. The parsers are pure functions and live here so they can be unit-tested without spinning up a server. Non-goals: reading or writing lock files, calling any update CLI, performing network requests.

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

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-strong-typing | ref | PackageKind and the parsed update shapes are named types crossing the server/client boundary | must follow | no any/unknown on parser returns |
| ref-side-effect-adapter | ref | This component is pure; every read of a real lock file happens in a c3-237 adapter | must follow | parsers take text, never paths |
| rule-colocated-bun-test | rule | Each parse-*.ts sits next to its .test.ts | wired compliance target | enforced for src/shared/packages/** |
| adr-20260902-package-auto-update | adr | Defines the four kinds and that unknown is distinct from up_to_date | mandatory | a failed check must not read as current |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| PackageKind | OUT | The closed union skill \| claude-plugin \| codex-plugin; a fourth kind is a change here first | c3-237 | src/shared/packages/types.ts |
| UpdateAvailability | OUT | up_to_date \| outdated \| partial \| unknown — unknown means the check FAILED and must not be coerced | c3-116 | src/shared/packages/types.ts |
| Lock-file parsers | OUT | parse-*.ts take file TEXT and return a typed result; they never touch the filesystem | c3-237 | src/shared/packages/ |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| src/shared/packages/types.ts | Contract (PackageKind, UpdateAvailability) | Field naming | src/shared/packages/types.ts |
| src/shared/packages/ parsers | Contract (lock-file parsers) | Upstream file format | src/shared/packages/ |
