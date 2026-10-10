---
id: c3-241
c3-seal: ee8d44fffd05610711466f72911ea76b7b9fb28a727ae2fe3fe5f82d99beb44e
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
| Runtime | Separate binary installed on the user's host and connecting outbound to the Kanna server: Bun-compiled everywhere Bun runs, and a Go 1.20 port in apps/beacon-win7 for Windows 7 and 8.1 |
| Consumers | c3-202 (beacon registry and connection), c3-226 (beacon MCP tools), c3-116 (Beacons settings section) |
| Boundary | Owns the daemon process, its ports, session loop and IO adapters; the wire contract belongs to c3-302 and server-side authorization to c3-202 |

## Purpose

Owns the beacon daemon: pairing client, key and state storage, the authenticated transport, the filesystem and shell adapters that carry out a request only inside the scope the user granted, and the beacon's own update to the server's version from the fixed GitHub release. Non-goals: deciding scope or consent on the server, defining the wire protocol, accepting an update URL, version or binary from the server, and any remote-control capability beyond the granted scope.

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-side-effect-adapter | ref | Every socket, filesystem and subprocess call lives in a dot-adapter file | must follow | ports.ts is the only seam session.ts sees |
| adr-20261008-beacon-companion-daemon | adr | Default-deny scope, signed challenge, one-time consent, unsigned Phase 1 | must follow | Phase 1 binaries are unsigned, so macOS needs a Gatekeeper bypass on first run |
| adr-20261009-beacon-win7-go | adr | The Windows 7 beacon is a Go 1.20 port held to the TypeScript contract by shared conformance fixtures | must follow | A protocol change updates apps/beacon-win7 and its testdata/conformance in the same PR |
| adr-20261010-beacon-self-update | adr | The beacon pulls its own release from the fixed GitHub repository at the server's version, checked against the release checksum file and a version smoke test | must follow | The server never supplies a URL, a version or a binary; update_status goes only to a protocol 4 server |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| Session loop | IN/OUT | Handles server requests through injected ports and answers only within the granted scope | c3-302 | src/beacon/session.ts |
| Ports | OUT | Abstract filesystem, shell, transport, key and state operations so the session is testable without IO | c3-302 | src/beacon/ports.ts |
| Pair client | OUT | Redeems a one-time pairing code against the server and stores the resulting key | c3-202 | src/beacon/pair-client.adapter.ts |
| Desktop app | IN/OUT | Pairs from a kanna-beacon link, edits the grant, records served requests, pauses and unpairs; the view and Electrobun glue only call this service | c3-302 | src/beacon/desktop/desktop-app.ts |
| Runner | IN/OUT | Owns the reconnect loop for the CLI and the desktop app: pause, resume, stop, unpair, typed status snapshots, and the update decision on ready, incompatible or an update frame, ending the run with exit update once the new build is in place | c3-202 | src/beacon/runner.ts |
| Windows 7 beacon | IN/OUT | Go 1.20 port of the CLI plus a Win32 tray, speaking protocol 4 and updating itself against SHA256SUMS-win7 by the same rule as the Bun beacon; its frame, path and signature behaviour is pinned by fixtures both suites assert | c3-302 | apps/beacon-win7/internal/session/session.go |
| File transfer | IN/OUT | Serves the upload and download ops by streaming one file in 8 MiB chunks over HTTP with a bearer ticket, resuming after a 409 and verifying SHA-256 before an atomic rename; bounded by idle time, never by perCallTimeoutMs or outputByteCap | c3-202 | src/beacon/transfer.adapter.ts |
| Self-update | IN/OUT | Installs the handshake serverVersion only when it is newer and in strict release form, from the fixed GitHub release download URL; checks SHA256SUMS and the new binary's version command, waits for in-flight requests, swaps by rename, and restarts through exit code 75 under a self-spawned supervisor; the desktop app uses the Electrobun updater gated on the same version | c3-202 | src/beacon/self-update.adapter.ts |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| src/beacon/main.ts | c3-241 Contract | CLI argument wording | src/beacon/main.ts |
| src/beacon/fs.adapter.ts | c3-241 Contract | Platform path handling | src/beacon/fs.adapter.ts |
| src/beacon/shell.adapter.ts | c3-241 Contract | Platform shell selection | src/beacon/shell.adapter.ts |
| src/beacon/transfer.adapter.ts | c3-241 Contract | Chunk size and retry timing | src/beacon/transfer.adapter.ts |
| src/beacon/self-update.ts | c3-241 Contract | Retry backoff and the release asset table | src/beacon/self-update.ts |
