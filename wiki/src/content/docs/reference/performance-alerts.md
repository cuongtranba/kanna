---
title: Performance Alerts
description: How a fleet performance regression opens a GitHub issue, and how to change or arm a rule.
---

Kanna installs export OTel metrics to a shared collector. When one of those
metrics breaches a threshold, an alert opens a GitHub issue on
`cuongtranba/kanna` labelled `performance` + `agent-fix`, carrying the firing
query, every affected host, and the code hints needed to start on a fix. When
the alert resolves, the issue closes itself.

```
Kanna installs ─OTLP→ collector → Prometheus → Grafana alert rule
                                                     │ webhook
                                                     ▼
                          GitHub repository_dispatch → perf-alert workflow → issue
```

Telemetry export is a user-facing setting (**Settings → Telemetry Tracing**,
on by default). An install with it turned off contributes nothing here.

## The rules

| Rule | Fires when | Armed |
| --- | --- | --- |
| `KannaMemoryPressure` | RSS averages over 90% of that install's own memory ceiling for 25 minutes | yes |
| `KannaSubagentFailureRate` | Over 30% of subagent runs fail across a 6-hour window with at least 10 runs | yes |
| `KannaMemoryGrowthPerInstall` | One install's average RSS is 30%+ above what the same install averaged 3 days earlier | paused |
| `KannaTurnLatencyHigh` | p95 end-to-end turn duration exceeds the threshold over at least 20 turns | paused |
| `KannaTurnLatencyGrowthPerInstall` | One install's p95 turn latency is 50%+ above what the same install measured 3 days earlier, over at least 50 turns | paused |

The two latency rules ship **paused**: `kanna.turn.duration_ms` is new, so there
is no baseline yet and any threshold would be a guess. Each carries a
`baselineNote` saying what to measure first. Arming one is a single flag.

### A threshold is per install, never fleet-wide

Installs differ by an order of magnitude in RAM, CPU and transcript corpus, so
a number that is alarming on one machine is unremarkable on another. Two
consequences shape every memory and latency rule here.

**The memory ceiling is computed per install, not hardcoded.** Each install
exports `kanna_process_memory_ceiling_bytes` — the lower of the process
manager's 2 GiB restart clamp and 80% of the machine's own RAM — plus
`kanna_process_rss_ratio`, its RSS as a fraction of that ceiling. The alert
reads the ratio, so a 4 GB laptop trips earlier than a 64 GB workstation, and
an install running without a process manager is judged against its real limit
rather than a clamp that does not apply to it. The division happens in-process
deliberately: a PromQL join between two gauges returns nothing on any label
mismatch, and every rule treats no-data as healthy, so a broken join would
disable the alert silently.

**A growth rule compares an install against its own past**, via a 3-day
`offset` on the same `job`. Comparing releases against each other across
different installs cannot work — an install upgrades on its own schedule, so
the ratio ends up measuring whose computer is bigger. The predecessor rule did
exactly that, dividing each release's fleet-average RSS by the *lightest*
install reporting, and filed one ticket per release with recorded ratios of
4.83x and 13.66x that were hardware differences rather than code.

A growth rule therefore also fires on genuine workload growth — a user opening
a much larger project. Confirm the install's `service_version` changed inside
the window before reading one as a release regression.

## Changing a rule

Rules are code, in `src/ops/alerting/rules.ts`. Edit the spec — query,
threshold, `for`, summary, runbook, `codeHints` — then apply:

```bash
bun run scripts/grafana-alerts.ts --dry-run   # prints payloads, token redacted
bun run scripts/grafana-alerts.ts             # applies
```

Applying is idempotent: rules are keyed by uid, the contact point by name, and
the notification route is *merged* into the existing policy rather than
replacing it. Required env: `KANNA_GRAFANA_PASSWORD` and
`KANNA_GITHUB_DISPATCH_TOKEN` (a GitHub token allowed to POST repository
dispatches). Optional: `KANNA_GRAFANA_URL`, `KANNA_GRAFANA_USER`,
`KANNA_GITHUB_REPO`, `KANNA_PROM_DATASOURCE_UID`.

The test suite gates the two ways a rule can fail silently: a query naming a
metric Kanna does not export (it would select no series and never fire), and a
dispatch event name that no workflow listens for (GitHub accepts it and nothing
happens).

