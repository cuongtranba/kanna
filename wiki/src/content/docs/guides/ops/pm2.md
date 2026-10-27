---
title: Deploy with pm2
description: pm2 process manager for VPS deployments.
---

## Install

```bash
bun install -g pm2
bun install -g @cuongtran001/kanna
```

## Start

Port and password are CLI flags, so they go after `--`:

```bash
pm2 start --name kanna kanna -- --port 3210 --password changeme --no-open
pm2 save
pm2 startup
```

Or keep the settings in an `ecosystem.config.cjs`, in a directory of its own so the
deploy config is versioned apart from any source checkout:

```js
module.exports = {
  apps: [
    {
      name: "kanna",
      script: "/home/<user>/.bun/bin/kanna",
      args: ["--no-open", "--port", "3210", "--password", "<UI_PASSWORD>"],
      interpreter: "none",
      exec_mode: "fork",
      autorestart: true,
      watch: false,
    },
  ],
}
```

Do not set `NODE_ENV`. Kanna's own mode comes from `KANNA_RUNTIME_PROFILE`
(production unless it is `dev`), and Kanna never passes its `NODE_ENV` on to the
agents, terminals and loop checks it starts for a project.

## Start the pm2 daemon with a clean environment

The pm2 daemon keeps the environment of the shell that first started it, and every
process it launches inherits that environment. pm2's `env:` block can only add or
override keys, never remove them. If the daemon was first started from inside a
Claude Code session, it carries `CLAUDE_CODE_SESSION_ID`, `CLAUDE_CODE_EXECPATH`,
`AI_AGENT` and similar variables. Kanna removes only `CLAUDECODE` before it starts
Claude, so the rest reach the agent and can override the OAuth token from the pool,
which shows up as:

```text
Failed to authenticate. API Error: 401 Invalid authentication credentials
```

Start the daemon itself under `env -i` so it comes up clean whatever shell you are
in:

```bash
pm2 delete all 2>/dev/null
pm2 kill
rm -f ~/.pm2/dump.pm2

env -i \
  HOME=$HOME \
  PATH=$HOME/.bun/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin \
  SHELL=/bin/bash \
  LANG=en_US.UTF-8 \
  USER=$USER \
  LOGNAME=$USER \
  PM2_HOME=$HOME/.pm2 \
  $HOME/.bun/bin/pm2 start /path/to/ecosystem.config.cjs

pm2 save
```

Check that nothing leaked in. This must print nothing:

```bash
pm2 env 0 | grep -iE '^(CLAUDE|ANTHROPIC|AI_AGENT)'
```

## In-app self-update under pm2

Two strategies, and the default is the one you want for a normal npm install.

- **`supervisor` (default).** The self-update button installs the new version
  from npm and exits; pm2 restarts the process on the new code. Nothing to
  configure — this is what runs unless you say otherwise.
- **`KANNA_RELOADER=pm2`.** For running Kanna from a **git checkout** rather
  than the npm package: it pulls, rebuilds, and runs `pm2 reload`. It requires
  `KANNA_REPO_DIR` pointing at that checkout and **throws at startup without
  it** — the failure is loud, not silent.

Kanna does not sniff for pm2. Setting neither variable is correct under pm2.

To update by hand instead, install the new version and restart; pm2 keeps the same
environment and arguments:

```bash
bun install -g @cuongtran001/kanna@latest
pm2 restart kanna
```

:::caution[`max_memory_restart` above 2 GB is silently clamped]
pm2 7.0.3 clamps the value at 2³¹ bytes: both `"3G"` and `"4G"` resolve to
`2147483648`. Raising the ceiling past 2 GB is not available, so if Kanna is
being restarted for memory, the lever is reducing RSS rather than raising the
limit. `KANNA_MEMLOG_MS` and the SIGUSR2 heap snapshot
([Self-host basics](/guides/ops/self-host/#diagnosing-a-slow-or-heavy-install))
are how you find out what is holding it.
:::

### Tabs left open across an upgrade

The client bundle is content-hashed, so an upgrade deletes the previous chunks. A
tab loaded before the restart still runs the old code, and the first lazily loaded
feature it opens (a Mermaid diagram, syntax highlighting) asks for a chunk that no
longer exists. **Reload the tab**; the deploy is fine. A Mermaid diagram in that
state says "This diagram needs the latest version of the app" and offers a
**Reload** button, and a later attempt in the same tab retries instead of staying
broken.

To confirm the served build is consistent after a deploy:

```bash
# The entry chunk index.html references must exist
curl -s http://127.0.0.1:3210/ | grep -o '/assets/index-[^"]*\.js'
# A missing asset must be a 404, never text/html
curl -sI http://127.0.0.1:3210/assets/does-not-exist.js | head -2
```

## Logs and restarts

| Command | Effect |
| --- | --- |
| `pm2 status kanna` | Process state |
| `pm2 logs kanna --lines 50` | Tail stdout and stderr |
| `pm2 stop kanna` | Stop |
| `pm2 restart kanna` | Restart with the same environment |
| `pm2 reload kanna --update-env` | Restart and re-read the `env:` block |
| `pm2 save` | Save the process list for `pm2 resurrect` after a reboot |

## Troubleshooting a 401

1. `pm2 env 0 | grep CLAUDE` must print nothing. If it does, restart the daemon
   under `env -i` as above.
2. In Settings → Claude accounts, check that the OAuth pool has at least one
   `active` (not `limited`) token.
3. Test a token against the `claude` binary Kanna ships with. For a `bun install -g`
   install it is in
   `~/.bun/install/global/node_modules/@anthropic-ai/claude-agent-sdk-<platform>/`,
   where `<platform>` is for example `linux-x64` or `darwin-arm64`:

   ```bash
   CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-... \
     ~/.bun/install/global/node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude \
     -p "hi" --model claude-haiku-4-5-20251001
   ```

   A reply means the token works. A 401 means it was revoked; mint a new one
   through the OAuth pool in Settings.
