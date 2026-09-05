---
id: adr-20260825-fleet-token-spend-metrics
c3-seal: a75a1c40f9d252875ef9bd4ccdef461ff04e7a313997aa8bce427aaa6301a177
title: fleet-token-spend-metrics
type: adr
goal: 'Make per-turn token spend visible in fleet telemetry. Kanna exports traces and metrics from every install, but nothing in that stream counts tokens: the only volume signals are turn and run COUNTS, and a 200k-token turn and a 2k-token turn are one turn each. Add three counters — `kanna.turn.tokens`, `kanna.turn.cost_usd` and `kanna.subagent.tokens` — recorded at the choke points that already exist, so "which install is burning tokens, and on what" becomes a PromQL query instead of an unanswerable question.'
status: done
date: "2026-08-25"
---

# fleet-token-spend-metrics

## Goal

Make per-turn token spend visible in fleet telemetry. Kanna exports traces and metrics from every install, but nothing in that stream counts tokens: the only volume signals are turn and run COUNTS, and a 200k-token turn and a 2k-token turn are one turn each. Add three counters — `kanna.turn.tokens`, `kanna.turn.cost_usd` and `kanna.subagent.tokens` — recorded at the choke points that already exist, so "which install is burning tokens, and on what" becomes a PromQL query instead of an unanswerable question.

## Context

A fleet investigation into one install's spend could reach turn counts, memory gauges and durations, and none of them answered the question asked. Enumerating every instrument in the collector confirmed why: no `kanna_*` series counts tokens at all. The investigation had to fall back on turn volume as a proxy, which cannot tell an expensive turn from a cheap one and so could neither confirm nor refute the report.

The data itself was already present and already discarded. `ProviderUsage` (`inputTokens`, `outputTokens`, `cachedInputTokens`, `costUsd`, all optional) rides every provider's `ResultEntry`, and `computeCostUsd` already consumes it for the client-side per-chat total in `computeSessionTotals`. Nothing server-side reads it, and nothing exports it.

Three constraints shape where the recording can go. `EventStore.onTurnTerminal` — the one choke point every provider terminal path funnels through, and where `kanna.turn.duration_ms` is recorded — carries only `(chatId, outcome)`; adr-20260821-perf-alert-github-tickets already rejected widening it, because 24 call sites would ripple to serve one observer. `ActiveTurn` carried no usage field. And a subagent run never passes through that choke point at all, which matters because a loop's per-iteration cost IS a subagent run, so a turn-only metric would show a loop spending nothing.

The providers are also uneven, and a metric that hides that would mislead. Codex reports usage only after a `thread/tokenUsageUpdated` notification; OpenRouter's token counts come from upstream; and PTY-mode turns have no price resolver wired at all, so their cost is provider-reported-or-nothing.

## Decision

**Record at the existing choke point, reached through `ActiveTurn`.** Both runners stash the result entry's usage on `ActiveTurn.usage` at the point they already set `hasFinalResult` — Claude and OpenRouter in `claude-session-runner.ts`, Codex in `claude-turn-runner.ts` — and the turn-terminal observer reads it beside the duration it already records. `onTurnTerminal`'s signature is untouched. This mirrors exactly how `startedAt` and `cronRun` already reach that observer, and it keeps one recording site with one attribute set instead of four runner sites guaranteed to drift.

**The `kind` values PARTITION the billed tokens.** `ProviderUsage.inputTokens` arrives already including the cache reads, so `splitBilledTokens` reports `input` as the non-cached remainder — the same subtraction `computeCostUsd` makes, and deliberately placed beside it so the two can never disagree about what was billed. Emitting both whole would bill the cache twice and overstate every install. One instrument split by `kind` rather than three named metrics, so a bare `sum` is the billable total, `sum by (kind)` splits it, and a token class the providers start reporting later is a new attribute value rather than a new metric name every alert rule must learn.

**Absent usage records nothing, never zero.** A turn that ended without a result entry — a cancel, a spawn failure — stashes nothing; a provider that reported no cost produces no cost point. Zero is a claim that zero tokens were billed, which is not what "the provider told us nothing" means, and a zero would drag any fleet total toward it. `kanna.turn.cost_usd` is therefore deliberately sparser than `kanna.turn.tokens`.

