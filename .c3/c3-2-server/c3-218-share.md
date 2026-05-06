---
id: c3-218
c3-version: 4
c3-seal: 2aafc9716cc4797e44fc41ce68e55c3d4f547f40e04f33aac60a1799841d5c9d
title: share
type: component
category: feature
parent: c3-2
goal: Create public trycloudflare URLs or named Cloudflare tunnels and emit terminal QR output.
uses:
    - ref-local-first-data
---

# share

## Goal

Create public trycloudflare URLs or named Cloudflare tunnels and emit terminal QR output.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-2 (server) |
| Parent Goal Slice | "Provide opt-in --share remote access via Cloudflare tunnels" |
| Category | feature |
| Lifecycle | Spawned only when --share is set; cleaned on shutdown |
| Replaceability | Replaceable provided tunnel URL + QR output contract preserved |

## Purpose

Spawns `cloudflared` to obtain a public URL, prints the QR code in the terminal, and exposes the URL to the CLI banner. Non-goals: in-chat tunnel detection (lives in c3-223), per-port tunnels.

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Precondition | --share flag set; cloudflared installed | c3-201 |
| Input — process utils | Spawn + signal cloudflared | c3-209 |
| Input — share types | Public URL + QR payload shape | c3-306 |
| Internal state | One tunnel handle per server | c3-218 |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Outcome | Remote users open the local Kanna over a tunnel | c3-2 |
| Primary path | Spawn cloudflared → parse URL → print QR | c3-201 |
| Alternate — named tunnel | Reads named-tunnel config from settings | c3-222 |
| Alternate — stop | Server shutdown signals tunnel kill | c3-209 |
| Failure — cloudflared missing | Surface helpful error and continue local-only | c3-201 |

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-local-first-data | ref | Only runs on explicit opt-in | must follow | No tunnel without --share |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| startTunnel(opts) | OUT | Returns public URL + QR payload | c3-201 | src/server/share.ts |
| Stop hook | IN | Tears down cloudflared on shutdown | c3-209 | src/server/share.ts |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| Tunnel leak on shutdown | Stop hook skipped | cloudflared lingers after exit | bun run check against src/server/share.ts |
| URL parse regression | cloudflared output format change | Empty URL surfaced to UI | Manual cloudflared smoke + grep src/server/share.ts for URL parser |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| src/server/share.ts | c3-218 Contract | Tunnel impl detail | src/server/share.ts |
