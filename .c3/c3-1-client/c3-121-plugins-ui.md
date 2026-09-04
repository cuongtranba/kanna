---
id: c3-121
c3-seal: 855adbe388a833f77ddc3cb85a23aae7896b80fb985b2a3c90c24e225bff4d1e
title: plugins-ui
type: component
category: feature
parent: c3-1
goal: 'Render what plugins contribute to the running app: evaluate each enabled plugin''s browser bundle against a host module registry, collect its contributions, and mount them as sidebar entries, a chat-footer panel and a Settings page — each isolated so one bad plugin cannot take the shell down.'
uses:
    - ref-strong-typing
    - rule-colocated-bun-test
    - rule-zustand-store
---

## Goal

Render what plugins contribute to the running app: evaluate each enabled plugin's browser bundle against a host module registry, collect its contributions, and mount them as sidebar entries, a chat-footer panel and a Settings page — each isolated so one bad plugin cannot take the shell down.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-1 Client |
| Runtime | Browser; plugin modules are evaluated from a Blob object-URL, never bundled with the app |
| Consumers | c3-112 (chat page mounts the footer panel), c3-116 (Settings page) |
| Ownership | Host module registry, plugin evaluator, contribution registry, error boundary, and the three mounted surfaces |

## Purpose

A plugin's UI is third-party code running inside Kanna's own React tree, so the risk is not that it fails but that its failure is indistinguishable from Kanna failing. Every seam here exists to keep that blast radius to one panel: a fixed module allowlist, an isolated evaluation, a per-plugin error boundary, and contributions held in a store the host reads rather than code the host calls.

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| rule-zustand-store | rule | Contributions live in a store whose selectors return module-level EMPTY constants | wired compliance target | an inline `?? []` is the React #185 shape `no-unstable-selector-fallback` bans |
| ref-strong-typing | ref | Contribution shapes are named types shared with the authoring declarations | must follow | no any/unknown on what a plugin hands the host |
| rule-colocated-bun-test | rule | Each module sits next to its test | wired compliance target | enforced for the plugin client modules |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| Host module registry | OUT | `require(name)` answers only an allowlisted set, so `react` identity matches the app shell and an off-list request fails with a documented message | c3-238 | src/client/plugins/hostModuleRegistry.ts |
| Plugin evaluator | OUT | Blob + object-URL + dynamic import, with the host global confined to the call and restored in a `finally` | c3-238 | src/client/plugins/evaluatePlugin.ts |
| Contribution registry | OUT | `createPluginContext(pluginId, registry)` is what a plugin's default export is called with; the host builds it locally and never imports `@kanna/plugin` at runtime | c3-313 | src/client/plugins/contributionRegistry.ts |
| Contribution store | OUT | React-visible projection of what plugins contributed, populated by `usePluginContributions` from the global switch | c3-112 | src/client/stores/pluginContributionsStore.ts |
| Error isolation | OUT | `PluginBoundary` contains a render-time throw per plugin, including under the legacy server renderer | c3-112 | src/client/plugins/PluginBoundary.tsx |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| src/client/plugins/hostModuleRegistry.ts | Contract (Host module registry) | Allowlist membership | src/client/plugins/hostModuleRegistry.ts |
| src/client/plugins/evaluatePlugin.ts | Contract (Plugin evaluator) | Object-URL lifecycle | src/client/plugins/evaluatePlugin.ts |
| src/client/plugins/contributionRegistry.ts | Contract (Contribution registry) and the shared authoring declarations | Internal keying | src/client/plugins/contributionRegistry.ts |
| src/client/stores/pluginContributionsStore.ts | Contract (Contribution store) | Selector naming | src/client/stores/pluginContributionsStore.ts |
| src/client/plugins/PluginBoundary.tsx | Contract (Error isolation) | Fallback presentation | src/client/plugins/PluginBoundary.tsx |
