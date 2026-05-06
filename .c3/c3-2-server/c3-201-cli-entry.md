---
id: c3-201
c3-version: 4
c3-seal: a4286636bc6eb380d95060bd342c3b6d3262fadafea1da8e1968d990ca6df387
title: cli-entry
type: component
category: foundation
parent: c3-2
goal: Parse CLI flags, supervise the Bun server process, pick dev/prod runtime mode, and open the browser.
uses:
    - ref-local-first-data
---

# cli-entry

## Goal

Parse CLI flags, supervise the Bun server process, pick dev/prod runtime mode, and open the browser.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-2 (server) |
| Parent Goal Slice | "Boot the local Bun server, supervise children, pick dev/prod mode" |
| Category | foundation |
| Lifecycle | Process entry — runs once per server boot |
| Replaceability | Replaceable provided same flag surface and supervisor contract preserved |

## Purpose

Parses argv, resolves runtime mode (dev/prod), supervises the Bun server child, opens the default browser, and wires `--share` into the tunnel manager. Non-goals: HTTP routing, agent execution, persistent state — those live in c3-202 and downstream.

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Precondition | Bun runtime available on PATH | c3-201 |
| Input — paths | Resolved via shared paths-config | c3-204 |
| Input — port defaults | Shared port constants | c3-304 |
| Input — process helpers | Spawn/signal helpers | c3-209 |
| Initialization | Invoked by bun run kanna entry | c3-201 |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Outcome | User runs one command and gets a working app + browser tab | c3-2 |
| Primary path | Parse flags → spawn server child → open browser | c3-202 |
| Alternate — share | --share triggers tunnel manager | c3-218 |
| Alternate — restart | Exit code 76 triggers self-relaunch | c3-220 |
| Failure — port in use | Surface error and exit non-zero | c3-304 |

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-local-first-data | ref | Defaults to localhost; --remote/--share are explicit opt-ins | must follow | No wider bind without flag |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| kanna CLI | IN | Accepts documented flags (--port, --share, --password, ...) | c3-2 | src/server/cli.ts |
| Spawned server child | OUT | Inherits stdio; restarts on exit code 76 | c3-202 | src/server/cli.ts |
| Tunnel hookup | OUT | Forwards public URL to share manager | c3-218 | src/server/cli.ts |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| Flag parsing regression | New flag added without parser update | Wrong defaults at boot | bun run check + manual kanna --help smoke against src/server/cli.ts |
| Restart loop | Bad exit-code handling | Process restarts forever | bun run check + manual restart smoke against src/server/cli.ts |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| src/server/cli.ts | c3-201 Contract | Flag impl details | src/server/cli.ts |
