---
id: adr-20260902-package-auto-update
title: package-auto-update
type: adr
goal: Record the contested design decisions for the package auto-update feature so that future changes are grounded in the original constraints.
status: proposed
date: "2026-09-02"
---

# adr-20260902-package-auto-update

## Goal

Record the contested design decisions for the package auto-update feature so that future changes are grounded in the original constraints.

## Context

Kanna manages three kinds of user-installed packages: Kanna skills (`.claude/skills/` dirs with a `.skill-lock.json` lock), Claude Code plugins (`~/.claude/plugins/installed_plugins.json`), and Codex skills (`~/.codex/skills/`). Before this feature, update availability was invisible and updates were applied by hand.

The feature needed to:
1. Detect when installed packages are behind upstream.
2. Notify the user without forcing any action.
3. Optionally apply updates automatically when the user opts in.
4. Not disrupt running chats.

## Decisions

### D1 — Three package kinds, not a unified abstraction

`PackageKind = "skill" | "claude-plugin" | "codex-plugin"`. Each kind has its own lock-file format, install toolchain, and upgrade path. A single "package" abstraction with a pluggable backend is not more expressive than three named kinds and three concrete checker/applier pairs; it just adds indirection. The checker and applier interfaces are intentionally minimal (`check`, `apply`) and the boot adapter (`package-update-appliers-boot.adapter.ts`) wires the three concrete adapters without any registry.

### D2 — Timer-driven check, not event-driven

Update checks run on a configurable interval (`checkIntervalMs`, clamped to [1 h, 30 d]). Push notifications from upstream are not available for any of the three package sources today, so polling is the only option. `PackageUpdateManager.start()` arms the timer from `server.ts` boot; `stop()` clears it on shutdown.

### D3 — Notify first, auto-apply opt-in per kind

`autoApply` defaults to `false`. When enabled, `autoApplyKinds` is a per-kind opt-in array: a user can auto-apply skills while reviewing Claude plugin updates manually. Auto-apply defers when `hasAnyChatBusy()` returns true — running a CLI during an active turn could interfere with the conversation.

### D4 — Applies are strictly serialized

`PackageUpdateManager.applyUpdates()` rejects with an error if `status === "applying"`. This is a hard guard, not advisory: concurrent CLI invocations could corrupt lock files. The `status` field of `PackageUpdateSnapshot` exposes this to the UI, which disables the Apply button while one is in flight.

### D5 — All state is in-memory; no Kanna-owned sidecar

The source of truth for what is installed lives in the upstream lock files (`~/.agents/.skill-lock.json`, `installed_plugins.json`, `~/.codex/skills/`). Kanna's `PackageUpdateSnapshot` is an in-memory view rebuilt on every check. `autoApplyHistory` (last 50 entries) is also in-memory only and is lost on restart — intentionally, because it is a convenience audit trail, not a billing or compliance record.

### D6 — `unknown` is not `up_to_date`

`UpdateAvailability` has four values: `up_to_date`, `outdated`, `partial`, `unknown`. `unknown` means the check failed (GitHub rate-limited, network error, etc.) and must be treated as "we don't know" rather than "all good." The UI renders a distinct state for `unknown` so the user can see that the check failed rather than silently assuming currency.

### D7 — Auto-apply backoff: exponential, capped at 3 failures

A package that fails to apply enters an exponential backoff (base 10 min, max 24 h). After 3 consecutive failures it is removed from the candidate set entirely (`AUTO_APPLY_MAX_FAILURES = 3`). The user can always trigger a manual apply, which bypasses the backoff.

### D8 — `CODEX_BINARY_PATH` is the only new env var

The Codex applier calls the `codex` CLI. Its path defaults to `~/.local/bin/codex` and can be overridden via `CODEX_BINARY_PATH`. No other env var was added for this feature; all other behavior is configured through the settings UI.

## Consequences

- Adding a fourth package kind requires: a new checker adapter, a new applier adapter, one entry in `package-update-appliers-boot.adapter.ts`, a new `PackageKind` union member, and corresponding UI updates. The three-kind pattern makes the extension surface clear.
- The in-memory-only design means no migration risk when the snapshot shape changes. The cost is that the last-50 auto-apply history is lost on restart.
- The busy-chat gate (D3) means auto-apply never races a running turn, at the cost of delaying an update until the user's conversation is idle.
