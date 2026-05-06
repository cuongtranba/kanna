---
id: c3-216
c3-version: 4
c3-seal: d3905261b855926416d9ff4d67f3fbefa4954daee0fff24140dd4918cd100740
title: terminal-manager
type: component
category: feature
parent: c3-2
goal: Spawn and manage PTY sessions for the embedded xterm terminal; stream I/O over WebSocket.
uses:
    - ref-ws-subscription
---

# terminal-manager

## Goal

Spawn and manage PTY sessions for the embedded xterm terminal; stream I/O over WebSocket.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-2 (server) |
| Parent Goal Slice | "Back the embedded xterm panel with managed PTY sessions" |
| Category | feature |
| Lifecycle | One PTY per active terminal panel; cleaned on disconnect |
| Replaceability | Replaceable provided PTY stream contract preserved |

## Purpose

Spawns PTY child processes via process-utils, streams stdin/stdout over the WS socket, accepts resize/cancel commands, and tears down on disconnect. Non-goals: client-side rendering, scrollback persistence.

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Precondition | OS PTY support available | c3-2 |
| Input — process utils | Spawn + signal helpers | c3-209 |
| Input — ws-router | Routes terminal envelopes | c3-208 |
| Internal state | Map of session id → PTY handle | c3-216 |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Outcome | User runs a shell next to the agent without leaving Kanna | c3-118 |
| Primary path | Open → spawn PTY → stream bytes | c3-208 |
| Alternate — resize | Resize envelope updates rows/cols | c3-118 |
| Alternate — cancel | Disconnect triggers PTY kill | c3-209 |
| Failure — spawn fail | Surface typed error envelope | c3-208 |

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-ws-subscription | ref | Terminal flows over single WS | must follow | No separate connection |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| openPty(opts) | OUT | Returns session id + I/O streams | c3-208 | src/server/terminal-manager.ts |
| Resize handler | IN | Adjusts PTY rows/cols | c3-118 | src/server/terminal-manager.ts |
| Close handler | IN | Kills PTY on disconnect | c3-209 | src/server/terminal-manager.ts |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| PTY leak on disconnect | Cleanup hook skipped | Process count grows | bun run check against src/server/terminal-manager.ts |
| Resize drift | Wrong rows/cols on update | Wrapping artifacts in client | Manual resize smoke pairing client src/client/app/terminalLayoutResize.ts and server src/server/terminal-manager.ts |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| src/server/terminal-manager.ts | c3-216 Contract | PTY detail | src/server/terminal-manager.ts |
