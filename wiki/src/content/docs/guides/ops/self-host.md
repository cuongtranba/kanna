---
title: Self-host basics
description: CLI flags, persistence, ports.
---

## Configuration is CLI flags, not env vars

Kanna is configured on the command line. There is no `KANNA_PORT`,
`KANNA_PASSWORD` or `KANNA_HOME` — those names appear in a lot of stale
snippets, but Kanna has never read them.

```
kanna [options]

  --port <number>        Port to listen on (default: 3210)
  --host <host>          Bind to a specific host or IP
  --remote               Shortcut for --host 0.0.0.0
  --password <secret>    Require a password before loading the app
  --share                Create a public Cloudflare quick tunnel, with a terminal QR
  --cloudflared <token>  Run a named Cloudflare tunnel from a token
  --strict-port          Fail instead of trying another port
  --no-open              Don't open a browser automatically
  --version              Print version and exit
  --help                 Show help
```

A typical exposed deployment:

```bash
kanna --remote --port 3210 --password 'a-long-random-secret' --no-open
```

`kanna --help` is the authoritative list; the table above mirrors it.

## Persistence

All state lives under `~/.kanna`, resolved from the process's `HOME`:

| Path | Holds |
| --- | --- |
| `~/.kanna/data/` | chats, transcripts, event logs, project metadata |
| `~/.kanna/data/settings.json` | every setting, including Claude OAuth tokens, custom MCP servers, and custom models |
| `~/.kanna/keybindings.json` | keybinding overrides |
| `~/.kanna/llm-provider.json` | quick-response LLM provider config |
| `~/.kanna/terminals.json` | embedded-terminal registry |

Back up `~/.kanna`. Losing it loses chat history.

:::note[Relocating the data directory]
The path is not configurable by a flag or a var — it is always `$HOME/.kanna`.
To put it elsewhere, run the process with a different `HOME` (this is exactly
what the Playwright suite does to get a throwaway instance):

```bash
HOME=/srv/kanna kanna --remote --password '<secret>'
```

Note that this changes `HOME` for everything the agent spawns too, including
the `claude` and `codex` CLIs and their own credentials.
:::

Setting `KANNA_RUNTIME_PROFILE=dev` switches the root to `~/.kanna-dev`, so a
development run cannot touch real chats. `bun run dev` sets it for you.

## Reverse proxy

Kanna does not terminate TLS itself. Front it with Caddy / nginx / Cloudflare
Tunnel. Use `--password` if exposing it publicly.

## Telemetry (OTel)

Kanna exports traces and metrics via OTLP (default endpoint:
`https://kanna-otel.lowbit.link`). Toggle it under **Settings → General →
Telemetry Tracing**; the toggle applies immediately, with no restart.

Every exported span and metric carries these OTel resource attributes:

| Attribute | Value |
| --- | --- |
| `service.name` | `kanna-<machine name>` (override with `KANNA_OTEL_SERVICE_NAME`) |
| `service.version` | The running Kanna version — bumped by every release |
| `host.name` | Raw machine display name |

`service.version` enables per-release filtering and grouping:

- **Tempo / TraceQL**: `{resource.service.version="1.44.0"}`
- **Prometheus**: `kanna_process_rss_bytes{service_version="1.44.0"}` or `by (service_version)`

Key env vars:

| Var | Default | Purpose |
|---|---|---|
| `KANNA_OTEL` | (unset) | `disabled` hard-disables; `enabled` overrides the Settings toggle |
| `KANNA_OTEL_SERVICE_NAME` | `kanna-<machine>` | Override the service name |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | (unset) | Override the OTLP endpoint for all signals |
| `KANNA_OTEL_METRIC_INTERVAL_MS` | `15000` | Metric export interval in ms |

## Diagnosing a slow or heavy install

Two knobs worth knowing before you need them:

- `KANNA_MEMLOG_MS` (default 60000) prints one `[kanna/mem] rss=…` line per
  interval. This is the correlation record if the process is ever OOM-killed.
- `kill -USR2 <pid>` writes a Chrome-DevTools-loadable heap snapshot under the
  data dir — the only way to answer *what* is holding the bytes on a live
  process. `KANNA_HEAP_SNAPSHOT=disabled` opts out.
