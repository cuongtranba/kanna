# Beacon — native installer + menu-bar/tray app — Design

**Status:** Draft for review (implementation deferred to a human on real hardware)
**Date:** 2026-10-08
**Author:** Design session (cuongtranba)
**Builds on:** `2026-10-08-beacon-companion-daemon-design.md`, ADR `adr-20261008-beacon-companion-daemon`
**Reference:** Undercroft's `apps/desktop` (Electrobun 2, ADR 0098) — structure only, not code to copy

## Why this document exists, and what it is not

The beacon daemon (Phase 1, shipped in #1215) already works from a terminal: `kanna-beacon pair`
then `kanna-beacon run`. This spec covers the **graphical installer + background tray app** so a
non-technical user never opens a terminal. It is a spec a person implements and **manually tests
on real macOS/Windows hardware** — there is no runnable background code here, and **code-signing
is explicitly out of scope for this round** (unsigned artifacts + checksums + a first-run bypass
guide, same as the daemon binaries today).

It deliberately stops short of shipping code because the thing being built — a process that starts
on login and runs commands received over a network — must be built and watched by a person on the
OS it targets, not generated and left unrun. The consent model from the daemon design is carried
forward unchanged; the tray does not weaken it, it makes **pause** and **unpair** one click.

## Goal

One downloadable app per OS. The user opens it, types the 6-digit pairing code Kanna showed them,
and from then on the beacon runs in the background with a menu-bar (macOS) / system-tray
(Windows/Linux) icon as its only face: online state, Pause, Unpair, Settings, Quit.

## Decisions

| # | Decision |
| --- | --- |
| 1 | **Electrobun 2** is the toolchain, with a **Bun main process** — so the app reuses the daemon's own TypeScript (`src/beacon/**`) as a library on the runtime it is already tested on, rather than shelling out to the compiled binary or re-implementing it. |
| 2 | The app is a **new workspace package** `apps/beacon-desktop/`, parallel to the daemon, not folded into `src/beacon` (which stays a headless, testable library + CLI). |
| 3 | **The main process imports the daemon ports directly** — `createKeyStore`, `createBeaconFs`, `createBeaconShell`, `createBeaconSession`, `createWebSocketTransport` — so there is one implementation of the protocol, scope and realpath enforcement, shared by the CLI and the app. |
| 4 | **The tray is the app's resident face**; `exitOnLastWindowClosed: false`, so closing the pairing window leaves it running in the tray, exactly as the reference does. |
| 5 | **The GUI app has its OWN per-OS CI matrix**, separate from the headless `beacon-binaries` job. Electrobun builds only for the OS it runs on — it cannot cross-compile the way `bun build --compile` does — so the app is built on one runner per platform, unlike the daemon binary. Updates come from the same GitHub release (`releases/latest/download`); no separate update server. |
| 6 | **Unsigned this round.** Artifacts are built from public source with SHA-256 checksums; the download screen carries the first-run bypass guide. Signing + notarization is a later round and its own ADR. |
| 7 | **The one-time auto-run consent lives in the wizard's final step** — it sets the per-beacon `autoRunScripts` flag through the same `/beacon/pair` → settings path, so the app and the CLI agree on what consent means. |

## Shape (mirrors the reference's `apps/desktop`)

```
apps/beacon-desktop/
  electrobun.config.ts      # app identity, Bun main process, tray assets, release baseUrl
  package.json              # deps: electrobun, @kanna shared beacon libs; private
  icon.iconset/             # macOS iconset
  assets/                   # icon.png / icon-windows.png / tray-Template.png (+@2x)
  src/
    main.ts                 # composition root: the ONLY module that touches Electrobun
    rpc.ts                  # typed RPC between the wizard view and the main process
    handlers/
      shell.ts              # the port the main process is written against (injected)
      pairing.ts            # POST /beacon/pair, write config + key via the daemon's key store
      runner.ts             # start/stop the beacon session (reuses src/beacon/session.ts)
    view/                   # the pairing wizard (a BrowserView)
      main.tsx  index.html  index.css
  scripts/
    build.ts  release.ts  icons.ts  check.ts   # wrapped by task, per tooling.md
```

`src/main.ts` is the composition root, as in the reference: it reads the platform + env, takes
`fetch` and a real clock, constructs one `BeaconApp` service, and binds it to the three things
Electrobun provides — the wizard window (+ its RPC), the tray, and the updater. Everything below
receives those as values; no other module imports Electrobun.

## The pairing wizard (one window)

1. On first launch (no stored config) the window opens. It asks for the **Kanna URL** (pre-filled
   from the download link when possible) and the **6-digit code**. Nothing else.
2. On submit: generate the Ed25519 keypair locally via the daemon's `createKeyStore` (private key
   `0600`), `POST {code, publicKey, label: hostname, os}` to `<url>/beacon/pair`. On success,
   persist `{kannaUrl, beaconId}` to the app's config dir.
