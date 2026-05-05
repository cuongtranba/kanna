---
id: c3-113
c3-version: 4
c3-seal: a7295207954690cc4cca0c902e8c387e94e3ca00035d147ef83af0c50f7584b5
title: transcript
type: component
category: feature
parent: c3-1
goal: Render a hydrated list of transcript entries (text, tool calls, plan dialogs, diffs) with virtualized scrolling and sticky focus.
uses:
    - ref-provider-adapter
    - ref-tool-hydration
---

# transcript

## Goal

Render a hydrated list of transcript entries (text, tool calls, plan dialogs, diffs) with virtualized scrolling and sticky focus.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-1 (client) |
| Parent Goal Slice | "Render hydrated transcripts including provider-agnostic tool calls" |
| Category | feature |
| Lifecycle | Mounts inside chat-page; remounts on session swap |
| Replaceability | Replaceable provided per-kind dispatch contract preserved |

## Purpose

Renders the virtualized list of hydrated transcript entries inside the chat page, dispatching each entry to the correct per-kind renderer and managing scroll position. Non-goals: per-kind rendering, hydration of raw events, server-side projection.

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Precondition | Chat page provides hydrated entries from chatView snapshot | c3-112 |
| Input — renderer map | Per-kind components from messages-renderer | c3-114 |
| Input — primitives | Scroll-area, dividers, status indicators | c3-103 |
| Input — tool normalization | Hydrated tool kinds from shared/tools | c3-303 |
| Internal state | Virtualization window indices, last-rendered length | c3-113 |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Outcome | Long transcripts stay performant; live updates keep place | c3-1 |
| Primary path | Subscribe to entries → render visible window → dispatch per-kind | ref-tool-hydration |
| Alternate — provider-agnostic | Same render path for Claude + Codex entries | ref-provider-adapter |
| Alternate — autoscroll | Pin to bottom while user is at bottom; release on manual scroll | c3-112 |
| Failure — unknown kind | Render raw envelope as fallback diagnostic block | c3-114 |

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-tool-hydration | ref | Dispatch by hydrated kind only | must follow | Never branch on provider |
| ref-provider-adapter | ref | Provider-agnostic render path | must follow | Hydration normalizes upstream |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| <KannaTranscript> | OUT | Receives entries; renders virtualized list | c3-112 | src/client/app/KannaTranscript.tsx |
| Renderer dispatch | IN | Pulls per-kind component from c3-114 map | c3-114 | src/client/app/KannaTranscript.tsx |
| Scroll-anchor callback | OUT | Reports bottom-pin state to parent | c3-112 | src/client/app/KannaTranscript.tsx |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| Virtualization breakage | Item-size estimator edit | Items overlap or list jitters | bun run test src/client/app/KannaTranscript.test.tsx + manual streaming smoke |
| Autoscroll regression | Scroll-anchor heuristic edit | User loses pin to bottom unexpectedly | bun run test src/client/app/KannaTranscript.test.tsx + manual scroll smoke |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| src/client/app/KannaTranscript.tsx | c3-113 Contract | Virtualization library detail | src/client/app/KannaTranscript.tsx |
