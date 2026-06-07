---
id: adr-20260607-agent-subagent-summary-card
c3-seal: 992ad18ba36b7df7c53cf31b68a4abbe9a0516fa9a16bbde4099d95e9acb7fdf
title: agent-subagent-summary-card
type: adr
goal: Render Claude's native `Agent` (a.k.a. `Task`) subagent tool call as a summary card carrying the run's stats — subagent type, token count, wall-clock duration, per-tool counts, status, and final result — instead of the current bare tool row. This is the "Tier 1" summary half of the screenshot the user shared (parent `Agent(...)` row with `↑ tokens · duration`); the expandable nested child transcript (Tier 2) is an explicit follow-up.
status: implemented
date: "2026-06-07"
---

## Goal

Render Claude's native `Agent` (a.k.a. `Task`) subagent tool call as a summary card carrying the run's stats — subagent type, token count, wall-clock duration, per-tool counts, status, and final result — instead of the current bare tool row. This is the "Tier 1" summary half of the screenshot the user shared (parent `Agent(...)` row with `↑ tokens · duration`); the expandable nested child transcript (Tier 2) is an explicit follow-up.

## Context

A native `Agent` tool call (input carries `subagent_type` → kanna's `subagent_task` toolKind) currently hydrates to a generic tool row: `ToolCallMessage` shows a `UserRound` icon + the subagent type as the label, and dumps the raw result text in a `MetaCodeBlock`. None of the rich run stats are surfaced even though Claude writes them: the `Agent` tool_result line in the transcript JSONL carries a top-level `toolUseResult` sidecar `{ agentId, agentType, status, totalTokens, totalDurationMs, totalToolUseCount, toolStats:{readCount,searchCount,bashCount,editFileCount,linesAdded,linesRemoved,otherToolCount}, content, usage }`. Kanna already persists the whole message into the `tool_result` entry's `debugRaw` (the same field `getStructuredToolResultFromDebug` reads for `ask_user_question`/`exit_plan_mode`), so the data is already client-side after hydration — no server, IO, transport, or read-model change is needed. The `workflow` toolKind already demonstrates the target pattern: a typed `.result` (`WorkflowToolResult`) feeding a dedicated card (`WorkflowMessage`) branched in `ToolCallMessage`.

## Decision

Type `HydratedSubagentTaskToolCall`'s result as a new `SubagentTaskResult` and populate it in `parseTranscript` by parsing `debugRaw.toolUseResult` (camelCase) for `subagent_task` tool calls — mirroring the existing `getStructuredToolResultFromDebug` debugRaw path (which reads snake-case `tool_use_result`). Add a dedicated `SubagentTaskMessage` card (parallel to `WorkflowMessage`) that `ToolCallMessage` renders for `subagent_task`: header = description / subagent type, a stat strip (↑ tokens · duration · tool counts), status pill, and the final result collapsed. Best-effort: when `toolUseResult` is absent (SDK driver, older transcripts, in-flight) fall back to the current generic render. This reuses the proven `workflow` card seam, adds zero IO, and keeps the c3-225 invariant untouched (nothing reads sidechain or agent files; the data already flows through the normal transcript pipeline via debugRaw).

## Affected Topology

| Entity | Type | Why affected | Governance review |
| --- | --- | --- | --- |
| c3-301 | component | New SubagentTaskResult (+SubagentToolStats) type; HydratedSubagentTaskToolCall result param changes unknown → SubagentTaskResult | Strong-typing: concrete interface, no escape types |
| c3-113 | component | parseTranscript parses debugRaw.toolUseResult onto subagent_task hydrated calls | Tool-result hydration stays a pure projection |
| c3-114 | component | New SubagentTaskMessage card + ToolCallMessage branch for subagent_task | New render added by extending the existing tool dispatch |

## Compliance Refs

| Ref | Why required | Action |
| --- | --- | --- |
| ref-strong-typing | SubagentTaskResult must be a concrete interface; the hydrated result param stops being unknown | comply |
| ref-tool-hydration | The change extends tool-result hydration for one toolKind; must follow the existing debugRaw-parse + typed-result pattern (WorkflowToolResult) | comply |
| ref-event-sourcing | No new event/kind — relies on existing tool_result.debugRaw; confirm no schema fork | review |
| ref-provider-adapter | c3-113 cites it; the parsed toolUseResult is emitted by the claude PTY transcript — confirm the hydration degrades gracefully for the SDK/codex adapters that may omit it (best-effort fallback) | review |

## Compliance Rules

| Rule | Why required | Action |
| --- | --- | --- |
| rule-strong-typing | New types + parse must avoid any/untyped maps; narrow unknown defensively | comply |
| rule-colocated-bun-test | New hydration parse + card need colocated *.test.ts(x) | comply |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| shared types | Add SubagentToolStats + SubagentTaskResult; retype HydratedSubagentTaskToolCall = HydratedToolCallBase<"subagent_task", input, SubagentTaskResult> | src/shared/types.ts:1403, template at :1415 (WorkflowToolResult) |
| hydration | In parseTranscript tool_result branch, for toolKind === "subagent_task" parse entry.debugRaw → .toolUseResult, normalize into SubagentTaskResult, assign to hydrated.result | src/client/lib/parseTranscript.ts:31 (getStructuredToolResultFromDebug), :116 (tool_result branch) |
| hydration test | Colocated test: debugRaw with toolUseResult → typed result; absent → undefined (fallback) | src/client/lib/parseTranscript.test.ts |
| renderer | New SubagentTaskMessage.tsx (stat strip + status + collapsed result) + .test.tsx | src/client/components/messages/ |
| renderer wiring | ToolCallMessage renders SubagentTaskMessage for subagent_task (mirror the workflow branch at :262), fallback to generic row when no result | src/client/components/messages/ToolCallMessage.tsx:262 |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| N.A - changes Kanna application code only; no c3x CLI command, validator, schema, template, hint, or test is touched | N.A | N.A |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| bun test src/client/lib/parseTranscript.test.ts | Fails if toolUseResult stops hydrating onto subagent_task | colocated hydration test |
| bun test src/client/components/messages/SubagentTaskMessage.test.tsx | Fails if the stat card regresses (tokens/duration/status) | colocated card test |
| tsc | HydratedSubagentTaskToolCall.result is now typed; any unsafe access breaks compile | typed result param |
| bun run lint | strong-typing rule blocks any/untyped narrowing in the parse | eslint |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Read the subagents/agent-<agentId>.jsonl files for stats | Unnecessary for stats — toolUseResult already carries totals in debugRaw; file-watch read-model is the heavier Tier-2 drill-in, deliberately deferred |
| Un-drop isSidechain lines into the turn pipeline to compute stats | Breaks the c3-225 invariant (sidechain results corrupt the main turn lifecycle/seq); also redundant given toolUseResult |
| Fold stats into the generic MetaCodeBlock result render | No structured surface for tokens/duration/tool-counts; would not match the screenshot and buries the signal in raw text |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| toolUseResult absent (SDK driver / older / in-flight) | Best-effort parse; fall back to existing generic subagent row when result is undefined | hydration test with no-sidecar fixture |
| debugRaw shape drift (camelCase toolUseResult) | Defensive narrowing (typeof guards per field) in the parser, same discipline as getStructuredToolResultFromDebug | parse test with partial/garbage sidecar |
| Large content bloats render | Final result rendered collapsed; stats strip is fixed-size | card test asserts collapsed default |

## Verification

| Check | Result |
| --- | --- |
| bun test src/client/lib/parseTranscript.test.ts src/client/components/messages/SubagentTaskMessage.test.tsx | all pass |
| bun run lint | 0 errors, warnings ≤ cap |
| tsc --noEmit | clean |
