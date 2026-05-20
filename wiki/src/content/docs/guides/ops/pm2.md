---
title: Deploy with pm2
description: pm2 process manager for VPS deployments.
---

## Install

```bash
bun install -g pm2
```

## Start

```bash
KANNA_PORT=3210 KANNA_PASSWORD=changeme pm2 start --name kanna kanna
pm2 save
pm2 startup
```

## In-app self-update under pm2

Kanna's self-update button detects pm2 and reloads via `pm2 reload kanna`. No extra config needed.

## Logs

```bash
pm2 logs kanna
```

## Stop / restart

```bash
pm2 stop kanna
pm2 restart kanna
```
