---
id: adr-20260626-per-turn-token-cost
c3-seal: a1b585705aa375d3827a4b86a6a687af447b8f7ea894736eb9182d7c5225d3ed
title: per-turn-token-cost
type: adr
goal: Add per-turn USD token cost computation and cumulative session-total readout across all three provider paths (Claude SDK, Claude PTY, Codex). A new pure shared module `token-pricing` (c3-307) is the single source of cost math; server coordinators attach `costUsd` to every `context_window_updated` and `result` event entry; the client sums these into a live cumulative total displayed in `SessionTokenPill`.
status: proposed
date: "2026-06-26"
---

## Goal

Add per-turn USD token cost computation and cumulative session-total readout across all three provider paths (Claude SDK, Claude PTY, Codex). A new pure shared module `token-pricing` (c3-307) is the single source of cost math; server coordinators attach `costUsd` to every `context_window_updated` and `result` event entry; the client sums these into a live cumulative total displayed in `SessionTokenPill`.

## Context

Before this change, Kanna tracked token counts per turn but had no concept of cost. Users could see input/output/cached token counts via `context_window_updated` events but could not tell how much each session was spending. The `result` event carried no `usage` or cost field. Three separate provider code paths (agent-coordinator for Claude SDK, jsonl-to-event for Claude PTY, and codex-app-server for Codex) all finalized turn results independently, making cross-cutting cost enrichment difficult without a shared pure module. The client `contextWindow.ts` computed session totals from token counts only; `SessionTokenPill` showed counts but no dollar figure.

## Decision

Introduce `src/shared/token-pricing.ts` (c3-307) as a pure, stateless module exporting `computeCostUsd(usage, ModelPrice)` and `resolveModelPrice(modelId, openRouterPricing?)`. Keep all cost arithmetic here — no per-provider duplication. Each provider path imports these two functions and attaches the result as `costUsd` to its finalized event entries. The coordinator (c3-210) also wires `listOpenRouterModels` (from c3-230) as a new dep so live OpenRouter pricing can override the static fallback table. The client `computeSessionTotals` (c3-110) sums per-turn `result.costUsd` into a session total displayed in `SessionTokenPill` (c3-115) alongside the existing token-count readout. Provider-reported `total_cost_usd` from the Claude SDK takes precedence over computed cost where available.

## Affected Topology

| Entity | Type | Why affected | Governance review |
| --- | --- | --- | --- |
| c3-307 | component | New component created to own pure USD cost math | ref-strong-typing: all exported types are named interfaces; no any |
| c3-3 | container | Gains c3-307; Responsibilities updated to include token-cost math | Parent-fit review: c3-307 is a pure shared module, correctly placed in the shared container |
| c3-210 | component | createClaudeHarnessStream now attaches costUsd to context_window_updated and result entries; new listOpenRouterModels coordinator dep; OpenRouter contextLength wired to context-window max | ref-provider-adapter: cost enrichment is part of the normalized event shape |
| c3-225 | component | jsonl-to-event.ts mirrors cost enrichment on synthesized result entries for CLI >= 2.1.x; uses same computeCostUsd + resolveModelPrice | ref-provider-adapter: PTY must produce same HarnessEvent shape as SDK |
| c3-211 | component | codex-app-server.ts computes cost on Codex usage snapshot; attaches usage + costUsd to turn-completed and failure result entries | ref-provider-adapter: Codex events flow through same coordinator path |
| c3-301 | component | ContextWindowUsageSnapshot.costUsd? and OpenRouterModel.pricing? fields added | ref-strong-typing: new fields are typed; no any |
| c3-110 | component | computeSessionTotals sums per-turn result.costUsd; formatCostUsd formats dollar display | N.A - pure client read utility, no boundary crossing |
| c3-115 | component | SessionTokenPill now renders cumulative cost alongside token counts | N.A - UI component, no shared-boundary impact |

## Compliance Refs

| Ref | Why required | Action |
| --- | --- | --- |
| ref-strong-typing | c3-307 exports named TypeScript interfaces; costUsd fields on event entries must be typed, not inferred as any | comply — ModelPrice, OpenRouterPricing are concrete interfaces; costUsd?: number typed in ContextWindowUsageSnapshot |
| ref-provider-adapter | Cost enrichment is added to the normalized HarnessEvent shape that the adapter contract defines; all three providers must emit the same shape | comply — all three paths (agent.ts, jsonl-to-event.ts, codex-app-server.ts) emit costUsd on result entries using the shared computeCostUsd |
| ref-colocated-bun-test | New pure module token-pricing.ts requires a colocated test file | comply — src/shared/token-pricing.test.ts must exist alongside the module |

## Compliance Rules

