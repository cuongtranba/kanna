---
id: c3-312
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
