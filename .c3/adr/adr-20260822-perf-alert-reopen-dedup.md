---
id: adr-20260822-perf-alert-reopen-dedup
title: perf-alert-reopen-dedup
type: adr
goal: |-
    Make a flapping performance alert reuse one GitHub ticket instead of filing a
    new one per breach. `decideAction` was only ever shown OPEN issues, so the
    auto-close-on-resolve behaviour defeated its own dedup: the next breach
    matched nothing and created a fresh ticket. Five identical
    KannaMemoryPressure tickets landed in five hours. This adds a reopen path
    over recently-closed tickets and, with it, the first way for an operator to
    mute a rule for a release without pausing the rule fleet-wide.
status: proposed
date: "2026-08-22"
---

# perf-alert-reopen-dedup

## Goal

Make a flapping performance alert reuse one GitHub ticket instead of filing a new one per breach. `decideAction` was only ever shown OPEN issues, so the auto-close-on-resolve behaviour defeated its own dedup: the next breach matched nothing and created a fresh ticket. Five identical KannaMemoryPressure tickets landed in five hours. This adds a reopen path over recently-closed tickets and, with it, the first way for an operator to mute a rule for a release without pausing the rule fleet-wide.

## Context

`adr-20260821-perf-alert-github-tickets` shipped ticket dedup as a marker match over the open `performance` issues, plus a 6h quiet period and a 10-issue creation cap. Two of those three bounds work. The dedup does not.

The failure is structural, not a coding slip. The resolve path *closes* the ticket, and the fetch in `scripts/perf-alert-issue.ts` asks GitHub for `state=open`. So the moment a rule stops firing, its ticket leaves the only set the dedup can see. `KannaMemoryPressure` sits near its threshold on a real install and therefore flaps — resolve, breach, resolve, breach:

| Issue | Marker | Opened |
| --- | --- | --- |
| #827 | KannaMemoryPressure@1.38.0 | 22:22 |
| #833 | KannaMemoryPressure@1.38.0 | 23:39 |
| #836 | KannaMemoryPressure@1.38.0 | 00:50 |
| #840 | KannaMemoryPressure@1.40.4 | 04:19 |
| #843 | KannaMemoryPressure@1.40.4 | 04:54 |

Every one of those is the same episode. The quiet period never applied: it guards the *comment* branch on an already-open ticket, and a closed ticket never reaches that branch.

The cap did not save it either, because the resolve path closes tickets as fast as the firing path opens them, so the open count never approaches 10.

There is a second, related gap the flapping made visible. Four memory fixes shipped across 1.40.1–1.40.5 (`2023e766`, `8f921161`, `2cad3664`, `ddf255c9`). The install still firing runs 1.40.4 and simply predates the last of them. The alert is *correct* and the work is *done*, and the pipeline offered no way to say so short of pausing `kanna-perf-memory` for the whole fleet — which would also silence a genuine regression in a later release.

## Decision

**Show `decideAction` the closed tickets, and reopen rather than re-file.** The pure function now takes `KnownIssue[]` (each carrying `closed: {at, reason} | null`) instead of `OpenIssue[]`, and gains a `reopen` action. A firing alert with no open match takes the most recently closed match inside `REOPEN_WINDOW_MS` and reopens it with a comment. One episode, one thread, with its own history attached.

**The window is 7 days, and it is a real boundary rather than a safety margin.** Inside it, a breach is the same cause still oscillating around the threshold. Outside it, resurrecting a months-old thread is worse than a new ticket — the reader wants the recent context, not archaeology. It also bounds the fetch: newest-first by activity means anything closed inside the window fits in one 100-issue page, which the open cap and the dedup together make unreachable to exceed.

**The quiet period does not gate a reopen, and neither does the cap.** The quiet period exists to keep a *visible* ticket readable; a closed ticket is not visible, so throttling there would hide a live alert. The cap exists to bound unbounded creation from forged metrics — a reopen is bounded by the set of markers already ticketed, so it is not that path. The cap now counts open tickets explicitly, since the input array is no longer all-open; counting settled history would wedge the pipeline shut after a few months.

**Closing as _not planned_ is the mute.** This is the off-switch the stale-install case needs, and it deliberately reuses a gesture GitHub already has rather than adding configuration. `CloseReason` is `completed | not_planned`; the adapter folds GitHub's `not_planned` and `duplicate` onto the latter, because both say "this is not the ticket to track it on" and reopening either would undo a human decision. The mute is scoped by marker, so muting `@1.40.4` cannot silence `@1.40.5` — a fix that ships earns a fresh group, and a regression in it files its own ticket.

