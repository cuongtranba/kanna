---
id: adr-20261010-beacon-self-update
c3-seal: 2a6bf7ac0306954da08ff7c7ec2cf0b716df6ca69788383a40a050afbe76f2e2
title: beacon-self-update
type: adr
goal: Let every beacon build (the Bun CLI, the Go 1.20 Windows 7 CLI and tray, and the Electrobun desktop app) update itself to the version of the Kanna server it connects to, automatically on connect and on demand from an Update now button in Settings, Beacons. The beacon pulls its own release from the fixed GitHub repository; the server only says "update" and never supplies a URL, a version or a binary. Beacon protocol 4 carries the request and the progress report.
status: accepted
date: "2026-10-10"
---

## Goal

Let every beacon build (the Bun CLI, the Go 1.20 Windows 7 CLI and tray, and the Electrobun desktop app) update itself to the version of the Kanna server it connects to, automatically on connect and on demand from an Update now button in Settings, Beacons. The beacon pulls its own release from the fixed GitHub repository; the server only says "update" and never supplies a URL, a version or a binary. Beacon protocol 4 carries the request and the progress report.

## Context

Every release already publishes the beacon binaries with SHA256SUMS (and SHA256SUMS-win7 for the Go build) to the GitHub release, and a beacon already reports its version in hello, so the Beacons settings row could show an Update available pill. Nothing acted on it: each paired machine had to be reinstalled by hand after every Kanna release, and a beacon that fell behind the server's protocol window was refused as incompatible. A beacon runs commands on the user's machine, so how it replaces its own executable is a security boundary: whoever can reach the server must not be able to make a beacon run a binary of their choosing. adr-20261008-beacon-companion-daemon left signing and notarization to Phase 2, so the only integrity evidence a release carries today is its checksum file. The Windows 7 port (adr-20261009-beacon-win7-go) is held to the TypeScript contract by shared conformance fixtures, so a protocol change lands in both implementations at once.

## Decision

