---
id: c3-204
c3-version: 4
c3-seal: c7f4554b449d6f6fe110a42dc0fdd31825e6b2d51bb5de14de36272977934386
title: paths-config
type: component
category: foundation
parent: c3-2
goal: Resolve all filesystem paths (data dir, JSONL logs, snapshots) and machine identity helpers for the server.
uses:
    - ref-local-first-data
---

# paths-config

## Goal

Resolve all filesystem paths (data dir, JSONL logs, snapshots) and machine identity helpers for the server.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-2 (server) |
| Parent Goal Slice | "Centralize filesystem layout under ~/.kanna/data" |
| Category | foundation |
| Lifecycle | Pure module, evaluated on first import |
| Replaceability | Replaceable provided path-resolver function names preserved |

## Purpose

Owns the canonical mapping of data dir, JSONL event logs, snapshot files, settings file, and machine identity helpers; everything else asks paths-config rather than hard-coding strings. Non-goals: I/O, persistence, schema decisions.

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Precondition | OS user home resolvable | c3-204 |
| Input — branding constants | App name + data dir prefix | c3-305 |
| Internal state | None — pure functions | c3-204 |
| Initialization | Imported lazily by consumers | c3-204 |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Outcome | Server reads/writes consistent paths everywhere | c3-2 |
| Primary path | Consumer calls paths.eventsLog(projectId) | c3-206 |
| Alternate — settings file | paths.settings() resolves shared settings json | c3-222 |
| Alternate — uploads dir | paths.uploadsDir() for attachments | c3-217 |

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-local-first-data | ref | All paths under ~/.kanna/data | must follow | No remote storage roots |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| paths.* helpers | OUT | Returns absolute paths within data dir | c3-206 | src/server/paths.ts |
| Machine identity helper | OUT | Stable per-machine id from data dir | c3-218 | src/server/paths.ts |
| resolveSubagentRoots | OUT | Resolves workingDir + allowedPaths against parent cwd via injected realpath fn; rejects absolute paths, tilde, parent-escape (lexical + realpath); returns { cwd, allowedPaths } with canonical absolute roots | c3-210 | src/server/paths.ts |
| paths-fs.adapter realpathAdapter | OUT | Sole node:fs realpath wrapper feeding resolveSubagentRoots; defensive fallback to input on errno | c3-204 | src/server/paths-fs.adapter.ts |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| Path drift | New consumer hard-codes string instead of helper | grep finds raw ~/.kanna/data literals | bun run check + audit src/server/ |
| Layout break on rename | Folder rename without migration | Existing data inaccessible | bun run check against src/server/paths.ts |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| src/server/paths.ts | c3-204 Contract | Path detail | src/server/paths.ts |
