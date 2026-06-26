# SDK Token Count + Cost Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface per-turn and cumulative token cost (USD) across all providers — Claude SDK (provider-reported), OpenRouter + Codex + PTY (computed from a price table) — and roll subagent usage into the session total shown in `SessionTokenPill`.

**Architecture:** A new pure pricing module computes USD cost from token usage + a `ModelPrice`. A hybrid resolver prefers provider-reported cost (Claude `total_cost_usd`) and falls back to a price table — OpenRouter prices come from its model-list API, Claude/Codex from a small built-in table. `costUsd` rides on `ContextWindowUsageSnapshot`; the client sums per-turn usage + subagent runs into cumulative session totals + cost.

**Tech Stack:** TypeScript, Bun test (`--conditions production`), React 19, Zustand, Claude Agent SDK, Codex App Server.

---

## File Structure

- Create `src/shared/token-pricing.ts` — pure: `ModelPrice`, `computeCostUsd`, `resolveModelPrice`.
- Create `src/shared/token-pricing.test.ts` — co-located test.
- Modify `src/shared/types.ts` — `OpenRouterModel.pricing`; `ContextWindowUsageSnapshot.costUsd`.
- Modify `src/server/openrouter-models.ts` — parse pricing.
- Modify `src/server/openrouter-models.test.ts` — pricing parse tests.
- Modify `src/server/agent.ts` — Claude cost passthrough onto snapshot; OpenRouter computed cost + `maxTokens` from contextLength.
- Modify `src/server/codex-app-server.ts` — Codex computed cost on snapshot.
- Modify `src/client/lib/contextWindow.ts` — `computeSessionTotals` (cumulative + subagent rollup) + `formatCostUsd`.
- Modify `src/client/lib/contextWindow.test.ts` — totals tests.
- Modify `src/client/components/chat-ui/SessionTokenPill.tsx` — cost stat + cumulative.
- Modify `src/client/components/chat-ui/SessionTokenPill.test.tsx` — cost render tests.

Every test runs with `bun test --conditions production <file>` (bare `bun test` crashes on a Lexical TDZ — see CLAUDE.md).

---

## Task 1: Pricing module (pure)

**Files:**
- Create: `src/shared/token-pricing.ts`
- Test: `src/shared/token-pricing.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/shared/token-pricing.test.ts
import { describe, expect, test } from "bun:test"
import { computeCostUsd, resolveModelPrice } from "./token-pricing"

describe("computeCostUsd", () => {
  test("sums input+output at per-MTok rates", () => {
    const cost = computeCostUsd(
      { inputTokens: 1_000_000, outputTokens: 1_000_000 },
      { inputPerMTok: 3, outputPerMTok: 15 },
    )
    expect(cost).toBeCloseTo(18, 6)
  })

  test("cached tokens use cachedInputPerMTok when present", () => {
    const cost = computeCostUsd(
      { inputTokens: 0, cachedInputTokens: 1_000_000, outputTokens: 0 },
      { inputPerMTok: 3, outputPerMTok: 15, cachedInputPerMTok: 0.3 },
    )
    expect(cost).toBeCloseTo(0.3, 6)
  })

  test("cached tokens fall back to input rate when no cached rate", () => {
    const cost = computeCostUsd(
      { inputTokens: 0, cachedInputTokens: 1_000_000, outputTokens: 0 },
      { inputPerMTok: 3, outputPerMTok: 15 },
    )
    expect(cost).toBeCloseTo(3, 6)
  })

  test("missing fields treated as zero", () => {
    expect(computeCostUsd({}, { inputPerMTok: 3, outputPerMTok: 15 })).toBe(0)
  })
})

describe("resolveModelPrice", () => {
  test("derives OpenRouter price from per-token model pricing (x1e6)", () => {
    const price = resolveModelPrice("anthropic/claude-sonnet-4", {
      promptPerTok: 0.000003,
      completionPerTok: 0.000015,
    })
    expect(price).toEqual({ inputPerMTok: 3, outputPerMTok: 15 })
  })

  test("uses built-in table for a known static model id", () => {
    const price = resolveModelPrice("claude-sonnet-4-6")
    expect(price?.inputPerMTok).toBeGreaterThan(0)
    expect(price?.outputPerMTok).toBeGreaterThan(0)
  })

  test("unknown model id returns null (never fabricate)", () => {
    expect(resolveModelPrice("totally-unknown-model")).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test --conditions production src/shared/token-pricing.test.ts`