| Rule | Why required | Action |
| --- | --- | --- |
| rule-strong-typing | No any at boundaries; costUsd and usage fields crossing the event-store boundary must have named types | comply — ContextWindowUsageSnapshot in c3-301 declares costUsd?: number; callers use typed spread |
| rule-colocated-bun-test | src/shared/token-pricing.ts is a non-trivial pure module with branching logic in resolveModelPrice | comply — src/shared/token-pricing.test.ts covers computeCostUsd and resolveModelPrice needle-match paths |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| New shared module | Create src/shared/token-pricing.ts with computeCostUsd, resolveModelPrice, ModelPrice, OpenRouterPricing | src/shared/token-pricing.ts |
| Types delta | Add costUsd?: number to ContextWindowUsageSnapshot; add pricing?: OpenRouterPricing to OpenRouterModel in src/shared/types.ts | src/shared/types.ts |
| Claude SDK enrichment | In src/server/agent.ts: import computeCostUsd/resolveModelPrice; add listOpenRouterModels dep; attach costUsd to context_window_updated and result entries; use total_cost_usd from SDK when available | src/server/agent.ts lines 52, 390, 833, 982–1041, 2707–2711 |
| PTY enrichment | In src/server/claude-pty/jsonl-to-event.ts: mirror cost enrichment on synthesized result entries; propagate usage + costUsd through the pending-flush path | src/server/claude-pty/jsonl-to-event.ts lines 192–193, 355–390 |
| Codex enrichment | In src/server/codex-app-server.ts: import computeCostUsd/resolveModelPrice; compute and attach costUsd on usage snapshots and result entries | src/server/codex-app-server.ts lines 2, 289–314, 1586, 1664, 1691 |
| Client session totals | In src/client/lib/contextWindow.ts: add computeSessionTotals(entries, subagentRuns) summing result.costUsd; add formatCostUsd | src/client/lib/contextWindow.ts lines 117–156 |
| SessionTokenPill UI | Update src/client/components/chat-ui/SessionTokenPill.tsx to render cumulative cost from computeSessionTotals | src/client/components/chat-ui/SessionTokenPill.tsx |
| C3 doc sync | Add c3-307 component; update c3-3 container; record this ADR | .c3/ directory |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| Component registry | c3-307 token-pricing created under c3-3 with codemap src/shared/token-pricing.ts, cites ref-strong-typing | c3x lookup src/shared/token-pricing.ts returns c3-307 |
| Container c3-3 | Responsibilities updated to include token-cost math; Components table gains c3-307 row | c3x read c3-3 shows c3-307 in Components table |
| ADR | This ADR (adr-per-turn-token-cost) records all topology deltas | c3x check passes with 0 issues |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| TypeScript compiler | Catches any type mismatch if ProviderUsage, ModelPrice, or costUsd shapes change | bun run tsc --noEmit exits 0 |
| bun run test | src/shared/token-pricing.test.ts covers computeCostUsd arithmetic and resolveModelPrice needle-match branches | bun test --conditions production src/shared/token-pricing.test.ts exits 0 |
| c3x check | Validates codemap coverage — src/shared/token-pricing.ts must resolve to c3-307 | c3x check exits with 0 issues |
| c3x lookup | Maps file to component — confirms c3-307 ownership of token-pricing.ts | c3x lookup src/shared/token-pricing.ts returns c3-307 |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Inline cost computation in each provider (agent.ts, jsonl-to-event.ts, codex-app-server.ts) | Triplicates the static price table and resolveModelPrice logic; any update to prices or needle-match rules requires three coordinated edits across server files; a shared pure module is the correct placement for math used by both client and server |
| Store cost only on the result entry, not on context_window_updated | Per-turn snapshots displayed in the UI derive from context_window_updated entries; omitting costUsd there means per-turn cost is not available at snapshot time; enriching both is consistent with how usage is already attached |
| Use the OpenRouter pricing exclusively and remove the static fallback table | Claude SDK and Codex are not OpenRouter providers; their costs would be unresolvable when listOpenRouterModels is not configured or the model is not in the catalog; the static fallback preserves cost display for Claude models without OpenRouter integration |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Static price table drift (STATIC_PRICES hardcoded at 2026-06 list prices) | Table is annotated with the date and a note to update on price change; resolveModelPrice prefers live OpenRouter pricing when available | bun test --conditions production src/shared/token-pricing.test.ts will catch numeric regressions if prices are updated |
| resolveModelPrice returns null for a new model pattern, silently omitting cost | Callers omit costUsd when null — no crash, just no cost display; the static table can be extended by adding a needle entry | c3x lookup src/shared/token-pricing.ts confirms single ownership; test coverage in token-pricing.test.ts for known model patterns |
| PTY synthesized result cost diverges from SDK result cost for the same turn | Both paths import the same computeCostUsd and resolveModelPrice from c3-307; cost arithmetic cannot diverge independently | src/server/claude-pty/parity-matrix.test.ts drives both paths with same fixtures and asserts identical HarnessEvent sequences |

## Verification

| Check | Result |
| --- | --- |
| c3x lookup src/shared/token-pricing.ts | Returns c3-307 token-pricing |
| c3x check | 0 issues |
| bun test --conditions production src/shared/token-pricing.test.ts | Exit 0 (all cost arithmetic and needle-match tests pass) |
| bun run tsc --noEmit | Exit 0 (no type errors) |
