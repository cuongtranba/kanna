---
title: Self-update
description: How the in-app Update button installs a new version, the two update strategies, and how to override the install command.
---

The **Update** button in Kanna installs the new version and restarts the server
on it; the open page reconnects to the fresh build by itself. You can also
install any earlier release from the changelog view.

What "install" means depends on how you run Kanna, and `KANNA_RELOADER` picks it
at startup:

| `KANNA_RELOADER` | Checks | Installs and reloads | For |
| --- | --- | --- | --- |
| unset or `supervisor` | the npm registry for `@cuongtran001/kanna` | installs `@latest` globally, then the supervisor restarts Kanna | an npm or Bun global install (the default) |
| `pm2` | `git fetch`, comparing `HEAD` with `origin/main` | `git pull --ff-only`, `bun install` if the lockfile changed, `bun run build`, `pm2 reload` | running from a git checkout |

Any other value is refused at startup.

## Supervisor mode (default)

The `kanna` command runs the server as a child process. When an update is
installed the child exits with a dedicated restart code and the supervisor starts
it again on the new code. Because the restart happens inside Kanna, the button
works under any process host: pm2, systemd, Docker, `screen`, or a plain shell.

The package manager is detected from where the `kanna` binary lives:

| Binary path | Install command |
| --- | --- |
| `~/.bun/bin/kanna` | `bun install -g` |
| any path containing `pnpm/` | `pnpm add -g` |
| any path containing `.yarn/` | `yarn global add` |
| anything else | `npm install -g` |

If the detected manager is not on `PATH`, Kanna falls back through bun, npm,
pnpm and yarn in that order.

### Override the install command

Set `KANNA_UPDATE_COMMAND` to replace the install step entirely, for a custom
installer, a wrapper script, or a container pull. `{package}` and `{version}`
are substituted, and the result runs through `sh -c`:

```bash
KANNA_UPDATE_COMMAND="npm install -g {package}@{version}" kanna
KANNA_UPDATE_COMMAND="my-deploy-hook && npm install -g {package}@{version}" kanna
```

## pm2 mode (git checkout)

For a checkout you run under pm2, set `KANNA_RELOADER=pm2` and point
`KANNA_REPO_DIR` at the checkout. Kanna refuses to start in pm2 mode without
`KANNA_REPO_DIR`, so a misconfiguration fails loudly rather than silently doing
nothing.

If any step fails, the UI shows the error with the tail of its output and the
old build keeps serving.

`scripts/deploy.sh` sets both variables for you; see
[Cloudflare tunnel](/guides/ops/cloudflare-tunnel/) for the full macOS recipe and
[Deploy with pm2](/guides/ops/pm2/) for an npm install under pm2.

## Adding another strategy

The checker and the reloader are two small interfaces in
`src/server/update-strategy.ts`, selected in `createUpdateStrategy`. A new
mechanism (a Docker image pull, a systemd unit) is a new branch there; nothing in
the update manager, the server or the client has to change.
