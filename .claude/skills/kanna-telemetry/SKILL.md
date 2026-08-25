---
name: kanna-telemetry
description: Instrument Kanna's code with spans, counters and gauges, and operate the collector that receives them. Read this BEFORE writing any instrumentation — Kanna has one permitted import path for it and a naming convention, so hand-rolled timing code gets rejected by the side-effect lint. Use whenever the task is to measure something: "add a metric", "add a counter", "log performance", "time this", "instrument this", "track how often X happens", "how long does X take", "why is this slow", profiling a turn or a subagent run, memory growth, RSS, heap, an OOM kill, or a pm2 max_memory_restart loop. Use it equally for the collector side: telemetry, tracing, spans, the observability stack, kanna-otel.lowbit.link, kanna-grafana.lowbit.link, Grafana dashboards for Kanna, "why is no telemetry arriving", turning telemetry on or off in settings, or redeploying and debugging the otel-lgtm service on lowbit Dokploy.
---

# Kanna telemetry — instrument, then observe

Two halves: adding instrumentation to Kanna's code, and operating the collector
that receives it. Start with **Instrumenting code** if the task is "measure this";
start with **Health check** if the task is "the telemetry is broken".

## Instrumenting code

Domain code imports `src/server/observability.ts` and nothing else — a pure facade
over `@opentelemetry/api` exposing `withSpan`, `addCounter`, and `recordUpDown`.
The SDK itself loads only in `src/server/otel.adapter.ts`, the one file permitted
to import it. That split is what makes instrumentation free to add: with no SDK
registered every facade call is the api package's no-op, so instrumented code needs
no test doubles and costs nothing when telemetry is off. Importing the adapter — or
any `@opentelemetry/sdk-*` package — from domain code breaks the side-effect seal
and fails lint.

Spans nest through AsyncLocalStorage, so adding depth is a one-line `withSpan` at
the call site with no handle to thread through the call chain.

Already instrumented, and worth extending rather than duplicating: spans
`kanna.turn.start` (the spawn pipeline), `kanna.subagent.run` (a loop's unit of
work), `kanna.loop.wake.deliver`; counters `kanna.subagent.run.finished`,
`kanna.autocontinue.fired`, `kanna.queued_message.recovered`,
`kanna.loop.wake.recovered`; and process-memory gauges.

Name new instruments `kanna.<area>.<thing>` so they group in Grafana alongside
these.

## Memory questions specifically

For "RSS is climbing" or an OOM kill, two tools answer different questions and both
are already wired:

- `KANNA_MEMLOG_MS` (default 60000, `0` disables) prints one `[kanna/mem] rss=…`
  line per interval. This is the correlation record — three OOM kills went
  undiagnosed for want of exactly this.
- `kill -USR2 <pid>` writes a Chrome-DevTools-loadable `.heapsnapshot` under
  `<dataDir>/heap-snapshots` (`KANNA_HEAP_SNAPSHOT=disabled` opts out). It is the
  only way to answer *what holds the bytes* on a live process.

The known heavy allocator is transcript parsing: one 96 MB transcript costs ~524 MB
peak RSS to parse (~5.4x its source bytes). Before optimizing, check whether the
path in question loads a whole transcript when a tail read would do.

## The collector (lowbit Dokploy)

One collector, many Kanna installs. Each install reports under
`service.name = kanna-<machine name>` (its computer name), so the Grafana
service dropdown is the inventory of live distributions. Telemetry is a
user-facing Kanna setting (default ON) — "no data" is usually the setting,
not the stack.

## Deployed topology (verified 2026-08-14)

