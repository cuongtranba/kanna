---
id: adr-20261008-beacon-desktop-app
c3-seal: 236387f3b96957a8ae251115f78995e1c601c74b9b1f25ae797446c29bf19b6b
title: beacon-desktop-app
type: adr
goal: Ship a Kanna Beacon desktop app (Electrobun 2, Bun main process) so a non-technical owner pairs, scopes, pauses and unpairs a beacon from a window and tray instead of the CLI, and extend the beacon wire protocol to version 2 so the machine can set its own scope and Kanna pushes scope changes to a connected beacon.
status: accepted
date: "2026-10-08"
---

## Goal

Ship a Kanna Beacon desktop app (Electrobun 2, Bun main process) so a non-technical owner pairs, scopes, pauses and unpairs a beacon from a window and tray instead of the CLI, and extend the beacon wire protocol to version 2 so the machine can set its own scope and Kanna pushes scope changes to a connected beacon.

## Context

The Phase 1 beacon (c3-241) was CLI-only. On Windows, double-clicking kanna-beacon-windows-x64.exe printed usage and exited, so the console closed instantly and users read it as a crash. Scope (folders, exec, auto-run consent) could only be edited in Kanna Settings, and a connected beacon learned its scope only from the ready frame, so a Settings edit did not reach it until it reconnected. The installer and tray spec (docs/superpowers/specs/2026-10-08-beacon-installer-tray-design.md) chose Electrobun with a Bun main process; Electrobun 2 builds only for the host OS, registers URL schemes only on macOS, and its Windows launcher forwards no argv to the main process.

## Decision

Keep one beacon implementation. The reconnect loop moves out of the CLI into src/beacon/runner.ts (pause, resume, stop, unpair, status snapshots), shared by the CLI and the app. The app's orchestration lives in src/beacon/desktop/desktop-app.ts behind injected ports and is tested without Electrobun; apps/beacon-desktop holds only Electrobun glue (window, tray, RPC). Protocol 2 adds refused, scope, set-scope and unpair frames; the ready frame carries the server protocolVersion and a beacon sends set-scope or unpair only to a server at SCOPE_SYNC_PROTOCOL or later, so old servers and old beacons keep working. The server validates a scope change with applyScopeChange (absolute folders, at most 64), persists it through settings, and one settings onChange listener pushes the stored scope to every connected protocol-2 beacon, deduped per connection. Pairing uses a kanna-beacon://pair link built by src/shared/beacon-pair-link.ts: macOS through Electrobun urlSchemes, Windows and Linux through a per-user handler that runs a helper which forwards the link over a named pipe or unix socket to the running app (single-instance), or stores it and starts the app. Autostart sets KANNA_BEACON_AUTOSTART so a login launch stays in the tray.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-241 | component | Gains the shared runner, activity record and the desktop app service and adapters | c3-241#n12978@v1:sha256:1026475e301c68556624845b2bed10a87eddcd740b931a80579965c47fa49099 "Run a user-authorized companion daemon on the user's own machine that dials out to Kanna and executes scoped file and shell requests." | ref-side-effect-adapter: IO stays in dot-adapter files |
| c3-302 | component | Beacon wire protocol moves to version 2 with scope sync frames and the pairing link format | c3-302#n13082@v1:sha256:4c7ecffd69e947220d2e183aff508ff27068adad53b1b11d4434236e59af2b8b "Define WebSocket wire envelopes (WsInbound, WsOutbound, subscribe/command kinds, correlation ids)." | rule-strong-typing: frames parsed field by field |
| c3-202 | component | Beacon connection persists set-scope, deletes on unpair, refuses unknown or disabled beacons, and pushes scope on settings change | c3-202#n10913@v1:sha256:2e868029505a294cb79ac3750f443e489fdca9fb37d30d865fbfc0e47ac582e0 "Serve HTTP (static + API) and upgrade to WebSocket; attach auth gating; expose /health." | ref-ws-subscription: push only to authenticated beacon sockets |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Spawn the compiled CLI from the app | Two processes and stdout parsing for state that the runner can publish as typed snapshots in-process |
| Localhost HTTP listener for the pairing link | Works only while the app runs, and any website could prefill it; the registered scheme starts the app when it is closed |
| Close and reconnect the beacon on every Settings scope edit | Drops in-flight requests and still gives the app no way to propose a scope |

## Verification

| Check | Result |
| --- | --- |
| bun test --conditions production src/beacon src/shared/beacon-protocol.test.ts src/shared/beacon-scope.test.ts src/shared/beacon-pair-link.test.ts src/server/beacon-connection.test.ts src/server/beacon-services.test.ts src/server/beacon-registry.test.ts | pass |
| bun run scripts/build-beacon-desktop.ts on a Windows host, then pair, grant, unpair against a local Kanna | paired, scope round-trip under 5 ms, unpair removed the Kanna entry and the Run key |
