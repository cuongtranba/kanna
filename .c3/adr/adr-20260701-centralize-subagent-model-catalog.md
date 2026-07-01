---
id: adr-20260701-centralize-subagent-model-catalog
c3-seal: 5673c1910ab8162deac1e190c20b36ba0fa9abcd962c774f2c88b22e33cdd79d
title: centralize-subagent-model-catalog
type: adr
goal: |-
    Replace the ad-hoc `getProviderCatalog(draft.provider)` calls inside the
    Subagent settings form (`src/client/app/SubagentsSection.tsx`) with the
    same merged provider catalog (`mergeCustomModels([...PROVIDERS],
    customModels)`) that `SettingsPage.tsx` and the chat composer's model
    picker already use, so a user-defined custom model (Settings → Models)
    is selectable when creating or editing a subagent instead of being
    silently unavailable.
status: implemented
date: "2026-07-01"
---

## Goal

Replace the ad-hoc `getProviderCatalog(draft.provider)` calls inside the
Subagent settings form (`src/client/app/SubagentsSection.tsx`) with the
same merged provider catalog (`mergeCustomModels([...PROVIDERS],
customModels)`) that `SettingsPage.tsx` and the chat composer's model
picker already use, so a user-defined custom model (Settings → Models)
is selectable when creating or editing a subagent instead of being
silently unavailable.

## Context

Settings → Models lets a user add/override Claude and Codex model
entries (`customModels` persisted in `settings.json`, seeded from
`PROVIDERS` and merged via `mergeCustomModels`). The server already
threads `customModels` through subagent normalization —
`normalizeSubagentEntry` in `src/server/app-settings.ts` calls
`normalizeClaudeModelId` / `normalizeCodexModelId` with `customModels`
— so a subagent record referencing a custom model id round-trips fine
on the backend.

The client-side Subagent form never got the same treatment. In
`src/client/app/SubagentsSection.tsx`:

- `SubagentForm` (line ~316) computes `const providerCatalog =
getProviderCatalog(draft.provider)` — the raw built-in `PROVIDERS`
entry — and renders its `.models` into the Model `<Select>`
(line ~373). Any custom model the user added never appears in this
dropdown.
- `createDefaultSubagentDraft` (line ~645) falls back to
`getProviderCatalog(provider).defaultModel` when `providerDefaults`
has no stored preference for that provider — same raw-catalog gap.