Expected: FAIL — "Cannot find module './token-pricing'".

- [ ] **Step 3: Write minimal implementation**

```ts
// src/shared/token-pricing.ts
import type { ProviderUsage } from "./types"

/** USD per 1,000,000 tokens. */
export interface ModelPrice {
  inputPerMTok: number
  outputPerMTok: number
  cachedInputPerMTok?: number
}

/** Per-token pricing as returned by the OpenRouter model list. */
export interface OpenRouterPricing {
  promptPerTok: number
  completionPerTok: number
}

const MILLION = 1_000_000

export function computeCostUsd(usage: ProviderUsage, price: ModelPrice): number {
  const input = nonNeg(usage.inputTokens)
  const cached = nonNeg(usage.cachedInputTokens)
  const output = nonNeg(usage.outputTokens)
  const cachedRate = price.cachedInputPerMTok ?? price.inputPerMTok
  return (
    (input / MILLION) * price.inputPerMTok
    + (cached / MILLION) * cachedRate
    + (output / MILLION) * price.outputPerMTok
  )
}

// Built-in table keyed by a substring of the model id. USD per 1M tokens.
// Keep small + current; unknown ids resolve to null (no fabricated cost).
const STATIC_PRICES: ReadonlyArray<readonly [string, ModelPrice]> = [
  ["opus", { inputPerMTok: 15, outputPerMTok: 75, cachedInputPerMTok: 1.5 }],
  ["sonnet", { inputPerMTok: 3, outputPerMTok: 15, cachedInputPerMTok: 0.3 }],
  ["haiku", { inputPerMTok: 0.8, outputPerMTok: 4, cachedInputPerMTok: 0.08 }],
  ["gpt-5", { inputPerMTok: 1.25, outputPerMTok: 10 }],
  ["o4", { inputPerMTok: 1.1, outputPerMTok: 4.4 }],
]

export function resolveModelPrice(
  modelId: string,
  openRouterPricing?: OpenRouterPricing | null,
): ModelPrice | null {
  if (openRouterPricing) {
    const inputPerMTok = openRouterPricing.promptPerTok * MILLION
    const outputPerMTok = openRouterPricing.completionPerTok * MILLION
    if (inputPerMTok > 0 || outputPerMTok > 0) {
      return { inputPerMTok, outputPerMTok }
    }
  }
  const id = modelId.toLowerCase()
  for (const [needle, price] of STATIC_PRICES) {
    if (id.includes(needle)) return price
  }
  return null
}

function nonNeg(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : 0
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test --conditions production src/shared/token-pricing.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/shared/token-pricing.ts src/shared/token-pricing.test.ts
git commit -m "feat(pricing): pure token cost + hybrid model-price resolver"
```

---

## Task 2: OpenRouter model pricing capture

**Files:**
- Modify: `src/shared/types.ts:19-23` (`OpenRouterModel`)
- Modify: `src/server/openrouter-models.ts:3-25`
- Test: `src/server/openrouter-models.test.ts`

- [ ] **Step 1: Write the failing test** (append to existing test file)

```ts
test("parses per-token pricing when present", () => {
  const models = parseOpenRouterModels({
    data: [{
      id: "anthropic/claude-sonnet-4",
      name: "Claude Sonnet 4",
      context_length: 200000,
      supported_parameters: ["tools"],
      pricing: { prompt: "0.000003", completion: "0.000015" },
    }],
  })
  expect(models[0]?.pricing).toEqual({ promptPerTok: 0.000003, completionPerTok: 0.000015 })
})

test("omits pricing when fields are missing or malformed", () => {
  const models = parseOpenRouterModels({
    data: [{
      id: "x/y",
      supported_parameters: ["tools"],
      pricing: { prompt: "abc" },
    }],
  })
  expect(models[0]?.pricing).toBeUndefined()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test --conditions production src/server/openrouter-models.test.ts`
Expected: FAIL — `pricing` undefined / type error.

- [ ] **Step 3: Add the type field**

In `src/shared/types.ts`, replace the `OpenRouterModel` interface (lines 19-23):

```ts
export interface OpenRouterModel {
  id: string
  label: string
  contextLength: number
  pricing?: { promptPerTok: number; completionPerTok: number }
}
```