## The workflow must be on the default branch

`repository_dispatch` only triggers a workflow that already exists on the
repository's **default branch**. A dispatch sent while `perf-alert.yml` lives
only on a feature branch is accepted by GitHub with `204 No Content` and then
runs nothing — there is no error anywhere to notice.

This fails safe: alerts firing before the workflow merges are silent no-ops, and
Grafana re-notifies on its repeat interval, so the first notification after the
merge opens the ticket.

## Why one ticket, not ten

Alert rules evaluate per install, so the ticket can name every affected host —
but notifications group by rule **and release**. Ten laptops breaching the same
threshold on the same version is one regression, and a fix targets the release.

Installs older than 1.38.0 report no version at all; those group under
`@unversioned`.

## Ticket behaviour

- Deduplicated by a marker in the issue body: `<!-- kanna-alert:<rule>@<version> -->`.
- A repeat firing comments rather than opening a second issue, and only if the
  issue has been quiet for 6 hours.
- Resolving closes the issue with a comment.
- Firing again after the issue closed **reopens that issue** with a comment,
  for up to 7 days after it closed. A rule that hovers near its threshold
  resolves and re-fires repeatedly, and each flap used to file a fresh ticket.
  Past 7 days the breach is treated as a new episode and gets a new issue.
- At most 10 open `performance` issues; past that, creation is skipped. Closing
  and reopening are never blocked by the cap — a reopen is bounded by the rules
  already ticketed, so it cannot be a runaway-creation path.

### Muting a rule for a release

**Close the issue as _not planned_** (GitHub's "Close as not planned", and
likewise "Close as duplicate"). Nothing will reopen it, and no new ticket is
filed for that rule on that release.

Use this when the fix has already shipped and the install still reporting is
simply out of date — the alert is real, but the work is done. The marker
carries the version, so muting one release never silences the next: a
regression in a later release files its own ticket.

Closing normally (**Close as completed**) leaves the issue reopenable, which is
what you want while the cause is still live.

## Metrics behind the rules

| Metric | What it measures |
| --- | --- |
| `kanna_process_rss_bytes` | Resident memory of the server process |
| `kanna_process_rss_ratio` | RSS as a fraction of this install's own memory ceiling |
| `kanna_process_memory_ceiling_bytes` | The lower of the 2 GiB process-manager clamp and 80% of the machine's RAM |
| `kanna_host_memory_total_bytes` | Total RAM of the machine the install runs on |
| `kanna_turn_duration_ms` | End-to-end wall clock of one chat turn, spawn included |
| `kanna_subagent_run_duration_ms` | End-to-end wall clock of one delegated subagent run |
| `kanna_subagent_run_finished_total` | Subagent runs, labelled by outcome |
| `kanna_turn_tokens_total` | Tokens billed for a chat turn, labelled by `provider`, `model` and `kind` |
| `kanna_turn_cost_usd_total` | What the provider said a turn cost, labelled by `provider` and `model` |
| `kanna_subagent_tokens_total` | Tokens billed for a delegated subagent run, labelled by `provider` and `kind` |

All carry `service_name` (`kanna-<machine name>`) and, from 1.38.0,
`service_version`.

No rule queries the three token metrics yet — they are exported so a spend
question can be answered at all, and a threshold for "too much" is a policy
choice nobody has made. They are listed here because a rule may name only a
metric on this list.

### Reading the token metrics

The `kind` values **partition** the billed tokens (`input` is the non-cached
remainder, because a provider's `inputTokens` already includes its cache
reads), so `sum` is the billable total and `sum by (kind)` splits it without
double-counting:

```promql
sort_desc(sum by (job) (increase(kanna_turn_tokens_total[24h])))
sum by (job, kind) (increase(kanna_turn_tokens_total[24h]))
```

A loop's per-iteration cost is a **subagent run, not a chat turn**, so a loop
that looks idle in `kanna_turn_tokens_total` shows up in
`kanna_subagent_tokens_total`. Check both before concluding an install is quiet.

**A missing series means unknown, never zero.** A turn that ended without a
result entry reports no usage, and not every provider reports a price — so
`kanna_turn_cost_usd_total` is deliberately sparser than the token counters.
Derive spend from tokens and your own rates when the cost is absent.
