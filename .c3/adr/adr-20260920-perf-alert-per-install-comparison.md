---
id: adr-20260920-perf-alert-per-install-comparison
c3-seal: 5fb88f0da119e57d402a1c0d6980a0956dee7a17edc34ef2573a2e758130a2e2
title: perf-alert-per-install-comparison
type: adr
goal: 'Stop the fleet''s memory alerts from measuring hardware and reporting it as code. Two rules read `kanna_process_rss_bytes` and both compare quantities that are not comparable across a heterogeneous fleet: `KannaMemoryReleaseRegression` ranks each release''s fleet-average RSS against the LIGHTEST install reporting, and `KannaMemoryPressure` tests every install against one hardcoded 1.8 GiB. This decision replaces the cross-install ratio with a per-install self-comparison over a 3-day offset, and replaces the hardcoded byte count with a ratio against a ceiling each install computes for its own machine.'
status: proposed
date: "2026-09-20"
---

## Goal

Stop the fleet's memory alerts from measuring hardware and reporting it as code. Two rules read `kanna_process_rss_bytes` and both compare quantities that are not comparable across a heterogeneous fleet: `KannaMemoryReleaseRegression` ranks each release's fleet-average RSS against the LIGHTEST install reporting, and `KannaMemoryPressure` tests every install against one hardcoded 1.8 GiB. This decision replaces the cross-install ratio with a per-install self-comparison over a 3-day offset, and replaces the hardcoded byte count with a ratio against a ceiling each install computes for its own machine.

## Context

