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

## Telemetry (OTel)

Kanna exports traces and metrics via OTLP (default endpoint: `https://kanna-otel.lowbit.link`). Enable/disable under Settings → Telemetry Tracing or via env vars.

Every exported span and metric carries these OTel resource attributes:

| Attribute | Value |
|---|---|
| `service.name` | `kanna-<machine name>` (override with `KANNA_OTEL_SERVICE_NAME`) |
| `service.version` | The running Kanna version (e.g. `1.37.0`) — bumped by every release |
| `host.name` | Raw machine display name |

`service.version` enables per-release filtering and grouping in your observability stack:

- **Tempo / TraceQL**: `{resource.service.version="1.37.0"}`
- **Prometheus**: `kanna_process_rss_bytes{service_version="1.37.0"}` or `by (service_version)`

Key env vars:

| Var | Default | Purpose |
|---|---|---|
| `KANNA_OTEL` | (unset) | `disabled` hard-disables; `enabled` overrides the Settings toggle |
| `KANNA_OTEL_SERVICE_NAME` | `kanna-<machine>` | Override the service name |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | (unset) | Override the OTLP endpoint for all signals |
| `KANNA_OTEL_METRIC_INTERVAL_MS` | `15000` | Metric export interval in ms |
