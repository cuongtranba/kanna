---
id: c3-220
c3-version: 4
c3-seal: d7e8358ab38406ef3cf67251e7ce228803282cd6b2a39a209789200afd9b8324
title: restart
type: component
category: feature
parent: c3-2
goal: Implement in-place server restart (self-relaunch) after version updates or CLI flag changes.
uses:
    - ref-ws-subscription
---

## Goal

Implement in-place server restart (self-relaunch) after version updates or CLI flag changes.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-2 (server) |
| Parent Goal Slice | "Self-relaunch the server cleanly after upgrades and flag edits" |
| Category | feature |
| Lifecycle | Stateless command handler |
| Replaceability | Replaceable provided restart command + exit-code contract preserved |

## Purpose

Coordinates the server-side relaunch: drains in-flight work, emits a restart-pending event, exits with the supervisor-recognized exit code so the CLI can spawn a fresh process. Non-goals: update detection, version selection — those live in c3-219. The drain is bounded: `shutdown()` in `server.ts` races all active-turn cancels against `KANNA_SHUTDOWN_GRACE_MS` (default 4 s, < pm2 `kill_timeout` 5 s); `cli.ts` wraps `result.stop()` in a `KANNA_SHUTDOWN_GRACE_MS + 1 s` backstop. Turns not drained within grace are recovered by c3-233 (turn-recovery) on the next boot.

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Precondition | CLI is supervising the server | c3-201 |
| Input — bounded drain | Promise.race(cancel-all, KANNA_SHUTDOWN_GRACE_MS deadline) in server.ts shutdown() | N.A - internal implementation in src/server/server.ts |
| Input — read-models | Emits restart-pending projection | c3-207 |
| Initialization | Bound to ws-router on boot | c3-208 |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Outcome | Users upgrade without manual kill/restart | c3-2 |
| Primary path | Command → drain → emit projection → exit 76 | c3-201 |
| Alternate — flag change | Settings edit triggers restart | c3-222 |
| Failure — drain timeout | Promise.race exceeds KANNA_SHUTDOWN_GRACE_MS; best-effort snapshot then exit; dangling turns recovered on next boot by c3-233 | c3-233 |

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-ws-subscription | ref | Restart state pushed via WS | must follow | Clients observe state |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| restart command handler | IN | Triggers drain + exit-76 | c3-208 | src/server/restart.ts |
| Restart-pending projection | OUT | Surfaces state to clients | c3-207 | src/server/restart.ts |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| Drain skipped | KANNA_SHUTDOWN_GRACE_MS set to 0 or Promise.race removed | In-flight requests dropped and no resume on next boot | bun run check against src/server/server.ts |
| Exit code drift | Code changed without CLI update | CLI fails to relaunch | Manual restart smoke pairing src/server/restart.ts and src/server/cli.ts |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| src/server/restart.ts | c3-220 Contract | Drain detail | src/server/restart.ts |
