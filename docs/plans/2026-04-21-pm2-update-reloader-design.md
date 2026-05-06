# pm2 Update Reloader Design

Date: 2026-04-21
Scope: dev-only deploy workflow on macOS.

## Goals

1. Replace the launchd job (`io.silentium.kanna`) used by `scripts/deploy.sh` with pm2 as the process supervisor for the author's local dev machine.
2. Keep the in-app "Update" button working, but wire it to a pm2 reload pipeline (git pull → build → `pm2 reload`) when running under pm2.
3. Abstract the update path so the reload mechanism can be swapped without touching `UpdateManager`.

End-user install flow (`bunx kanna`, `bun install -g kanna-code`) is unchanged. The existing supervisor-fork path in `bin/kanna` + `cli-supervisor.ts` remains the default.

## Non-goals

- Shipping pm2 as a runtime dependency for end users.
- Daemon mode / background process for end users.
- Git-based update flow for end users (they stay on npm-registry self-update).
- Auto-rollback on failed build.

## Current state

- `bin/kanna` forks `cli-supervisor.ts` (parent) → `cli.ts` (child).
- Supervisor restarts child on exit code 75 (startup self-update) or 76 (UI-triggered update).
- `update-manager.ts` drives the UI: checks npm registry via `fetchLatestVersion`, installs via `installVersion` (`bun install -g kanna-code@<ver>`), then child exits 76 → supervisor respawns.
- `scripts/deploy.sh` symlinks the global install to the repo, runs `bun run build`, then `launchctl kickstart -k gui/<uid>/io.silentium.kanna` to restart the launchd job.

## Architecture

### New interfaces — `src/server/update-strategy.ts`

```ts
export interface UpdateChecker {
  check(): Promise<{ latestVersion: string | null; updateAvailable: boolean }>
}

export interface UpdateReloader {
  reload(): Promise<void>
}
```

### Implementations

| Impl | Purpose |
|------|---------|
| `NpmChecker` | Wraps `fetchLatestPackageVersion` + `compareVersions`. Default. |
| `GitChecker` | `git fetch origin main` then compares `git rev-parse HEAD` vs `origin/main`. `latestVersion` = short SHA. |
| `SupervisorExitReloader` | Runs current `installPackageVersion` then `process.exit(CLI_UI_UPDATE_RESTART_EXIT_CODE)`. |
| `Pm2Reloader` | git pull → conditional `bun install` → `bun run build` → `pm2.reload("kanna")`. Fail-fast, throws on any non-zero step. |

### Selection

Factory `createUpdateStrategy()` reads `KANNA_RELOADER`:

- unset / `"supervisor"` → `{ checker: NpmChecker, reloader: SupervisorExitReloader }` (default, unchanged behavior).
- `"pm2"` → `{ checker: GitChecker, reloader: Pm2Reloader }`.
- anything else → throw at startup.

`Pm2Reloader` reads `KANNA_REPO_DIR` (set by `deploy.sh`) to resolve the working directory for git/build commands.

### UpdateManager changes

`UpdateManagerDeps` swaps `fetchLatestVersion` + `installVersion` for `checker: UpdateChecker` + `reloader: UpdateReloader`. `checkForUpdates()` delegates to `checker.check()`. `installUpdate()` delegates to `reloader.reload()` and surfaces thrown errors via `UpdateSnapshot.error` + `install_failed` error code. Existing devMode, concurrent-install, caching, and listener semantics preserved.

Wiring in `cli.ts`: call `createUpdateStrategy()` where UpdateManager is constructed today; pass `checker` and `reloader` into `new UpdateManager(...)`.

### pm2 reload internals

Uses the `pm2` npm package programmatic API:

```ts
import pm2 from "pm2"
await new Promise<void>((resolve, reject) => {
  pm2.connect((err) => {
    if (err) return reject(err)
    pm2.reload("kanna", (reloadErr) => {
      pm2.disconnect()
      reloadErr ? reject(reloadErr) : resolve()
    })
  })
})
```

Shell steps (`git pull`, `bun install`, `bun run build`) run via `spawn` with stdio captured. On non-zero exit the reloader throws `Error` with `"<step> failed: <stderr tail>"`.

## pm2 config — `scripts/pm2.config.cjs.tmpl`

Template rendered by `deploy.sh` (envsubst) to produce `scripts/pm2.config.cjs`:

```js
module.exports = {
  apps: [{
    name: "kanna",
    script: "./src/server/cli.ts",
    interpreter: "bun",
    cwd: "${REPO_DIR}",
    env: {
      KANNA_RELOADER: "pm2",
      KANNA_REPO_DIR: "${REPO_DIR}",
      KANNA_DISABLE_SELF_UPDATE: "1",
      KANNA_CLI_MODE: "child",
    },
    autorestart: true,
    max_memory_restart: "1G",
    kill_timeout: 5000,
  }]
}
```

`KANNA_CLI_MODE=child` makes `bin/kanna` skip the supervisor branch — pm2 is the supervisor.

## `scripts/deploy.sh`

- Keep: symlink `$HOME/.bun/install/global/node_modules/kanna-code` → `$REPO_DIR`; `bun install` if lockfile changed; `bun run build`.
- Replace launchd block with: pm2 install check → render pm2 config from template → `pm2 reload` if process exists, else `pm2 start` → `pm2 save`.
- One-shot by hand (not scripted): `launchctl bootout gui/$(id -u)/io.silentium.kanna` to remove the old launchd job; `pm2 startup` to register pm2 itself for boot.

## Error handling

Fail-fast pipeline (Q9 option A): any step failure aborts, surfaces stderr tail in `UpdateSnapshot.error`, pm2 keeps running the old build. No auto-rollback.

## Testing

### Unit — `src/server/update-strategy.test.ts`

- `createUpdateStrategy()` env matrix: unset, `"supervisor"`, `"pm2"`, unknown.
- `NpmChecker` — mocked `fetchLatestVersion`.
- `GitChecker` — stubbed spawn returning canned `git rev-parse` / `git fetch` output; updateAvailable when SHAs differ.
- `Pm2Reloader.reload()` — stubbed spawn + pm2 API; verify pipeline order; verify throws with captured stderr on non-zero exit; verify skips `bun install` when lockfile unchanged.
- `SupervisorExitReloader` — stubbed `installVersion` + `process.exit`; exit code 76 on success, throws on install failure.

### Unit — `src/server/update-manager.test.ts`

Update existing tests to inject fake `checker` + `reloader` fixtures. Preserve all scenarios (devMode, concurrent install, error path, listener notifications).

### Manual verification

1. Run `./scripts/deploy.sh`; `pm2 list` shows `kanna` online.
2. Commit + push a change; click Update in UI → pipeline runs, pm2 reloads, new code live.
3. Push a syntax error; click Update → red banner with build-failure stderr tail; pm2 keeps serving old build.
4. `pm2 delete kanna`, run `kanna` in a terminal → supervisor path still works (regression).

## Rollout

- Ship behind `KANNA_RELOADER`; unset = no behavior change for end users or other contributors.
- Old `deploy.sh` preserved in git history.
- Manual one-shots noted in PR body: unload old launchd plist, run `pm2 startup`.

## Open questions

None blocking implementation.
