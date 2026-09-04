---
title: Deploy with pm2
description: pm2 process manager for VPS deployments.
---

## Install

```bash
bun install -g pm2
```

## Start

Port and password are CLI flags, so they go after `--`:

```bash
pm2 start --name kanna kanna -- --port 3210 --password changeme --no-open
pm2 save
pm2 startup
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

:::caution[`max_memory_restart` above 2 GB is silently clamped]
pm2 7.0.3 clamps the value at 2³¹ bytes: both `"3G"` and `"4G"` resolve to
`2147483648`. Raising the ceiling past 2 GB is not available, so if Kanna is
being restarted for memory, the lever is reducing RSS rather than raising the
limit. `KANNA_MEMLOG_MS` and the SIGUSR2 heap snapshot
([Self-host basics](/guides/ops/self-host/#diagnosing-a-slow-or-heavy-install))
are how you find out what is holding it.
:::

## Logs

```bash
pm2 logs kanna
```

## Stop / restart

```bash
pm2 stop kanna
pm2 restart kanna
```
