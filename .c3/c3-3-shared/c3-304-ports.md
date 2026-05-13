---
id: c3-304
c3-version: 4
c3-seal: 867cf0e9907bec39192aeeaa7cecb62eca2c4a1148adb04b12a3616127febdcd
title: ports
type: component
category: foundation
parent: c3-3
goal: Centralize default ports and dev-mode port offsets (Vite client + Bun backend).
uses:
    - ref-strong-typing
    - rule-strong-typing
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
| rule-strong-typing | rule | Compliance target added by c3x wire; refine what must be reviewed or complied with before handoff. | wired compliance target beats uncited local prose | Added by c3x wire for explicit compliance review. |

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
