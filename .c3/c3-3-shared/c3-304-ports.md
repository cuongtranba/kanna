---
id: c3-304
c3-version: 4
c3-seal: 7f5e25d35669e8a640b98118303d5f17e067c1165098c223e40eeffbd2acbb83
title: ports
type: component
category: foundation
parent: c3-3
goal: Centralize default ports and dev-mode port offsets (Vite client + Bun backend).
uses:
    - ref-strong-typing
---

# ports

## Goal

Centralize default ports and dev-mode port offsets (Vite client + Bun backend).

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-3 (shared) |
| Parent Goal Slice | "Centralize default ports and dev-mode offsets used by client + server" |
| Category | foundation |
| Lifecycle | Static constants module |
| Replaceability | Replaceable provided constant names preserved |

## Purpose

Exports the canonical default ports and dev-mode offsets used by the CLI, Bun server, and Vite client. Non-goals: socket transport, runtime port discovery.

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Precondition | TypeScript strict mode | c3-3 |
| Input — branding constants | App name used in env var keys | c3-305 |
| Internal state | None | c3-304 |
| Initialization | Imported by CLI/server/client on demand | c3-201 |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Outcome | CLI, server, client agree on port defaults | c3-2 |
| Primary path | Consumer reads DEFAULT_PORT/DEV_OFFSET | c3-201 |
| Alternate — env override | Consumer respects KANNA_PORT env when set | c3-202 |
| Alternate — dev | Vite reads dev offset for hot reload | c3-101 |

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-strong-typing | ref | Typed numeric constants | must follow | No magic literals |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| Port constants | OUT | Default port + dev offset exports | c3-202 | src/shared/ports.ts |
| Dev URL helper | OUT | Returns ws/http URL for dev consumers | c3-101 | src/shared/ports.ts |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| Drift between client + server | Constant edit on one side only | dev hot-reload fails | bun run check against src/shared/ports.ts |
| Dev offset collision | Offset changed without doc update | Two services compete for port | Manual bun run dev smoke + grep vite.config.ts for port wiring |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| src/shared/ports.ts | c3-304 Contract | Port detail | src/shared/ports.ts |
