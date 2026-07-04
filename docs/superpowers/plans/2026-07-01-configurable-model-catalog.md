# Configurable Model Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users add/edit/remove Claude & Codex models from the Settings UI (persisted in `settings.json`) instead of editing hardcoded arrays.

**Architecture:** A new `customModels[]` field in app settings, seeded from the built-in `PROVIDERS` list on first load. A pure `mergeCustomModels(base, custom)` folds custom entries over the built-in catalog (override by `id`, append new). The merged catalog flows to the client through the existing per-chat `ChatSnapshot.availableProviders`; the Settings UI mirrors the `customMcpServers` CRUD pattern end-to-end. The duplicate Codex source (`HARD_CODED_CODEX_MODELS`) is deleted so `PROVIDERS` is the single source of truth.

**Tech Stack:** TypeScript, Bun test, Zustand (client store), React 19. Run tests with `bun test --conditions production <file>`.

---

## Conventions (read once)

- Worktree: `.worktrees/configurable-model-catalog`, branch `feat/configurable-model-catalog`. All paths below are relative to the worktree root.
- Run a single suite: `bun test --conditions production src/<path>.test.ts`.
- **Never** run the full test suite or full lint from a subagent — scope to the files you touched.
- Side-effect seal: `src/shared/**` and `src/client/**` are pure — no `node:*`, no `process.env`. `mergeCustomModels` and all new shared code must stay pure.
- After the last code task, run `bun run lint` and `bun run test` once from the top level (Task 9).

---

## File Structure

- `src/shared/types.ts` — MODIFY: add `CustomModelEntry`, `CustomModelInput`, `CustomModelPatch`, `mergeCustomModels`, and the `customModels` fields on `AppSettingsSnapshot` / `AppSettingsPatch`.
- `src/shared/types.test.ts` — MODIFY: `mergeCustomModels` tests.
- `src/server/provider-catalog.ts` — MODIFY: delete duplicate Codex list; `SERVER_PROVIDERS = [...PROVIDERS]`; `normalizeServerModel` gains `customModels`.
- `src/server/provider-catalog.test.ts` — MODIFY: single-source + custom-id tests.
- `src/server/app-settings.ts` — MODIFY: seed/normalize/validate/build/apply/reducer arms + snapshot/file/comparable field.
- `src/server/app-settings.test.ts` — MODIFY: seed, validation, CRUD reducer tests.
- `src/server/read-models.ts` — MODIFY: thread `customModels` into `deriveChatSnapshot`; merge into `availableProviders`.
- `src/server/read-models.test.ts` — MODIFY: snapshot includes custom model.
- `src/server/ws-router.ts` — MODIFY: pass `customModels` at the `deriveChatSnapshot` call site.
- `src/client/stores/appSettingsStore.ts` — MODIFY: preserve `customModels` in `mergeAppSettingsPatch`; add `selectCustomModels`.
- `src/client/stores/appSettingsStore.test.ts` — MODIFY: selector test.
- `src/client/app/ModelsSection.tsx` — CREATE: CRUD UI (mirrors `McpServersSection.tsx`).
- `src/client/app/ModelsSection.test.tsx` — CREATE: render + dispatch tests.
- `src/client/app/SettingsPage.tsx` — MODIFY: mount `ModelsSection`; feed pickers the merged catalog.

---

## Task 1: Shared types + `mergeCustomModels`

**Files:**
- Modify: `src/shared/types.ts` (near `ProviderModelOption` at :105 and `PROVIDERS` at :349; `AppSettingsSnapshot` at :752, `AppSettingsPatch` at :781)
- Test: `src/shared/types.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/shared/types.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { PROVIDERS, mergeCustomModels, type CustomModelEntry } from "./types"

describe("mergeCustomModels", () => {
  const base = () => PROVIDERS.map((p) => ({ ...p, models: [...p.models] }))

  const entry = (over: Partial<CustomModelEntry>): CustomModelEntry => ({
    id: "custom-x",
    label: "Custom X",
    provider: "claude",
    supportsEffort: true,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  })

  test("appends a new model to the matching provider", () => {
    const merged = mergeCustomModels(base(), [entry({ id: "claude-new", label: "New" })])
    const claude = merged.find((p) => p.id === "claude")!
    expect(claude.models.some((m) => m.id === "claude-new")).toBe(true)
  })

  test("overrides a built-in with the same id in place", () => {
    const merged = mergeCustomModels(base(), [entry({ id: "claude-opus-4-8", label: "Renamed Opus" })])
    const claude = merged.find((p) => p.id === "claude")!
    const opus = claude.models.filter((m) => m.id === "claude-opus-4-8")
    expect(opus).toHaveLength(1)
    expect(opus[0]!.label).toBe("Renamed Opus")
  })

  test("routes codex entries to the codex provider only", () => {
    const merged = mergeCustomModels(base(), [entry({ id: "gpt-x", label: "GPT X", provider: "codex", supportsEffort: false })])
    expect(merged.find((p) => p.id === "codex")!.models.some((m) => m.id === "gpt-x")).toBe(true)
    expect(merged.find((p) => p.id === "claude")!.models.some((m) => m.id === "gpt-x")).toBe(false)
  })

  test("empty custom list returns an equal catalog and does not mutate base", () => {
    const original = base()
    const merged = mergeCustomModels(original, [])
    expect(merged.find((p) => p.id === "claude")!.models.map((m) => m.id))
      .toEqual(original.find((p) => p.id === "claude")!.models.map((m) => m.id))
    expect(original.find((p) => p.id === "claude")!.models.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test --conditions production src/shared/types.test.ts`
