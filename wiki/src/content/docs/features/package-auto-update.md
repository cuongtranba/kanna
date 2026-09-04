---
title: Package Auto-Update
description: How Kanna detects and applies updates for installed skills, Claude Code plugins, and Codex plugins.
---

Kanna can detect when your installed packages are out of date and optionally apply updates automatically, keeping your agent environment current without manual intervention.

## What it manages

Three kinds of packages are tracked:

| Kind | Source of truth | Updated via |
| --- | --- | --- |
| **Kanna skills** | `~/.agents/.skill-lock.json` | Kanna's built-in skill installer |
| **Claude Code plugins** | `~/.claude/plugins/installed_plugins.json` | Claude Code plugin CLI |
| **Codex plugins** | `~/.codex/skills/` directory | `codex` CLI (`CODEX_BINARY_PATH`) |

## How update checks work

Background checking runs **every 24 hours** by default, and the interval is clamped to between 1 hour and 30 days. For each installed package Kanna compares the local revision (lock file hash or installed version) against the latest available from the package's source repository.

Turning background checking off does **not** disable updates — **Check for updates** still works on click.

### Update availability states

| State | Meaning |
| --- | --- |
| `up_to_date` | Local revision matches latest |
| `outdated` | A newer revision is available |
| `partial` | Some components updated, others not |
| `unknown` | The check failed (network error, GitHub rate-limit) |

**`unknown` is not the same as `up_to_date`.** When a check fails, Kanna cannot determine whether an update exists. The UI shows a distinct indicator so you know to try again rather than assuming everything is current.

## Enabling auto-update

By default Kanna only *tells* you an update exists — auto-apply is opt-in, and starts with no package kinds selected.

1. Open **Settings → Plugins** (skills also appear under **Settings → Skills**).
2. Enable auto-update.
3. Choose which **package kinds** to auto-apply — you can auto-update skills while reviewing Claude plugin updates by hand.

Auto-apply defers when any chat is active — Kanna will not run update CLIs while a conversation is in flight, since that could interfere with running tools.

## How applies work

Updates are applied **one at a time**, in sequence. While an apply is in progress, the Apply button in Settings is disabled and `status` shows `"applying"`.

For auto-apply, packages that fail to apply enter an exponential backoff (starting at 10 minutes, capped at 24 hours). After 3 consecutive failures a package is skipped from auto-apply until the next manual trigger.

The last 50 auto-apply results are shown in **Settings → Plugins**. This history is in-memory only and resets on server restart.

## Codex binary path

The Codex plugin applier calls the `codex` CLI. If yours is not at `~/.local/bin/codex`, set the `CODEX_BINARY_PATH` environment variable to the correct path before starting Kanna.

## Where revisions live

Kanna does not write its own sidecar files. The upstream lock files are the source of truth:

- Skills: `~/.agents/.skill-lock.json` (skill folder hashes)
- Claude plugins: `~/.claude/plugins/installed_plugins.json`
- Codex plugins: `~/.codex/skills/` directory

After a successful apply, Kanna re-reads the lock file to record the new revision in the update history.
