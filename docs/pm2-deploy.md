# PM2 Deploy Recipe

Run Kanna as a long-lived background process under [pm2](https://pm2.keymetrics.io/) using the published global binary, isolated from any developer shell that might be a Claude Code session.

## Why this matters

When the `pm2` daemon is spawned from inside a Claude Code shell, it permanently inherits parent env vars such as:

- `CLAUDECODE=1`
- `CLAUDE_CODE_SESSION_ID`
- `CLAUDE_CODE_EXECPATH`
- `CLAUDE_CODE_SUBAGENT_MODEL`
- `CLAUDE_CODE_DISABLE_AUTO_MEMORY`
- `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`
- `AI_AGENT`

Kanna's `buildClaudeEnv` (`src/server/agent.ts`) strips only `CLAUDECODE` before spawning the bundled `claude` binary via `@anthropic-ai/claude-agent-sdk`. The remaining `CLAUDE_CODE_*` siblings flow through to the child and can collide with the OAuth token injected from the pool, surfacing as:

```
[quick-response] claude structured request failed: Claude Code returned an error result: Failed to authenticate. API Error: 401 Invalid authentication credentials
```

A pm2 `env:` block in `ecosystem.config.cjs` cannot fix this — pm2 always uses the daemon's parent env as the base and the `env:` block only adds or overrides keys. The fix is to spawn the daemon itself under a clean environment.

## One-time install

```bash
bun install -g @cuongtran001/kanna
which kanna   # -> /Users/<you>/.bun/bin/kanna
```

## Deploy directory layout

```
~/Desktop/repo/kanna_deploy_pm2/
└── ecosystem.config.cjs
```

The cwd is intentionally separate from the source checkout so the global binary and the deploy config can be versioned independently.

## `ecosystem.config.cjs`

```js
module.exports = {
  apps: [
    {
      name: "kanna",
      script: "/Users/<you>/.bun/bin/kanna",
      args: [
        "--no-open",
        "--cloudflared", "<TUNNEL_TOKEN>",
        "--password", "<UI_PASSWORD>",
      ],
      cwd: "/Users/<you>/Desktop/repo/kanna_deploy_pm2",
      interpreter: "none",
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      env: {
        HOME: "/Users/<you>",
        PATH: "/Users/<you>/.bun/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
        SHELL: "/bin/zsh",
        LANG: "en_US.UTF-8",
        NODE_ENV: "production",
      },
    },
  ],
}
```

The `env` block is belt-and-suspenders only; the real defense is starting the daemon under `env -i` (next section).

## Launch under a clean daemon

Run these from any terminal — the `env -i` wrapper strips inherited env so the daemon comes up clean even when the surrounding shell is a Claude Code session.

```bash
# Stop the old daemon (if any) and wipe its dump
pm2 delete all 2>/dev/null
pm2 kill
rm -f ~/.pm2/dump.pm2

# Spawn pm2 daemon with a clean environment, then start kanna
env -i \
  HOME=$HOME \
  PATH=$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin \
  SHELL=/bin/zsh \
  LANG=en_US.UTF-8 \
  USER=$USER \
  LOGNAME=$USER \
  PM2_HOME=$HOME/.pm2 \
  NODE_ENV=production \
  $HOME/.bun/bin/pm2 start \
    $HOME/Desktop/repo/kanna_deploy_pm2/ecosystem.config.cjs

# Persist for `pm2 resurrect` on reboot
pm2 save
```

## Verify the daemon is clean

```bash
pm2 env 0 | grep -iE '^(CLAUDE|ANTHROPIC|AI_AGENT)'
# Expected output: empty
```

If anything prints, the daemon inherited env from a Claude Code session — repeat the launch steps from a non-Claude shell or use the `env -i` wrapper above.

## Routine commands

| Command | Effect |
| --- | --- |
| `pm2 status kanna` | Process state |
| `pm2 logs kanna --lines 50` | Tail stdout/stderr |
| `pm2 restart kanna` | Restart preserving env |
| `pm2 reload kanna --update-env` | Restart and re-read `env:` block |
| `pm2 save` | Persist process list to `~/.pm2/dump.pm2` |
| `pm2 resurrect` | Restore from dump (reboot recovery) |

## Updating the published binary

```bash
bun install -g @cuongtran001/kanna@latest
pm2 restart kanna
```

The pm2 process keeps the same env and args; only the binary on disk changes.

## Troubleshooting 401

1. `pm2 env 0 | grep CLAUDE` — must be empty. If not, restart daemon under `env -i`.
2. Verify the OAuth pool has at least one `active` (non-`limited`) token via the Kanna UI Settings → Claude accounts.
3. Test a token directly against the bundled binary:
   ```bash
   CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-... \
     $HOME/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude \
     -p "hi" --model claude-haiku-4-5-20251001
   ```
   A real reply confirms the token is valid; a 401 means the token was revoked and must be re-minted from `claude /login`.