Expected: FAIL — `mergeCustomModels`/`CustomModelEntry` not exported.

- [ ] **Step 3: Add the types and merge helper**

In `src/shared/types.ts`, after the `ProviderModelOption` interface (ends at :112), add:

```ts
export interface CustomModelEntry {
  id: string
  label: string
  provider: "claude" | "codex"
  supportsEffort: boolean
  aliases?: readonly string[]
  contextWindowOptions?: readonly ProviderContextWindowOption[]
  supportsMaxReasoningEffort?: boolean
  createdAt: number
  updatedAt: number
}

export interface CustomModelInput {
  id: string
  label: string
  provider: "claude" | "codex"
  supportsEffort: boolean
  aliases?: readonly string[]
  contextWindowOptions?: readonly ProviderContextWindowOption[]
  supportsMaxReasoningEffort?: boolean
}

export interface CustomModelPatch {
  label?: string
  supportsEffort?: boolean
  aliases?: readonly string[] | null
  contextWindowOptions?: readonly ProviderContextWindowOption[] | null
  supportsMaxReasoningEffort?: boolean
}

function customEntryToModelOption(entry: CustomModelEntry): ProviderModelOption {
  return {
    id: entry.id,
    label: entry.label,
    supportsEffort: entry.supportsEffort,
    ...(entry.aliases ? { aliases: entry.aliases } : {}),
    ...(entry.contextWindowOptions ? { contextWindowOptions: entry.contextWindowOptions } : {}),
    ...(entry.supportsMaxReasoningEffort !== undefined ? { supportsMaxReasoningEffort: entry.supportsMaxReasoningEffort } : {}),
  }
}

export function mergeCustomModels(
  base: ProviderCatalogEntry[],
  customModels: readonly CustomModelEntry[],
): ProviderCatalogEntry[] {
  return base.map((entry) => {
    if (entry.id !== "claude" && entry.id !== "codex") return { ...entry, models: [...entry.models] }
    const forProvider = customModels.filter((m) => m.provider === entry.id)
    if (forProvider.length === 0) return { ...entry, models: [...entry.models] }
    const models = [...entry.models]
    for (const custom of forProvider) {
      const option = customEntryToModelOption(custom)
      const idx = models.findIndex((m) => m.id === option.id)
      if (idx >= 0) models[idx] = option
      else models.push(option)
    }
    return { ...entry, models }
  })
}
```

- [ ] **Step 4: Add the settings fields**

In `AppSettingsSnapshot` (:752), after `customMcpServers: McpServerConfig[]` add:

```ts
  customModels: CustomModelEntry[]
```

In `AppSettingsPatch` (:781), after the `customMcpServers?: {...}` block add:

```ts
  customModels?: {
    create?: CustomModelInput
    update?: { id: string; patch: CustomModelPatch }
    delete?: { id: string }
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test --conditions production src/shared/types.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/shared/types.test.ts
git commit -m "feat(shared): add CustomModelEntry + mergeCustomModels catalog merge"
```

---

## Task 2: Server settings — seed, validate, CRUD

**Files:**
- Modify: `src/server/app-settings.ts`
- Test: `src/server/app-settings.test.ts`

Reference structures to mirror: `validateMcpShape` (:1002), `buildMcpFromInput` (:1032), `applyMcpPatch` (:1061), `normalizeMcpServers` (:621), reducer arms (:1176–1222), `toFilePayload` (:807), `toSnapshot` (:831), `toComparablePayload` (:944), `AppSettingsState` (:115), normalize assembly (:902–930).

- [ ] **Step 1: Write the failing tests**

Add to `src/server/app-settings.test.ts` (follow the existing import style at the top of that file; `AppSettingsManager`, `normalizeAppSettings` are already imported there — reuse them):