The beacon updates to the server's version, taken from the serverVersion field that protocol 4 adds to the ready and incompatible frames, and only when that version is newer than its own; it never downgrades, and a manual request on a current beacon answers current. The version is interpolated into the download URL, so it must match a strict release-version pattern (digits.digits.digits with an optional prerelease suffix) before anything is fetched. The beacon downloads only from https://github.com/cuongtranba/kanna/releases/download/v<version>/<asset>, fetches SHA256SUMS (SHA256SUMS-win7 for the Go build) from the same release, hashes the asset while streaming it to a staging file, and deletes the staging file on a mismatch. It then runs the new binary's version command and requires the target version back, which catches a wrong-platform or truncated asset that a checksum file copied from the same origin would still match. Before the swap the session refuses new requests and waits for in-flight ones; the swap is an atomic rename on POSIX and a rename-aside of the running exe on Windows, restored if the move fails. The CLI then exits with code 75; an unsupervised beacon becomes a small supervisor that respawns the new binary while it exits 75 and forwards SIGINT and SIGTERM, so launchd, systemd or a terminal keeps seeing one process. The Go tray releases its mutex, starts the new build detached and quits. The desktop app goes through Electrobun's own updater (release.baseUrl points at the latest GitHub release, delta patches off) behind the same decision rule, and because Electrobun compares build hashes rather than versions it fails unless the manifest version equals Kanna's exactly. The server's part is a field-less update frame sent by the beacons.update command, refused for a beacon that is offline or below protocol 4, plus recording the update_status frames (checking, downloading, installing, restarting, current, failed) for the Beacons snapshot. A beacon sends update_status only to a protocol 4 server, because an older server closes the socket on any frame it cannot parse. Auto updates can be switched off on the machine with KANNA_BEACON_AUTO_UPDATE=disabled, which still allows Update now; after a failure an automatic retry of the same version waits 30 minutes. KANNA_BEACON_RELEASE_BASE replaces the download location for testing and is read only on the machine, never from the server. This wins over the alternatives below because the server, which is reachable through a tunnel and whose account may be the weakest link, gains no ability to choose what a beacon executes: the worst a compromised server can do is ask a beacon to install a genuine Kanna release that is newer than the one it runs.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-0 | system | N.A - named only to complete the top-down descent; the system is unchanged | N.A - ancestor only | N.A - ancestor only |
| c3-1 | container | N.A - named only to complete the top-down descent; the client container is unchanged | N.A - ancestor only | N.A - ancestor only |
| c3-2 | container | N.A - named only to complete the top-down descent; the server container is unchanged | N.A - ancestor only | N.A - ancestor only |
| c3-3 | container | N.A - named only to complete the top-down descent; the shared container is unchanged | N.A - ancestor only | N.A - ancestor only |
| c3-241 | component | Gains the self-update decision, the release download and swap, the restart supervisor and the desktop Electrobun updater; the runner ends a run with exit update | c3-241#n14230@v1:sha256:3b0c69e496824880834e4dc22eb6860942318de06b1d669fcfd727f4ec02214e | ref-side-effect-adapter: download, hashing, chmod, rename and spawn live in self-update.adapter.ts and the entry adapter; self-update.ts and supervisor.ts stay pure |
| c3-302 | component | Protocol 4 adds the update and update_status frames and serverVersion on ready and incompatible, mirrored in apps/beacon-win7 with conformance fixtures | c3-302#n13223@v1:sha256:35f70de24aca0a7fef0da1cb3b3c0f996af2f1d891cf8361c6d5ce05cb1a447f | ref-strong-typing and rule-strong-typing: BeaconUpdateStatus is a named type and every new field is parsed, never cast |
| c3-202 | component | The beacon connection sends serverVersion, the registry records update_status and answers beacons.update | c3-202#n14232@v1:sha256:dd5b274bf77e5ac772e1290ec609f9637a3e70bf4398892b993eca4a575b4baf | ref-ws-subscription: update progress rides the existing beacons snapshot, and the request is one typed command |
| c3-116 | component | The Beacons section gains Update now, live update progress beside the version, and a reinstall hint on a beacon too old to update itself; the fact does not enumerate settings sections, so its body is unchanged | c3-116#n10561@v1:sha256:9f6e3ac8943d89276398fdab980fb40a5a26c8ca7e600344486d38a7fd9d1696 | The button renders its pending state through runPendingAction and shows the command error on the row |

## Compliance Refs

| Ref | Why required | Evidence | Action |
| --- | --- | --- | --- |
| ref-side-effect-adapter | The updater downloads, writes, renames and spawns, all of which the beacon keeps out of its session loop | ref-side-effect-adapter#n13885@v1:sha256:d97da3a35cbbfc743202e4b37a53c5ae837c6f8c802bdd22685991e0bfe439ee | comply: the IO is in self-update.adapter.ts and entry.adapter.ts behind the BeaconUpdater and SupervisorPort ports; the Go port keeps it in internal/selfupdate and internal/cli |
| ref-ws-subscription | The update request and its progress cross the client-server socket | ref-ws-subscription#n13990@v1:sha256:856dbc5b26887801a91ee1acf2a59bd940bd7592ddaa57b46a8689de86dd07cc | comply: beacons.update is a typed command and update status is part of the pushed beacons snapshot |
| ref-strong-typing | The update frames, serverVersion and the beacons.update reply cross the beacon-server and client-server boundaries | ref-strong-typing#n13924@v1:sha256:390cd8fee6d22c17530c1b9551d02cbd40ea33c56574b7ebc313f21961a707af | comply: BeaconUpdateStatus, BeaconUpdateState and BeaconUpdateResult are named shared types, parsed field by field on both sides |
| ref-local-first-data | The registry now holds each beacon's update status, and the beacon now reaches a host other than its Kanna server | ref-local-first-data#n13820@v1:sha256:6b71d8a9c2f48d47b9acda0a867f9936d76727141dc2efbbdfead90101e7fd49 | review: update status is in-memory registry state and is never persisted; the only new outbound request is the beacon's own download from the fixed GitHub release, and the server opens no new listener |
| ref-zustand-store | The Update now button keeps a per-beacon error on the client | ref-zustand-store#n14023@v1:sha256:53e3365a2350860110617c32292965a5051709854e758fc7470752136627d86e | comply: updateErrors and the setUpdateError action live in beaconsSectionStore, and the pending state comes from pendingActionsStore |

