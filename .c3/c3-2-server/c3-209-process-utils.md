---
id: c3-209
c3-version: 4
c3-seal: b918e5a6cebad774726da49a15a584b6d85b22b13fbd464ff22562afee7b1930
title: process-utils
type: component
category: foundation
parent: c3-2
goal: Provide helpers for spawning, signaling, and tearing down child processes (agents, terminals, tunnels).
uses:
    - ref-strong-typing
    - rule-strong-typing
---

## Goal

Provide helpers for spawning, signaling, and tearing down child processes (agents, terminals, tunnels).

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-2 (server) |
| Parent Goal Slice | "Manage child-process lifecycles uniformly across features" |
| Category | foundation |
| Lifecycle | Pure helper module |
| Replaceability | Replaceable provided spawn/signal helper signatures preserved |

## Purpose

Wraps Bun's child-process APIs into typed helpers (spawn, signal, kill, drain stdio) that features call rather than reinventing process lifecycle logic. Non-goals: domain-specific process orchestration — that belongs to feature components. Bounded shutdown drain (SIGTERM grace → SIGKILL) is implemented directly in `server.ts`/`cli.ts`, not as a process-utils helper.

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Precondition | Bun runtime spawn API available | c3-2 |
| Input — typed handles | Reused across spawners | c3-301 |
| Internal state | None — helpers manage state per call | c3-209 |
| Initialization | Imported lazily by feature modules | c3-210 |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Outcome | Features dispose child processes cleanly | c3-2 |
| Primary path | Caller spawns → drains stdio → awaits exit | c3-216 |
| Alternate — signal | Caller signals SIGTERM → grace timeout → SIGKILL | c3-220 |
| Alternate — supervisor | CLI uses helpers to relaunch server | c3-201 |

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-strong-typing | ref | Typed child-process handles | must follow | No any for spawn options |
| rule-strong-typing | rule | Compliance target added by c3x wire; refine what must be reviewed or complied with before handoff. | wired compliance target beats uncited local prose | Added by c3x wire for explicit compliance review. |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| spawn(opts) | OUT | Returns typed child handle | c3-216 | src/server/process-utils.adapter.ts |
| N.A - signalAndWait removed | N.A - surface no longer exists | N.A - bounded drain is now Promise.race in server.ts; no helper exported | N.A - removed surface | src/server/server.ts |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| Zombie process leak | Helper skips wait on exit | Process count grows over session | bun run check against src/server/process-utils.adapter.ts |
| Signal escalation regression | Timeout edit | Stuck on shutdown | Manual SIGTERM smoke + grep src/server/ for stuck process patterns |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| src/server/process-utils.adapter.ts | c3-209 Contract | Helper detail | src/server/process-utils.adapter.ts |