```ts
describe("customModels", () => {
  test("seeds from built-in PROVIDERS when absent", () => {
    const snap = normalizeAppSettings(undefined).payload
    const ids = snap.customModels.map((m) => m.id)
    expect(ids).toContain("claude-opus-4-8")
    expect(ids).toContain("gpt-5.5")
    expect(snap.customModels.every((m) => m.provider === "claude" || m.provider === "codex")).toBe(true)
  })

  test("create adds a new custom model", () => {
    const before = normalizeAppSettings(undefined).payload
    const after = applySettingsPatch(before, {
      customModels: { create: { id: "claude-test", label: "Test", provider: "claude", supportsEffort: true } },
    })
    expect(after.customModels.some((m) => m.id === "claude-test" && m.label === "Test")).toBe(true)
  })

  test("rejects create with empty label", () => {
    const before = normalizeAppSettings(undefined).payload
    expect(() =>
      applySettingsPatch(before, {
        customModels: { create: { id: "claude-bad", label: "  ", provider: "claude", supportsEffort: true } },
      }),
    ).toThrow()
  })

  test("rejects duplicate id within the same provider", () => {
    const before = normalizeAppSettings(undefined).payload
    expect(() =>
      applySettingsPatch(before, {
        customModels: { create: { id: "claude-opus-4-8", label: "Dup", provider: "claude", supportsEffort: true } },
      }),
    ).toThrow()
  })

  test("update edits label; delete removes the entry", () => {
    const before = normalizeAppSettings(undefined).payload
    const created = applySettingsPatch(before, {
      customModels: { create: { id: "claude-edit", label: "Before", provider: "claude", supportsEffort: true } },
    })
    const updated = applySettingsPatch(created, {
      customModels: { update: { id: "claude-edit", patch: { label: "After" } } },
    })
    expect(updated.customModels.find((m) => m.id === "claude-edit")!.label).toBe("After")
    const deleted = applySettingsPatch(updated, { customModels: { delete: { id: "claude-edit" } } })
    expect(deleted.customModels.some((m) => m.id === "claude-edit")).toBe(false)
  })
})
```

> The reducer function in `app-settings.ts` is exported as `applySettingsPatch` — verify the exact exported name in the file's existing tests (search the test file for how MCP CRUD is invoked, e.g. `applySettingsPatch(` or a manager method) and match it. If the tests use a manager instance instead, mirror that call shape.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test --conditions production src/server/app-settings.test.ts`
Expected: FAIL — `customModels` unknown / not seeded.

- [ ] **Step 3: Add constants + validation + build/apply/normalize**

Near the MCP constants (:139) add:

```ts
const MODEL_ID_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/
const MODEL_LABEL_MAX = 64
```

Add a validation exception + functions (mirror `McpValidationException` / `validateMcpShape`). Place beside the MCP validators (~:1000):

