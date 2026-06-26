---
id: c3-307
c3-seal: 61f59d23e03ff698d6d860f9015ff858d55124ed1d8e89eda62380e0e6dfc72c
title: token-pricing
type: component
category: foundation
parent: c3-3
goal: Compute per-turn USD token cost and resolve model price schedules shared by client and server.
uses:
    - ref-strong-typing
---

# token-pricing

## Goal

Compute per-turn USD token cost and resolve model price schedules shared by client and server.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-3 (shared) |
| Parent Goal Slice | "Pure math module in the thin seam that both client and server import" |
| Category | foundation |
| Lifecycle | Stateless pure functions; no I/O, no side effects |
| Replaceability | Replaceable provided computeCostUsd and resolveModelPrice signatures and ModelPrice shape preserved |

## Purpose

Owns the USD cost arithmetic for per-turn token usage and model-price resolution across providers. Exports `computeCostUsd(usage, ModelPrice)` (applies input/cached-input/output rates to a `ProviderUsage` snapshot), `resolveModelPrice(modelId, openRouterPricing?)` (returns a `ModelPrice` from live OpenRouter pricing or a static fallback table keyed on model-name needles), and the `ModelPrice` / `OpenRouterPricing` interfaces. Non-goals: I/O, network fetches, currency conversion, display formatting — those live in the server adapters and client components that call this module.

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Precondition | TypeScript strict mode; imports ProviderUsage from c3-301 | c3-3 |
| Input — provider usage | ProviderUsage (inputTokens, outputTokens, cachedInputTokens) passed by callers | c3-301 |
| Input — model price | ModelPrice (inputPerMTok, outputPerMTok, cachedInputPerMTok?) constructed by resolveModelPrice or passed directly | c3-307 |
| Input — OpenRouter pricing | OpenRouterPricing struct (promptPerTok, completionPerTok) sourced from the live OpenRouter model catalog; c3-210 passes it when listOpenRouterModels is configured, otherwise passes null | c3-230 |
| Internal state | STATIC_PRICES is a read-only const array in src/shared/token-pricing.ts; all functions are stateless and referentially transparent | c3-301 |
| Initialization | ES module imported by c3-210 at src/server/agent.ts line 52 and c3-110 at src/client/lib/contextWindow.ts; no runtime init required | c3-210 |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Outcome | Every turn in every provider carries a costUsd field so the UI can display cumulative spend | c3-210 |
| Primary path — Claude SDK | agent-coordinator calls resolveModelPrice with live OpenRouter pricing then computeCostUsd on the usage snapshot; attaches result to context_window_updated and result entries | c3-210 |
| Primary path — PTY | jsonl-to-event.ts mirrors the same enrichment on the synthesized result entry from CLI ≥ 2.1.x transcripts | c3-225 |
| Primary path — Codex | codex-app-server calls resolveModelPrice (static table only; no OpenRouter) then computeCostUsd on the Codex usage snapshot; attaches to context_window_updated and turn-completed/failure result entries | c3-211 |
| Alternate — no price match | resolveModelPrice returns null; callers omit costUsd; UI shows no cost | c3-210 |
| Client readout | computeSessionTotals (c3-110) sums per-turn result.costUsd fields to display cumulative session spend in SessionTokenPill | c3-115 |

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-strong-typing | ref | All exported interfaces and function signatures must use named types; no any | 1 | ModelPrice, OpenRouterPricing are concrete interfaces; ProviderUsage imported from c3-301 |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| computeCostUsd(usage, price) | IN | Accepts ProviderUsage and ModelPrice; returns non-negative number (USD); treats undefined/negative counts as zero | shared → server, shared → client | src/shared/token-pricing.ts |
| resolveModelPrice(modelId, openRouterPricing?) | IN | Returns ModelPrice or null; prefers live OpenRouter pricing; falls back to static needle-match table; returns null when no match | shared → server | src/shared/token-pricing.ts |
| ModelPrice interface | OUT | { inputPerMTok: number, outputPerMTok: number, cachedInputPerMTok?: number } — USD per 1M tokens | shared → server, shared → client | src/shared/token-pricing.ts |
| OpenRouterPricing interface | OUT | { promptPerTok: number, completionPerTok: number } — used by callers to bridge OpenRouter model list into ModelPrice | shared → server | src/shared/token-pricing.ts |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| Static price table drift | Anthropic/OpenAI pricing changes after 2026-06 | Cost shown in UI diverges from invoices | bun test --conditions production src/shared/token-pricing.test.ts passes with updated STATIC_PRICES entries in src/shared/token-pricing.ts |
| resolveModelPrice needle-match regression | New model ID format breaks regex anchor | New model shows no cost in UI | bun test --conditions production src/shared/token-pricing.test.ts covers needle-match cases; add test case for new model format |
| ProviderUsage type shape mismatch | c3-301 renames or removes token count fields | TypeScript error in src/shared/token-pricing.ts at import site | bun run tsc --noEmit exits 0 with no errors on src/shared/token-pricing.ts |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| costUsd on context_window_updated and result entries | Contract section: computeCostUsd(usage, price) return value; callers in c3-210 and c3-211 must not invent cost values | May be absent when resolveModelPrice returns null | src/server/agent.ts (line 990), src/server/codex-app-server.ts (line 293), src/server/claude-pty/jsonl-to-event.ts (line 193) |
