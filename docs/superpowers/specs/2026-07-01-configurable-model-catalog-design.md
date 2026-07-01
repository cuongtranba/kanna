# Configurable Model Catalog

**Date:** 2026-07-01
**Status:** Approved design — pending implementation plan

## Problem

Adding or updating a Claude/Codex model today requires editing hardcoded
arrays and recompiling:

- `PROVIDERS` in `src/shared/types.ts` (Claude + Codex + OpenRouter catalog).
- A **duplicate** `HARD_CODED_CODEX_MODELS` in `src/server/provider-catalog.ts`
  (drift risk — two sources for the same Codex list).

The user wants to manage the model list from the Settings UI (like the existing
custom MCP servers panel) so new models need no code change.

## Goals

- Add / edit / remove Claude and Codex models from Settings UI.
- Persist to `settings.json` (same mechanism as `customMcpServers`).
- Built-in models remain as a fallback so the catalog is never empty.
- Remove the duplicate Codex source (single source of truth).

## Non-Goals (YAGNI)

- OpenRouter models — already dynamic via API (`mergeOpenRouterModels`). Untouched.
- Adding/removing whole providers — models only.
- Per-model pricing / token-cost config — out of scope.
- Reasoning-effort or context-window option **editing** beyond the boolean/opts
  already on `ProviderModelOption`.

## Merge Semantics

Chosen behavior: **additive + override, with editable seeded copies of
built-ins.**

- **Base** = built-in `PROVIDERS` list (Claude + Codex). Always present as a
  fallback; guarantees a non-empty catalog.
- **`customModels`** = user-editable entries persisted in `settings.json`.
- **`mergeCustomModels(base, customModels)`** produces the effective catalog:
  - A custom entry whose `id` matches a built-in **overrides** that built-in
    entry (same position semantics — replaced in place).
  - A custom entry with a new `id` is **appended** to that provider's list.
- **Seeding:** on first load (when `customModels` is absent from
  `settings.json`), seed it with editable copies of every built-in Claude +
  Codex model. This makes all current models visible and editable in the UI.
- **Delete semantics (revert-to-default):** deleting a seeded copy removes the
  override, so the identical built-in shows through again — i.e. deleting a
  built-in twin is a "reset to default", not a true removal. Deleting a purely
  user-added `id` removes it entirely. This is internally consistent: built-in
  ids are always backed by the base list; only novel ids are fully removable.

## Architecture

Three merge/validation touch-points, mirroring how OpenRouter dynamic models
and custom MCP servers already flow through the system.

### 1. Shared (`src/shared/types.ts`)

New pure type + merge helper (no side effects — respects the shared-layer seal):

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

