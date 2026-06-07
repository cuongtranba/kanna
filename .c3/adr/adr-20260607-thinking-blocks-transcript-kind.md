---
id: adr-20260607-thinking-blocks-transcript-kind
c3-seal: 37da346abcc4b2c1c4dcd6a89d4fae66d480ccca2bb8a725ae35c05af8193ec0
title: thinking-blocks-transcript-kind
type: adr
goal: Map Claude assistant `thinking` content blocks from the on-disk transcript JSONL (and SDK stream messages) into a new persisted `assistant_thinking` transcript entry kind, and render it in the client as a collapsed "Thought for…" disclosure. Today `normalizeClaudeStreamMessage` only emits entries for `text` and `tool_use` assistant content blocks; every `thinking` block (733 in the single heaviest local session alone) is silently dropped, so model reasoning never reaches the event log or the UI.
status: implemented
date: "2026-06-07"
---

## Goal

Map Claude assistant `thinking` content blocks from the on-disk transcript JSONL (and SDK stream messages) into a new persisted `assistant_thinking` transcript entry kind, and render it in the client as a collapsed "Thought for…" disclosure. Today `normalizeClaudeStreamMessage` only emits entries for `text` and `tool_use` assistant content blocks; every `thinking` block (733 in the single heaviest local session alone) is silently dropped, so model reasoning never reaches the event log or the UI.

## Context

In the heaviest local transcript (`358e5199…jsonl`, 10 MB / 4361 lines) assistant content blocks break down as 733 `thinking`, 1051 `tool_use`, 368 `text`. `normalizeClaudeStreamMessage` (`src/server/agent.ts:592-651`) iterates `message.message.content` and only branches on `content.type === "text"` and `content.type === "tool_use"`; a `thinking` block (`{type:"thinking", thinking, signature}`, text up to ~10k chars) falls through and produces no `TranscriptEntry`. Because both drivers funnel through this one function (SDK via `createClaudeHarnessStream`, PTY via `jsonl-to-event.ts` → `normalizeClaudeStreamMessage`), reasoning is lost in every mode. The transcript event union (`src/shared/types.ts`) has no thinking kind, the client dispatch switches (`KannaTranscript.tsx`, `ShareViewPage.tsx`, `SubagentEntryRow.tsx`, `parseTranscript.ts`) have no case, and there is no renderer component. Constraint: thinking is reasoning, not final output — it must be visually demoted (collapsed by default) but still persisted as a first-class event so it survives reload and appears in share view.

## Decision

Add an `AssistantThinkingEntry` (`kind:"assistant_thinking"`, fields `text: string`, optional `signature?: string`) to the `TranscriptEntry` and `HydratedTranscriptMessage` unions. Extend `normalizeClaudeStreamMessage` to emit one `assistant_thinking` entry per `thinking` content block (preserving order relative to text/tool_use). Hydrate it through `parseTranscript.ts` unchanged-passthrough, and add a dispatch case in the three render switches that renders a new collapsed `ThinkingMessage` component (mirrors the `assistant_text` plumbing but defaults collapsed with a "Thought for N chars / Thinking" header and dimmed body). Persist exactly like `assistant_text` (no new event type — it is an additional transcript-entry kind on the existing `message` event), so it lands in the JSONL event log and renders in `ShareViewPage`. This reuses every existing seam (one mapper, one union, the existing dispatch maps) rather than introducing a parallel reasoning channel, which keeps both drivers and the share view automatically correct.

## Affected Topology

| Entity | Type | Why affected | Governance review |
| --- | --- | --- | --- |
| c3-301 | component | Adds AssistantThinkingEntry interface + assistant_thinking arm to TranscriptEntry / HydratedTranscriptMessage unions | Strong-typing: concrete interface, no escape types |
| c3-210 | component | normalizeClaudeStreamMessage gains a thinking content-block branch emitting the new entry | Colocated bun test for the new mapping |
| c3-113 | component | parseTranscript.ts passthrough + KannaTranscript.tsx dispatch case for the new kind | Render dispatch stays exhaustive over the union |
| c3-114 | component | New ThinkingMessage.tsx collapsed renderer + dispatch wiring; SubagentEntryRow + ShareViewPage cases | New kind added by extending the dispatch map |

## Compliance Refs