- [ ] **Step 4: Parse pricing**

In `src/server/openrouter-models.ts`, extend `RawModel` and `parseOpenRouterModels`:

```ts
interface RawModel {
  id?: unknown
  name?: unknown
  context_length?: unknown
  supported_parameters?: unknown
  pricing?: { prompt?: unknown; completion?: unknown }
}

function parsePricing(
  pricing: RawModel["pricing"],
): { promptPerTok: number; completionPerTok: number } | undefined {
  const prompt = Number(pricing?.prompt)
  const completion = Number(pricing?.completion)
  if (!Number.isFinite(prompt) || !Number.isFinite(completion)) return undefined
  if (prompt < 0 || completion < 0) return undefined
  return { promptPerTok: prompt, completionPerTok: completion }
}
```

Then inside the `out.push({...})` add `pricing` (compute once before push):

```ts
    const pricing = parsePricing(entry.pricing)
    out.push({
      id: entry.id,
      label: typeof entry.name === "string" && entry.name.length > 0 ? entry.name : entry.id,
      contextLength: typeof entry.context_length === "number" ? entry.context_length : 0,
      ...(pricing ? { pricing } : {}),
    })
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test --conditions production src/server/openrouter-models.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/server/openrouter-models.ts src/server/openrouter-models.test.ts
git commit -m "feat(openrouter): capture per-token model pricing"
```

---

## Task 3: Cost field on the usage snapshot + Claude provider-cost passthrough

**Files:**
- Modify: `src/shared/types.ts:1152-1168` (`ContextWindowUsageSnapshot`)
- Modify: `src/server/agent.ts` (result handling ~947-977; `createClaudeHarnessStream`)
- Test: `src/server/agent.test.ts`

- [ ] **Step 1: Add `costUsd` to the snapshot type**

In `src/shared/types.ts`, add to `ContextWindowUsageSnapshot` (after `durationMs?`):

```ts
  /** USD cost for this turn. Provider-reported (Claude) or computed (others). */
  costUsd?: number
```

- [ ] **Step 2: Write the failing test** (append to `src/server/agent.test.ts`)

Find the existing helper that drives `createClaudeHarnessStream` over fake SDK messages (search the file for `createClaudeHarnessStream`). Add:

```ts
test("claude result cost is attached to the final-turn snapshot", async () => {
  const messages = [
    { type: "assistant", message: { id: "m1", usage: { input_tokens: 100, output_tokens: 50 } }, usage: { input_tokens: 100, output_tokens: 50 } },
    { type: "result", subtype: "success", total_cost_usd: 0.0123, usage: { input_tokens: 100, output_tokens: 50 }, duration_ms: 10, num_turns: 1, result: "ok" },
  ]
  const events = await collect(createClaudeHarnessStream(fakeQuery(messages)))
  const cwUpdates = events.filter((e) => e.type === "transcript" && e.entry.kind === "context_window_updated")
  const last = cwUpdates.at(-1)
  expect(last?.entry.usage.costUsd).toBeCloseTo(0.0123, 6)
})
```

