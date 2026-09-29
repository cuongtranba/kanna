---
id: c3-123
c3-seal: 2c1871773ab0d917c71a27e06182c989835ceee9ed79bed2d76f846173ec9049
title: genui-ui
type: component
category: feature
parent: c3-1
goal: Render kanna-ui fences in the transcript as validated interactive views, run their local and Kanna actions, and hand agent actions back after the user confirms.
uses:
    - rule-colocated-bun-test
    - rule-strong-typing
    - rule-zustand-store
---

## Goal

Render kanna-ui fences in the transcript as validated interactive views, run their local and Kanna actions, and hand agent actions back after the user confirms.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-1 Client |
| Runtime | A lazy chunk loaded when a transcript row holds a kanna-ui fence; charts load a further lazy VChart chunk |
| Consumers | c3-114 (messages renderer), c3-113 (transcript host), c3-218 (read-only share view) |
| Boundary | Owns rendering and view interaction; the spec contract belongs to c3-315 and remote data to c3-240 |

## Purpose

Owns the generative UI renderer: the Lexical node and transformers for kanna-ui and kanna-ui-intent fences, the json-render registry of Kanna components, financial charts and statements, the per-view state store, the action handlers with the agent confirm strip, and the host that queries datasets over the socket. Non-goals: validating on the server, choosing chart-library options from the spec, and any action outside the catalog.

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| rule-zustand-store | rule | Per-element UI state lives in the view's json-render store and a scoped zustand store, never useState | must follow | /_ui and /_drill paths |
| rule-strong-typing | rule | Resolved props are re-parsed with the catalog schemas before use | must follow | A bound value can resolve to anything |
| adr-20260929-generative-ui | adr | Agent actions confirm first and travel as a chat message with an intent fence | must follow | No protocol change for agent actions |
| rule-colocated-bun-test | rule | Rendering behaviour is pinned by colocated suites | must follow | GenUIBlock.test.tsx, chart-model.test.ts |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| KannaUiNode | IN | An open fence renders a building placeholder; a closed one renders the view or a fallback that names the issue | c3-114 | src/client/components/genui/GenUIBlock.test.tsx |
| Agent actions | OUT | Shown in a confirm strip and sent as chat.send with a kanna-ui-intent fence only after Send | c3-208 | e2e/genui.pw.ts |
| Read-only host | IN | A shared view renders inline data and hides every non-local action | c3-218 | src/client/components/genui/host.tsx |
| Charts | OUT | buildChartModel refuses a combo whose units differ, keeps series order stable, and every chart has a table view | c3-123 | src/client/components/genui/charts/chart-model.test.ts |
| Transformer list | OUT | The kanna-ui transformers live in their own module and the default list is built at call time; a module-load spread blanked the production app | c3-114 | e2e/smoke.pw.ts |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| src/index.css chart tokens | c3-123 Contract | Token values, re-validated for contrast | src/server/design/chart-palette.test.ts |
| src/client/components/lexical/markdown/kannaUiTransformers.ts | c3-123 Contract | Transformer shape | src/client/components/lexical/markdown/kannaUiTransformers.ts |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| The whole app renders blank | KANNA_BUILTIN_TRANSFORMERS is spread at module load again | Production bundle throws on load while bun tests pass | bun run test:e2e |
| Handlers act on a stale host | HandlerSync is removed | Actions from a view use the previous chat | bun run test src/client/components/genui/GenUIBlock.test.tsx |
| Chart marks fail contrast | A chart token changes without re-validation | chart-palette.test.ts fails | bun run test src/server/design/chart-palette.test.ts |