3. **The consent step** (the design's one-time install consent): an un-pre-checked control —
   *"Let this machine run commands and scripts from your Kanna without asking each time? Anyone who
   can sign into your Kanna can run things on this computer. You can turn this off anytime from the
   tray or in Settings."* Ticking it records `autoRunScripts` on that beacon's scope. Leaving it
   unticked keeps per-call approval.
4. The window confirms *"Paired with <Kanna>. You can close this."* and the app drops to the tray.
5. A later launch with a stored config skips the window and goes straight to the tray, connecting.

A beacon paired through the **CLI** never sees this window, so `autoRunScripts` stays off there
until the user sets it — the design's existing rule, unchanged.

## The tray

`exitOnLastWindowClosed: false`. The menu:

- **Status** — an online/offline mark (never colour alone): connected to `<Kanna>`, last-seen age.
- **Pause** — disconnects the socket and stops answering, without unpairing; **Resume** reconnects.
- **Settings** — reopens the wizard over the existing config (change URL, toggle `autoRunScripts`,
  edit scope roots).
- **Unpair** — deletes the local key + config and tells Kanna to drop the entry (revocation is
  immediate server-side once the key is gone).
- **Quit** — on `before-quit`, if a session is live, stop it cleanly, then quit (mirror the
  reference's single quit path; never prompt, so a logout is not blocked).

## Runtime, launch-on-login, and connection

- The main process builds the real ports (`createBeaconFs(getReadRoots)`, `createBeaconShell(os)`,
  `createKeyStore(path)`, `createWebSocketTransport({url})`) and runs `createBeaconSession(...)`,
  the same session the CLI's `run` drives. Reconnect-with-backoff lives where the CLI already has
  it; the app surfaces the state to the tray.
- **Launch-on-login** is a login item (macOS `SMAppService` / Electrobun's helper), a Startup
  registry entry (Windows), or a `systemd --user` unit (Linux). It is **opt-in in the wizard**, not
  silent: a checkbox "Start Beacon when I log in", default on only after the user has paired. This
  is the one place the app differs from the headless CLI, and it is a visible, revocable choice.
- The scope (`readRoots`, `exec`, `autoRunScripts`) is the server's copy, received in the `ready`
  frame; the app re-checks every request with realpath exactly as the daemon library already does.

## Updates

`release.baseUrl = https://github.com/cuongtranba/kanna/releases/latest/download`, `generatePatch:
false` (only the latest release is reachable there, so a patch could bridge at most one release,
and the full archive is what downloads anyway — the reference's reasoning). The updater reads
`stable-<os>-<arch>-update.json`, whose name is the contract the release must keep.

## Signing — deferred, and what the user sees meanwhile

Unsigned, like the daemon binaries. macOS Gatekeeper blocks a double-click of a downloaded
unsigned app; the download screen in Settings → Beacons shows the bypass (right-click → Open →
Open, or clear the quarantine attribute), and Windows SmartScreen's *More info → Run anyway*. The
checksum is the integrity check. **A later round adds an Apple Developer ID + notarization and a
Windows Authenticode cert and removes this guide;** it is its own ADR because it needs paid certs
and changes the trust story. This is a named rough edge, not the finished experience.

## Build + release (through `task`, per `tooling.md`; the concrete CI)

**Not an npm package.** `apps/beacon-desktop` is `private: true` and is published as **GitHub
release assets** (the installers + `stable-*-update.json` + checksums), exactly like the daemon
binaries and like the reference's desktop app — there is no `npm publish` for it. The only
`npm publish` in this repo stays the main `kanna` package (server + CLI); the beacon GUI is a
downloaded app, not a dependency anyone installs.

Electrobun builds for the OS it runs on, so the headless `beacon-binaries` job (one ubuntu runner,
`bun build --compile`, five targets) **cannot** build this app. The GUI app gets two new jobs in
the release workflow, modelled exactly on Undercroft's `build-desktop` / `release-desktop`:

- **`build-beacon-desktop`** — a matrix `runner: [macos-15, windows-2025, ubuntu-24.04]`,
  `needs: release-please`, gated on `release_created == 'true'`, `permissions: contents: read`.
  Each runner: checkout → `setup-bun` → `setup-task` → `bun install --frozen-lockfile` →
  `task build:beacon-desktop` → `upload-artifact` the `apps/beacon-desktop/artifacts/` folder as
  `beacon-desktop-<runner>` (`if-no-files-found: error`). macOS is Apple-Silicon only, as the
  reference notes (Electrobun publishes no macOS x64 core).
- **`release-beacon-desktop`** — `needs: [release-please, build-beacon-desktop]`, one ubuntu
  runner, **`permissions: contents: write`** (only this job writes to the release): checkout →
  tooling → `download-artifact pattern: beacon-desktop-*` → `task cd:beacon-desktop-release
  DIR=... TAG=${{ needs.release-please.outputs.tag_name }}` with `GH_TOKEN: GITHUB_TOKEN`. That
  task checksums every platform's installer + `stable-*-update.json` into one
  `kanna-beacon-desktop-SHA256SUMS` and `gh release upload --clobber`s them under Electrobun's
  names (the updater builds its URLs from those names, so they are the contract). A build failure
  on any platform must NOT block the npm publish or the daemon binaries — these are separate jobs.

Task wrappers (each wraps a `scripts/*.ts`, never a second definition):
`task build:beacon-desktop` → `scripts/build.ts` (Electrobun release build into `artifacts/`);
`task build:beacon-desktop-icons` → `scripts/icons.ts`; `task dev:beacon-desktop` →
`scripts/build.ts --dev --run`; `task ci:beacon-desktop-check` → `scripts/check.ts` (network + a
display, a CI step **outside** the no-Docker/no-network gate, like the reference's
`ci:desktop-check`); `task cd:beacon-desktop-release` → `scripts/release.ts`.

`scripts/release.ts` mirrors the reference: it lists files by the `(?:stable-)?(macos|win|linux)-
(arm64|x64)-` name pattern rather than globbing (a stray file is never attached), rejects a
duplicate name across platforms, writes the one `sha256sum --check` file, and `--upload TAG`s.

`scripts/check.ts` is the CI smoke switch (`KANNA_BEACON_DESKTOP_SMOKE=<file>`): the app opens the
wizard, walks it to the pairing step against a throwaway local server, writes the result, and
quits — the one automated check that the window renders and the RPC is wired, short of a real
pairing. It needs a display, so it is the `ci:beacon-desktop-check` step, not part of `ci:verify`.

## What the user does to verify (manual, this round)

Because signing is deferred and the GUI needs the real OS, the acceptance is a person's manual run:

1. `task build:beacon-desktop` on a Mac → a `.app` under the build dir.
2. Open it (right-click → Open past Gatekeeper), enter the URL + a code minted in Settings → Beacons.
3. Confirm it pairs, drops to the tray, shows online; in a chat, `beacon_read` a file and
   `beacon_exec` a harmless command; toggle Pause and confirm the tools stop; Unpair and confirm the
   entry disappears from Settings.
4. Repeat on Windows for the `.exe`.

## Security posture (unchanged from the daemon design)

- A Kanna password is still required to pair; the app refuses to pair against a passwordless server.
- Consent is one-time and explicit (the wizard step), per beacon, revocable from the tray.
- The daemon library's realpath scope enforcement is the final authority; the app adds no bypass.
- The private key never leaves the host; unpair deletes it and revokes server-side.

## Open items

- Electrobun's login-item API coverage per OS (confirm macOS `SMAppService` and the Windows path).
- Whether the tray should show a live command feed or stay minimal (lean minimal; the transcript
  is the audit record).
- Icon assets (a beacon mark) — needs a designer; the reference ships an `icon.iconset` + tray
  templates to copy the structure from.
- The signing round (separate ADR): Developer ID + notarization, Authenticode, and removing the
  bypass guide.
