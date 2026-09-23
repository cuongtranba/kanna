---
id: adr-20260923-claude-cost-running-total
c3-seal: 76317f5432dfb2af8c384366ad7ac7357be3cfb0b35c556f4ac3c3a608bd0109
title: claude-cost-running-total
type: adr
goal: Make every Claude result entry's `costUsd` mean the cost of that one turn, as c3-307 already promises, by treating the Agent SDK's `total_cost_usd` as the running total it is. Store that raw running total on the result entry as `cumulativeCostUsd`, so a newly spawned SDK process for the same session can continue from it instead of counting the whole session again.
status: done
date: "2026-09-23"
---

## Goal

Make every Claude result entry's `costUsd` mean the cost of that one turn, as c3-307 already promises, by treating the Agent SDK's `total_cost_usd` as the running total it is. Store that raw running total on the result entry as `cumulativeCostUsd`, so a newly spawned SDK process for the same session can continue from it instead of counting the whole session again.

## Context

The Agent SDK documents `total_cost_usd` (and `modelUsage`) as cumulative across turns in a streaming-input session: each result carries the running total so far, a resumed or forked session starts from the total its transcript saved, and a mid-session clear resets it. Kanna copied that value straight into `costUsd` in both `claude-message-normalizer.ts` and `claude-harness-stream.ts`. Every consumer treats `costUsd` as per-turn: `computeSessionTotals` (c3-110) sums it for the session pill, `recordTurnSpend` adds it to the turn-cost counter, and the subagent run reducer mirrored it. So each turn re-counted all earlier spend, and every respawn (idle eviction, the resident-session budget, loop arming, a config change, a server restart, a fork) added the whole prior session total again.

## Decision

`createClaudeHarnessStream` owns the conversion because its lifetime is exactly one `query()` process. It starts from a baseline and emits `costUsd = total - previousTotal`, treating a total below the baseline as a reset. It also emits `cumulativeCostUsd = total` on the result entry, and resets the baseline to zero on `context_cleared`. The normalizer stops setting `costUsd`, so the harness is the only source. On a resume, `spawnClaudeTurn` reads the baseline through `EventStore.getLatestClaudeCumulativeCostUsd`: the newest result's `cumulativeCostUsd` after the last `context_cleared`, found with the same bounded backward tail scan the context-window read already uses. A fork copies the transcript, so it inherits the source session's baseline. Keep-alive subagent runs now add up their turns' usage instead of keeping only the last. Parent Delta: none.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-307 | component | Its Derived Materials row states where result costUsd comes from; the Claude SDK path now derives it from the SDK running total, and cumulativeCostUsd is a new derived field | c3-307#n12959@v1:sha256:ab8f0b30035282d5365541468c66ff5f8ff5ac835d80a119633fe6c2dd9effcd | Confirm costUsd stays per-turn for every provider and cumulativeCostUsd is only written by the Claude harness |
| c3-206 | component | The event store gains a bounded backward read for the latest SDK running total, sharing the existing tail-scan loop | c3-206#n10701@v1:sha256:4bbe28051be1ca893e66e498279b8364077c001c1ffd682ea36f2f8c16266178 | Confirm the read is bounded by the existing lookback limit and has colocated tests |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Keep the last running total per chat in coordinator memory only | A server restart loses it, so the first turn after every restart would re-count the resumed session's whole cost |
| Read the latest result instead of summing, in the client | Codex and OpenRouter-priced turns report per-turn cost, so the client would need provider-specific math, and the turn-cost metric and subagent totals would still be wrong |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Chats created before this change have result entries without cumulativeCostUsd, so their first resumed turn still counts the prior total once | Accepted and documented; the baseline read skips entries without the field | event-store-messages.adapter.test.ts: a chat whose results predate the running total has no baseline |
| A resume where the CLI did not restore the saved total reports a smaller total than the baseline | Treated as a reset, so the turn reports the whole new total rather than a negative number | claude-harness-stream.test.ts: a running total below the baseline is treated as a reset |

## Verification

| Check | Result |
| --- | --- |
| bun run test | 8402 pass, 0 fail |
| bun run check | typecheck, lint, comment scan, client build and bundle budget pass |
| bun run check:arch and bun run lint:limits | 69 pass; all 4 ESLint ceilings tight |
