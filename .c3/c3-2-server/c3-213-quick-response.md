---
id: c3-213
c3-version: 4
c3-seal: 53f98bb17164654664f4e35f347ebd9a90d61bd3a16f0e3a9fb3dc7feb451f37
title: quick-response
type: component
category: feature
parent: c3-2
goal: Execute lightweight structured queries (titles, commit messages) via Claude Haiku with Codex fallback.
uses:
    - ref-provider-adapter
---

# quick-response

## Goal

Execute lightweight structured queries (titles, commit messages) via Claude Haiku with Codex fallback.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-2 (server) |
| Parent Goal Slice | "Run cheap helper queries (titles, commit messages) without involving the full coordinator" |
| Category | feature |
| Lifecycle | Stateless module invoked per helper request |
| Replaceability | Replaceable provided JSON-shape input/output contract preserved |

## Purpose

Performs short structured-output LLM calls (chat title generation, commit message synthesis) using Claude Haiku, falling back to Codex when Claude fails. Non-goals: agent turn lifecycle, persistence, transcript events.

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Precondition | Provider catalog loaded | c3-212 |
| Input — Codex fallback | Codex App Server reused | c3-211 |
| Input — diff store | Reads diff snapshot for commit synthesis | c3-215 |
| Internal state | Stateless | c3-213 |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Outcome | UI gets fast titles/commits without spinning a full turn | c3-208 |
| Primary path | Helper request → Haiku call → typed JSON | c3-208 |
| Alternate — fallback | Haiku error → Codex with the same schema | c3-211 |
| Failure — both fail | Surface typed error to caller | c3-208 |

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-provider-adapter | ref | Fallback honors adapter contract | must follow | No bespoke per-provider shapes |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| generateTitle(input) | OUT | Returns typed title string | c3-208 | src/server/quick-response.ts |
| generateCommit(diffRef) | OUT | Returns typed commit message + summary | c3-215 | src/server/quick-response.ts |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| Fallback regression | Codex path skipped on Haiku error | UI shows unhandled failures | bun run check against src/server/quick-response.ts |
| Schema drift | JSON shape change without consumer update | Decode errors at runtime | bun run check plus replay JSON fixtures from src/server/quick-response.ts |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| src/server/quick-response.ts | c3-213 Contract | Helper detail | src/server/quick-response.ts |
