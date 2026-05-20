---
title: Self-host basics
description: Env vars, persistence, ports.
---

## Required env vars

| Var | Purpose |
|---|---|
| `KANNA_HOME` | Data directory (defaults to `~/.kanna/`) |
| `KANNA_PORT` | HTTP port (defaults to `3210`) |
| `KANNA_PASSWORD` | HTTP/WS/API password gate (recommended for exposed deployments) |

## OAuth pool

For subscription billing, register OAuth tokens via the UI (Settings → OAuth Pool) or seed `KANNA_HOME/oauth-pool.json` directly. See [OAuth Pool Admin](/guides/ops/oauth-pool-admin/).

## Persistence

All Kanna state lives under `$KANNA_HOME`:

- `chats/` — chat transcripts, events
- `projects/` — project metadata
- `oauth-pool.json` — registered OAuth tokens
- `settings.json` — user settings

Back this directory up. Losing it loses chat history.

## Reverse proxy

Kanna does not terminate TLS itself. Front it with Caddy / nginx / Cloudflare Tunnel. Enable `KANNA_PASSWORD` if exposing publicly.
