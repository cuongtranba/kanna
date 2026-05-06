---
id: c3-221
c3-version: 4
c3-seal: 1c6f78bcd3646c0041d0d4dc9257c0a71dd2679704aa5b287dbd75fab18fc390
title: external-open
type: component
category: feature
parent: c3-2
goal: Open URLs, files, and VS Code / editor links in the user's external apps.
uses:
    - ref-local-first-data
---

# external-open

## Goal

Open URLs, files, and VS Code / editor links in the user's external apps.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-2 (server) |
| Parent Goal Slice | "Bridge in-app links to the host OS without leaking remote endpoints" |
| Category | feature |
| Lifecycle | Stateless command handler bound at boot |
| Replaceability | Replaceable provided open command + URL allowlist contract preserved |

## Purpose

Routes UI requests to open URLs/files/VS Code links to the host OS via platform-specific helpers. Non-goals: file content access, remote URL forwarding.

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Precondition | Local-only execution context | c3-2 |
| Input — paths | Validates file paths against data dir | c3-204 |
| Internal state | Stateless | c3-221 |
| Initialization | Registered on ws-router boot | c3-208 |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Outcome | Users follow links/files without leaving Kanna | c3-101 |
| Primary path | UI command → spawn open helper | c3-208 |
| Alternate — VS Code | Detects VS Code link → invokes code CLI | c3-221 |
| Failure — disallowed scheme | Reject with typed error | c3-208 |

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-local-first-data | ref | Dispatches to local host only | must follow | No remote forwarding |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| open command handler | IN | Accepts typed URL/file payload | c3-208 | src/server/external-open.ts |
| OS dispatcher | OUT | Spawns platform open binary | c3-209 | src/server/external-open.ts |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| Open injection | Payload validation skipped | Arbitrary command runs on host | bun run check against src/server/external-open.ts |
| Platform fallback drift | New OS path not handled | Open fails silently | Manual macOS+Linux smoke against src/server/external-open.ts |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| src/server/external-open.ts | c3-221 Contract | Helper detail | src/server/external-open.ts |