| Fact | Value |
|---|---|
| Dokploy install | lowbit — `$LOWBIT_DOKPLOY_BASE_URL`, key `$LOWBIT_DOKPLOY_API_KEY` from `~/.config/dokploy/env` (never inline the key) |
| Project | `observability` (`_WxA9mpkAogz9h6hEYaja`), env `production` (`-JZ9m8QuozlfkswziqJbr`) |
| Compose | `otel-lgtm` (`RjoiChI_VwjX1UBlg5a-j`), appName `compose-index-auxiliary-circuit-88jw2k`, sourceType **raw** (compose file lives IN Dokploy — edit via `compose.update`, no git involved) |
| Image | `grafana/otel-lgtm:latest`, single service `otel-lgtm`, volumes `grafana-data:/data/grafana`, `prometheus-data:/data/prometheus`, `loki-data:/data/loki` |
| Grafana UI | https://kanna-grafana.lowbit.link (port 3000) — login `admin` / `GF_ADMIN_PASSWORD` from the compose env (read it via `compose.one`, never print it into chat unprompted). The otel-lgtm image ships with ANONYMOUS ADMIN access baked in (`GF_AUTH_ANONYMOUS_ENABLED=true` — it is a local-dev demo image); the compose overrides it with `GF_AUTH_ANONYMOUS_ENABLED: "false"` + `GF_AUTH_DISABLE_LOGIN_FORM: "false"`. Keep those overrides in any compose rewrite, or the public URL silently becomes admin-without-login again |
| OTLP ingest | https://kanna-otel.lowbit.link (port 4318, OTLP/HTTP) — `POST /v1/traces`, `POST /v1/metrics` |
| Auth on ingest | none (open endpoint) — acceptable for now; keep this in mind before pointing anything sensitive at it |

The general Dokploy API mechanics (env-placeholder rule, deploy verification,
domain creation) live in the sibling `dokploy` skill — read it for anything
beyond the recipes below.

## Kanna side: how an install reports

- Settings group `telemetry: {enabled, endpoint}` in `~/.kanna/data/settings.json`
  (Settings page → "Telemetry Tracing" row). Defaults: `enabled: true`,
  `endpoint: https://kanna-otel.lowbit.link`. The toggle applies at runtime —
  no server restart.
- Service name: `kanna-<sanitized machine display name>` (macOS `scutil --get
  ComputerName`, else hostname). Raw name rides the `host.name` resource attribute.
- Env overrides (all optional): `KANNA_OTEL=disabled` hard-off,
  `KANNA_OTEL=enabled` force-on, `OTEL_EXPORTER_OTLP_ENDPOINT` beats the
  settings endpoint, `KANNA_OTEL_SERVICE_NAME` beats the derived name,
  `KANNA_OTEL_METRIC_INTERVAL_MS` (default 15000).
- Precedence logic: `src/server/otel-config.ts` (`resolveOtelConfig`); adapter:
  `src/server/otel.adapter.ts`; ADR `adr-20260814-telemetry-settings-gate`.
- What arrives: spans `kanna.turn.start`, `kanna.subagent.run`,
  `kanna.loop.wake.deliver`; counters `kanna.subagent.run.finished`,
  `kanna.autocontinue.fired`, `kanna.queued_message.recovered`,
  `kanna.loop.wake.recovered`, `kanna.turn.tokens`, `kanna.turn.cost_usd`,
  `kanna.subagent.tokens`; histograms `kanna.turn.duration_ms`,
  `kanna.subagent.run.duration_ms`; gauges `kanna.process.rss_bytes`,
  `kanna.process.heap_used_bytes`, `kanna.process.heap_total_bytes`,
  `kanna.process.external_bytes`.

**Answering "which install is burning tokens".** Turn counts do not answer it —
a 200k-token turn and a 2k-token turn are one turn each. Use the token
counters, whose `kind` values partition the billed tokens so a bare `sum` is
the total:

```bash
GF_PW=<from compose.one env>
PROM="https://kanna-grafana.lowbit.link/api/datasources/proxy/uid/prometheus/api/v1"
# tokens/24h per install, highest first
curl -s -u "admin:$GF_PW" --get "$PROM/query" \
  --data-urlencode 'query=sort_desc(sum by (job) (increase(kanna_turn_tokens_total[24h])))'
# split by kind — a high cached_input share is cache working, not waste
curl -s -u "admin:$GF_PW" --get "$PROM/query" \
  --data-urlencode 'query=sum by (job, kind) (increase(kanna_turn_tokens_total[24h]))'
# what a loop spent: its per-iteration cost is a subagent run, not a chat turn
curl -s -u "admin:$GF_PW" --get "$PROM/query" \
  --data-urlencode 'query=sum by (job) (increase(kanna_subagent_tokens_total[24h]))'
```