```ts
interface CustomModelValidationError {
  code: "INVALID_ID" | "EMPTY_LABEL" | "INVALID_PROVIDER" | "DUPLICATE_ID" | "NOT_FOUND"
  field?: string
  message: string
}

class CustomModelValidationException extends Error {
  constructor(readonly validationError: CustomModelValidationError) {
    super(validationError.message)
  }
}

function validateCustomModelShape(
  entry: CustomModelEntry,
  others: Array<{ id: string; provider: string }>,
): CustomModelValidationError | null {
  if (!MODEL_ID_REGEX.test(entry.id)) {
    return { code: "INVALID_ID", field: "id", message: `id must match ${MODEL_ID_REGEX}` }
  }
  if (entry.label.trim().length === 0 || entry.label.length > MODEL_LABEL_MAX) {
    return { code: "EMPTY_LABEL", field: "label", message: "label must be non-empty and <= 64 chars" }
  }
  if (entry.provider !== "claude" && entry.provider !== "codex") {
    return { code: "INVALID_PROVIDER", field: "provider", message: "provider must be claude or codex" }
  }
  for (const other of others) {
    if (other.id === entry.id && other.provider === entry.provider) {
      return { code: "DUPLICATE_ID", field: "id", message: `model '${entry.id}' already exists for ${entry.provider}` }
    }
  }
  return null
}

function buildCustomModelFromInput(input: CustomModelInput): CustomModelEntry {
  const now = Date.now()
  return {
    id: input.id.trim(),
    label: input.label.trim(),
    provider: input.provider,
    supportsEffort: input.supportsEffort,
    ...(input.aliases ? { aliases: input.aliases } : {}),
    ...(input.contextWindowOptions ? { contextWindowOptions: input.contextWindowOptions } : {}),
    ...(input.supportsMaxReasoningEffort !== undefined ? { supportsMaxReasoningEffort: input.supportsMaxReasoningEffort } : {}),
    createdAt: now,
    updatedAt: now,
  }
}

function applyCustomModelPatch(existing: CustomModelEntry, patch: CustomModelPatch): CustomModelEntry {
  return {
    ...existing,
    label: patch.label !== undefined ? patch.label.trim() : existing.label,
    supportsEffort: patch.supportsEffort ?? existing.supportsEffort,
    aliases: patch.aliases === null ? undefined : patch.aliases ?? existing.aliases,
    contextWindowOptions: patch.contextWindowOptions === null ? undefined : patch.contextWindowOptions ?? existing.contextWindowOptions,
    supportsMaxReasoningEffort: patch.supportsMaxReasoningEffort ?? existing.supportsMaxReasoningEffort,
    updatedAt: Date.now(),
  }
}

function seedCustomModelsFromBuiltins(): CustomModelEntry[] {
  const now = Date.now()
  const out: CustomModelEntry[] = []
  for (const provider of PROVIDERS) {
    if (provider.id !== "claude" && provider.id !== "codex") continue
    for (const model of provider.models) {
      out.push({
        id: model.id,
        label: model.label,
        provider: provider.id,
        supportsEffort: model.supportsEffort,
        ...(model.aliases ? { aliases: model.aliases } : {}),
        ...(model.contextWindowOptions ? { contextWindowOptions: model.contextWindowOptions } : {}),
        ...(model.supportsMaxReasoningEffort !== undefined ? { supportsMaxReasoningEffort: model.supportsMaxReasoningEffort } : {}),
        createdAt: now,
        updatedAt: now,
      })
    }
  }
  return out
}

function normalizeCustomModels(value: unknown, warnings: string[]): CustomModelEntry[] {
  if (value === undefined || value === null) return seedCustomModelsFromBuiltins()
  if (!Array.isArray(value)) {
    warnings.push("customModels must be an array")
    return seedCustomModelsFromBuiltins()
  }
  const out: CustomModelEntry[] = []
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue
    const candidate = raw as Partial<CustomModelEntry>
    const entry: CustomModelEntry = {
      id: String(candidate.id ?? ""),
      label: String(candidate.label ?? ""),
      provider: candidate.provider === "codex" ? "codex" : "claude",
      supportsEffort: candidate.supportsEffort === true,
      ...(Array.isArray(candidate.aliases) ? { aliases: candidate.aliases.map(String) } : {}),
      ...(Array.isArray(candidate.contextWindowOptions) ? { contextWindowOptions: candidate.contextWindowOptions } : {}),
      ...(typeof candidate.supportsMaxReasoningEffort === "boolean" ? { supportsMaxReasoningEffort: candidate.supportsMaxReasoningEffort } : {}),
      createdAt: typeof candidate.createdAt === "number" ? candidate.createdAt : Date.now(),
      updatedAt: typeof candidate.updatedAt === "number" ? candidate.updatedAt : Date.now(),
    }
    const err = validateCustomModelShape(entry, out.map((m) => ({ id: m.id, provider: m.provider })))
    if (err) {
      warnings.push(`customModels: dropped ${entry.id || "entry"} (${err.message})`)
      continue
    }
    out.push(entry)
  }
  return out
}
```

Add the import of `CustomModelEntry`, `CustomModelInput`, `CustomModelPatch`, and `PROVIDERS` to the existing `../shared/types` import block near the top of the file (PROVIDERS may not yet be imported there — add it).

- [ ] **Step 4: Wire the field into state assembly + payloads**

In the `normalizeAppSettings` state object (:902, alongside `customMcpServers: normalizeMcpServers(...)` at :926) add:

```ts
    customModels: normalizeCustomModels(source?.customModels, warnings),
```

Add `customModels: state.customModels,` to `toFilePayload` (:824 area), `toSnapshot` (:849 area), and `toComparablePayload` (:961 area — read `source.customModels`).

- [ ] **Step 5: Add reducer arms**

In the reducer (after the `customMcpServers` block ends at :1222) add:

```ts
  let nextCustomModels = state.customModels
  if (patch.customModels?.create) {
    const entry = buildCustomModelFromInput(patch.customModels.create)
    const error = validateCustomModelShape(entry, state.customModels.map((m) => ({ id: m.id, provider: m.provider })))
    if (error) throw new CustomModelValidationException(error)
    nextCustomModels = [...state.customModels, entry]
  } else if (patch.customModels?.update) {
    const { id, patch: modelPatch } = patch.customModels.update
    const idx = state.customModels.findIndex((m) => m.id === id)
    if (idx < 0) throw new CustomModelValidationException({ code: "NOT_FOUND", message: `custom model ${id} not found` })
    const updated = applyCustomModelPatch(state.customModels[idx]!, modelPatch)
    nextCustomModels = [...state.customModels.slice(0, idx), updated, ...state.customModels.slice(idx + 1)]
  } else if (patch.customModels?.delete) {
    nextCustomModels = state.customModels.filter((m) => m.id !== patch.customModels!.delete!.id)
  }
```

