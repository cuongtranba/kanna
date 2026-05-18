---
id: adr-20260518-version-pinned-update-install
c3-seal: 5c6db2d6ced3f422939c89fd405d7f58000d53600b018d7af2e09221f1f4a97d
title: version-pinned-update-install
type: adr
goal: Let users install any published kanna-code release from the Settings → Changelog UI — not just the latest. The `update.install` command now accepts an optional `version`; the supervisor reloader pins npm to that exact tag so users can roll back to a known-good release or jump forward without waiting for `check-for-updates` to flag an update available.
status: implemented
date: "2026-05-18"
---

# adr-20260518-version-pinned-update-install

## Goal

Let users install any published kanna-code release from the Settings → Changelog UI — not just the latest. The `update.install` command now accepts an optional `version`; the supervisor reloader pins npm to that exact tag so users can roll back to a known-good release or jump forward without waiting for `check-for-updates` to flag an update available.

## Context

`UpdateManager.installUpdate()` previously had no version argument. The supervisor reloader called `installPackageVersion(PACKAGE_NAME, latestVersionHint())` and the UI rendered an "Update" button only on the release that matched `updateSnapshot.latestVersion` while `canInstallUpdate` was true. Users hitting a regression had no in-app path to install an older release; the only remedy was a manual `bun add -g kanna-code@x.y.z` from a terminal, which most non-developer users cannot do. The npm `installPackageVersion(name, version)` helper already accepts any tag — the constraint lived only in the manager and the UI gating, not in the install pipeline. Affected topology: c3-219 update-manager, c3-302 protocol, c3-208 ws-router, c3-116 settings-page. The pm2 reloader pulls `origin/main --ff-only` and cannot pin to an arbitrary tag, so version pinning is supervisor-only.

## Decision

Add an optional `version: string` to the `update.install` WebSocket command. Plumb it through `WsRouter → UpdateManager.installUpdate({version}) → runInstall(targetVersion) → UpdateReloader.reload(version)`. `SupervisorExitReloader.reload(version)` uses the explicit version when supplied (stripping a leading `v`), else falls back to `targetVersion()` (latest). `Pm2Reloader.reload(version)` throws `UpdateInstallError("Version pin not supported", "install_failed", "Version pin not supported")` when a version is passed, because git-pull mode cannot resolve an arbitrary tag. When `targetVersion` is set, `runInstall` skips the `updateAvailable` gate so rollback (older than current) and side-grade work. The Changelog UI now renders an install button on every non-current release: "Update" for the latest+available release (existing wording preserved), "Rollback" when the tag is older than the current installed version (compared via a client-side `compareSemverTags`), and "Install" otherwise. The current release still renders only the "Current" badge with no button.

## Affected Topology

| Entity | Type | Why affected | Governance review |
| --- | --- | --- | --- |
| c3-219 | component | New installUpdate({version?}) signature, runInstall(targetVersion?) bypass of updateAvailable gate, reloader interface widened to reload(version?), snapshot currentVersion written from targetVersion | Review Contract row "applyUpdate() / Strategy factory" — interface now optional-version-aware |
| c3-302 | component | update.install envelope gains optional version: string discriminated-union field | Review WsInbound contract — new optional field is backward-compatible |
| c3-208 | component | update.install handler forwards command.version to manager | Review envelope dispatch row — no new envelope kind, only forwarded payload |
| c3-116 | component | Changelog section renders Install/Rollback/Update button on every non-current release; adds compareSemverTags helper; handleInstallUpdate accepts version? | Review settings setters contract — new setter forwards optional version to update.install |

## Compliance Refs

| Ref | Why required | Action |
| --- | --- | --- |
| ref-strong-typing | New optional version field on protocol + reloader interface must stay strictly typed; no any | comply |
| ref-ws-subscription | update.install keeps WS subscription/command envelope contract; payload backward-compatible | comply |
| ref-cqrs-read-models | Update snapshot remains the projection of update state; currentVersion now reflects the chosen target after install | comply |
| ref-zustand-store | Settings-page reuses the existing kanna state store; no new store added | comply |
| ref-local-first-data | Install path still resolves through local npm/bun toolchain on the user's machine | comply |
| ref-colocated-bun-test | ws-router handler change is exercised by src/server/ws-router.test.ts colocated next to the source; manager + strategy edits covered by their colocated suites | comply |

## Compliance Rules