(Reuse the file's existing `collect` / `fakeQuery` helpers; if names differ, match them.)

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test --conditions production src/server/agent.test.ts`
Expected: FAIL — `costUsd` undefined on the final snapshot.

- [ ] **Step 4: Pass provider cost through**

In `src/server/agent.ts`, in `createClaudeHarnessStream`'s `result` branch (after `finalUsage` is computed, before yielding), attach the provider cost:

```ts
      const providerCostUsd =
        typeof (sdkMessage as { total_cost_usd?: unknown }).total_cost_usd === "number"
          ? (sdkMessage as { total_cost_usd: number }).total_cost_usd
          : undefined

      if (finalUsage) {
        const usageWithCost = providerCostUsd !== undefined
          ? { ...finalUsage, costUsd: providerCostUsd }
          : finalUsage
        yield {
          type: "transcript",
          entry: timestamped({ kind: "context_window_updated", usage: usageWithCost }),
        }
      }
```

(Replace the existing `if (finalUsage) { yield ... }` block.)

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test --conditions production src/server/agent.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/server/agent.ts src/server/agent.test.ts
git commit -m "feat(agent): attach claude provider cost to context-window snapshot"
```

---

## Task 4: OpenRouter computed cost + maxTokens from contextLength

**Files:**
- Modify: `src/server/agent.ts` (`createClaudeHarnessStream` signature + result branch; OpenRouter session wiring)
- Test: `src/server/agent.test.ts`

**Context:** OpenRouter turns run through `createClaudeHarnessStream` with no `total_cost_usd`. We thread an optional cost-resolver into the stream so the result snapshot gets a computed `costUsd`, and pass the OpenRouter model `contextLength` as the configured context window.

- [ ] **Step 1: Write the failing test** (append to `src/server/agent.test.ts`)

```ts
test("openrouter turn gets computed cost from a price resolver", async () => {
  const messages = [
    { type: "assistant", message: { id: "m1", usage: { input_tokens: 1_000_000, output_tokens: 0 } }, usage: { input_tokens: 1_000_000, output_tokens: 0 } },
    { type: "result", subtype: "success", usage: { input_tokens: 1_000_000, output_tokens: 0 }, duration_ms: 10, num_turns: 1, result: "ok" },
  ]
  const events = await collect(
    createClaudeHarnessStream(fakeQuery(messages), 200000, () => ({ inputPerMTok: 3, outputPerMTok: 15 })),
  )
  const last = events.filter((e) => e.type === "transcript" && e.entry.kind === "context_window_updated").at(-1)
  expect(last?.entry.usage.costUsd).toBeCloseTo(3, 6)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test --conditions production src/server/agent.test.ts`
Expected: FAIL — third arg unsupported / cost undefined.

- [ ] **Step 3: Add the resolver parameter**

In `src/server/agent.ts`, change the signature:

```ts
export async function* createClaudeHarnessStream(
  q: Query,
  configuredContextWindow?: number,
  resolveTurnPrice?: () => import("../shared/token-pricing").ModelPrice | null,
): AsyncGenerator<HarnessEvent> {
```

In the `result` branch, extend the cost resolution from Task 3 to fall back to the resolver:

```ts
      let costUsd = providerCostUsd
      if (costUsd === undefined && resolveTurnPrice && finalUsage) {
        const price = resolveTurnPrice()
        if (price) {
          costUsd = computeCostUsd(
            {
              inputTokens: finalUsage.inputTokens,
              cachedInputTokens: finalUsage.cachedInputTokens,
              outputTokens: finalUsage.outputTokens,
            },
            price,
          )
        }
      }
      if (finalUsage) {
        const usageWithCost = costUsd !== undefined ? { ...finalUsage, costUsd } : finalUsage
        yield { type: "transcript", entry: timestamped({ kind: "context_window_updated", usage: usageWithCost }) }
      }
```

Add the import at the top of `agent.ts`:

```ts
import { computeCostUsd } from "../shared/token-pricing"
```

- [ ] **Step 4: Wire the resolver at the OpenRouter call site**

Find where `createClaudeHarnessStream(...)` is invoked for the session (search `createClaudeHarnessStream(` outside the definition). When the provider is `openrouter`, pass:
- `configuredContextWindow` = the selected OpenRouter model's `contextLength` (already available via the cached model list used at agent.ts:2040 area / `session.openrouterModel`).
- `resolveTurnPrice` = `() => resolveModelPrice(session.openrouterModel ?? "", openRouterModel?.pricing ?? null)` where `openRouterModel` is looked up from the cached list by id.

Add import:

```ts
import { resolveModelPrice } from "../shared/token-pricing"
```

If the cached OpenRouter model list is not already reachable at the call site, thread it through the same path that already resolves `session.openrouterModel` (the coordinator holds `listOpenRouterModels`; cache the resolved `OpenRouterModel` on the session next to `openrouterModel`/`openrouterKeyMasked`). For non-OpenRouter providers pass `undefined` (Claude keeps provider cost; Codex handled in Task 5).

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test --conditions production src/server/agent.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/agent.ts src/server/agent.test.ts
git commit -m "feat(agent): compute openrouter turn cost + wire context window"
```

---

## Task 5: Codex computed cost on snapshot

**Files:**
- Modify: `src/server/codex-app-server.ts:265-298` (`normalizeCodexTokenUsage`) + its call site
- Test: `src/server/codex-app-server.test.ts`

- [ ] **Step 1: Write the failing test** (append to `src/server/codex-app-server.test.ts`)

```ts
test("codex usage snapshot includes computed cost from model price", () => {
  const snap = normalizeCodexTokenUsage(
    { tokenUsage: { last_token_usage: { input_tokens: 1_000_000, output_tokens: 0, total_tokens: 1_000_000 }, model_context_window: 400000 } } as never,
    () => ({ inputPerMTok: 1.25, outputPerMTok: 10 }),
  )
  expect(snap?.costUsd).toBeCloseTo(1.25, 6)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test --conditions production src/server/codex-app-server.test.ts`
Expected: FAIL — second arg unsupported / `costUsd` undefined.

- [ ] **Step 3: Add the price resolver param**

In `src/server/codex-app-server.ts`, change the signature + append cost to the returned object:

```ts
function normalizeCodexTokenUsage(
  notification: ThreadTokenUsageUpdatedNotification,
  resolveTurnPrice?: () => import("../shared/token-pricing").ModelPrice | null,
): ContextWindowUsageSnapshot | null {
```

Before `return { ... }`, compute cost:

```ts
  let costUsd: number | undefined
  if (resolveTurnPrice) {
    const price = resolveTurnPrice()
    if (price) {
      costUsd = computeCostUsd({ inputTokens, cachedInputTokens, outputTokens }, price)
    }
  }
```

Add `...(costUsd !== undefined ? { costUsd } : {})` into the returned object, and import:

```ts
import { computeCostUsd, resolveModelPrice } from "../shared/token-pricing"
```

- [ ] **Step 4: Wire the resolver at the call site**

Find where `normalizeCodexTokenUsage(notification)` is called and pass `() => resolveModelPrice(activeModelId)` where `activeModelId` is the Codex session's selected model id (search the file for the model id held on the session/context).

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test --conditions production src/server/codex-app-server.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/codex-app-server.ts src/server/codex-app-server.test.ts
git commit -m "feat(codex): compute turn cost on usage snapshot"
```

---

## Task 6: Cumulative + subagent rollup (client)

**Files:**
- Modify: `src/client/lib/contextWindow.ts`
- Test: `src/client/lib/contextWindow.test.ts`

**Context:** Per-turn token deltas live on each `context_window_updated` entry's `last*` fields (`lastInputTokens`, `lastOutputTokens`, `lastCachedInputTokens`) and `costUsd`. Summing `last*` avoids double-counting the running context-window figure. Subagent usage comes from each run's `run.usage` (`ProviderUsage`).

- [ ] **Step 1: Write the failing test** (append to `src/client/lib/contextWindow.test.ts`)

```ts
import { computeSessionTotals, formatCostUsd } from "./contextWindow"

test("computeSessionTotals sums per-turn last* deltas + subagent usage + cost", () => {
  const entries = [
    { kind: "context_window_updated", createdAt: 1, usage: { usedTokens: 100, lastInputTokens: 100, lastOutputTokens: 20, costUsd: 0.01, compactsAutomatically: false } },
    { kind: "context_window_updated", createdAt: 2, usage: { usedTokens: 300, lastInputTokens: 150, lastOutputTokens: 30, costUsd: 0.02, compactsAutomatically: false } },
  ] as never
  const subagentRuns = [
    { usage: { inputTokens: 40, outputTokens: 10, cachedInputTokens: 5, costUsd: 0.005 } },
  ] as never
  const totals = computeSessionTotals(entries, subagentRuns)
  expect(totals?.inputTokens).toBe(290)   // 100 + 150 + 40
  expect(totals?.outputTokens).toBe(60)   // 20 + 30 + 10
  expect(totals?.costUsd).toBeCloseTo(0.035, 6) // 0.01 + 0.02 + 0.005
})

test("formatCostUsd formats sub-cent, dollars", () => {
  expect(formatCostUsd(0)).toBe("$0.00")
  expect(formatCostUsd(0.004)).toBe("<$0.01")
  expect(formatCostUsd(0.42)).toBe("$0.42")
  expect(formatCostUsd(12.3)).toBe("$12.30")
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test --conditions production src/client/lib/contextWindow.test.ts`
Expected: FAIL — exports missing.

- [ ] **Step 3: Implement**

Add to `src/client/lib/contextWindow.ts` (use the real subagent-run type from the store; if a narrower shape is enough, define a local `interface SessionSubagentUsage { usage?: ProviderUsage | null }` and import `ProviderUsage` from shared types):

```ts
import type { ContextWindowUsageSnapshot, ProviderUsage, TranscriptEntry } from "../../shared/types"

export interface SessionTotals {
  inputTokens: number
  outputTokens: number
  cachedTokens: number
  costUsd: number
  cacheHitPercentage: number | null
}

export function computeSessionTotals(
  entries: ReadonlyArray<TranscriptEntry>,
  subagentRuns: ReadonlyArray<{ usage?: ProviderUsage | null }>,
): SessionTotals | null {
  let input = 0
  let output = 0
  let cached = 0
  let cost = 0

  for (const entry of entries) {
    if (entry.kind !== "context_window_updated") continue
    const u = entry.usage
    input += pos(u.lastInputTokens)
    output += pos(u.lastOutputTokens)
    cached += pos(u.lastCachedInputTokens)
    cost += pos(u.costUsd)
  }
  for (const run of subagentRuns) {
    const u = run.usage
    if (!u) continue
    input += pos(u.inputTokens)
    output += pos(u.outputTokens)
    cached += pos(u.cachedInputTokens)
    cost += pos(u.costUsd)
  }

  if (input === 0 && output === 0 && cached === 0 && cost === 0) return null

  const billedAndCached = input + cached
  const cacheHitPercentage = billedAndCached > 0 ? (cached / billedAndCached) * 100 : null
  return { inputTokens: input, outputTokens: output, cachedTokens: cached, costUsd: cost, cacheHitPercentage }
}

export function formatCostUsd(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "$0.00"
  if (value < 0.01) return "<$0.01"
  return `$${value.toFixed(2)}`
}

function pos(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : 0
}
```

(`pos` duplicates the existing `toNonNegative`; reuse `toNonNegative` instead if you prefer — do not keep two identical helpers.)

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test --conditions production src/client/lib/contextWindow.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/lib/contextWindow.ts src/client/lib/contextWindow.test.ts
git commit -m "feat(client): cumulative session totals + cost with subagent rollup"
```

---

## Task 7: SessionTokenPill shows cumulative totals + cost

**Files:**
- Modify: `src/client/components/chat-ui/SessionTokenPill.tsx`
- Modify: `src/client/app/ChatPage/index.tsx` and/or `src/client/components/chat-ui/ChatInput.tsx` (callers — pass entries + subagent runs)
- Test: `src/client/components/chat-ui/SessionTokenPill.test.tsx`

**Context:** Follow `kanna-react-style` (tabular-nums, project Popover) + `impeccable` (consistent spacing/hierarchy). The pill currently takes `usage: ContextWindowSnapshot | null`. Add `totals: SessionTotals | null` so the trigger shows cumulative in/out + cost, popover breaks down main-vs-subagent + total cost. Keep `usage` for the cache-hit context-window detail if desired.

- [ ] **Step 1: Write the failing test** (extend `SessionTokenPill.test.tsx`)

```ts
test("renders cumulative cost when totals carry cost", () => {
  render(<SessionTokenPill usage={null} totals={{ inputTokens: 290, outputTokens: 60, cachedTokens: 5, costUsd: 0.42, cacheHitPercentage: 1.7 }} />)
  expect(screen.getByText("$0.42")).toBeTruthy()
})

test("omits cost stat when cost is zero", () => {
  render(<SessionTokenPill usage={null} totals={{ inputTokens: 10, outputTokens: 5, cachedTokens: 0, costUsd: 0, cacheHitPercentage: null }} />)
  expect(screen.queryByText("$0.00")).toBeNull()
})
```

(Match the file's existing render harness / imports.)

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test --conditions production src/client/components/chat-ui/SessionTokenPill.test.tsx`
Expected: FAIL — `totals` prop unsupported.

- [ ] **Step 3: Implement**

Update `SessionTokenPillProps` and render. Prefer `totals` for the in/out numbers; add a cost `Stat` when `totals.costUsd > 0`:

```tsx
import { type ContextWindowSnapshot, type SessionTotals, computeSessionTokenSummary, formatContextWindowTokens, formatCostUsd } from "../../lib/contextWindow"

interface SessionTokenPillProps {
  usage: ContextWindowSnapshot | null
  totals: SessionTotals | null
  className?: string
}

export function SessionTokenPill({ usage, totals, className }: SessionTokenPillProps) {
  const summary = computeSessionTokenSummary(usage)
  if (!totals && !summary) return null
  const inTokens = totals?.inputTokens ?? summary?.input ?? 0
  const outTokens = totals?.outputTokens ?? summary?.output ?? 0
  const showCost = (totals?.costUsd ?? 0) > 0
  // ...render Stat in / out / (cost when showCost) / cache; popover: main vs subagent + total cost
}
```

(Render `<Stat label="$" value={formatCostUsd(totals.costUsd)} />` — or label `"cost"` with the `$` value — keeping the existing `Stat`/`Separator`/`Row` structure and tabular-nums classes.)

- [ ] **Step 4: Update callers**

In `src/client/app/ChatPage/index.tsx` (and `ChatInput.tsx` if it mounts the pill), compute `totals` via `computeSessionTotals(entries, subagentRuns)` from the transcript entries + the chat's subagent runs store (the same store read by `SubagentsSection`), and pass `totals={totals}` alongside the existing `usage`.

- [ ] **Step 5: Run tests**

Run: `bun test --conditions production src/client/components/chat-ui/SessionTokenPill.test.tsx`
Expected: PASS.

- [ ] **Step 6: Lint + commit**

```bash
bun run lint
git add src/client/components/chat-ui/SessionTokenPill.tsx src/client/components/chat-ui/SessionTokenPill.test.tsx src/client/app/ChatPage/index.tsx src/client/components/chat-ui/ChatInput.tsx
git commit -m "feat(ui): show cumulative session tokens + cost in pill"
```

---

## Task 8: OpenRouter live verification + full gate + c3 sync

**Files:**
- Optional create: `src/server/agent.openrouter-cost.live.test.ts` (env-gated)
- Docs/c3 as needed

- [ ] **Step 1: Manual OpenRouter repro**

With an OpenRouter key configured, run one OpenRouter turn in the UI. Confirm: `SessionTokenPill` shows non-zero in/out and a non-zero `$` cost, and the context-window meter max reflects the OpenRouter model `contextLength`. Record findings in the PR description. (If tokens are zero, capture the raw SDK `usage` shape — that is the real OpenRouter bug to fix before merge.)

- [ ] **Step 2: Full test + lint gate**

Run: `bun run test`
Expected: PASS (all suites).
Run: `bun run lint`
Expected: 0 errors, warnings within cap.

- [ ] **Step 3: c3 doc sync**

Run `/c3 change` (or `/c3 sweep`) for the new `token-pricing` module + the `costUsd` snapshot contract + the pricing flow through agent-coordinator (c3-210), codex provider, and the client context-window component. Update refs/rules in this PR if boundaries moved.

- [ ] **Step 4: Open PR**

```bash
git push -u origin feat/sdk-token-count-cost
gh pr create --repo cuongtranba/kanna --base main --head feat/sdk-token-count-cost \
  --title "feat: token cost across SDK/OpenRouter/Codex + cumulative + subagent rollup" \
  --body "$(cat <<'EOF'
## Summary
- Pure pricing module: provider-reported cost (Claude) with model-price-table fallback (OpenRouter from model list, Codex/static built-in).
- `costUsd` on the per-turn context-window snapshot for all drivers.
- Cumulative session totals + subagent rollup, shown as a cost stat in SessionTokenPill.
- OpenRouter context-window max wired from model contextLength.

## Test plan
- [ ] `bun run test` green
- [ ] `bun run lint` clean
- [ ] Manual OpenRouter turn shows non-zero tokens + cost
- [ ] Codex turn shows computed cost
- [ ] Claude turn shows provider-reported cost
EOF
)"
```

---

## Self-Review notes

- **Spec coverage:** OpenRouter cost (Task 4) + maxTokens (Task 4); cost readout (Tasks 3,5,7); cumulative + subagent rollup (Tasks 6,7); hybrid source (Task 1 resolver). All spec sections mapped.
- **Type consistency:** `ModelPrice`/`computeCostUsd`/`resolveModelPrice` (Task 1) reused verbatim in Tasks 4,5; `costUsd` on `ContextWindowUsageSnapshot` (Task 3) consumed in Task 6; `SessionTotals`/`computeSessionTotals`/`formatCostUsd` (Task 6) consumed in Task 7.
- **Open integration points (read code at execution time, not placeholders):** the exact `createClaudeHarnessStream` session call site (Task 4 Step 4) and the Codex active-model id + `normalizeCodexTokenUsage` call site (Task 5 Step 4) must be located in-file; the plan names the search anchors.
