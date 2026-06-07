---
id: adr-20260607-ask-question-pending-dedup
c3-seal: bdab0fc4bcfb0fd9d546aca92e96ab773534d581258bcaa540a5993e54d6009d
title: ask-question-pending-dedup
type: adr
goal: Stop the durable approval protocol from rendering a new `AskUserQuestion` (and `ExitPlanMode`) prompt card every time the same logical interactive tool call is re-delivered while it is still pending. Today a long user wait produces duplicate pending prompts that pile up "again and again"; the fix makes a pending interactive request idempotent on its content for the duration of the pending window, while still allowing a genuinely new ask after the prior one resolves.
status: implemented
date: "2026-06-07"
---

## Goal

Stop the durable approval protocol from rendering a new `AskUserQuestion` (and `ExitPlanMode`) prompt card every time the same logical interactive tool call is re-delivered while it is still pending. Today a long user wait produces duplicate pending prompts that pile up "again and again"; the fix makes a pending interactive request idempotent on its content for the duration of the pending window, while still allowing a genuinely new ask after the prior one resolves.

## Context

Interactive tools route through `createToolCallbackService.submit` (`src/server/tool-callback.ts`). The persisted `ToolRequest.id` is `hmac(chatId | sessionId | toolUseId | toolName | argsHash)`. `toolUseId` originates in `kanna-mcp.ts` as `requestId != null ? String(requestId) : randomUUID()` — for the `mcp__kanna__ask_user_question` / `exit_plan_mode` shims the MCP `extra.requestId` is the volatile per-JSON-RPC-request id (and is often absent → `randomUUID()`). When the streamable-HTTP MCP transport re-delivers the same `tools/call` during a long block (reconnect / retry while the model waits for the answer), the handler runs again with a fresh `toolUseId`, so `submit` computes a **different** `id`, persists a **second** pending `ToolRequest`, and `getRecentChatHistory` synthesizes a second `pending_tool_request` transcript entry with a distinct `_id` (`pending-tool-request-<id>`). The client dedups transcript entries by `_id` (`useKannaState.mergeTranscriptEntries`), so distinct ids each render their own card — the visible duplication. The existing id-based idempotency (in-memory mirror) cannot collapse these because the id itself varies. `submit` already has the right collapse behavior for a matching id (attach a new waiter to the live record); it just never matches across re-deliveries.

## Decision

Add a content-scoped pending index to `createToolCallbackService`: a map from `contentKey = chatId | sessionId | toolName | canonicalArgsHash` to the id of the currently-live (status `pending`) record, plus the reverse `id → contentKey`. In `submit`, after the existing id-based idempotency checks and before creating a new record, if a live pending record exists for the same `contentKey`, attach a new waiter to **that** record and return — no second `ToolRequest`, no second card. The content index entry is registered only when a record actually goes `pending` (the "ask" verdict path) and is cleared whenever the record resolves (`persistResolve`, covering answer / cancel / cancelAllForChat / recoverOnStartup). Because the index only holds non-terminal records, a legitimately repeated question asked **after** the prior one is answered does not match (its prior record is terminal and was evicted), so it correctly creates a fresh prompt. This is trigger-agnostic (works whether the duplicate comes from a random `toolUseId`, a new `requestId`, or any re-delivery) and is fully contained in `tool-callback.ts` — `submit`'s signature and the persisted shape are unchanged.

## Affected Topology

| Entity | Type | Why affected | Governance review |
| --- | --- | --- | --- |
| c3-226 | component | createToolCallbackService.submit gains a content-scoped pending dedup index; resolution paths clear it | Strong-typing on the new maps; colocated test for dedup + post-resolve re-ask |

## Compliance Refs

| Ref | Why required | Action |
| --- | --- | --- |
| ref-strong-typing | New index maps and content key must be concretely typed, no untyped shapes | comply |
| ref-tool-hydration | The dedup is upstream of hydration; confirm the synthesized pending_tool_request entry shape is unchanged so renderers are unaffected | review |
| ref-local-first-data | Behavior change is in-memory/JSONL only; no new persistence surface or network exposure | review |

## Compliance Rules

| Rule | Why required | Action |
| --- | --- | --- |
| rule-strong-typing | New maps (Map<string,string>) and helpers must avoid any/untyped object literals | comply |
| rule-colocated-bun-test | New dedup behavior needs a colocated tool-callback.test.ts case | comply |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| service state | Add pendingByContent: Map<contentKey,id> + contentKeyById: Map<id,contentKey>; contentKey(chatId,sessionId,toolName,hash) helper | src/server/tool-callback.ts:57 (service body), id at :75 |
| submit dedup | After id-idempotency block, if a live pending record exists for the contentKey, attach a waiter and return; no new record | src/server/tool-callback.ts:145-161 |
| register | On the "ask" verdict path, set both index maps when the pending record is created | src/server/tool-callback.ts:204-213 |
| clear | In persistResolve, evict both index maps for the resolved id | src/server/tool-callback.ts:102-112 |
| test | Colocated: two submits, same content, different toolUseId, while pending → 1 pending record, both promises resolve on answer; after answer, a third submit (same content) → a new pending record | src/server/tool-callback.test.ts |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| N.A - changes Kanna application code only; no c3x CLI command, validator, schema, template, hint, or test is touched | N.A | N.A |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| bun test src/server/tool-callback.test.ts | Fails if a re-delivered pending ask creates a second record, or if a post-answer re-ask is wrongly suppressed | colocated dedup + re-ask tests |
| bun test src/server/kanna-mcp-tools/ask-user-question.test.ts | Existing ask-tool behavior stays green (single ask still works) | existing suite |
| bun run lint | strong-typing on the new maps | eslint |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Derive a deterministic toolUseId from args content in kanna-mcp.ts (ignore requestId) | Makes the id content-stable forever, so a legitimately repeated question in a later turn collapses onto the prior terminal record and auto-returns the stale answer without ever prompting the user |
| Add a wall-clock timeout so stale pending records expire | The protocol deliberately uses NEVER_EXPIRES to match upstream CLI (block until answered/canceled); a timeout would silently cancel real waits and does not address the duplicate-while-waiting symptom |
| Dedup on the client by (toolName,args) | Hides server state divergence (multiple live records still exist, each resolvable separately) and leaks the dedup contract into every renderer |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Two genuinely different pending asks with identical serialized args in one session collapse to one | Interactive asks are answered before the next is issued; the index only holds one live record per content and the second invocation resolves with the same answer (acceptable for identical content) | dedup test asserts both waiters resolve |
| Post-answer re-ask wrongly suppressed | Index holds only non-terminal records; persistResolve evicts on resolution, so a later identical ask creates a fresh record | re-ask test asserts a new pending record after answer |
| Index leak on abnormal resolution | All resolution flows funnel through persistResolve, including recoverOnStartup | resolve paths covered by existing + new tests |

## Verification

| Check | Result |
| --- | --- |
| bun test src/server/tool-callback.test.ts src/server/kanna-mcp-tools/ask-user-question.test.ts | all pass |
| bun run lint | 0 errors, warnings ≤ cap |
| bunx tsc --noEmit | clean |
