# SDK Token Count + Cost — Design

Date: 2026-06-26
Status: proposed
Scope: one PR (per user decision)

## Problem

Kanna already captures per-turn token usage for every driver (Claude SDK,
Codex, PTY) as `context_window_updated` transcript entries, and renders the
**latest** snapshot in `SessionTokenPill` (in / out / cache). Three gaps
remain:

1. **OpenRouter route** — turns route through the Claude SDK with
   `ANTHROPIC_AUTH_TOKEN` set to the OpenRouter key
   (`buildClaudeEnv`, agent.ts:1156). Token usage arrives Anthropic-shaped
   and is normalized, but **cost is never available**: OpenRouter does not
   return `total_cost_usd` in-stream, and the `/api/v1/generation` cost
   lookup needs a generation id + a second request we cannot reach through
   the SDK's Anthropic-compatible path. Context-window max may also be wrong
   (OpenRouter `contextLength` is known from the model list but not wired as
   `maxTokens`).
2. **Cost / $ readout** — `ResultEntry.costUsd` is captured from the Claude
   SDK's `total_cost_usd` (agent.ts:824), stored in the event-store, mirrored
   onto subagent runs — but **never displayed**. Codex + OpenRouter never
   populate it at all.
3. **Cumulative / subagent totals** — `SessionTokenPill` shows only the
   latest snapshot's `inputTokens`/`outputTokens`, not a session sum, and
   subagent runs' token/cost usage (already tracked on `run.usage`,
   event-store.ts:915) is not rolled up into the parent session total.

## Decisions (locked)

- **Cost source = hybrid.** Prefer provider-reported cost when present
  (Claude SDK `total_cost_usd`). Fall back to a `model → $/token` price table
  for everything else (OpenRouter, Codex, and any cumulative/subagent rollup
  where provider cost is absent).
- **One PR.** Shared data-model change + all three surfacings ship together.

## Cost source matrix

| Provider   | Tokens (today)        | Cost source (this PR)                          |
|------------|-----------------------|------------------------------------------------|
| Claude SDK | `usage` (works)       | provider `total_cost_usd` (works) — keep       |
| OpenRouter | `usage` (works)       | price table from OpenRouter model-list pricing |
| Codex      | `tokenUsage` (works)  | price table (OpenAI models)                    |
| PTY        | transcript usage      | price table (no provider cost in transcript)   |

## Architecture

Three layers, each a small focused unit.

### 1. Pricing module (new, pure) — `src/shared/token-pricing.ts`

- Type `ModelPrice { inputPerMTok: number; outputPerMTok: number;
  cachedInputPerMTok?: number }` (USD per 1M tokens).
- `computeCostUsd(usage: ProviderUsage, price: ModelPrice): number` — pure,
  no IO. `cost = input/1e6*in + cached/1e6*(cachedRate ?? in) +
  output/1e6*out`.
- `resolveModelPrice(modelId, openRouterPricing?): ModelPrice | null` —
  hybrid resolver:
  - OpenRouter: derive from the model-list `pricing.prompt` /
    `pricing.completion` (USD per token → ×1e6). Requires extending the
    OpenRouter model parser (below) to carry pricing.
  - Claude / Codex / static models: a small built-in table keyed by model id
    prefix (sonnet/opus/haiku, gpt-5/o-series). Unknown id → `null`
    (no fabricated cost).
- Pure module: no `node:*`, no globals. Lives in `src/shared` (side-effect
  seal compliant).

### 2. OpenRouter model pricing capture — `src/server/openrouter-models.ts`

- Extend `OpenRouterModel` (types.ts:19) with
  `pricing?: { promptPerTok: number; completionPerTok: number }`.
- `parseOpenRouterModels` reads `entry.pricing.prompt` /
  `entry.pricing.completion` (strings in the OpenRouter API → `Number()`),
  drops the field when unparseable. No other behavior change.

### 3. Cost wiring on the usage snapshot (server)

Add optional `costUsd` to `ContextWindowUsageSnapshot` (types.ts:1152) so the
per-turn snapshot carries cost alongside tokens.

- **Claude SDK** (agent.ts): already has `total_cost_usd` on the result
  message → set `costUsd` on the final-turn snapshot. (Provider-reported wins.)
