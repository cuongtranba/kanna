---
id: c3-215
c3-version: 4
c3-seal: 5fc35c53fbad01f497a90133bbcd4620e19b7d5c82a2c7e121554e3862d48fcc
title: diff-store
type: component
category: feature
parent: c3-2
goal: Maintain per-chat diff state for hydrated write_file/delete_file tool rendering and commit scaffolding.
uses:
    - ref-tool-hydration
---

# diff-store

## Goal

Maintain per-chat diff state for hydrated write_file/delete_file tool rendering and commit scaffolding.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-2 (server) |
| Parent Goal Slice | "Track per-chat diffs for hydrated tool rendering and commit synthesis" |
| Category | feature |
| Lifecycle | Per-chat diff state, rebuilt from event log on boot |
| Replaceability | Replaceable provided diff snapshot contract preserved |

## Purpose

Maintains a per-chat map of file paths → cumulative diff state, hydrated from write_file/delete_file tool entries. Powers diff rendering and commit message synthesis. Non-goals: tool dispatch, transcript persistence — those live in c3-210.

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Precondition | Tool hydration available | c3-303 |
| Input — paths | Resolves file paths within data dir | c3-204 |
| Input — tool events | Reads write_file/delete_file entries | c3-205 |
| Internal state | Per-chat diff map | c3-215 |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Outcome | UI renders full file diffs without replaying tool history | c3-114 |
| Primary path | Tool hydrated → diff updated → projection pushed | c3-207 |
| Alternate — commit | Quick-response reads diff snapshot to draft commit | c3-213 |
| Alternate — boot replay | Rebuilds diffs from event log | c3-206 |

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-tool-hydration | ref | Diff updates flow through hydration | must follow | One pipeline for tool entries |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| diffsForChat(chatId) | OUT | Returns typed diff snapshot | c3-207 | src/server/diff-store.ts |
| Hydrate hook | IN | Tool hydration writes into store | c3-303 | src/server/diff-store.ts |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| Stale diff after delete | Delete handler skipped | UI shows file that no longer exists | bun run check against src/server/diff-store.ts |
| Boot replay drift | Replay path differs from runtime path | Diffs differ after restart | Replay smoke from src/server/event-store.ts + boot snapshot diff |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| src/server/diff-store.ts | c3-215 Contract | Diff impl detail | src/server/diff-store.ts |