`KannaMemoryReleaseRegression` filed a GitHub ticket for essentially every release from 1.42 to 1.56 — sixteen of them, two still open at the time of writing (#1107, #1121). The recorded firing values say plainly that it is not measuring code: 13.66x on 1.55.0 and 4.83x on 1.56.0. A 13.66x memory regression between point releases does not happen; a heavy development machine being divided by an idle one does.

The mechanism is `scalar(min(...))` in the denominator. It makes the single leanest install in the fleet the definition of good. Installs are not randomly assigned to versions — each upgrades on its own schedule, and the maintainer's own install, with roughly a gigabyte of transcripts across 262 chats, is always first onto the newest release. So the newest version's average is dominated by the heaviest machine while the baseline is whatever light install is sitting on an older build. The rule cannot produce a true positive, and no threshold fixes that; the shape is wrong.

The same query has a second defect that made the tickets useless even as a prompt. It aggregates `by (service_version)`, which drops `job` and `host_name` — the very labels `buildWebhookPayloadTemplate` reads per alert instance. Every regression ticket therefore rendered its Affected installs table with empty Service and Host cells, so a reader could not tell which install was heavy.

`KannaMemoryPressure` is the opposite case and must not be confused with it. It produced the one genuinely actionable ticket in this family (#1105, 1.897 GB on a named install). But its 1.8 GiB constant is justified entirely by pm2's restart clamp, and that clamp only exists for pm2-managed installs. A user running the CLI directly has no such ceiling; a user on an 8 GB laptop has a real ceiling far below it. One constant cannot describe both, which is what makes the threshold noise on the machines it does not fit.

`KannaTurnLatencyReleaseRegression` carries the identical `scalar(min(...))` construct. It is paused today, so it has filed nothing, but turn duration includes spawn cost and therefore tracks machine speed even more directly than RSS does. Arming it unchanged would reproduce this failure immediately.

## Decision

A threshold is per install. Never rank one install against another, and never hardcode a byte count.

Both regression rules are replaced by growth rules that divide an install by its own past: `avg by (job, service_name, host_name, service_version) (avg_over_time(rss[6h])) / on (job) group_left() avg by (job) (avg_over_time(rss[6h] offset 3d))`. Joining on `job` means machine power, installed RAM and transcript corpus appear on both sides of the division and cancel exactly. The grouping keeps the four labels the webhook template renders, so the ticket finally names the install. A 256 MiB floor on the numerator stops an idle install producing a large ratio out of noise, and the latency twin keeps its existing 50-turn volume guard.

Both ship paused with a `baselineNote`, because the self-comparison ratio has no observed history and any threshold now would be the same guess that produced the old one. `KannaMemoryGrowthPerInstall` and `KannaTurnLatencyGrowthPerInstall` replace the old uids outright rather than sitting beside them; the applier PUTs the whole rule group, so the renamed uids drop the old rules with no orphan left in Grafana.

The accepted cost is stated in the rule's own description: a self-comparison also fires on genuine workload growth, such as a user opening a much larger project. That is a real limitation, not a defect to route around — the remedy is to confirm the install's `service_version` changed inside the window before reading a breach as a release regression. It is strictly better than the alternative it replaces, which fired on nothing else.

`KannaMemoryPressure` now reads `kanna_process_rss_ratio` at 0.9 instead of a byte count. Each install computes its own ceiling through the pure `resolveMemoryCeiling` in `src/server/memory-ceiling.ts`: the lower of pm2's 2 GiB clamp and 80% of `os.totalmem()`. Keeping the pm2 clamp inside that formula is load-bearing rather than conservative — a pure fraction-of-RAM rule makes 1.9 GB on a 64 GB workstation a 3% ratio and would have missed #1105, the only ticket in this family worth having. An unreadable total falls back to the clamp rather than to zero, so an install that cannot read its own RAM still alerts instead of going silently dark.

The division happens in-process, not as a PromQL join between two gauges. A `/ on (job) group_left` join returns empty on any label mismatch and every rule ships `noDataState: "OK"`, so a broken join would disable the alert in a way indistinguishable from a healthy fleet — precisely the silent-failure class this pipeline already guards against for metric names. `kanna_host_memory_total_bytes` and `kanna_process_memory_ceiling_bytes` are exported alongside the ratio so a ticket can say which of the two bounds applied.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-234 | component | Owns both halves of this change: the alert specs in src/ops/alerting/rules.ts whose queries are rewritten, and the instrument facade plus its one adapter, which gain three memory gauges. The new pure module src/server/memory-ceiling.ts is a leaf of the same component and is added to its eval binding and code-map | c3-234#n12151@v1:sha256:712a8889949a50f052b40626018c0e54041956b3d6db9aee07abce0fa801352d "Gives every other component a dependency-free way to record a span, a counter or a histogram (`src/server/observability.ts`), and keeps every side effect — the " | Confirm the ceiling math stays pure and testable while os.totalmem and the pm2 probe stay inside otel.adapter.ts, and that every new metric name is a constant an alert query reads back |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Keep the cross-install shape but swap min for a median baseline | Reduces the magnitude of the noise without removing its cause. The comparison is still between different machines running different workloads, so the ratio still answers whose computer is bigger. A 13.66x reading does not become correct by being divided by a different denominator |
| Retire the regression rules entirely and rely on the absolute pressure rule | Leaves no fleet-wide way to notice that a release made memory worse, which is a real question worth an alert. The self-comparison shape answers it honestly, so deleting the capability is a larger loss than fixing the query |
| Export only the host total and divide in PromQL | A join between two gauges returns empty on any label mismatch, and noDataState is OK on every rule, so a broken join silently disables the alert. Dividing in-process cannot fail that way, and the raw total is still exported for triage |
| Make the pressure rule a pure fraction of system RAM | 1.9 GB is 3% of a 64 GB machine, so the rule would have missed #1105 — the one actionable ticket this family produced. pm2 restarts at its clamp regardless of how much RAM the host has, so the clamp has to stay in the ceiling |
| Raise the 1.8 GiB threshold to cut flapping | Trades warning time for quiet on every install at once, and still applies one number to machines whose real limits differ by an order of magnitude. It treats the symptom of a hardcoded bound by hardcoding a different bound |
| Compare each install against itself over a shorter window than 3 days | A release reaches an install and then has to accumulate enough runtime for its average to be meaningful. A window short enough to react quickly is dominated by whatever that install happened to be doing, which is the workload noise the offset exists to cancel |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| The growth rules ship paused, so a genuine memory regression goes unnoticed until one is armed | KannaMemoryPressure stays armed and is the rule that catches the failure that actually hurts, now correctly scaled per machine. The paused rules carry a baselineNote naming what to observe first | Test "an unarmed rule says what must be observed before arming it" |
| Someone reintroduces a cross-install ratio in a later rule | The construct is pinned by a test rather than left to review, so a revert fails CI instead of quietly filing tickets again | Test "no rule ranks one install against another" |
| A growth rule fires on workload growth and is misread as a release regression | The rule's own description and runbook say to confirm the service_version changed inside the window before reading it that way, and the labels needed to check are now on the alert | Test "a growth rule compares an install against its own past" |
| An install that cannot read its own total memory reports a zero ceiling and never alerts | resolveMemoryCeiling falls back to the pm2 clamp for any non-finite or non-positive total, and resolveRssRatio returns 0 rather than Infinity for an unusable ceiling | Test "an unreadable total falls back to the clamp rather than to zero" |
| The two open regression tickets never close, because a paused rule never resolves | Closing them as not planned is the documented mute gesture and is checked before the reopen window, so they stay closed | Read the footer rendered by renderIssue, which names the gesture on every ticket |

## Verification

| Check | Result |
| --- | --- |
| bun test --conditions production src/ops/alerting/ src/server/memory-ceiling.test.ts src/server/observability.test.ts | pass |
| bun run check (typecheck, lint, lint:comments, build:client, check:bundle) | clean |
| bun run check:arch | pass, no budget breach from the new module |
| bun run scripts/grafana-alerts.ts --dry-run | Both growth rules divide by an offset series joined on (job); KannaMemoryPressure reads kanna_process_rss_ratio; 2 of 5 rules armed |
| Query kanna_process_rss_ratio on a live install after export | A value between 0 and 1, with kanna_process_memory_ceiling_bytes equal to the pm2 clamp under pm2 and to 80% of total RAM otherwise |