- **OpenRouter** (agent.ts): provider cost absent → compute via
  `computeCostUsd(usage, resolveModelPrice(model, openRouterPricing))`. The
  driver already holds `openrouterModel`; thread the cached OpenRouter model
  list (with pricing) into the harness/session so the resolver can look it up.
  Also wire OpenRouter `contextLength` as `maxTokens` when the SDK underreports.
- **Codex** (codex-app-server.ts `normalizeCodexTokenUsage`): compute via
  price table from the active model id.

### 4. Cumulative + subagent rollup (client) — `src/client/lib/contextWindow.ts`

- New `computeSessionTotals(entries, subagentRuns)` returning
  `{ inputTokens, outputTokens, cachedTokens, costUsd, cacheHitPercentage }`:
  - **Cumulative tokens/cost** = sum across all `result` /
    `context_window_updated` entries for the main chat (not just the latest),
    being careful to sum *per-turn* `last*`/result usage to avoid
    double-counting the running context-window figure.
  - **Subagent rollup** = sum each subagent run's `run.usage`
    (`inputTokens`/`outputTokens`/`cachedInputTokens`/`costUsd`) into the
    session total.
- Keep `computeSessionTokenSummary` (latest-snapshot context-window view) for
  the existing context-window meter; the new totals power the cost/cumulative
  pill.

### 5. UI — `src/client/components/chat-ui/SessionTokenPill.tsx`

- Add a **cost** stat (e.g. `$0.42`) next to in/out/cache when `costUsd > 0`.
- Switch the pill's in/out/cache numbers (or add a popover section) to the
  **cumulative session totals** incl. subagent rollup; the popover breaks
  down main vs subagent and shows total cost.
- New `formatCostUsd(value)` helper (`<$0.01`, `$0.42`, `$12.30`).
- Follow `kanna-react-style` + `impeccable` for consistency (tabular-nums,
  project Tooltip/Popover, mobile/desktop parity).

## Data flow

```
provider stream
  ├─ Claude SDK: usage + total_cost_usd ─┐
  ├─ OpenRouter: usage ─ computeCostUsd(price from model list) ─┤
  ├─ Codex: tokenUsage ─ computeCostUsd(price table) ───────────┤
  └─ PTY: transcript usage ─ computeCostUsd(price table) ───────┤
                                                                 ▼
                              ContextWindowUsageSnapshot { ...tokens, costUsd }
                                                                 ▼
                                   context_window_updated transcript entry
                                                                 ▼
                            client: computeSessionTotals(entries, subagentRuns)
                                                                 ▼
                                          SessionTokenPill (cumulative + cost)
```

## Error handling

- Unknown model id → `resolveModelPrice` returns `null` → no `costUsd` set
  (pill omits cost; tokens still shown). Never fabricate a price.
- OpenRouter pricing missing/unparseable on a model → treated as unknown.
- Cost is always additive and optional; absence degrades to the current
  tokens-only behavior.

## Testing (co-located `*.test.ts`, `--conditions production`)

- `token-pricing.test.ts` — `computeCostUsd` math (incl. cached rate
  fallback), `resolveModelPrice` hybrid (OpenRouter pricing vs static table
  vs unknown→null).
- `openrouter-models.test.ts` — pricing parse (valid, missing, malformed).
- `agent.test.ts` — Claude provider cost passthrough; OpenRouter computed
  cost on snapshot; OpenRouter `maxTokens` from contextLength.
- `codex-app-server.test.ts` — Codex computed cost on snapshot.
- `contextWindow.test.ts` — `computeSessionTotals` cumulative sum + subagent
  rollup + double-count guard.
- `SessionTokenPill.test.tsx` — cost render, `<$0.01`, cost-absent omission,
  cumulative numbers.

## OpenRouter live verification (required, not unit-mockable)

A `.live.test.ts` (env-gated) or a manual repro confirming an OpenRouter turn
yields non-zero `usedTokens` and a computed `costUsd`, and the context-window
max reflects the OpenRouter model contextLength.

## Out of scope

- The `/api/v1/generation` post-hoc exact-cost lookup (second request, gen-id
  plumbing through the SDK).
- Per-model historical cost analytics / billing dashboard.
- Persisting a price table to disk / admin-editable pricing.

## c3 follow-up

Touches component boundaries (agent-coordinator c3-210, codex provider,
client context-window). Run `/c3 change` in the same PR if refs/contracts move
(new pricing module, snapshot field).