**Subagent spend is its own counter**, recorded at the `subagent_run_completed` emission where usage is already in scope. Only the completed path carries usage; failed and cancelled runs carry none and so contribute nothing.

**Attributes stay low-cardinality.** `provider`, `model` and `kind` on the turn counters, `provider` and `kind` on the subagent one. No `chat_id` or `run_id` — the established boundary in this codebase puts high-cardinality identity on spans and never on a metric. `outcome` is deliberately omitted too: the duration histogram beside it already segments by outcome, and in practice a turn with no result entry has no usage to attribute anyway.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-0 | system | N.A - ancestor named only to complete the top-down descent | N.A - ancestor named only to complete the top-down descent | N.A - ancestor named only to complete the top-down descent |
| c3-2 | container | N.A - ancestor named only to complete the top-down descent | N.A - ancestor named only to complete the top-down descent | N.A - ancestor named only to complete the top-down descent |
| c3-3 | container | N.A - ancestor named only to complete the top-down descent | N.A - ancestor named only to complete the top-down descent | N.A - ancestor named only to complete the top-down descent |
| c3-234 | component | Owns the instrument facade and the alert-rule allowlist. Gains three metric-name constants and the EXPORTED_PROM_METRICS rows that let a future rule name them | c3-234#n11639@v1:sha256:2532cfb976d17c1c559f9027ea0435856b6b8a255aae3db0ab3840377becb682 | Facade stays pure — counters need no bucket view, so otel.adapter.ts is untouched |
| c3-307 | component | Owns the token/cost math. Gains splitBilledTokens and billedUsageOfResult, placed here so the cache-already-in-input invariant lives in one module with computeCostUsd | c3-307#n12013@v1:sha256:9f7598f952ee23ea758371c66d69917f972047812e86ea9a8ee3d77574fc58db | Stays pure shared code under the side-effect seal; ref-strong-typing applies |
| c3-210 | component | Owns the turn-terminal observer and ActiveTurn. Gains the optional usage field and the spend recording beside the existing duration histogram | c3-210#n10318@v1:sha256:cdd19a6bd6d4ddb1a4ea9d799c955b24809af3a11232ae0967dffa63f0618e82 | onTurnTerminal signature must stay (chatId, outcome, error?) — the 24-call-site constraint adr-20260821 recorded |

## Compliance Refs

| Ref | Why required | Evidence | Action |
| --- | --- | --- | --- |
| ref-local-first-data | Governs c3-234 because OTLP export opens outbound sockets. The three counters ride the EXISTING exporter and telemetry gate — they add no new egress and no new endpoint, so the ref's boundary is unchanged | ref-local-first-data#n12219@v1:sha256:6c1744cb29d49192d5bb3ac1662201087df01c9ee04f38fb3f53d04844e79485 | comply |
| ref-strong-typing | Governs c3-307, where the two new helpers live. BilledTokenKind is a closed union and splitBilledTokens returns a readonly tuple array, so an unhandled kind is a compile error rather than a silently dropped metric point | ref-strong-typing#n12323@v1:sha256:eaa7509d80f8a56b00105ed5d46af5a604bfae2e81889e9dac7d7a095fbf5009 | comply |
| ref-event-sourcing | Governs c3-210. The recording READS the event-sourced terminal signal and writes no event; ActiveTurn.usage is live session state, not a persisted fact, so the event log's shape is untouched | ref-event-sourcing#n12186@v1:sha256:ee0316401639d91b6d6f6b1c3615cf7eab1abbd5cbf9cef319474a29c2567775 | comply |
| ref-provider-adapter | Governs c3-210. Usage is read through each provider's already-normalised ResultEntry, so no provider-specific shape reaches the metric — the Claude, OpenRouter and Codex paths converge on one billedUsageOfResult call | ref-provider-adapter#n12252@v1:sha256:3bcf82b74f0f034db61a050837c7182691d29b77181e6f6c7805be1f2e00e180 | comply |
| ref-tool-hydration | Cited by c3-210, so the ADR must close over it. Reviewed and unaffected: the recording reads the already-hydrated ResultEntry at turn end and touches no tool-call hydration path | ref-tool-hydration#n12356@v1:sha256:1cda574e5908fc3b6c85e5bbb9432e5edeee3a0c7d0d11e0230c45ac05c8a718 | review |
| ref-colocated-bun-test | Cited by c3-210 alongside its rule twin. Both new surfaces ship their suite in the same directory as the code — token-pricing.test.ts beside token-pricing.ts, agent.turn-tokens-metric.test.ts beside the coordinator | ref-colocated-bun-test#n12120@v1:sha256:2bc20e87f7c1e3aabe46c42732cca6d91bf2f72516544a2924fe9870e8df4385 | comply |