This is exactly the hardcode pattern PR #469 (`feat: configurable model
catalog`) already fixed for `SettingsPage.tsx`'s default-model pickers
(`mergedProviders = useMemo(() => mergeCustomModels([...PROVIDERS],
customModels), [customModels])`, `SettingsPage.tsx:1095-1096`) and for
the per-chat composer catalog (`deriveChatSnapshot` /
`availableProviders` in `src/server/read-models.ts`). The Subagent
settings branch (`SubagentsSettingsBranch`, same file) already reads
from `useAppSettingsStore` directly, so it can pull `customModels` the
same way `SettingsPage.tsx` does via the existing `selectCustomModels`
selector — no new store or selector needed.

Affected topology: `c3-116` (settings-page, client container `c3-1`).
`src/client/app/SubagentsSection.tsx` is currently uncharted in the c3
codemap under `c3-116` (no `c3x lookup` match) — this ADR does not
change that; it is an internal wiring fix within the existing feature
surface, not a new component or contract boundary.

## Decision

Thread the already-computed merged catalog into the Subagent form
instead of introducing a second ad-hoc merge or a new server round
trip:

1. In `SubagentsSettingsBranch`, add
`const customModels = useAppSettingsStore(selectCustomModels)` and
`const availableProviders = useMemo(() => mergeCustomModels([...PROVIDERS], customModels), [customModels])`
— identical pattern to `SettingsPage.tsx:1095-1096`.
2. Add `availableProviders: ProviderCatalogEntry[]` to
`SubagentsSectionProps` and to `SubagentFormProps`, threading it
`SubagentsSettingsBranch` → `SubagentsSection` → `SubagentForm`.
3. In `SubagentForm`, resolve the catalog entry from
`props.availableProviders` instead of calling `getProviderCatalog`
directly (`getProviderCatalog` stays as a defensive fallback only if
the merged list is somehow missing the provider id, which
`mergeCustomModels` never drops since it always maps over `base`).
4. Give `createDefaultSubagentDraft` an optional
`availableProviders?: ProviderCatalogEntry[]` third parameter used
for the `defaultModel` fallback lookup, called with
`props.availableProviders` from both call sites in `SubagentForm`
(initial baseline + `handleProviderChange`).

This reuses the existing `mergeCustomModels` pure function
(`src/shared/types.ts`) and the existing `selectCustomModels` Zustand
selector (`src/client/stores/appSettingsStore.ts`) rather than adding a
new merge helper, a new prop-drilling path from `SettingsPage`, or a
new server RPC. No server changes — `app-settings.ts` subagent
normalization is already `customModels`-aware.

## Affected Topology

| Entity | Type | Why affected | Governance review |
| --- | --- | --- | --- |
| c3-116 | component | SubagentsSection.tsx (its Subagent-settings sub-feature) gains a merged-catalog prop chain; no new external contract, no new store | Confirm rule-zustand-store / ref-zustand-store still hold: no new store created, existing useAppSettingsStore selector reused |
| c3-301 | N.A - reused, not changed | mergeCustomModels, PROVIDERS, ProviderCatalogEntry already exported from src/shared/types.ts; this ADR consumes them, does not modify their shape or behavior | N.A - no shared-type change |

## Compliance Refs

| Ref | Why required | Action |
| --- | --- | --- |
| ref-zustand-store | SubagentsSettingsBranch reads app-settings state via useAppSettingsStore; must keep using small, stable selectors rather than ad-hoc store access | comply |
| ref-strong-typing | New availableProviders prop and updated createDefaultSubagentDraft signature must use the existing ProviderCatalogEntry type, no any/loose shape | comply |
| ref-local-first-data | Cited by c3-116 (settings-page); this ADR only reads already-loaded client state (useAppSettingsStore) to render a Select, no new persistence path or network bind | N.A - no persistence/bind surface touched |

## Compliance Rules

| Rule | Why required | Action |
| --- | --- | --- |
| rule-zustand-store | Adding selectCustomModels usage inside SubagentsSettingsBranch must follow the stable-selector pattern (no new store, reuse existing exported selector) to avoid a fresh-reference render loop | comply |
| rule-strong-typing | availableProviders prop and catalog lookups must be typed as ProviderCatalogEntry[] / ProviderCatalogEntry, no untyped fallback | comply |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| src/client/app/SubagentsSection.tsx — SubagentsSettingsBranch | Add customModels + availableProviders via selectCustomModels + mergeCustomModels([...PROVIDERS], customModels); pass availableProviders to <SubagentsSection> | Diff of SubagentsSettingsBranch function body |
| src/client/app/SubagentsSection.tsx — SubagentsSectionProps / SubagentsSection | Add availableProviders field, forward to <SubagentForm> | Diff of interface + JSX prop |
| src/client/app/SubagentsSection.tsx — SubagentFormProps / SubagentForm | Add availableProviders field; replace getProviderCatalog(draft.provider) with a lookup (props.availableProviders.find((p) => p.id === draft.provider) ?? getProviderCatalog(draft.provider)) | Diff at model <Select> render site |
| src/client/app/SubagentsSection.tsx — createDefaultSubagentDraft | Add optional availableProviders?: ProviderCatalogEntry[] param; use it for the defaultModel fallback instead of the raw getProviderCatalog call; update both call sites in SubagentForm | Diff of function signature + call sites |
| src/client/app/SubagentsSection.test.tsx | Extend/add a test asserting a custom model appears in the Model dropdown when customModels contains one | New/updated it(...) block, bun test output |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| N.A - no C3 CLI/schema/validator change | This ADR only touches application client code, not C3 tooling | N.A |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| src/client/app/SubagentsSection.test.tsx | Colocated test asserts custom models render in the Model select and are selectable/saved | bun test --conditions production src/client/app/SubagentsSection.test.tsx |
| bun run lint (ESLint, --max-warnings=0) | Catches strong-typing / hook-dependency regressions in the touched file | bun run lint (or scoped bunx eslint src/client/app/SubagentsSection.tsx) |
| c3x check | Confirms no doc/code drift introduced against c3-116 | c3x check after implementation |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Fetch availableProviders via a new WS command scoped to the Subagent form | Duplicates the exact mergeCustomModels([...PROVIDERS], customModels) computation SettingsPage.tsx already does client-side from data already in the useAppSettingsStore; adds a network round trip and a second source of truth for no benefit |
| Leave getProviderCatalog as-is and only fix it server-side | Server-side (app-settings.ts) is already correct; the actual defect is the client dropdown never offering custom models, so a server-only fix does not change user-visible behavior |
| Introduce a brand-new useMergedProviderCatalog() hook shared across SettingsPage and SubagentsSection | Larger refactor than the bug warrants; SettingsPage.tsx and SubagentsSection.tsx both already have direct access to useAppSettingsStore + mergeCustomModels, so duplicating the two-line useMemo is simpler than introducing and threading a new hook abstraction for a single extra call site |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| A subagent already saved with a model id that is later removed from customModels renders an empty/mismatched <Select> value | Pre-existing risk, unchanged by this ADR — getProviderCatalog fallback already had the same gap for built-in ids; Select degrades to showing the placeholder, no crash | Manual check: delete a custom model referenced by an existing subagent, reopen the subagent edit form, confirm no runtime error |
| New useMemo selector recomputes on every customModels mutation, causing extra renders of the Subagent form while it's open | mergeCustomModels output is already the same shape/identity strategy used by SettingsPage.tsx in production without a reported render-loop; scoped to SubagentsSettingsBranch, not a new global store | bun test render-loop check equivalent (renderForLoopCheck if the test file already uses it) plus manual Settings → Subagents interaction while editing Models in another tab |

## Verification

| Check | Result |
| --- | --- |
| bun test --conditions production src/client/app/SubagentsSection.test.tsx | All tests pass, including new custom-model assertion |
| bunx eslint src/client/app/SubagentsSection.tsx | Zero errors/warnings |
| c3x check | No new drift reported for c3-116 |
| Manual: add custom Claude model in Settings → Models, open Settings → Subagents → create subagent, select the custom model, save, reopen | Custom model shows in dropdown, persists across reopen |
