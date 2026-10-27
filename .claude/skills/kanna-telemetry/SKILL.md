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
  undiagnosed for want of exactly this. It ends with the latest process-vitals
  reading: `loopP99=…ms loopMax=…ms children=…MB (claude=…MB×N …)`, so the
  RAM of the per-turn `claude` processes is visible even with export off.
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
  `kanna.process.external_bytes`, `kanna.event_loop.delay_p50_ms`,
  `kanna.event_loop.delay_p99_ms`, `kanna.event_loop.delay_max_ms`,
  `kanna.process.children.rss_bytes{kind}`, `kanna.process.children.count{kind}`.
- Process vitals (`src/server/process-vitals-sampler.adapter.ts`, pure half in
  `process-vitals.ts`) sample once per `KANNA_OTEL_METRIC_INTERVAL_MS`, whether
  or not export is on. Event-loop delay is a per-window reading: the histogram
  is reset after each sample. Child RSS comes from `ps` over the server's
  descendants, grouped by the direct child Kanna launched (`claude`, `codex`,
  `nats-server`, `cloudflared`, `git`, `shell`, `bun`, `node`, `other`), so an
  MCP server spawned by `claude` counts as `claude`. The Agent SDK exposes no
  child pid, which is why this walks the process tree instead of tracking pids.
  RSS includes shared pages, so a sum over several `claude` processes
  over-reports. No `ps` (Windows) means no child series, never zeros.

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
a turn whose provider reports tokens but no cost leaves no cost series, so a
missing one means unknown, never free. Derive spend from tokens × your own rates when it is
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

## Server-side observability and perf alerts

### Observability (OTel traces + metrics, memlog, SIGUSR2 heap snapshot)

Three independent concerns, one adapter (`src/server/otel.adapter.ts` — the
ONLY file that may import the OTel SDK/exporters), initialized from
`server.ts` boot right after `appSettings.initialize()` (the telemetry
setting gates OTel export) and shut down in the server stop path:

- **OTel traces + metrics** — gated by the user-facing telemetry setting
  (Settings page → "Telemetry Tracing"; `telemetry: {enabled, endpoint}` in
  `settings.json`, default ON with endpoint `https://kanna-otel.lowbit.link`,
  the grafana/otel-lgtm compose on the lowbit Dokploy). Enabled, it registers
  a `NodeTracerProvider` (BatchSpanProcessor → OTLP http) and a
  `MeterProvider` (periodic reader, `KANNA_OTEL_METRIC_INTERVAL_MS`, default
  15000). Precedence lives in the pure `src/server/otel-config.ts`
  (`resolveOtelConfig`): `KANNA_OTEL=disabled` hard-disables,
  `KANNA_OTEL=enabled` enables even when the setting is off, else the setting
  decides; `OTEL_EXPORTER_OTLP_ENDPOINT` beats the settings endpoint;
  `KANNA_OTEL_SERVICE_NAME` beats the derived name. Service name defaults to
  `kanna-<machine name>` (sanitized `getMachineDisplayName()` — each install
  reports under its computer name; the raw name rides the `host.name`
  resource attribute). The `service.version` attribute is always set to
  `APP_VERSION` (`package.json` version, bumped by release-please on every
  release) so every span and metric is version-tagged — TraceQL
  `{resource.service.version="1.37.0"}` selects and
  `by (service_version)` groups in Prometheus. The toggle applies at RUNTIME:
  `AppSettingsManager.onChange` → `ObservabilityHandle.applyTelemetrySettings`
  restarts/stops the providers, and the facade's instrument cache is cleared
  on each transition (`resetMetricInstrumentCache`) so cached counters never
  record into a shut-down provider. Init never throws: a broken collector
  must not take the server down.
- **Memory log** — `KANNA_MEMLOG_MS` (default 60000, `0` disables) prints one
  `[kanna/mem] rss=…` line per interval. This is the correlation record for
  the next OOM kill; three OOMs (1.06–2.43 GB) went undiagnosed for lack of
  exactly this.