export function mergeCustomModels(
  base: ProviderCatalogEntry[],
  customModels: readonly CustomModelEntry[],
): ProviderCatalogEntry[]
```

- `mergeCustomModels` is pure and deterministic: for each provider entry, fold
  the provider's custom models over `entry.models` (override by `id`, else
  append). Returns a new array; never mutates `base`.
- Extend `AppSettingsSnapshot` with `customModels: CustomModelEntry[]`.
- Extend `AppSettingsPatch` with a `customModels` CRUD block mirroring
  `customMcpServers`:
  ```ts
  customModels?: {
    create?: CustomModelInput
    update?: { id: string; patch: CustomModelPatch }
    delete?: { id: string }
  }
  ```
- `CustomModelInput` / `CustomModelPatch` mirror the MCP input/patch shapes.

### 2. Server

**`src/server/provider-catalog.ts`**
- Delete `HARD_CODED_CODEX_MODELS` and the `SERVER_PROVIDERS.map(...)` override.
  `SERVER_PROVIDERS` becomes `[...PROVIDERS]` — single source of truth. (The
  Codex models already exist verbatim in `PROVIDERS`; verified identical.)
- `normalizeServerModel(provider, model, customModels?)`: accept the merged
  catalog so a custom model id validates instead of silently falling back to
  the provider default.

**`src/server/app-settings.ts`**
- `normalizeCustomModels(source, warnings)` — load + coerce from persisted JSON;
  seed from built-ins when absent.
- `validateCustomModelShape(entry, existing)` — mirrors `validateMcpShape`:
  - `id` matches a model-id regex (non-empty, no whitespace, bounded length).
  - `label` non-empty.
  - `provider ∈ {"claude","codex"}`.
  - No duplicate `id` within the same provider (dedupe).
- Reducer arms in the settings patch handler for `create` / `update` / `delete`,
  following the exact structure of the `customMcpServers` arms
  (`app-settings.ts:1167+`). Persist to `settings.json`.

**`src/server/read-models.ts`**
- Thread `customModels` (read from `AppSettingsManager`) into
  `deriveChatSnapshot`, and emit
  `availableProviders: mergeCustomModels([...SERVER_PROVIDERS], customModels)`
  (currently `[...SERVER_PROVIDERS]` at line 344). This keeps the per-chat
  snapshot the single server→client transport for the catalog.

### 3. Client

**`src/client/app/useKannaState.ts`**
- Extend the existing merge step (line ~1513). After `mergeOpenRouterModels`,
  the catalog already carries custom models because the server merged them into
  the snapshot's `availableProviders`. No second client merge needed for chat
  pickers — they consume `availableProviders`.
- The Settings page pickers (`SettingsPage.tsx:2283`, `:2313`) currently pass
  raw `PROVIDERS`. Switch them to the merged catalog derived from
  `appSettingsStore.customModels` via `mergeCustomModels([...PROVIDERS], custom)`
  so subagent/default-model pickers see custom models too.

**`src/client/app/ModelsSection.tsx`** (new — mirrors `McpServersSection.tsx`)
- Per-provider (Claude, Codex) list of models.
- Each row: label, id, effort/context-window flags; edit + delete actions.
- "Add model" form per provider (id, label, supportsEffort, optional aliases,
  context-window options, max-effort flag).
- Dispatches `AppSettingsPatch.customModels` CRUD via the same settings RPC
  path as `McpServersSection`.
- Uses the `impeccable` skill for UI/UX consistency with existing settings
  sections.
- Mounted in `SettingsPage.tsx` alongside `McpServersSection`.

## Data Flow

```
settings.json (customModels[])
   │  AppSettingsManager.getSnapshot()
   ├─► server: read-models.deriveChatSnapshot
   │        availableProviders = mergeCustomModels([...SERVER_PROVIDERS], custom)
   │        └─► ChatSnapshot ──WS──► client appStore
   │                                    └─► useKannaState.availableProviders
   │                                          └─► ChatInput / ChatPreferenceControls pickers
   ├─► server: normalizeServerModel(provider, model, custom)  (turn validation)
   └─► client: appSettingsStore.customModels
            ├─► ModelsSection (CRUD UI)
            └─► SettingsPage pickers = mergeCustomModels([...PROVIDERS], custom)
```

## Error Handling

- Invalid custom entry (bad id / empty label / bad provider / dup id) → patch
  rejected with a `warning` on the settings snapshot, same channel as MCP
  validation. UI surfaces the message inline.
- Unknown model id at turn time → `normalizeServerModel` falls back to provider
  default (unchanged behavior; now custom ids are known and won't fall back).
- Corrupt `customModels` in `settings.json` → `normalizeCustomModels` drops bad
  entries, pushes warnings, and re-seeds if the array is unusable — never
  crashes startup.

## Testing (TDD, co-located)

- `types.test.ts`: `mergeCustomModels` — override by id, append new, no mutation,
  empty custom = base unchanged.
- `app-settings.test.ts`: `validateCustomModelShape` (each reject code),
  `normalizeCustomModels` seeding + corrupt-input recovery, reducer CRUD arms.
- `provider-catalog.test.ts`: `SERVER_PROVIDERS` equals `PROVIDERS` (duplicate
  removed); `normalizeServerModel` accepts a custom id.
- `read-models.test.ts`: snapshot `availableProviders` includes a custom model.
- `useKannaState` / `SettingsPage` pickers: render includes custom model.
- `ModelsSection.test.tsx`: render built-in + custom rows; add/edit/delete
  dispatch the correct patch.

## Migration / Compatibility

- `customModels` absent → seeded from built-ins on first snapshot load. Existing
  installs get the current models as editable copies automatically.
- No breaking change to `ChatSnapshot.availableProviders` shape (still
  `ProviderCatalogEntry[]`).

## C3

Touches component boundaries (shared catalog, server settings, client settings
UI). Run `/c3 change` in the same PR if refs/rules/contracts move.