## Compliance Rules

| Rule | Why required | Evidence | Action |
| --- | --- | --- | --- |
| rule-colocated-bun-test | Cited by both c3-234 and c3-210, and this change adds behaviour to both. Every new surface ships a colocated suite: token-pricing.test.ts for the split and the cost precedence, agent.turn-tokens-metric.test.ts for the observer enrichment and its null cases | rule-colocated-bun-test#n12455@v1:sha256:2bc20e87f7c1e3aabe46c42732cca6d91bf2f72516544a2924fe9870e8df4385 | comply |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Widen onTurnTerminal to carry the result entry | adr-20260821-perf-alert-github-tickets already rejected this for the duration metric: 24 call sites ripple to serve one observer, and most of them have no result entry to pass |
| Record at each runner's result site instead of the observer | Four sites, each needing the same attribute set, guaranteed to drift — the same reason the duration histogram is recorded at the observer |
| Three separate metrics for input / cached / output | A new token class the providers start reporting becomes a new metric name every alert rule and dashboard must learn; one instrument split by kind absorbs it as an attribute value |
| Derive spend from ContextWindowUsageSnapshot.usedTokens | That is the live CONTEXT size, not what was billed, and its sibling totalProcessedTokens re-counts cache reads on every tool round-trip and balloons to millions |
| Emit zero when a provider reports nothing | Makes "no data" indistinguishable from "this turn was free" — and PTY-mode cost is unreported by design, so the common case would read as a fleet of free turns |
| Reuse computeCostUsd to synthesize a cost when the provider reports none | Fabricates a number from a static price table whose rates drift; a missing cost series is honest, a wrong one is not |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Double-counting the cached reads, silently overstating every install's spend | splitBilledTokens subtracts cached from input, beside computeCostUsd which makes the same subtraction | token-pricing.test.ts asserts the split sums to exactly the billed total, and that a cached-heavy turn does not inflate it |
| A metric that is silently always-zero because a provider reports nothing | Absent usage records no point at all, so a missing series reads as unknown rather than as zero | agent.turn-tokens-metric.test.ts asserts nothing is recorded for a turn with no usage and for a terminal with no ActiveTurn |
| Series-count blowup from a high-cardinality attribute | Attributes limited to provider, model and kind; identity stays on spans | agent.turn-tokens-metric.test.ts asserts the exact attribute set, so a stray attribute fails the test |
| A future alert rule names a metric that does not exist and silently never fires | The three Prometheus names are added to EXPORTED_PROM_METRICS | rules.test.ts asserts every kanna_* token in a rule query resolves to an exported instrument |

## Verification

| Check | Result |
| --- | --- |
| bun test --conditions production src/shared/token-pricing.test.ts | 23 pass — partition, clamping, non-finite handling, and the entry-vs-usage cost precedence |
| bun test --conditions production src/server/agent.turn-tokens-metric.test.ts | 6 pass — kind split, billable sum, cost present/absent, no-usage and no-ActiveTurn null cases |
| bun test --conditions production src/ops/alerting/rules.test.ts | Passes with the three new names in EXPORTED_PROM_METRICS |
| bun run typecheck | Clean (TypeScript 7) |
| bun run lint | Clean at --max-warnings=0 |
| bun run test | Full suite green (exit 0) |