`kanna_turn_cost_usd_total` is deliberately SPARSER than the token counters —
PTY-mode turns have no price resolver wired, so a missing cost series means
unknown, never free. Derive spend from tokens × your own rates when it is
absent. Installs older than the release that added these report no token series
at all; that is a version gap, not a quiet install.

## Recipes

Always `source ~/.config/dokploy/env` first. Use curl (python urllib gets
Cloudflare-1010-blocked on lowbit).

**Health check (do this first for any "telemetry broken" report):**
```bash
curl -s -o /dev/null -w '%{http_code}\n' https://kanna-grafana.lowbit.link/api/health   # want 200
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'Content-Type: application/json' \
  -d '{}' https://kanna-otel.lowbit.link/v1/traces                                      # want 200
curl -s -H "x-api-key: $LOWBIT_DOKPLOY_API_KEY" \
  "$LOWBIT_DOKPLOY_BASE_URL/api/docker.getContainersByAppNameMatch?appName=compose-index-auxiliary-circuit-88jw2k"
# want state=running, status "Up … (healthy)"
```

**Which installs are reporting** (Grafana datasource proxy → Prometheus):
```bash
GF_PW=<from compose.one env>
curl -s -u "admin:$GF_PW" \
  "https://kanna-grafana.lowbit.link/api/datasources/proxy/uid/prometheus/api/v1/label/job/values"
```
Each `kanna-<machine>` value is one live install. Traces: Grafana → Explore →
Tempo datasource, filter by service name.

**Container logs:**
```bash
curl -s -H "x-api-key: $LOWBIT_DOKPLOY_API_KEY" \
  "$LOWBIT_DOKPLOY_BASE_URL/api/compose.readLogs?composeId=RjoiChI_VwjX1UBlg5a-j&containerId=<id from getContainersByAppNameMatch>&tail=200&since=10m"
```

**Redeploy** (config/image change): `POST /api/compose.deploy` with
`{"composeId":"RjoiChI_VwjX1UBlg5a-j"}`, then VERIFY — fresh row in
`deployment.allByCompose` AND container uptime reset (`Up N seconds`).
Dokploy reports success it did not achieve; never trust `composeStatus` alone.

**Edit the compose file** (raw source, so the API owns it): read current via
`compose.one?composeId=…` (`composeFile` field), modify, `POST /api/compose.update`
with `{"composeId","sourceType":"raw","composeFile":"…"}`, then deploy + verify.

**Rotate the Grafana admin password:** read env via `compose.one`, replace the
`GF_ADMIN_PASSWORD=` line, `POST /api/compose.saveEnvironment` with the WHOLE
env blob (it replaces, not merges), redeploy, verify uptime reset. The
password only reaches the container because the compose file declares
`GF_SECURITY_ADMIN_PASSWORD: ${GF_ADMIN_PASSWORD}` — keep that placeholder.

## Troubleshooting

| Symptom | Likely cause → check |
|---|---|
| 526 on either host | Missing Traefik router/cert, not a dead panel — first deploy's Let's Encrypt takes ~20 s; check a known-good lowbit host, then `domain.byComposeId` |
| Ingest 200 but no data in Grafana | The POST `{}` probe proves routing only. Check the INSTALL: Settings → Telemetry Tracing on? `KANNA_OTEL=disabled` set? Server log should show `[kanna/otel] tracing + metrics enabled` with the serviceName |
| One machine missing from service list | That install toggled off, or its machine name changed (new service name). `[kanna/mem]` lines in its server log confirm the process; the enabled line confirms export |
| Container restart loop | `compose.readLogs`; volumes persist Grafana/Prometheus/Loki state across restarts, so a wipe means volumes were removed, not restarted |
| All data gone after redeploy | Named volumes survive redeploys. If truly gone, someone removed the volumes — check `docker volume ls` on the host, and say so rather than guessing |

## Safety

- Never echo `$LOWBIT_DOKPLOY_API_KEY` or the Grafana password into output.
- `compose.saveEnvironment` replaces the whole blob — read, line-edit, write back.
- This stack is shared by every reporting Kanna install; a redeploy drops a few
  minutes of incoming telemetry (no queue). Fine to do, but say so.
