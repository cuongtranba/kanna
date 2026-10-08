---
id: c3-241
c3-seal: b2151f6e1d633db86364a02546b136eb9086c537adf8e4b8f860d28df8c6253f
title: beacon-daemon
type: component
category: feature
parent: c3-2
goal: Run a user-authorized companion daemon on the user's own machine that dials out to Kanna and executes scoped file and shell requests.
uses:
    - ref-side-effect-adapter
---

## Goal

Run a user-authorized companion daemon on the user's own machine that dials out to Kanna and executes scoped file and shell requests.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-2 Server |
| Runtime | Separate Bun-compiled binary installed on the user's host; connects outbound to the Kanna server |
| Consumers | c3-202 (beacon registry and connection), c3-226 (beacon MCP tools), c3-116 (Beacons settings section) |
| Boundary | Owns the daemon process, its ports, session loop and IO adapters; the wire contract belongs to c3-302 and server-side authorization to c3-202 |

## Purpose

Owns the beacon daemon: pairing client, key and state storage, the authenticated transport, and the filesystem and shell adapters that carry out a request only inside the scope the user granted. Non-goals: deciding scope or consent on the server, defining the wire protocol, and any remote-control capability beyond the granted scope.

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-side-effect-adapter | ref | Every socket, filesystem and subprocess call lives in a dot-adapter file | must follow | ports.ts is the only seam session.ts sees |
| adr-20261008-beacon-companion-daemon | adr | Default-deny scope, signed challenge, one-time consent, unsigned Phase 1 | must follow | Phase 1 binaries are unsigned, so macOS needs a Gatekeeper bypass on first run |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| Session loop | IN/OUT | Handles server requests through injected ports and answers only within the granted scope | c3-302 | src/beacon/session.ts |
| Ports | OUT | Abstract filesystem, shell, transport, key and state operations so the session is testable without IO | c3-302 | src/beacon/ports.ts |
| Pair client | OUT | Redeems a one-time pairing code against the server and stores the resulting key | c3-202 | src/beacon/pair-client.adapter.ts |
| Desktop app | IN/OUT | Pairs from a kanna-beacon link, edits the grant, records served requests, pauses and unpairs; the view and Electrobun glue only call this service | c3-302 | src/beacon/desktop/desktop-app.ts |
| Runner | IN/OUT | Owns the reconnect loop for the CLI and the desktop app: pause, resume, stop, unpair, and typed status snapshots | c3-202 | src/beacon/runner.ts |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| src/beacon/main.ts | c3-241 Contract | CLI argument wording | src/beacon/main.ts |
| src/beacon/fs.adapter.ts | c3-241 Contract | Platform path handling | src/beacon/fs.adapter.ts |
| src/beacon/shell.adapter.ts | c3-241 Contract | Platform shell selection | src/beacon/shell.adapter.ts |
