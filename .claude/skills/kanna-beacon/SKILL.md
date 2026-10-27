---
name: kanna-beacon
description: Kanna beacons — beacon_pull / beacon_push file transfer (tickets, /beacon/transfer, atomic replace), beacon self-update (protocol 4), and the Windows 7 Go port in apps/beacon-win7 (Go 1.20 pin, conformance fixtures). Use whenever a task touches src/beacon/**, apps/beacon-win7/**, src/shared/beacon-*, beacon-transfer, or the beacon protocol.
---

# Kanna beacons

Moved verbatim from the root `CLAUDE.md`. Any protocol change must update the Go port and its conformance fixtures in the same PR.

## Beacon file transfer (`beacon_pull`, `beacon_push`)

Two MCP tools copy ONE file between a chat's project and a paired beacon, over
HTTP, disk to disk. Design and the six invariants: `docs/superpowers/specs/2026-10-09-beacon-file-transfer-design.md`;
ADR `adr-20261009-beacon-file-transfer`. Protocol 3 adds the `upload` (beacon →
Kanna, tool `beacon_pull`, judged by `readRoots`) and `download` (Kanna →
beacon, tool `beacon_push`, judged by `writeRoots`) request ops.

- **The bytes never touch the model or the WebSocket.** The request frame
  carries only a ticket; the beacon then talks to `/beacon/transfer` with
  `Authorization: Bearer <ticket>`. No cookie, no origin check, and
  `!auth → 403` like `/beacon/pair`. A tool result carries path, byte count and
  sha256 only. Never `readFile` or `.arrayBuffer()` file content on either side.
- **A ticket is one file, one direction, one beacon.** `beacon-transfer-tickets.ts`
  is pure (clock and token injected); `beacon-transfer-http.adapter.ts` streams to
  disk. Every piece moved calls `touch`, so a slow link that still moves bytes
  never idles out. Idle, disconnect, cancel or a failed `complete` revokes the
  ticket and the beacon's next request gets 401.
- **No fixed deadline.** `dispatchBeaconRequest` takes `timeoutMs: null` for
  transfers; the 600 s `BEACON_REQUEST_TIMEOUT_MS` and the beacon's
  `perCallTimeoutMs` / `outputByteCap` do not apply.
- **Atomic replace.** Both sides write `<dest>.kanna-part` and rename it only
  after size and SHA-256 verify; a failure deletes the part. `beacon_pull`
  deletes a stale part at mint time, otherwise a new ticket would "resume" a
  different file's bytes.
- **`writeRoots` stays out of `set-scope`**, so a beacon cannot grant itself
  write access; only Kanna settings edit it.
- **Kanna-side deny lists apply too:** `beacon_push` refuses a `source` matching
  the chat's `readPathDeny` and `beacon_pull` a destination matching `writePathDeny`.
- **Both beacons implement it.** The Bun daemon (`src/beacon/transfer.adapter.ts`)
  and the Go port (`apps/beacon-win7/internal/transfer`) share the constants in
  `src/shared/beacon-transfer.ts` and the request fixtures in
  `apps/beacon-win7/testdata/conformance/frames.json`. The registry fails a
  transfer op at once for a beacon below `TRANSFER_PROTOCOL` (3); without that
  gate an old beacon drops the unknown op and the call hangs.

## Beacon self-update (protocol 4)

ADR `adr-20261010-beacon-self-update`. Two invariants a refactor could quietly
break:

- **The server says "update" and nothing else.** The `update` frame has no
  fields. The target is the `serverVersion` from the handshake, acted on only
  when newer and when it matches `isReleaseVersion` (it is interpolated into the
  download URL), fetched from the fixed GitHub release base and checked against
  that release's `SHA256SUMS`. Never add a URL, version or binary to the frame;
  that turns a compromised server into code execution on every paired machine.
  `KANNA_BEACON_RELEASE_BASE` is a machine-local test override for that reason.
- **`update_status` goes only to a server at `UPDATE_PROTOCOL` (4).** An older
  server's `beacon-connection.ts` closes the socket on any frame it cannot
  parse, so sending it unconditionally would drop the beacon mid-update. A new
  beacon-to-server frame needs the same gate.

## Windows 7 beacon (apps/beacon-win7, Go 1.20)

`apps/beacon-win7` is a second beacon, in Go, for Windows 7 and 8.1, where Bun
and WebView2 cannot run. It is a port of `src/beacon/**` (CLI plus a native
tray), not a fork of the protocol: the server is the same for both. Details
and the deliberate divergences are in `apps/beacon-win7/README.md`.

- **Go 1.20.14 is the pin, on purpose** — the last Go whose runtime runs on
  Windows 7. `go.mod` says `go 1.20` with no `toolchain` line. Never raise it,
  and never add or bump a dependency whose own `go.mod` declares a `go`
  directive above 1.20 (`curl -s https://proxy.golang.org/<module>/@v/<version>.mod`).
  Go 1.20 does not enforce that, so the `beacon-win7` CI job checks it; keep
  `golang.org/x/sys` at a version whose `go.mod` says `go 1.18` (≤ v0.30.0).
- **The protocol has two implementations now.** Any change to
  `src/shared/beacon-protocol.ts` (or `isPathInsideRoots` in
  `beacon-scope.ts`, or the signing in `key-store.adapter.ts`) must update the
  Go port and `apps/beacon-win7/testdata/conformance/` in the same PR.
  `src/shared/beacon-conformance.test.ts` and the Go `protocol` / `keystore`
  tests read the same fixture files, so a fixture change that only one side
  honours fails CI.
- No repo TypeScript gate (Oxlint, type check, `lint:comments`, `check:arch`,
  ast-grep) scans the module; `go vet` and `go test` on Linux and Windows,
  plus a PE import-table check of the cross-built `.exe` files, do.
