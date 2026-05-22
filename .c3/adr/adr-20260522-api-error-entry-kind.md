---
id: adr-20260522-api-error-entry-kind
c3-seal: a34ec349ae4dead4bafda81507427b386058d997dbdfd1a56f033e868fbbbfd3
title: api-error-entry-kind
type: adr
goal: Introduce a first-class transcript entry kind `api_error` so synthetic Claude CLI API-error assistant messages (e.g. `529 Overloaded`) render with dedicated error styling, status badge, and optional request id, instead of being rendered as plain assistant text. The decision authorizes a new discriminant in the `TranscriptEntry` union — not just a flag on `AssistantTextEntry`.
status: proposed
date: "2026-05-22"
---

# adr-20260522-api-error-entry-kind

## Goal

Introduce a first-class transcript entry kind `api_error` so synthetic Claude CLI API-error assistant messages (e.g. `529 Overloaded`) render with dedicated error styling, status badge, and optional request id, instead of being rendered as plain assistant text. The decision authorizes a new discriminant in the `TranscriptEntry` union — not just a flag on `AssistantTextEntry`.

## Context

Today the Claude CLI writes synthetic assistant messages with `model:"<synthetic>"`, `isApiErrorMessage:true`, `apiErrorStatus:<code>` and human-readable error text. `normalizeClaudeStreamMessage` in `src/server/agent.ts` ignores these flags and emits a normal `assistant_text` entry. `KannaTranscript.tsx` routes that through `TextMessage`, so a 529 looks indistinguishable from a model reply. Found via session `d4386ad9-005c-413f-947a-9150c3f48185`. The transcript event union, hydration types, history primer, snapshot, subagent-orchestrator scans, and the renderer switch all branch on `entry.kind`, so a new kind is the lowest-drift carrier for retry metadata and analytics later.

## Decision

Add a new `ApiErrorEntry { kind:"api_error", status:number, requestId?:string, text:string }` to the `TranscriptEntry` union in `src/shared/types.ts`. Server normalize emits this kind when the Claude CLI synthetic API-error markers are present (status parsed from `apiErrorStatus`, fallback regex on text). Hydration, history primer, snapshot, and subagent-orchestrator mention scans treat the kind as a non-text, non-tool entry (no mention parsing, no tool grouping). Client adds an `ApiErrorMessage` component and a dedicated `case "api_error"` in `KannaTranscript.tsx`. Chosen over option A (annotate `AssistantTextEntry`) because the kind is semantically distinct, easier to carry retry metadata, and the user explicitly accepted the larger blast radius.

## Affected Topology

| Entity | Type | Why affected | Governance review |
| --- | --- | --- | --- |
| c3-301 | component | Adds new discriminant in TranscriptEntry union | ref-strong-typing: named type at shared boundary |
| c3-210 | component | normalizeClaudeStreamMessage emits new kind | ref-provider-adapter: provider-agnostic transcript |
| c3-206 | component | JSONL replay must accept new kind in hydration paths | ref-event-sourcing: append-only, replay-safe |
| c3-114 | component | New per-kind component + exhaustive switch | ref-tool-hydration, ref-strong-typing |
| c3-113 | component | KannaTranscript switch gains case | ref-strong-typing |

## Compliance Refs

| Ref | Why required | Action |
| --- | --- | --- |
| ref-strong-typing | New union member must be named, no any at boundary | comply |
| ref-event-sourcing | New kind must replay cleanly from existing JSONL | comply |
| ref-provider-adapter | API errors normalized to provider-agnostic kind | comply |
| ref-tool-hydration | Confirm api_error does not pass through tool hydration | comply |

## Compliance Rules

| Rule | Why required | Action |
| --- | --- | --- |
| rule-strong-typing | All boundary values typed; new union member declared with named fields | comply |
| rule-colocated-bun-test | New ApiErrorMessage component ships colocated .test.tsx | comply |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| shared types | Add ApiErrorEntry to TranscriptEntry union | src/shared/types.ts |
| server normalize | Detect synthetic + isApiErrorMessage in normalizeClaudeStreamMessage; emit api_error | src/server/agent.ts |
| event-store / hydration | Exhaustive switches accept api_error (no special replay logic) | src/server/event-store*.ts, hydration types |
| history primer / snapshot | Pass-through; no mention scan, no tool grouping | src/server/history-primer*.ts, snapshot*.ts |
| subagent-orchestrator | Mention parsers skip api_error entries | src/server/subagent*.ts |
| client renderer | New ApiErrorMessage component + case in KannaTranscript | src/client/components/messages/ApiErrorMessage.tsx, src/client/components/KannaTranscript.tsx |
| tests | Normalize unit test, renderer test fixture | colocated *.test.ts(x) |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| N.A - no c3x CLI / validator surface affected | N.A | N.A |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| TypeScript exhaustive switches | Compiler flags missing api_error case in any switch | tsc / bun run lint |
| ApiErrorMessage.test.tsx | Snapshot test ensures status + text render | bun test |
| normalize unit test | Asserts synthetic message → api_error entry | bun test src/server/agent.test.ts |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Option A: annotate AssistantTextEntry with optional apiError field | Mixes error semantics into text kind; harder to carry retry metadata; user explicitly chose B |
| Replace synthetic message with toast / banner outside transcript | Loses chronological context; error vanishes on reload; breaks event-sourcing invariant |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Missing kind handler in some exhaustive switch | TypeScript compile-time exhaustiveness in shared union | bun run lint |
| Old JSONL events not re-emitted as api_error | Pre-existing 529 entries stay as assistant_text; only new sessions get the new kind | manual: load old session, confirm no crash |
| Subagent mention parser scans new kind | Update parser allowlist to skip api_error | unit test on parser |

## Verification

| Check | Result |
| --- | --- |
| bun run lint | exit 0, no new warnings |
| bun test src/server/agent.test.ts src/client/components/messages/ApiErrorMessage.test.tsx | pass |
| Manual: load session d4386ad9-005c-413f-947a-9150c3f48185 | 529 entry renders as ApiErrorMessage with red badge |