| Rule | Why required | Action |
| --- | --- | --- |
| rule-strong-typing | Optional version?: string typed on protocol union, reloader, manager method, state setter, UI prop — no untyped escape | comply |
| rule-zustand-store | handleInstallUpdate continues to live on the kanna state hook; signature widened only | comply |
| rule-colocated-bun-test | Existing update-manager.test.ts / update-strategy.test.ts colocated tests cover the new branches | comply |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| Protocol | Add optional version?: string to update.install discriminated union | src/shared/protocol.ts |
| Update strategy | UpdateReloader.reload(version?); SupervisorExitReloader honors override and strips ^v; Pm2Reloader throws on version pin | src/server/update-strategy.ts |
| Update manager | installUpdate({version?}), runInstall(targetVersion?) bypass updateAvailable when target set, snapshot currentVersion derived from target | src/server/update-manager.ts |
| WS router | Forward command.version to manager | src/server/ws-router.ts |
| Client state | handleInstallUpdate(version?) sends {type:"update.install", version} | src/client/app/useKannaState.ts |
| Settings UI | Render Install/Rollback/Update button on every non-current release; add compareSemverTags helper | src/client/app/SettingsPage.tsx |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| c3-219 Contract | No structural row change — surfaces stay (Update projection, applyUpdate(), Strategy factory). Behavior delta captured in this ADR; component body still derives. | c3x read c3-219 --full |
| c3-302 Contract | WsInbound row already covers the union; optional field is additive. No row mutation needed. | c3x read c3-302 --section Contract |
| c3-116 Contract | Setting setters row already covers typed commands; no row mutation needed for an optional argument extension. | c3x read c3-116 --section Contract |
| N.A - no rules/refs/recipes added or removed | N.A - no rules/refs/recipes added or removed | N.A - no rules/refs/recipes added or removed |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| bun test src/server/update-manager.test.ts | Existing tests assert lifecycle + tracking; signature widening must not regress them | bun test output: 24 pass on update-manager + update-strategy suites |
| bun test src/server/ws-router.test.ts | Asserts envelope routing; forwarded version must not break existing handlers | bun test output: 53 pass |
| tsc --noEmit | Discriminated union + reloader interface change must compile across client + server | bunx tsc --noEmit clean |
| bun run lint | ESLint --max-warnings=0 must stay green with the new client helper | bun run lint clean |
| SupervisorExitReloader.reload guard | Throws UpdateInstallError("Unable to determine target version.") if neither override nor targetVersion() resolves | src/server/update-strategy.ts |
| Pm2Reloader.reload guard | Throws UpdateInstallError("Version pin not supported") if a version is supplied in pm2 mode | src/server/update-strategy.ts |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Add a second update.installVersion command kind | Doubles the protocol surface for the same operation; the discriminated union already supports optional fields, and update.install semantics are unchanged when version is omitted |
| Allow pm2 mode to checkout an arbitrary tag (git checkout v1.2.3 && build) | Out of scope for this change — pm2 reloader assumes a tracking branch and lockfile diff against HEAD@{1}; arbitrary checkout breaks both. Deferred behind an explicit ADR |
| Server-side semver comparison to label the button | Forces a round trip and duplicates logic already present in cli-runtime.compareVersions; client compare keeps the UI snappy and labels are advisory only |
| Hide the Install button on pm2 deployments | Client cannot detect the server-side reloader mode without a new snapshot field; falling back to a user-visible error from the Pm2Reloader guard is simpler and surfaces the limitation honestly |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| User installs an incompatible older version and breaks state migrations | Rollback prompts the same restart/reload path; users can roll forward again from the UI. No migration safety net is added in this ADR | bun test src/server/update-manager.test.ts asserts snapshot transitions on install path |
| pm2-mode users click Install and see a generic error | Pm2Reloader throws a typed UpdateInstallError with "Version pin not supported" title that surfaces in the existing dialog | grep src/server/update-strategy.ts "Version pin not supported" |
| Concurrent installs of two different versions race | UpdateManager.installPromise remains a single global lock; second click during install short-circuits via the existing status === "updating" branch | src/server/update-manager.ts installUpdate early return |
| compareSemverTags mislabels prereleases | Helper drops the suffix after - like server compareVersions; mismatch only affects button label, not install correctness | bun test src/server/update-manager.test.ts (compareVersions logic), src/client/app/SettingsPage.tsx inline parse |

## Verification

| Check | Result |
| --- | --- |
| bun test src/server/update-manager.test.ts src/server/update-strategy.test.ts | 24 pass, 0 fail |
| bun test src/server/ws-router.test.ts | 53 pass, 0 fail |
| bunx tsc --noEmit | clean |
| bun run lint | clean (--max-warnings=0) |