**The mute is announced on every ticket.** Nothing in the GitHub UI hints that the close reason carries meaning, so `renderIssue`'s footer states it, pinned by a test. An affordance nobody can discover is not an affordance.

## Affected Topology

| Entity | Type | Why affected | Governance review |
| --- | --- | --- | --- |
| c3-234 | component | Owns `src/ops/alerting/**` and `scripts/perf-alert-issue.ts`. The ticket decision's input type and action union both widen; no boundary moves and no new file appears, so the existing `code:` globs in `.c3/eval/c3-234.yaml` already cover the change | Confirm the pipeline stays a pure decision plus an IO adapter — the reopen must not leak GitHub's state vocabulary into `perf-issue.ts` beyond the two-value `CloseReason` |

## Compliance Rules

| Rule | Why required | Action |
| --- | --- | --- |
| rule-colocated-bun-test | `perf-issue.test.ts` gains 11 cases for the flap, mute, ordering, and cap-interaction paths; `perf-alert-workflow.test.ts` gains 2 guarding the fetch query | comply |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| Decision | `OpenIssue` → `KnownIssue` with `closed`; `reopen` action; `muted` skip reason; `REOPEN_WINDOW_MS`; cap counts open only | src/ops/alerting/perf-issue.ts |
| Ticket body | Footer states the reopen behaviour and the not-planned mute | src/ops/alerting/perf-issue.ts |
| Adapter | Fetch `state=all&sort=updated&direction=desc`; map `state`/`closed_at`/`state_reason`; PATCH-then-comment on reopen | scripts/perf-alert-issue.ts |
| Docs | Ticket-behaviour list and a muting section | wiki/src/content/docs/reference/performance-alerts.md, CLAUDE.md |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| `perf-alert-workflow.test.ts` fetch guard | Asserts the script queries `state=all` and never `state=open`, ordered by recent activity. This is the one silent-revert path: narrowing the query leaves `decideAction` correct and fully tested while the pipeline returns to filing a ticket per flap, with the whole suite green | scripts/perf-alert-workflow.test.ts |
| `perf-issue.test.ts` mute-scope case | Asserts a `not_planned` close on one release does not suppress the next. A marker-wide mute would silence real regressions | src/ops/alerting/perf-issue.test.ts |
| `perf-issue.test.ts` footer case | Asserts the ticket body names "Close as not planned" | src/ops/alerting/perf-issue.test.ts |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Stop closing tickets on resolve | Trades duplicate tickets for tickets that never close; the ticket would stop describing whether the alert is currently firing |
| Comment on the closed ticket without reopening | The alert is firing, so there is an open problem. A comment on a closed issue notifies nobody watching open work |
| Widen the quiet period to hours-to-days | Wrong mechanism: it gates commenting on an open ticket, and every flap here matched no ticket at all. Widening it would also delay legitimate "still firing" updates |
| Pause `kanna-perf-memory` until the fleet upgrades | Silences a real rule fleet-wide to quiet one stale install, and nothing would restore it. The mute is per rule *and release*, which is the actual granularity of the complaint |
| A mute list in the repo | Requires a PR to silence a ticket, so it will not be used. The close reason is one click, on the object being silenced |
| Reopen regardless of close reason | Removes the only way to stop the pipeline, making a stale-install alert unmutable — the complaint that prompted this decision |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| A human closes a ticket as *completed* meaning "handled", and a later flap reopens it, reading as the pipeline ignoring them | The distinction is exactly what the two close reasons carry, and the footer states it on every ticket. Reopening a completed close is also the correct default: the alert is firing again, so the cause was not in fact removed | `perf-issue.test.ts` "respects a not-planned close as a mute for that release" |
| A muted release keeps breaching and nobody is told | Intended: the operator asserted the work is done. The mute cannot outlive the release, because the marker carries the version | `perf-issue.test.ts` "a mute on one release does not silence the next" |
| More than 100 `performance` issues are touched inside the reopen window, so a reopenable ticket falls off the page and a duplicate is filed | Degrades to today's behaviour rather than breaking. The open cap (10) and the dedup make the volume unreachable in practice | Fetch is newest-first by activity, asserted in `perf-alert-workflow.test.ts` |

## Verification

| Check | Result |
| --- | --- |
| `bun run lint` | Clean |
| `bun run typecheck` | Clean |
| `bun test --conditions production` | 7022 pass, 2 skip, 0 fail across 539 files |
| `bun test --conditions production src/ops/alerting/ scripts/perf-alert-workflow.test.ts` | 58 pass |
