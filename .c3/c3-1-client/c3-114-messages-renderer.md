---
id: c3-114
c3-version: 4
c3-seal: 3f0c3c6289bd6d4c1bc7a806ee30949c36aea62cd2b39ae04d80e8a372008e69
title: messages-renderer
type: component
category: feature
parent: c3-1
goal: Render each transcript entry kind (text, tool call, write_file, delete_file, plan, diff, ...) consistently, with collapse/expand and status.
uses:
    - ref-strong-typing
    - ref-tool-hydration
    - rule-strong-typing
---

# messages-renderer

## Goal

Render each transcript entry kind (text, tool call, write_file, delete_file, plan, diff, ...) consistently, with collapse/expand and status.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-1 (client) |
| Parent Goal Slice | "Render hydrated transcripts including provider-agnostic tool calls, plan-mode prompts, and diffs" |
| Category | feature |
| Lifecycle | Components mounted by transcript per visible item |
| Replaceability | New kinds added by extending the dispatch map |

## Purpose

Owns the per-kind UI for transcript entries — text, tool_use, tool_result, plan, diff, file ops — with consistent collapse/expand, status badges, and provider-agnostic styling. Non-goals: hydration logic, virtualization, scroll behavior.

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Precondition | Entry already hydrated to a normalized kind | c3-303 |
| Input — primitives | Buttons, code blocks, dialogs | c3-103 |
| Input — shared tools | Tool kind definitions and helpers | c3-303 |
| Internal state | Per-item collapsed flag, copy-to-clipboard state | c3-114 |
| Initialization | Pulled lazily via dispatch map keyed by kind | c3-113 |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Outcome | Consistent reading experience across all entry kinds | c3-1 |
| Primary path | Receive entry → switch on kind → render component | ref-tool-hydration |
| Alternate — collapse | Long blocks collapse by default with "Show more" | c3-114 |
| Alternate — exhaustive switch | TypeScript exhaustiveness ensures coverage | ref-strong-typing |
| Failure — unknown kind | Fallback diagnostic renderer with raw payload | c3-114 |

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-tool-hydration | ref | Branch by kind only, not provider | must follow | Provider-agnostic UI |
| ref-strong-typing | ref | Exhaustive switch on entry union | must follow | Compile-time coverage |
| rule-strong-typing | rule | Compliance target added by c3x wire; refine what must be reviewed or complied with before handoff. | wired compliance target beats uncited local prose | Added by c3x wire for explicit compliance review. |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| Renderer map | OUT | Record<EntryKind, React.FC<...>> | c3-113 | src/client/components/messages |
| Per-kind component | OUT | Pure component receiving typed entry | c3-113 | src/client/components/messages |
| Collapse callback | IN/OUT | Caller may control expanded state | c3-113 | src/client/components/messages |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| Missing kind handler | New entry kind added without renderer | Fallback shows in UI | bun run check against src/client/components/messages/ |
| Collapsed default regression | Default expand-state change | User overwhelmed by long blocks | bun run check + manual review of src/client/components/messages/ |
| Stale lazy chunk | A renderer lazy-imports a bundle (mermaid, shiki) and the tab outlives the deploy that deleted that hashed chunk | Diagram or highlight fails with "Failed to fetch dynamically imported module"; caching the rejected promise breaks every later instance in the tab | bun test --conditions production src/shared/lazyModule.test.ts src/client/components/messages/MermaidDiagram.test.tsx |
| Fence boundaries diverge between the editor and the validator | The Lexical `MERMAID_FENCE` transformer grows its own start/end regex again instead of consuming `src/shared/mermaid-fences.ts`; the renderer and the server-side validation gate (c3-226) then disagree about where a diagram ends, so a diagram the gate cleared renders as something else | mermaid-fences tests pin a 4-backtick fence, an unterminated fence and a nested ``` at both the scanner and the transformer level | bun test --conditions production src/shared/mermaid-fences.test.ts src/client/components/lexical/markdown/renderMessage.test.tsx src/client/components/lexical/markdown/messageTransformers.test.ts |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| src/client/components/messages/**/*.tsx | c3-114 Contract | Per-kind layout detail | src/client/components/messages |