- **Heap snapshot** — `kill -USR2 <pid>` writes a Chrome-DevTools-loadable
  v8 `.heapsnapshot` under `<dataDir>/heap-snapshots`
  (`KANNA_HEAP_SNAPSHOT=disabled` opts out). The only way to answer "WHAT
  holds the bytes" on a live process.

**Domain code imports `src/server/observability.ts` ONLY** — a pure facade
over `@opentelemetry/api` (`withSpan`, `addCounter`, `recordUpDown`). With no
SDK registered every call is the api package's no-op, so instrumentation
needs no test doubles and costs nothing when disabled. Never import the
adapter from domain code; never import SDK packages outside the adapter.

Instrumented so far: `kanna.turn.start` (spawn pipeline), `kanna.subagent.run`
(whole run, the loop's unit of work), `kanna.loop.wake.deliver`, counters
`kanna.subagent.run.finished`, `kanna.autocontinue.fired`,
`kanna.queued_message.recovered`, `kanna.loop.wake.recovered`,
`kanna.turn.tokens`, `kanna.turn.cost_usd`, `kanna.subagent.tokens`,
`kanna.compaction.started` / `kanna.compaction.finished` with the
`kanna.compaction.pre_tokens` / `.post_tokens` histograms (see **Compaction
observability** above), and process-memory gauges. Spans nest via
AsyncLocalStorage — add depth with a one-line `withSpan` at the call site, no
handle threading.

**Token spend — `kanna.turn.tokens`, `kanna.turn.cost_usd`,
`kanna.subagent.tokens`.** Turn and run COUNTS cannot answer "what is this
install spending": a 200k-token turn and a 2k-token turn are one turn each.
These are what a fleet-wide cost question reads.

**The `kind` values PARTITION the billed tokens, and that is load-bearing.**
`ProviderUsage.inputTokens` arrives already including the cache reads
(`claude-usage-math.ts` sums direct + cacheCreation + cacheRead into it), so
`splitBilledTokens` (`src/shared/token-pricing.ts`) reports `input` as the
NON-cached remainder — the same subtraction `computeCostUsd` makes, kept beside
it so the two can never disagree about what was billed. Emitting both whole
would bill the cache twice and overstate every install. `sum(...)` over the
metric is therefore the billable total; `sum by (kind)` splits it.

**A kind with nothing to report is omitted, never recorded as zero.** Absent
usage means the provider told us nothing, which is a different claim from "this
turn was free" — and the providers really are uneven here: Codex reports usage
only after a `thread/tokenUsageUpdated` notification, OpenRouter's token counts
come from upstream, so `kanna.turn.cost_usd` is deliberately sparser than
`kanna.turn.tokens`. Read a missing series as unknown, not zero.

**Usage reaches the metric on `ActiveTurn.usage`, not through the callback.**
The `EventStore.subscribeTurnTerminal` listener carries only the chat id, the
outcome and the failure message — never turn timing or spend — and must keep
doing so, so both runners stash the result entry's usage on the ActiveTurn — Claude/
OpenRouter at `claude-session-runner.ts`, Codex at `claude-turn-runner.ts`,
both through `billedUsageOfResult`, which settles the entry-level-cost vs
`usage.costUsd` precedence in ONE place. Terminal paths with no result entry
(cancel, spawn failure) stash nothing and so record nothing. Subagent runs
never pass through that choke point at all and are recorded separately at
`subagent-orchestrator.ts`'s `subagent_run_completed` emission — which is where
a loop's spend actually shows up, since its per-iteration cost is a subagent
run, not a chat turn.

**Duration histograms — `kanna.turn.duration_ms`, `kanna.subagent.run.duration_ms`.**
Turn duration is recorded in `AgentCoordinator.handleTurnTerminal` (`agent-coordinator.ts`),
the listener it registers with `EventStore.subscribeTurnTerminal`,
the one choke point every provider terminal path funnels through, enriched from
`activeTurns.get(chatId)` — the same lookup the cron-outcome consumer already
does there, valid because a turn leaves the map only after its terminal record
persists. `ActiveTurn.startedAt` is REQUIRED and carried over from the
`StartingTurn`, so the measurement includes spawn cost. A terminal with no
ActiveTurn (a background-task self-wake) records nothing rather than a
fabricated duration. Do NOT widen the `subscribeTurnTerminal` listener's signature to carry this —
every subscriber would ripple to serve one observer.

**`DURATION_BUCKETS_MS` is load-bearing.** OTel's default explicit boundaries
stop at 10s and a turn runs seconds to tens of minutes, so without the adapter's
view every observation lands in the `+Inf` bucket and `histogram_quantile`
returns garbage. `observability.test.ts` pins it by asserting turn-length
durations land in distinct finite buckets.

**Metric names are constants, because an alert query reads them back.**
`PROCESS_RSS_BYTES`, `SUBAGENT_RUN_FINISHED`, `TURN_DURATION_MS`,
`SUBAGENT_RUN_DURATION_MS`, `TURN_TOKENS`, `TURN_COST_USD` and
`SUBAGENT_TOKENS` live in `observability.ts` and are consumed by
`src/ops/alerting/rules.ts`. A rule naming a metric that does not exist selects
no series and therefore never fires — indistinguishable from a healthy fleet —
so `rules.test.ts` asserts every `kanna_*` token in a query resolves to an
exported instrument. A new instrument must also be added to
`EXPORTED_PROM_METRICS` in its Prometheus form (`_total` for a counter, the
`_bucket`/`_count`/`_sum` expansion for a histogram) before any rule may name
it.

### Performance alerts → GitHub tickets

A fleet performance regression opens its own GitHub issue on
`cuongtranba/kanna`, labelled `performance` + `agent-fix`, carrying the firing
query, every affected host, and the code hints an agent needs to start.
Prometheus → Grafana alert rule → webhook contact point → GitHub
`repository_dispatch` → `.github/workflows/perf-alert.yml`. See
`adr-20260821-perf-alert-github-tickets` and component `c3-234`.

**Everything that decides what an alert is, and what the ticket says, lives in
this repo.** Grafana holds only the payload template it was given by
`scripts/grafana-alerts.ts`. `src/ops/alerting/rules.ts` is a flat spec table
(query, threshold, summary, runbook, `codeHints`) over a builder that hides
Grafana's rule model. Apply with `bun run scripts/grafana-alerts.ts`
(`--dry-run` prints redacted payloads); it is idempotent — rules keyed by uid,
contact point by name, route merged.

- **Instance-level rules, version-level grouping.** Rules query per install so
  the ticket can name every affected host; the notification policy groups by
  `alertname` + `service_version`, so ten breaching installs are ONE ticket. A
  fix targets a release, not a laptop. Installs older than 1.38.0 report no
  `service_version` at all — queries must never require the label; those group
  as `@unversioned`.
- **`mergePerfRoute`, never a rebuilt policy.** Grafana's notification-policy
  endpoint is a whole-tree PUT on a shared instance; building the tree from
  scratch would delete routes this repo does not own.
- **A threshold is per INSTALL. Never rank one install against another, and
  never hardcode a byte count** (`adr-20260920-perf-alert-per-install-comparison`).
  Installs differ by an order of magnitude in RAM, CPU and transcript corpus, so
  both shapes measure hardware and report it as code.

  `KannaMemoryReleaseRegression` divided each version's fleet-average RSS by
  `scalar(min(...))` — **the lightest install in the fleet defined "good"**. Since
  an install upgrades on its own schedule and the heaviest machine is first onto
  the newest release, it filed **one ticket per release, 16 of them** (1.42 →
  1.56), with recorded ratios of **4.83x** (#1121) and **13.66x** (#1107). A
  13.66x memory regression between point releases is not code. It could not
  produce a true positive, and its ticket could not even name the heavy install:
  aggregating `by (service_version)` drops the `job` / `host_name` labels the
  webhook template reads, so the **Affected installs** table rendered empty.

  Both replacements divide an install by **its own past** (`offset 3d`, joined
  `on (job)`), so machine power, RAM and corpus size cancel exactly. They keep
  `job, service_name, host_name, service_version` so the ticket table is
  populated. `rules.test.ts` asserts no rule contains `scalar(min(` — the
  cheapest thing that stops a revert. Accepted cost: a growth rule also fires on
  genuine workload growth, which is why its description says to confirm the
  version changed.

  `KannaMemoryPressure` no longer reads a hardcoded 1.8 GiB. Each install
  exports `kanna.process.rss_ratio` — RSS over `resolveMemoryCeiling`
  (`src/server/memory-ceiling.ts`), the lower of pm2's 2 GiB clamp and 80% of
  `os.totalmem()` — plus the raw ceiling and host total for triage. **Keeping the
  pm2 clamp in that formula is load-bearing:** a pure fraction-of-RAM rule makes
  1.9 GB on a 64 GB machine a 3% ratio, missing the one genuinely actionable
  ticket this rule ever produced (#1105). **The division happens in-process, not
  as a PromQL join** — a `/ on (job) group_left` between two gauges returns empty
  on any label mismatch, and every rule ships `noDataState: "OK"`, so a broken
  join would disable the alert indistinguishably from a healthy fleet.

  `KannaTurnLatencyHigh` and `KannaSubagentFailureRate` still aggregate
  `by (service_version)` and so still render an empty install table. Neither
  ranks installs against each other, so neither is noisy; the label fix is
  outstanding.
- **Minimum-volume guards are not defensive trimming.** At current fleet volumes
  one failed subagent run out of five is a 20% failure rate. The failure-rate
  and latency rules `and` themselves against an `increase(...) >= N` clause.
- **Unarmed rules ship paused, with a `baselineNote`.** `kanna.turn.duration_ms`
  has no history, so both latency rules are applied paused until a threshold can
  be set from observed p95 rather than guessed. `rules.test.ts` requires the note
  on any unarmed rule; arming is one flag plus a re-apply.
- **Ticket noise is bounded on purpose.** Dedup by a readable
  `<!-- kanna-alert:… -->` marker (not a hash — a mis-grouped ticket is
  diagnosed by reading it), a 6h quiet period before a repeat firing comments,
  and `MAX_OPEN_PERF_ISSUES` (10). The cap is deliberately IGNORED on the
  resolve and reopen paths, so a storm can still close what it opened. **The
  OTLP ingest endpoint is unauthenticated**, so forged metrics can drive this
  path; the cap is what bounds that.
- **`AlertRuleSpec.ticketScope` decides what a ticket IS, and therefore both
  how it dedups and what a resolve means** (`adr-20260822-perf-alert-ticket-scope`).
  It is one field rather than two flags because those are one question:

  | scope | marker | on resolve | rules |
  | --- | --- | --- | --- |
  | `release` | `<alertname>@<version>` | closes | the two `…GrowthPerInstall` rules, whose breach is expected to be explained by a version change |
  | `condition` | `<alertname>` | **stays open** | the three threshold rules (memory pressure, subagent failures, turn latency) |

  Scoping a condition per release was the second flap, after
  `adr-20260822-perf-alert-reopen-dedup` fixed the first. release-please cuts
  several releases a day, so a problem that survives the upgrade got a fresh
  dedup key on every deploy: #855 (@1.41.0) and #863 (@1.41.3) were filed
  hours apart WITH the reopen fix already live. A condition ticket also never
  auto-closes — #863 opened at 10:19 and closed at 10:24, and a five-minute dip
  under the threshold is not the work being done. Whether a rule is firing
  right now is Grafana's question; the ticket tracks the fix.
- **The scope rides the wire, and must keep doing so.** `buildRuleGroup` emits
  it as the `ticket_scope` ANNOTATION (`TICKET_SCOPE_ANNOTATION`), exactly as
  `promql` / `threshold` / `code_hints` already travel; `perf-issue.ts` reads it
  off the payload. Looking it up from `ALERT_RULES` instead is the obvious
  refactor and it breaks the pipeline: `perf-alert.yml` runs the script with
  **no `bun install`** on purpose, so importing `rules.ts` drags in
  `observability.ts` + `@opentelemetry/api` and the job dies on module
  resolution — with tickets simply never appearing. `perf-alert-workflow.test.ts`
  pins `perf-issue.ts` at zero runtime imports. Anything but an explicit
  `condition` reads as `release`, so a notification from a Grafana state
  predating the annotation behaves exactly as it did.
- **Both marker shapes close with `" -->"`,** so neither substring-matches the
  other: tickets filed under the old `@<version>` key for a now-condition rule
  are left alone rather than adopted. Expect exactly one new ticket per
  condition rule after applying, then stability.
- **A flap is one episode, so it gets one ticket** (`REOPEN_WINDOW_MS`, 7 days).
  `decideAction` is fed CLOSED tickets as well as open ones and REOPENS the most
  recently closed match instead of filing a new one. Dedup over open issues
  alone was not dedup: auto-close on resolve meant the next breach matched
  nothing, so a rule hovering at its threshold filed a fresh ticket per flap —
  five identical `KannaMemoryPressure` tickets in five hours (#827, #833, #836,
  #840, #843). The quiet period never covered this; it throttles chatter on a
  ticket that is already visible, and a closed one is not. Past the window a
  breach is a genuinely new episode and resurrecting a months-old thread reads
  as noise. **`scripts/perf-alert-issue.ts` must query `state=all`** —
  narrowing it back to `state=open` restores the bug with every unit test still
  green, which is why `perf-alert-workflow.test.ts` asserts the query string.
- **Closing as _not planned_ is the mute**, and for a `condition` rule it is the
  ONLY way the ticket ever ends. `CloseReason` is `completed | not_planned`; the
  adapter maps GitHub's `not_planned` AND `duplicate` onto the latter (both say
  "not the ticket to track this on" — reopening either would undo a human
  decision). It is scoped by marker, so muting one rule cannot silence another,
  and muting `@1.40.4` cannot silence `@1.40.5`. The gesture has no UI affordance
  hinting it exists, so `renderIssue` names it in every ticket footer, pinned by
  a test — delete that line and the mute becomes undiscoverable.
- **The mute is checked BEFORE the reopen window, and is not bounded by it.**
  The two ask different questions — the window asks "is this the same episode",
  a mute asks "should this be tracked at all" — and a decision to stop tracking
  does not age. Resolving the mute through `mostRecentlyClosed` (which filters by
  `REOPEN_WINDOW_MS` first) made every deliberate mute expire after seven days,
  silently, and the rule start filing again. Do not fold the check back in.
- **`repository_dispatch` only fires a workflow that is already on the DEFAULT
  branch.** A dispatch sent while `perf-alert.yml` exists only on a feature
  branch returns `204 No Content` and runs nothing — verified, and there is no
  error anywhere to notice. It fails safe (Grafana re-notifies on its repeat
  interval, so the first notification after the merge files the ticket), but it
  means the pipeline cannot be proven end-to-end from a PR branch.
- **Grafana's rule-group `interval` is SECONDS as a number.** A duration string
  is rejected with a bare `400 bad request data` that names no field, while the
  individual rules validate fine — so the failure looks like it is anywhere but
  there. `rules.test.ts` pins the type.
- **Two silent-failure modes are gated by tests, not review.**
  `perf-alert-workflow.test.ts` asserts the workflow's `repository_dispatch`
  type equals `PERF_ALERT_EVENT_TYPE` (a mismatch is accepted by GitHub and
  matches no workflow — alerts just vanish), and the workflow's `concurrency`
  key serialises runs per alert so the read-then-write dedup cannot race two
  dispatches into two issues.

**One manual step:** the contact point needs a GitHub token permitted to POST
repository dispatches (classic `repo`, or fine-grained with Contents: write).
It is passed to the applier as `KANNA_GITHUB_DISPATCH_TOKEN` and stored as a
Grafana secure setting — never in the repo. The workflow itself needs no
secret; it uses the built-in `GITHUB_TOKEN`.
