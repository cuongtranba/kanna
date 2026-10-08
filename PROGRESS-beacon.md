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

M0 (design PR) in progress on `docs/beacon-design`.

## Completed

- 2026-10-08 Design doc and ADR written, resolved questions recorded.

## Remaining

- M0 seal ADR and open the design PR.
- M1–M8 per the plan.

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

## Failed approaches

## Unresolved errors
