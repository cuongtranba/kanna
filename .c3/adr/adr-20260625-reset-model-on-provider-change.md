---
id: adr-20260625-reset-model-on-provider-change
c3-seal: 394316d146454c09744f39aab040912a93990ad72eab03fa96a7476e981d5c4f
title: reset-model-on-provider-change
type: adr
goal: Change the settings Quick Response SDK provider switch behavior so selecting a different LLM provider immediately resets the model field to that provider default, or to an empty string for a custom provider, preventing invalid cross-provider combinations such as OpenAI with a Claude/OpenRouter model id.
status: implemented
date: "2026-06-25"
---

## Goal

Change the settings Quick Response SDK provider switch behavior so selecting a different LLM provider immediately resets the model field to that provider default, or to an empty string for a custom provider, preventing invalid cross-provider combinations such as OpenAI with a Claude/OpenRouter model id.

## Context

The settings page owns the Quick Response SDK form under c3-116 and persists the selected provider, key, model, and custom base URL through the server-backed local settings path. The previous handler reset OpenAI and OpenRouter models but preserved the current model when switching to custom, so stale provider-specific model ids could remain visible and be saved against the wrong provider. The chat composer path was inspected and already resets its provider/model state through the chat preferences store.

## Decision

Extract the Quick Response SDK provider draft transition into a small typed helper and use it from SettingsPage. The helper keeps the API key, resets the model from provider defaults for OpenAI and OpenRouter, clears the model for custom providers because Kanna cannot know a universal custom model id, and preserves the custom base URL only when the selected provider is custom.

## Affected Topology

| Entity | Type | Why affected | Governance review |
| --- | --- | --- | --- |
| c3-116 | component | Owns the settings Quick Response SDK form where provider changes could keep a stale model id | Review local-first settings behavior and avoid moving settings state into a new store |

## Compliance Refs

| Ref | Why required | Action |
| --- | --- | --- |
| ref-local-first-data | Quick Response SDK settings are stored locally through the existing server settings path | comply |
| ref-zustand-store | Settings page also manages UI-local preferences, but this change keeps the provider draft in component state and does not add a new store | review |

## Compliance Rules

| Rule | Why required | Action |
| --- | --- | --- |
| rule-zustand-store | The change must not add a new store or persist draft state outside the existing settings flow | comply |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| Provider draft helper | Add a typed helper for Quick Response SDK provider selection that resets model ids by provider | src/client/app/llmProviderDraft.ts |
| Settings form | Use the helper from handleLlmProviderSelection before persisting the new value | src/client/app/SettingsPage.tsx |
| Regression test | Cover OpenAI, OpenRouter, and custom model reset behavior without importing the full settings route tree | src/client/app/llmProviderDraft.test.ts |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| N.A - application-only change | No c3x commands, validators, schemas, templates, or help are changed by this ADR | c3x check after implementation |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| llmProviderDraft tests | Provider changes reset model ids to OpenAI/OpenRouter defaults and clear custom model ids | bun test src/client/app/llmProviderDraft.test.ts |
| Store/control smoke tests | Existing chat composer preference controls and store reset behavior continue passing | bun test src/client/stores/chatPreferencesStore.test.ts src/client/components/chat-ui/ChatPreferenceControls.test.tsx |
| Type/check command | Catches invalid TypeScript, lint, and client build drift | bun run check |
| C3 validation | Confirms documentation topology remains valid | c3x check |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Keep old custom model until save validation | Leaves the UI visibly wrong and lets users save a model id from another provider |
| Normalize only on the server | The draft field would still show stale state and the saved payload would not reflect the user-visible reset |
| Hardcode a default custom model | Custom providers do not have a reliable cross-provider default model id |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| User loses a custom model while switching away and back | Preserve the custom base URL, but clear model because it may not belong to the next custom provider; user can enter the provider-specific model explicitly | llmProviderDraft custom-provider test |
| OpenAI/OpenRouter defaults drift | Use shared DEFAULT_OPENAI_SDK_MODEL and DEFAULT_OPENROUTER_SDK_MODEL constants | llmProviderDraft default-model test |
| Settings form import churn pulls large route dependencies into the regression test | Test the pure helper in a colocated .test.ts file instead of importing SettingsPage | bun test src/client/app/llmProviderDraft.test.ts |

## Verification

| Check | Result |
| --- | --- |
| bun test src/client/app/llmProviderDraft.test.ts src/client/stores/chatPreferencesStore.test.ts src/client/components/chat-ui/ChatPreferenceControls.test.tsx | pass: 23 tests, 40 assertions |
| bun test src/client/app/SettingsPage.test.tsx | blocked by existing Lexical module initialization error: Cannot access defineImportRule before initialization |
| bun test src/client/components/chat-ui/ChatInput.test.ts | blocked by existing Lexical module initialization error: Cannot access defineImportRule before initialization |
| bun run check | pass: tsc, eslint, client build |
| bash /Users/cuongtran/.agents/skills/c3/bin/c3x.sh check | pass: Checked 135 docs, all clear |