Then add `customModels: nextCustomModels,` to the object passed to `normalizeAppSettings(...)` at the end of the reducer (:1275 area, next to `customMcpServers: nextMcpServers,`).

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun test --conditions production src/server/app-settings.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/server/app-settings.ts src/server/app-settings.test.ts
git commit -m "feat(server): seed + CRUD custom models in app settings"
```

---

## Task 3: Single-source provider catalog + custom-aware normalize

**Files:**
- Modify: `src/server/provider-catalog.ts` (:22 `HARD_CODED_CODEX_MODELS`, :29 `SERVER_PROVIDERS`, :47 `normalizeServerModel`)
- Test: `src/server/provider-catalog.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/server/provider-catalog.test.ts`:

```ts
import { PROVIDERS, type CustomModelEntry } from "../shared/types"
import { SERVER_PROVIDERS, normalizeServerModel } from "./provider-catalog"

test("SERVER_PROVIDERS mirrors PROVIDERS (no duplicate codex source)", () => {
  expect(SERVER_PROVIDERS.map((p) => p.id)).toEqual(PROVIDERS.map((p) => p.id))
  const codex = SERVER_PROVIDERS.find((p) => p.id === "codex")!
  expect(codex.models.map((m) => m.id)).toEqual(PROVIDERS.find((p) => p.id === "codex")!.models.map((m) => m.id))
})

test("normalizeServerModel accepts a known custom model id", () => {
  const custom: CustomModelEntry[] = [
    { id: "claude-experimental", label: "Exp", provider: "claude", supportsEffort: true, createdAt: 1, updatedAt: 1 },
  ]
  expect(normalizeServerModel("claude", "claude-experimental", custom)).toBe("claude-experimental")
})

