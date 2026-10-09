# Beacon — Progress

Plan: `docs/superpowers/plans/2026-10-08-beacon-phase1.md`.
Design: `docs/superpowers/specs/2026-10-08-beacon-companion-daemon-design.md`.

## Objective

Phase 1 of Beacon: pair a machine, grant it a default-deny scope, and let the
agent read files and run approved commands on it through `beacon_*` tools.

## Acceptance criteria

- Pairing and `/beacon` work only on an install with a Kanna password.
- A wrong key, a revoked beacon, or an old protocol version is refused.
- Scope is enforced on the server (lexical) and on the beacon (realpath).
- Every `beacon_*` call shows in the transcript with the machine it targeted.
- Binaries for five targets are attached to each release with `SHA256SUMS`.
- `bun run check`, `bun run test`, `bun run lint:usestate`, `bun run check:arch`,
  and `bunx ast-grep test` pass, with no budget pin raised.

## Status

Phase 1 COMPLETE on feat/beacon-phase1 except the native GUI installer + tray app.
The whole repo is green: `bun run check` (bundle 170657/350000), `bun run test`
(8293 pass / 0 fail), lint:usestate, ast-grep, check:arch, lint:limits, and
`c3x check` (0 errors). The follow-up items M1–M6 listed are now done; see Completed.
Still deferred: the signed native .pkg/.exe installer and the menu-bar/tray app
(need real macOS/Windows + code-signing), and a real daemon↔server end-to-end run.

## Completed

- 2026-10-08 Design doc + ADR (sealed) + plan on docs/beacon-design (PR #1213).
- 2026-10-08 M1 shared contracts: beacon-protocol.ts (frames + parser + version),
  beacon-scope.ts (BeaconScope, DEFAULT_BEACON_SCOPE, evaluateBeaconRequest).
- 2026-10-08 M2 customBeacons settings collection + in-memory pairing-code store.
- 2026-10-08 M3a ed25519 crypto (verified under Bun), live registry, status snapshot.
- 2026-10-08 M3b /beacon ws endpoint + handshake + POST /beacon/pair + beacons topic;
  server.ts kept at 695 lines, no pin raised.
- 2026-10-08 M4 daemon in src/beacon/** with its own IO seal: handshake session,
  realpath-scoped fs, shell with timeout/cap, key store (0600), CLI pair/run.
- 2026-10-08 M5a beacon_* MCP tools + scope-aware permission-gate branch + transcript
  tool kind + threading; a beacon "ask" verdict forces a real prompt regardless of the
  chat default (otherwise an auto-allow chat would run beacon exec unprompted).
- 2026-10-08 M6 Settings -> Beacons section: pair (mint code + CLI line), live status,
  enable/revoke, scope editor incl. the autoRunScripts opt-in toggle; store + subscription.
- 2026-10-08 Heartbeat: registry.sweep() pings online beacons and evicts stale ones;
  per-beacon trusted-script hashes wired into the gate (addTrustedScript/removeTrustedScript).
- 2026-10-08 Granted subagents reach beacon tools via the parent chat's toolCallback
  (shims stay off; non-granted subagents unchanged); allowBeaconTools Settings toggle.
- 2026-10-08 Dedicated beacon consent card names the machine (label/OS/online + command or
  full script body); update-available badge via isBeaconBehind vs the server version.
- 2026-10-08 M7 (partial): release-please beacon-binaries job cross-compiles the five
  targets + SHA256SUMS; scripts/build-beacon.ts (daemon compiles + runs as a 62MB binary);
  scripts/install-beacon.sh; workflow test pins the job.
- 2026-10-08 M8: c3 bound (c3-241 beacon-daemon created; beacon files bound into c3-202/
  c3-226/c3-302/c3-116), c3x check clean; ADR set accepted + resealed; wiki pairing guide;
  CLAUDE.md 0600 settings.json claim corrected to 0644.
- 2026-10-09 File transfer (beacon_pull / beacon_push), server + shared + Bun daemon
  + UI + docs half: protocol 3 with the upload and download ops, ticket store,
  /beacon/transfer streaming route, registry version gate, writeRoots editor,
  adr-20261009-beacon-file-transfer. The Go port is implemented separately in
  apps/beacon-win7.

## Remaining

- Native signed .pkg/.exe installer + menu-bar/tray app + launchd/Windows-service/systemd
  units. Needs real macOS/Windows and paid code-signing certs; the binaries + install
  script + Settings pairing are the interim path.
- A real daemon<->server end-to-end run (pair -> connect -> read a file -> run a command)
  against a live server; and verifying the signed handshake from inside the compiled binary.
  The compiled binary runs; the live handshake is exercised only by unit tests so far.
- The design/ADR describe an installer final-step consent; the shipped consent is the
  per-beacon autoRunScripts toggle (default off). The wiki describes the shipped behavior.

## Decisions

- 2026-10-08 Scope is per beacon only; no per-chat or per-project narrowing.
- 2026-10-08 Audit is the chat transcript; no separate activity view.
- 2026-10-08 Distribution is a standalone Bun binary wrapped in a graphical
  installer + tray app, on GitHub releases; the handshake carries a protocol
  version. Non-technical install: .pkg/.exe, 6-digit code, background + tray.
- 2026-10-08 Phase 1 installers are unsigned with an in-product first-run bypass
  guide; signing/notarization is Phase 2.
- 2026-10-08 Large files: beacon_read (windowed), beacon_grep, beacon_fetch;
  the model routes itself, none privileged.
- 2026-10-08 beacon_script runs a full script in the login session. Consent is
  ONE-TIME at install, not per-script: the installer's final step asks once,
  agreeing turns on per-beacon autoRunScripts so scripts and commands then run
  with no prompt on that machine (same shape as adding an SSH key). Revocable in
  one click; transcript still records every run; requires a Kanna password; per
  beacon. Default when unset = ask, so a CLI-paired beacon with no consent
  screen is safe until the user turns it on. This matches the user's ask (prompt
  once at install, bypass after) while keeping an explicit, revocable
  authorization gesture rather than silent bypass.
- 2026-10-08 Beacons require a Kanna password, because `/ws` is unauthenticated
  without one.
- 2026-10-08 Live status follows the global `cron-jobs` topic; the
  `pty-instances` precedent was deleted with the PTY driver.

- 2026-10-08 Subagent access to beacon tools is a per-subagent allowed-tool
  setting, default off. Main chat always gets the group; a subagent only when
  granted. Gated on delegation depth plus the flag.
- 2026-10-08 Implementation: thin vertical slice first (protocol, scope,
  settings, /beacon transport, registry, beacon tools, daemon CLI), skipping the
  native .pkg/.exe installer and tray app. Running the milestones continuously,
  reporting at the end. Branch feat/beacon-phase1 off docs/beacon-design.

- 2026-10-09 Large-file transfer goes over HTTP with a one-file ticket, not the
  WebSocket and not a session cookie; bounded by an idle timeout, not a deadline.
  Design: docs/superpowers/specs/2026-10-09-beacon-file-transfer-design.md.

## Failed approaches

## Unresolved errors
