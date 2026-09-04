---
id: c3-237
c3-seal: 640ca553a898d66fb148a66aa5f96a603f688eae55d376341e64cb6aa5427d02
title: package-autoupdate
type: component
category: feature
parent: c3-2
goal: Detect when installed packages (skills, Claude Code plugins, Codex plugins) are behind upstream and apply updates on a configurable schedule, notifying the user and optionally auto-applying per kind.
uses:
    - ref-side-effect-adapter
---

# package-autoupdate

## Goal

Detect when installed packages (skills, Claude Code plugins, Codex plugins) are behind upstream and apply updates on a configurable schedule, notifying the user and optionally auto-applying per kind.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-2 Server |
| Runtime | Long-lived timer started from server.ts boot; adapters spawn CLI child processes |
| Consumers | ws-router-settings.ts (snapshot push), settings UI (c3-116) |
| Boundary | Pure domain in package-update-manager.ts; all IO in *.adapter.ts files |

## Purpose

Surfaces update availability for the three package kinds Kanna manages — Kanna skills, Claude Code plugins, Codex plugins — and applies updates through their respective CLI toolchains. Non-goals: managing the upstream registries themselves, supporting rollback, persisting history across server restarts.

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Precondition | server.ts boot calls PackageUpdateManager.start() | c3-202 |
| Input — inventory | package-inventory-io.adapter.ts reads lock files | c3-204 |
| Input — settings | PackageUpdateSettings from AppSettingsManager | c3-202 |
| Input — busy gate | hasAnyChatBusy() injected dep; defers auto-apply | c3-210 |
| Output — snapshot | PackageUpdateSnapshot broadcast via ws-router-settings | c3-208 |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Outcome | User sees update availability; opted-in packages update automatically | c3-116 |
| Primary path | Timer fires → runCheck() → checkers → snapshot → maybeAutoApply() |  |
| Alternate — manual | User triggers applyUpdates() from UI; same apply path, no busy-gate |  |
| Failure — check error | Stored in snapshot.error; availability marked "unknown" for affected pkgs |  |
| Failure — apply error | Exponential backoff (base 10 min, max 24 h); max 3 failures per package |  |

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-side-effect-adapter | rule | IO in *.adapter.ts only | mandatory | package-inventory-io.adapter.ts, skill-update-applier.adapter.ts, etc. |
| adr-20260902-package-auto-update | adr | applies serialized; no sidecar; unknown != up_to_date | mandatory | the four invariants below are this ADR's, not defensive choices |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| Update snapshot | OUT | PackageUpdateSnapshot per package kind (skill, claude-plugin, codex-plugin), rebuilt on every check and never persisted | c3-207 | src/server/package-update-manager.ts |
| Check request | IN | checkForUpdates() reads each kind's upstream lock file through its checker adapter | c3-312 | src/server/skill-update-checker.adapter.ts, src/server/claude-plugin-update-checker.adapter.ts, src/server/codex-plugin-update-checker.adapter.ts |
| Apply request | IN | applyUpdates() shells out to the owning CLI per kind; throws when already applying, so the caller must gate its own UI | c3-116 | src/server/package-update-manager.ts, src/server/package-update-appliers-boot.adapter.ts |
| Busy-chat veto | IN | hasAnyChatBusy() is injected and consulted before any auto-apply; a running CLI during an active turn can interfere with conversation tools | c3-210 | src/server/package-update-manager.ts |
| Settings | IN | PackageUpdateSettings in settings.json is the only configuration surface; CODEX_BINARY_PATH is the one env var | c3-206 | src/server/app-settings-package-updates.ts |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| src/server/package-update-manager.ts | Contract (check/apply/snapshot surface) and Key Invariants | Scheduling detail | src/server/package-update-manager.ts |
| src/server/skill-update-checker.adapter.ts | Contract (check request) | Upstream lock-file format | src/server/skill-update-checker.adapter.ts |
| src/server/claude-plugin-update-checker.adapter.ts | Contract (check request) | Upstream lock-file format | src/server/claude-plugin-update-checker.adapter.ts |
| src/server/codex-plugin-update-checker.adapter.ts | Contract (check request) | Upstream lock-file format | src/server/codex-plugin-update-checker.adapter.ts |
| src/server/package-update-appliers-boot.adapter.ts | Contract (apply request) | Per-kind CLI invocation | src/server/package-update-appliers-boot.adapter.ts |

## Key Invariants

**Applies are serialized.** `applyUpdates()` throws if `status === "applying"`. The UI must check `snapshot.status` and disable the Apply button while applying. Concurrent CLI invocations could corrupt lock files.

**`unknown` is not `up_to_date`.** `UpdateAvailability` has four values. `unknown` means the check failed (rate-limit, network error). UI must render a distinct state — do not coerce it to `up_to_date` or ignore it.

**All state is in-memory.** `PackageUpdateSnapshot` and `autoApplyHistory` are rebuilt on every check. No Kanna-owned sidecar file is written. The upstream lock files are the source of truth for what is installed.

**Auto-apply defers when any chat is busy.** The `hasAnyChatBusy()` dep is injected; a running CLI during an active turn could interfere. Auto-apply is not retried in the same check cycle — it waits for the next timer tick.

**`CODEX_BINARY_PATH` is the only env var.** Defaults to `~/.local/bin/codex`. No other behavior is env-var gated.

## Files

| File | Role |
| --- | --- |
| src/server/package-update-manager.ts | Pure domain: timer, check loop, apply serialization, auto-apply backoff |
| src/server/package-update-manager.test.ts | Colocated unit tests |
| src/server/package-inventory-io.adapter.ts | Reads lock files for all three kinds |
| src/server/package-inventory-io.adapter.test.ts | Colocated tests |
| src/server/package-update-appliers-boot.adapter.ts | Wires three applier adapters at boot |
| src/server/skill-update-checker.adapter.ts | GitHub Trees API check for skills |
| src/server/skill-update-applier.adapter.ts | kanna/skills CLI apply for skills |
| src/server/claude-plugin-update-checker.adapter.ts | GitHub Trees API check for Claude plugins |
| src/server/codex-plugin-update-checker.adapter.ts | GitHub check for Codex plugins |
| src/server/codex-plugin-update-applier.adapter.ts | codex CLI apply for Codex plugins |
