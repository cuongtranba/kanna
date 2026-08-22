---
id: adr-20260822-perf-alert-ticket-scope
c3-seal: d0eb7d7557e1e010cc1e0ed38067256a0aa1a9f35f8723a62b381c21efbb62e2
title: perf-alert-ticket-scope
type: adr
goal: Make a performance alert that describes an ongoing CONDITION file exactly one GitHub ticket, which stays open until a human closes it and stays muted once they close it as not planned. Today the ticket's identity embeds the release, so a condition that survives an upgrade mints a fresh ticket on every deploy, and the mute expires after seven days without saying so. This decision introduces TicketScope on the alert-rule spec, transports it to the ticket pipeline as a Grafana annotation, and makes the mute independent of the reopen window.
status: proposed
date: "2026-08-22"
---

## Goal

Make a performance alert that describes an ongoing CONDITION file exactly one GitHub ticket, which stays open until a human closes it and stays muted once they close it as not planned. Today the ticket's identity embeds the release, so a condition that survives an upgrade mints a fresh ticket on every deploy, and the mute expires after seven days without saying so. This decision introduces TicketScope on the alert-rule spec, transports it to the ticket pipeline as a Grafana annotation, and makes the mute independent of the reopen window.

## Context

adr-20260822-perf-alert-reopen-dedup fixed the first flap: five identical KannaMemoryPressure tickets in five hours (#827, #833, #836, #840, #843), caused by auto-close-on-resolve leaving the next breach with nothing to match. It added REOPEN_WINDOW_MS and taught the fetch to read closed tickets, and it works.

It was not enough. That fix landed at 05:57 UTC on 2026-08-22, and #855 (@1.41.0) at 08:04 and #863 (@1.41.3) at 10:19 were filed after it, for the same condition on the same install. Two defects survived, and neither is a threshold problem.

First, alertMarker embeds service_version. That is right for the two release-regression rules, whose query compares releases and whose subject IS the release. It is wrong for the three absolute-threshold rules: the version is incidental, the condition survives the upgrade, and release-please cuts several releases a day — so the dedup key changes underneath a problem that has not.

Second, the mute is the only documented off-switch, and it silently expires. decideAction resolved a not-planned close through mostRecentlyClosed, which filters closed tickets by REOPEN_WINDOW_MS before the reason is ever read. The window answers "is this the same episode"; a mute answers "should this be tracked at all", and that decision does not age. Seven days after muting, the rule files again.

The auto-close is the third of the churn: #863 opened at 10:19 and closed at 10:24. RSS dipping under the threshold for five minutes is not the work being done.

One constraint shapes the transport. .github/workflows/perf-alert.yml runs scripts/perf-alert-issue.ts with no bun install, deliberately, so a lockfile problem can never stop an alert being filed. Reading the scope from ALERT_RULES would pull rules.ts, observability.ts and @opentelemetry/api into that job and kill it on module resolution.

## Decision

Add TicketScope to AlertRuleSpec — release or condition — and let it decide both how a ticket is deduplicated and what a resolve means.

A release-scoped ticket keys on alertname@version and closes when that version recovers; the version has been judged and never ships again. A condition-scoped ticket keys on alertname alone and a resolve leaves it open, because only a human knows whether the fix landed. KannaMemoryReleaseRegression and KannaTurnLatencyReleaseRegression are release; KannaMemoryPressure, KannaSubagentFailureRate and KannaTurnLatencyHigh are condition.

It is ONE field rather than a dedup flag plus an auto-close flag because the two questions have one answer: a ticket is settled by the same thing that identifies it. The two combinations the pair would additionally permit are both incoherent — rule-scoped with auto-close closes a shared ticket while another version still fires, and version-scoped without auto-close accumulates one ticket per release until the open cap wedges.

The scope reaches the pipeline as the Grafana annotation ticket_scope, emitted by buildRuleGroup from the spec, exactly as promql, threshold, runbook and code_hints already travel. That keeps rules.ts the single source of truth while leaving the decision module free of runtime imports, which the no-install workflow requires. An annotation rather than a label because labels take part in Alertmanager's fingerprint and routing, and this is neither. Anything but an explicit condition reads as release, so a notification predating the annotation behaves exactly as it does today.

Separately, the mute check moves ahead of the reopen window and is no longer bounded by it. Both marker shapes close with " -->", so neither substring-matches the other and tickets filed under the old version-scoped key are left alone rather than silently adopted.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-234 | component | Owns src/ops/alerting/ and scripts/perf-alert-issue.ts — the rule spec that declares the scope, the webhook template that carries it, and the decision module that reads it all live here. AlertRuleSpec gains a required field and the notification payload gains an annotation; no boundary moves and no new file appears, so the existing code globs in .c3/eval/c3-234.yaml already cover the change | c3-234#n11583@v1:sha256:b6b043ffe2b689fe8edaaa9e064f5f7461804b34ef385cbcb04dad018f6f1a93 "Non-goals: deciding WHAT is worth instrumenting — that stays with the component that owns the code path; and rendering telemetry in the UI." | Confirm the alerting surface stays one spec table over a builder, and that perf-issue.ts remains a pure decision with no runtime imports — the no-install workflow depends on it |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Import ticketScopeOf from rules.ts into perf-issue.ts | rules.ts imports observability.ts and @opentelemetry/api. The perf-alert workflow runs with no bun install by design, so the job would die on module resolution and tickets would simply stop appearing — the exact silent-failure class this pipeline already guards against elsewhere |
| Pause KannaMemoryPressure, or raise its threshold above what the reporting install does | The alert is truthful — that install really is over the pm2 restart ceiling — and both options trade a real fleet-wide signal for silence on one laptop. Scoping the ticket correctly gives the operator a permanent one-click mute without disarming the rule for everyone |
| Keep version scope and make the mute cover future versions too | A mute that silences a rule on releases it has never seen cannot distinguish a stale install from a genuine regression in the next release. The version dimension is simply wrong for these rules; removing it is the honest fix |
| Group the notification policy by alertname only for condition rules | Needs a second route inside mergePerfRoute, which is a whole-tree PUT on a shared Grafana instance. Grouping already sends one notification per version; the first creates the ticket and the rest comment under the quiet period, which is the desired behaviour with no extra route to own |
| Comment on the ticket when a condition resolves instead of skipping | Reproduces the churn as comments — #863 flapped inside five minutes — and re-notifies every subscriber. Whether a rule is firing right now is a question Grafana already answers |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| A condition ticket never closes on its own, so a fixed problem leaves a stale open ticket | The ticket footer states it stays open and names the not-planned close; the open cap of 10 still bounds total tickets, and condition rules can now hold at most one each | Test "a condition ticket says it stays open" plus the existing cap tests |
| A mute that no longer expires hides a rule forever | The mute is a deliberate human gesture recorded on a findable ticket, and reopening it resumes tracking. It is scoped per marker, so muting one rule cannot silence another | Tests "a mute is not bounded by the reopen window" and "a mute wins over a more recent auto-close" |
| Someone later imports rules.ts into the decision module and breaks the no-install workflow | The invariant is pinned by a test that reads both files rather than left to review | Test "the decision module it loads has no runtime imports at all", plus a run of the script in a tree with no node_modules |
| A future rule is added without a scope, or with the wrong one | ticketScope is required on AlertRuleSpec, so omitting it fails typecheck; buildRuleGroup must emit it for every rule | Test "every rule ships the scope its ticket is deduped by" and "a release-scoped rule actually distinguishes releases" |
| Old version-scoped tickets are orphaned by the new marker | Intentional and bounded: all of them are already closed, and the two marker shapes cannot match each other, so the first fire after apply opens exactly one condition ticket | Test "the two marker shapes cannot match each other" |

## Verification

| Check | Result |
| --- | --- |
| bun test --conditions production src/ops/alerting/ scripts/perf-alert-workflow.test.ts | 75 pass, 0 fail |
| bun run test (full suite) | 7063 pass, 2 skip, 0 fail |
| bun run lint | clean at --max-warnings=0 |
| bun run typecheck | clean on TypeScript 7 |
| bun run scripts/grafana-alerts.ts --dry-run | ticket_scope condition on the three threshold rules, release on the two regression rules, and the annotation present in the webhook template |
| Copy scripts/perf-alert-issue.ts and src/ops/alerting/perf-issue.ts into a tree with no node_modules and run it | Reaches its env-var check, proving module resolution needs no dependencies |
| bun run scripts/grafana-alerts.ts against the live instance | Rules re-applied so every notification carries ticket_scope |