| Ref | Why required | Action |
| --- | --- | --- |
| ref-strong-typing | New transcript entry must be a concrete interface added to the discriminated union, not an untyped/any payload | comply |
| ref-event-sourcing | New entry kind is appended to the JSONL event log via the existing message event; must extend the one union, not fork a new log shape | comply |
| ref-tool-hydration | Hydration passes thinking through unchanged; verify the new kind is handled (passthrough) and not misrouted as a tool | review |
| ref-colocated-bun-test | c3-210 cites it; new mapper + renderer behavior needs colocated *.test.ts(x) next to the changed files | comply |
| ref-provider-adapter | c3-210/c3-113 cite it; thinking arrives through both provider adapters (SDK + PTY) but both funnel one mapper, so no adapter contract changes — single seam preserved | review |

## Compliance Rules

| Rule | Why required | Action |
| --- | --- | --- |
| rule-strong-typing | AssistantThinkingEntry and the mapper branch must use concrete types, no any/untyped maps | comply |
| rule-colocated-bun-test | New mapper behavior and renderer need colocated *.test.ts(x) next to the changed files | comply |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| shared types | Add AssistantThinkingEntry interface; add to TranscriptEntry union and the HydratedTranscriptMessage union arm | src/shared/types.ts:1028 (next to AssistantTextEntry), union at :1262, hydrated arm at :1418 |
| server mapper | In normalizeClaudeStreamMessage loop add if (content.type === "thinking" && typeof content.thinking === "string") → push timestamped({kind:"assistant_thinking", text, signature, messageId, debugRaw}) | src/server/agent.ts:628-648 |
| server test | Colocated test asserting a thinking block produces an assistant_thinking entry in order with text/tool_use | src/server/agent.test.ts (or claude-pty jsonl-to-event.test.ts) |
| client hydrate | parseTranscript.ts add case "assistant_thinking" passthrough | src/client/lib/parseTranscript.ts:78 |
| client renderer | New ThinkingMessage.tsx (collapsed disclosure, dimmed) + ThinkingMessage.test.tsx | src/client/components/messages/ |
| client dispatch | Add case "assistant_thinking" to KannaTranscript.tsx (2 switch spots), ShareViewPage.tsx, SubagentEntryRow.tsx | KannaTranscript.tsx:255/454, ShareViewPage.tsx:43, SubagentEntryRow.tsx:54 |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| N.A - this ADR changes Kanna application code only; no c3x CLI command, validator, schema, template, hint, or test is touched | N.A | N.A |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| bun test src/server/agent.test.ts | Fails if the mapper stops emitting assistant_thinking for a thinking block | colocated mapper test |
| bun test src/client/components/messages/ThinkingMessage.test.tsx | Fails if the collapsed renderer regresses (header/expand) | colocated renderer test |
| bun run lint (--max-warnings=0) | TS exhaustiveness over the discriminated union flags any dispatch switch missing the new kind | eslint + tsc |
| tsc discriminated-union narrowing | New union arm forces every switch (entry.kind) to handle or default it | compile error on omission |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Reuse assistant_text for thinking (set a thinking:true flag) | Pollutes the text kind's contract; every text consumer (streaming preview, share, subagent last-message) would need a flag check, and the event log could no longer distinguish reasoning from output |
| Transient render only (no persist) | User chose persist; reasoning would vanish on reload and never appear in share view, defeating the audit value |
| Separate thinking event type (not a transcript entry kind) | Forks the JSONL log shape against ref-event-sourcing's one-union rule and bypasses the existing hydrate/dispatch seams, doubling the render plumbing |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Long thinking blocks bloat transcript render / scroll | Collapsed-by-default disclosure; full text only on expand | ThinkingMessage.test.tsx asserts collapsed initial state |
| Non-exhaustive dispatch switch silently drops the kind (renders nothing) | TS discriminated-union narrowing + lint cap make a missing case a compile/lint failure | bun run lint + tsc |
| Redacted thinking (thinking empty, only signature) renders empty card | Guard on typeof content.thinking === "string" && content.thinking.length > 0; skip empty | mapper test with redacted fixture |
| Share view leaks reasoning unexpectedly | Explicit decision to show in share (user chose "Persist as entry"); ShareViewPage case added intentionally | ShareViewPage dispatch + manual share smoke |

## Verification

| Check | Result |
| --- | --- |
| bun test src/server/agent.test.ts src/client/components/messages/ThinkingMessage.test.tsx | all pass |
| bun run lint | 0 errors, warnings ≤ cap |
| bun test (full suite pre-push) | green |