test("normalizeServerModel falls back to default for unknown id", () => {
  expect(normalizeServerModel("claude", "nope", [])).toBe(PROVIDERS.find((p) => p.id === "claude")!.defaultModel)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test --conditions production src/server/provider-catalog.test.ts`
Expected: FAIL — `normalizeServerModel` has no 3rd param / codex still hardcoded.

- [ ] **Step 3: Delete the duplicate and rewrite**

Replace lines :22–:54 of `src/server/provider-catalog.ts` with:

```ts
import { mergeCustomModels } from "../shared/types"
import type { CustomModelEntry } from "../shared/types"

export const SERVER_PROVIDERS: ProviderCatalogEntry[] = [...PROVIDERS]

export function getServerProviderCatalog(provider: AgentProvider): ProviderCatalogEntry {
  const entry = SERVER_PROVIDERS.find((candidate) => candidate.id === provider)
  if (!entry) {
    throw new Error(`Unknown provider: ${provider}`)
  }
  return entry
}

export function normalizeServerModel(
  provider: AgentProvider,
  model?: string,
  customModels: readonly CustomModelEntry[] = [],
): string {
  const merged = mergeCustomModels([...SERVER_PROVIDERS], customModels)
  const catalog = merged.find((candidate) => candidate.id === provider) ?? getServerProviderCatalog(provider)
  const normalizedModel = normalizeProviderModelId(provider, model, catalog.defaultModel)
  if (catalog.models.some((candidate) => candidate.id === normalizedModel)) {
    return normalizedModel
  }
  return catalog.defaultModel
}
```

Remove the now-unused `HARD_CODED_CODEX_MODELS` const and its imports. Keep the other exports in the file (`normalizeClaudeModelOptions`, etc.) unchanged. If any existing caller of `normalizeServerModel` breaks, it just omits the 3rd arg (defaults to `[]`) — no change needed.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test --conditions production src/server/provider-catalog.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/provider-catalog.ts src/server/provider-catalog.test.ts
git commit -m "refactor(server): single-source provider catalog + custom-aware normalize"
```

---

## Task 4: Merge custom models into the chat snapshot

**Files:**
- Modify: `src/server/read-models.ts` (:268 `deriveChatSnapshot` signature, :344 `availableProviders`)
- Modify: `src/server/ws-router.ts` (:969 call site)
- Test: `src/server/read-models.test.ts`

- [ ] **Step 1: Write the failing test**

In `src/server/read-models.test.ts`, extend the existing snapshot test (near :137 which already asserts `availableProviders`). Add a new test that passes a custom model through the new param:

```ts
test("availableProviders includes seeded/custom models", () => {
  // build the same state the existing test uses, then:
  const custom = [
    { id: "claude-plan-only", label: "Plan Only", provider: "claude" as const, supportsEffort: true, createdAt: 1, updatedAt: 1 },
  ]
  const snap = deriveChatSnapshot(
    state, activeStatuses, drainingChatIds, slashLoading, chatId,
    getMessages, getTunnelEvents, new Map(), Date.now(), new Map(), custom,
  )
  const claude = snap!.availableProviders.find((p) => p.id === "claude")!
  expect(claude.models.some((m) => m.id === "claude-plan-only")).toBe(true)
})
```

> Match the exact argument list the existing `deriveChatSnapshot` test in this file already builds; append `custom` as the new trailing argument. If the existing test calls with fewer args, add the new arg only to this new test.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test --conditions production src/server/read-models.test.ts`
Expected: FAIL — extra arg ignored / merge not applied.

- [ ] **Step 3: Thread the param + merge**

In `src/server/read-models.ts`:
- Import at top: `import { mergeCustomModels } from "../shared/types"` and `import type { CustomModelEntry } from "../shared/types"`.
- Add a trailing param to `deriveChatSnapshot` (:278, after `claudeSessionStates`):

```ts
  customModels: readonly CustomModelEntry[] = [],
```

- Change line :344 from `availableProviders: [...SERVER_PROVIDERS],` to:

```ts
    availableProviders: mergeCustomModels([...SERVER_PROVIDERS], customModels),
```

- [ ] **Step 4: Pass it from ws-router**

In `src/server/ws-router.ts` at the `deriveChatSnapshot(...)` call (:969–:980), add a trailing argument after `agent.getClaudeSessionStates?.() ?? new Map()`:

```ts
          appSettings?.getSnapshot().customModels ?? [],
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test --conditions production src/server/read-models.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/read-models.ts src/server/ws-router.ts src/server/read-models.test.ts
git commit -m "feat(server): merge custom models into chat snapshot catalog"
```

---

## Task 5: Client store — preserve field + selector

**Files:**
- Modify: `src/client/stores/appSettingsStore.ts` (:2 imports, :68 preserve, :92 selectors)
- Test: `src/client/stores/appSettingsStore.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/client/stores/appSettingsStore.test.ts`:

```ts
import { selectCustomModels } from "./appSettingsStore"

test("selectCustomModels returns stable empty ref when unset", () => {
  const a = selectCustomModels({ settings: null } as never)
  const b = selectCustomModels({ settings: null } as never)
  expect(a).toBe(b)
  expect(a).toEqual([])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test --conditions production src/client/stores/appSettingsStore.test.ts`
Expected: FAIL — `selectCustomModels` not exported.

- [ ] **Step 3: Implement**

- Add `CustomModelEntry` to the type import on :2.
- In `mergeAppSettingsPatch`, next to `customMcpServers: settings.customMcpServers,` (:69) add:

```ts
    customModels: settings.customModels,
```

- After `selectCustomMcpServers` (:94) add:

```ts
const EMPTY_CUSTOM_MODELS: readonly CustomModelEntry[] = []

export const selectCustomModels = (state: AppSettingsStoreState): readonly CustomModelEntry[] =>
  state.settings?.customModels ?? EMPTY_CUSTOM_MODELS
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test --conditions production src/client/stores/appSettingsStore.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/stores/appSettingsStore.ts src/client/stores/appSettingsStore.test.ts
git commit -m "feat(client): custom models selector + patch preservation"
```

---

## Task 6: Settings-page pickers see custom models

**Files:**
- Modify: `src/client/app/SettingsPage.tsx` (:36 import, :2283 & :2313 `availableProviders={PROVIDERS}`)

The chat-input pickers already receive the merged catalog via `state.availableProviders` (server-merged snapshot), so no change is needed there. Only the Settings-page subagent/default pickers pass raw `PROVIDERS`.

- [ ] **Step 1: Derive the merged catalog**

Near the top of the `SettingsPage` component body, add (import `mergeCustomModels` and `selectCustomModels`):

```tsx
const customModels = useAppSettingsStore(selectCustomModels)
const mergedProviders = useMemo(
  () => mergeCustomModels([...PROVIDERS], customModels),
  [customModels],
)
```

- [ ] **Step 2: Use it in the pickers**

Replace `availableProviders={PROVIDERS}` at :2283 and :2313 with `availableProviders={mergedProviders}`.

- [ ] **Step 3: Verify build/type**

Run: `bun test --conditions production src/client/app/useKannaState.test.ts`
Expected: PASS (no regression; picker still renders).

- [ ] **Step 4: Commit**

```bash
git add src/client/app/SettingsPage.tsx
git commit -m "feat(client): settings pickers use merged custom-model catalog"
```

---

## Task 7: `ModelsSection` CRUD UI

**Files:**
- Create: `src/client/app/ModelsSection.tsx`
- Create: `src/client/app/ModelsSection.test.tsx`
- Modify: `src/client/app/SettingsPage.tsx` (mount the section)

Mirror `src/client/app/McpServersSection.tsx` structure: a `ModelsSettingsBranch` wrapper reading `selectCustomModels`, a list grouped by provider (Claude, Codex) showing built-in (seeded) + custom rows, an add/edit form, and delete. Dispatch via `props.state.handleWriteAppSettings`. Use the `impeccable` skill to match existing settings-section styling (spacing, buttons, Tooltip-over-title). Reuse the same primitives `McpServersSection` imports (`Button`, form inputs).

- [ ] **Step 1: Write the failing test**

Create `src/client/app/ModelsSection.test.tsx`:

```tsx
import { describe, expect, test, mock } from "bun:test"
import { render, screen, fireEvent } from "@testing-library/react"
import { ModelsSection } from "./ModelsSection"
import type { CustomModelEntry } from "../../shared/types"

const models: CustomModelEntry[] = [
  { id: "claude-opus-4-8", label: "Opus 4.8", provider: "claude", supportsEffort: true, createdAt: 1, updatedAt: 1 },
  { id: "gpt-5.5", label: "GPT-5.5", provider: "codex", supportsEffort: false, createdAt: 1, updatedAt: 1 },
]

describe("ModelsSection", () => {
  test("renders claude + codex rows", () => {
    render(<ModelsSection models={models} handlers={{ onCreate: mock(), onUpdate: mock(), onDelete: mock() }} />)
    expect(screen.getByText("Opus 4.8")).toBeInTheDocument()
    expect(screen.getByText("GPT-5.5")).toBeInTheDocument()
  })

  test("delete dispatches onDelete with the id", async () => {
    const onDelete = mock(async () => {})
    render(<ModelsSection models={models} handlers={{ onCreate: mock(), onUpdate: mock(), onDelete }} />)
    fireEvent.click(screen.getAllByRole("button", { name: /delete/i })[0]!)
    expect(onDelete).toHaveBeenCalledWith("claude-opus-4-8")
  })
})
```

> Confirm the test-utility imports match how `McpServersSection.test.tsx` renders (same `@testing-library/react` setup). Match its `describe`/matcher conventions exactly.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test --conditions production src/client/app/ModelsSection.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `ModelsSection.tsx`**

Create the presentational `ModelsSection` (pure props: `models`, `handlers`) plus a `ModelsSettingsBranch` wrapper that binds to the store. Concrete shape:

```tsx
import { useMemo, useState } from "react"
import type { AppSettingsPatch, CustomModelEntry, CustomModelInput, CustomModelPatch } from "../../shared/types"
import { useAppSettingsStore, selectCustomModels } from "../stores/appSettingsStore"
import type { KannaState } from "./useKannaState"
import { Button } from "../components/... " // match McpServersSection's Button import path

export interface ModelsSectionHandlers {
  onCreate: (input: CustomModelInput) => Promise<void>
  onUpdate: (id: string, patch: CustomModelPatch) => Promise<void>
  onDelete: (id: string) => Promise<void>
}

export function ModelsSection(props: { models: readonly CustomModelEntry[]; handlers: ModelsSectionHandlers }) {
  const claude = props.models.filter((m) => m.provider === "claude")
  const codex = props.models.filter((m) => m.provider === "codex")
  // render two groups; each row shows label + id + supportsEffort, an Edit and a Delete button.
  // an "Add model" form per provider collects { id, label, supportsEffort } and calls handlers.onCreate.
  // (Match McpServersSection's list/edit/toolbar markup + class names for visual consistency.)
  return (/* ...impeccable-styled markup... */)
}

export function ModelsSettingsBranch(props: { state: Pick<KannaState, "handleWriteAppSettings"> }) {
  const models = useAppSettingsStore(selectCustomModels)
  const handlers = useMemo<ModelsSectionHandlers>(
    () => ({
      onCreate: async (input) => {
        await props.state.handleWriteAppSettings({ customModels: { create: input } } as AppSettingsPatch)
      },
      onUpdate: async (id, patch) => {
        await props.state.handleWriteAppSettings({ customModels: { update: { id, patch } } } as AppSettingsPatch)
      },
      onDelete: async (id) => {
        await props.state.handleWriteAppSettings({ customModels: { delete: { id } } } as AppSettingsPatch)
      },
    }),
    [props.state],
  )
  return <ModelsSection models={models} handlers={handlers} />
}
```

Fill the markup by copying `McpServersSection`'s list + form primitives (buttons labelled "Delete"/"Edit"/"Add model"). Keep each row's delete button accessible name containing "delete" (the test relies on it).

- [ ] **Step 4: Mount in SettingsPage**

In `src/client/app/SettingsPage.tsx`, next to where `McpServersSettingsBranch` is rendered, add `<ModelsSettingsBranch state={state} />` in the appropriate settings tab/section. Import it at the top.

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test --conditions production src/client/app/ModelsSection.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/client/app/ModelsSection.tsx src/client/app/ModelsSection.test.tsx src/client/app/SettingsPage.tsx
git commit -m "feat(client): models settings section CRUD UI"
```

---

## Task 8: Manual UI verification

- [ ] **Step 1: Start dev server**

Run the project's dev command (check `package.json` scripts — e.g. `bun run dev`). Open the app in a browser.

- [ ] **Step 2: Exercise the golden path**

- Settings → Models: confirm seeded Claude + Codex models render.
- Add a custom Claude model (id `claude-test-ui`, label `Test UI`). Confirm it appears.
- Open a chat's model picker: confirm `Test UI` is selectable.
- Edit its label; confirm the picker updates after refresh.
- Delete a seeded copy (e.g. a Claude model); confirm the built-in still works as fallback (revert-to-default) and the app never shows an empty model list.
- Delete `claude-test-ui`; confirm it disappears.

- [ ] **Step 3: Record the result**

If the UI cannot be exercised in this environment, state that explicitly instead of claiming success. Note any issues found and loop back to the relevant task.

---

## Task 9: Lint, full test, docs + C3 sync

- [ ] **Step 1: Lint**

Run: `bun run lint`
Expected: 0 errors, warnings at or below the cap. Fix any new warning; if it drops the count, lower the cap in `eslint.config.js` (see CLAUDE.md Lint ratchet).

- [ ] **Step 2: Full test suite**

Run: `bun run test`
Expected: all pass.

- [ ] **Step 3: Update docs**

- Add a "Configurable Model Catalog" section to `CLAUDE.md` describing: `customModels` in `settings.json`, seeded from built-ins, `mergeCustomModels` merge semantics, revert-to-default delete, and the `provider-catalog` single-source change.

- [ ] **Step 4: C3 sync**

Run `/c3 change` (or `c3x lookup src/server/provider-catalog.ts`) if the change touches component boundaries/refs/rules; update `.c3/` docs in this PR. If nothing binds, note that C3 reported no drift.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "docs: document configurable model catalog"
```

- [ ] **Step 6: Open PR**

Push the branch and open a PR **targeting `cuongtranba/kanna` main** (fork rule — never `jakemor/kanna`):

```bash
git push -u origin feat/configurable-model-catalog
gh pr create --repo cuongtranba/kanna --base main --head feat/configurable-model-catalog \
  --title "feat: configurable model catalog" \
  --body "$(cat <<'EOF'
## Summary
- Add/edit/remove Claude & Codex models from Settings (persisted in settings.json), seeded from built-ins.
- `mergeCustomModels` folds custom entries over the built-in catalog (override by id, append new).
- Remove duplicate `HARD_CODED_CODEX_MODELS`; `SERVER_PROVIDERS` = single source (`PROVIDERS`).

## Test plan
- [ ] `bun run lint` clean
- [ ] `bun run test` green
- [ ] Manual UI: add/edit/delete custom model; picker reflects it; revert-to-default works
EOF
)"
```

---

## Self-Review (author checklist — already applied)

- **Spec coverage:** merge semantics (Task 1), seed+CRUD (Task 2), single-source + normalize (Task 3), snapshot merge (Task 4), client store (Task 5), settings pickers (Task 6), UI (Task 7), tests each task, docs/C3 (Task 9). ✓
- **Type consistency:** `CustomModelEntry` / `CustomModelInput` / `CustomModelPatch` used identically across shared, server, client. `mergeCustomModels(base, custom)` signature stable in Tasks 1/3/4/6. `normalizeServerModel(provider, model, customModels)` stable Task 3. ✓
- **Placeholders:** UI markup in Task 7 intentionally references `McpServersSection` primitives to copy — the import path and row markup are the one place the implementer copies an existing file rather than transcribing it, because the exact class names live in that sibling and must match for visual consistency. All logic/types/tests are concrete. ✓
- **Open risk:** confirm the reducer export name (`applySettingsPatch`) against the existing MCP tests in `app-settings.test.ts` before writing Task 2 tests; adjust call shape if the suite uses a manager method.