## Compliance Rules

| Rule | Why required | Evidence | Action |
| --- | --- | --- | --- |
| rule-strong-typing | New frames and fields cross the beacon-server boundary | rule-strong-typing#n14116@v1:sha256:7e110467821b764c655f13db69c1331592e23c71af38ac5825037c97b15ea180 | comply: BeaconUpdateState is a closed union, parseBeaconFrame rejects an unknown state, and BeaconUpdateResult types the command reply |
| rule-zustand-store | The per-beacon update error is client state with a transition | rule-zustand-store#n14148@v1:sha256:f4987b0b2521426050c0c2a5307760c102f3ed1e0a9334b074ed1913fe818f64 | comply: the error is set and cleared only through the store's setUpdateError action, never by a useState or an inline updater |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| The server pushes the new binary, or sends a download URL | It turns a compromised or tunnelled server into remote code execution on every paired machine, which adr-20261008-beacon-companion-daemon exists to prevent; a fixed origin limits the server to choosing between genuine releases |
| Target the latest GitHub release instead of the server's version | A beacon would run ahead of an un-upgraded server and leave its protocol window; matching the server keeps both sides on one tested pair, and the server version is already in the handshake |
| Rewrite Electrobun's baseUrl inside the installed desktop app to point at the server's version | Electrobun reads baseUrl from its bundled version.json with no runtime override, so an exact tag would mean mutating its cached internals, which any Electrobun upgrade could break silently; the app instead uses the baked latest/download address and refuses any manifest whose version is not Kanna's |
| Wait for signed releases before shipping any updater | Signing is deferred to Phase 2 by adr-20261008-beacon-companion-daemon, and manual reinstalls already trust the same checksum file over the same TLS origin, so self-update adds no trust the manual path lacks |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Beacons released at 1.70.x and older have no updater, and the 1.70.0 desktop app has an empty update address baked in | One manual reinstall of every build; the Settings row links the Update available pill to the download page with a reinstall hint, and the wiki says so | BeaconsSection.test.tsx and the wiki Updating section |
| The checksum file is same-origin and unsigned, so it proves integrity in transit, not provenance | TLS to github.com, the fixed origin, a strict version pattern and the version smoke test; signing stays a Phase 2 decision | self-update.adapter.test.ts checksum-mismatch case leaves the target byte-identical |
| The desktop app updates only when the latest GitHub release equals Kanna's version, and its download is checked by Electrobun over TLS rather than by SHA256SUMS | The version gate refuses a mismatched manifest with a message naming both versions, before anything is downloaded | desktop-updater.test.ts |
| A Windows desktop app outside the Electrobun-managed LOCALAPPDATA folder cannot update | The Electrobun error is translated into a reinstall-with-the-installer message | desktop-updater.test.ts |
| On Windows the supervisor is the pre-update process, so it keeps the old image open | The running exe is renamed aside to .old, or .old-n when an earlier one is still locked, and leftovers are removed on a later start | swap_internal_test.go and self-update.adapter.test.ts |
| npm publishes Kanna before the release jobs upload the beacon assets, so a fresh server can name a release whose files return 404 | A 404 reports that the release has no asset yet, and automatic retries of the same version back off for 30 minutes while Update now retries at once | self-update.test.ts backoff case and the Go selfupdate tests |
| A server older than protocol 4 closes the socket on an update_status frame | The beacon sends update_status only to a server at UPDATE_PROTOCOL | runner.test.ts and the Go session update tests |

## Verification

| Check | Result |
| --- | --- |
| bun run test src/beacon src/shared/beacon-protocol.test.ts src/shared/beacon-conformance.test.ts src/server/beacon-registry.test.ts src/server/ws-router-settings.test.ts src/client/app/BeaconsSection.test.tsx | pass |
| go vet ./... and go test ./... in apps/beacon-win7 with Go 1.20 | pass |
| bun run scripts/build-beacon.ts --host | pass |
| A real CLI beacon updates from Update now against the next published GitHub release | run by the user after the release ships |
