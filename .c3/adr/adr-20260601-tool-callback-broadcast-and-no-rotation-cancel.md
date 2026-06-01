---
id: adr-20260601-tool-callback-broadcast-and-no-rotation-cancel
c3-seal: d874c0c73b807742063023d0b5b083371964a1abd6f813dc9cc1265b149ff87d
title: tool-callback-broadcast-and-no-rotation-cancel
type: adr
goal: |-
    Fix three converging causes of "the kanna question tool dropped / timed
    out" UX bugs in c3-226 (kanna-mcp-host): (1) `createToolCallbackService`
    never fires a chat-state broadcast after `putToolRequest` /
    `resolveToolRequest`, so the UI never sees the new pending until an
    unrelated event flushes the read model; (2) `makeClaudeSessionHandle.close`
    calls `cancelAllForSession("session_closed")` on every PTY/SDK teardown,
    including transparent token-rotation and idle-sweep respawns where the
    model's turn is still live, denying mid-prompt asks for no real reason;
    (3) the 600s wall-clock ask-pending timeout (ticked every 5s from
    `server.ts`) silently masks (1) — pendings the UI never showed deny after
    10 min instead of waiting for an answer. The selected change adds an
    `onStateChange(chatId)` callback wired to `router.scheduleChatStateBroadcast`,
    removes the session-close cancel cascade in favour of an explicit
    `cancelAllForChat` from the `chat.cancel` ws-router handler, and removes
    the wall-clock timeout (matching upstream Claude Code's AskUserQuestion
    built-in which has no timeout).
status: proposed
date: "2026-06-01"
---

# Tool-callback live broadcast + drop-cancel-on-rotation + remove ask-timeout

## Goal

Fix three converging causes of "the kanna question tool dropped / timed
out" UX bugs in c3-226 (kanna-mcp-host): (1) `createToolCallbackService`
never fires a chat-state broadcast after `putToolRequest` /
`resolveToolRequest`, so the UI never sees the new pending until an
unrelated event flushes the read model; (2) `makeClaudeSessionHandle.close`
calls `cancelAllForSession("session_closed")` on every PTY/SDK teardown,
including transparent token-rotation and idle-sweep respawns where the
model's turn is still live, denying mid-prompt asks for no real reason;
(3) the 600s wall-clock ask-pending timeout (ticked every 5s from
`server.ts`) silently masks (1) — pendings the UI never showed deny after
10 min instead of waiting for an answer. The selected change adds an
`onStateChange(chatId)` callback wired to `router.scheduleChatStateBroadcast`,
removes the session-close cancel cascade in favour of an explicit
`cancelAllForChat` from the `chat.cancel` ws-router handler, and removes
the wall-clock timeout (matching upstream Claude Code's AskUserQuestion
built-in which has no timeout).

## Context

Today every interactive tool prompt (ask_user_question, exit_plan_mode,
delegate_subagent) registers a `ToolRequest` in `tool-callback.ts`. The
read model surfaces it as a `pending_tool_request` transcript entry via
`getRecentChatHistory`. That snapshot only ships to the client when
something else triggers `broadcastChatAndSidebar` (a stream chunk, a
reconnect, a sidebar refresh). Between the model emitting `tool_use` and
the next transcript line under PTY mode (transcript JSONL watcher idle
while model awaits tool_result), nothing fires — so the user sees no
prompt at all. The 600s `tickTimeouts` driver then resolves it
`{kind:"deny", reason:"timeout"}` and the model gets a silent deny.
Separately, `makeClaudeSessionHandle.close()` (agent.ts:1071) calls
`cancelAllForSession(sessionToken, "session_closed")` on every teardown.
Token rotation under PTY tears down and respawns the same chat
constantly; each respawn denies any in-flight pending even though the
turn is conceptually unbroken. Upstream Claude Code's built-in
AskUserQuestion uses a synchronous React useState pending + a single
`onAllow` resolve, with NO wall-clock timeout, NO cross-process state,
and a TUI lock that fires the equivalent of a broadcast synchronously
because state + view share one process. Kanna's server/client split
makes the broadcast mandatory — there is no equivalent of the TUI lock.

## Decision

Inject an optional `onStateChange?: (chatId: string) => void` into
`ToolCallbackServiceArgs`. Fire it after every persisted state change
(submit's `persistPut`, answer/cancel/cancelAllForChat's `persistResolve`).
Wire it from `server.ts` through a deferred holder
(`let broadcastChatState: ...`) populated immediately after
`createWsRouter` returns — `recoverOnStartup` runs before the router
exists and its broadcasts no-op, which is correct (no connected client).
Remove `cancelAllForSession` from `ToolCallbackService` entirely and drop
its call site in `makeClaudeSessionHandle.close()`. Pending records now
survive transparent respawns (rotation, idle sweep) and are reaped only
by the three explicit paths that already exist: `cancelAllForChat` from
`chat.delete`, a new `cancelAllForChat` call added to the `chat.cancel`
handler in `ws-router.ts`, and `recoverOnStartup`'s fail-closed pass on
server boot. Remove the `timeoutMs` field, the `tickTimeouts` method,
and the 5s `setInterval` in `server.ts` that drives it. Existing
persisted records still carry `expiresAt` — fill it with
`Number.MAX_SAFE_INTEGER` (NEVER_EXPIRES) so the schema stays
compatible while nothing enforces it.

## Affected Topology

| Entity | Type | Why affected | Governance review |
| --- | --- | --- | --- |
| c3-226 | component | Contract row "Durable approval protocol" changes shape (new onStateChange, no timeout, no cancelAllForSession). Failure modes table needs the "pending timeout" row removed and a "live broadcast missing" row added. | Update c3-226 Contract + Change Safety + Foundational/Business Flow rows in the same PR. |
| c3-210 | component | Owns makeClaudeSessionHandle; close() no longer cascades cancel. | No contract surface change — remove the implicit "close also denies pendings" assumption from the Foundational Flow narrative if present. |
| c3-2 | container | server.ts wires the broadcast holder and drops the tickTimeouts setInterval. | Container Responsibilities row "host the in-process MCP server + tool-callback service" stays correct; no Parent Delta required. |
| c3-206 | component | No code change. putToolRequest/resolveToolRequest contract unchanged. | N.A - read-only consumer of the same EventStore API. |

## Compliance Refs

| Ref | Why required | Action |
| --- | --- | --- |
| ref-strong-typing | New onStateChange?: (chatId: string) => void is a typed boundary at MCP-host edge. | comply |
| ref-event-sourcing | Broadcast still fires AFTER opts.store.putToolRequest / resolveToolRequest resolves — log remains source of truth, no broadcast-before-log inversion. | comply |
| ref-tool-hydration | UI still hydrates pending_tool_request through src/shared/tools.ts; broadcast just makes the snapshot reach the client sooner. | comply |
| ref-local-first-data | Persistence unchanged — same JSONL under ~/.kanna/data. | comply |
| ref-provider-adapter | close() change applies to both SDK and PTY Claude drivers; both share makeClaudeSessionHandle. | comply |

## Compliance Rules

| Rule | Why required | Action |
| --- | --- | --- |
| rule-strong-typing | onStateChange and broadcastChatState are named function types at boundaries — no any. | comply |
| rule-colocated-bun-test | New broadcast test sits in src/server/tool-callback.test.ts next to source; updated stub shape in src/server/agent.test.ts, kanna-mcp.test.ts, kanna-mcp-tools/grep.test.ts. | comply |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| tool-callback.ts | Drop timeoutMs field; add onStateChange field; drop cancelAllForSession+tickTimeouts methods; add notify(chatId) helper called from persistPut and persistResolve; set expiresAt = NEVER_EXPIRES for ask-verdict records. | src/server/tool-callback.ts |
| server.ts | Add let broadcastChatState: ...; pass onStateChange: (chatId) => broadcastChatState?.(chatId) to initToolCallbackOnBoot; populate broadcastChatState after createWsRouter; remove the toolCallbackTickInterval setInterval and its clearInterval in shutdown. | src/server/server.ts |
| agent.ts | Drop the args.toolCallback.cancelAllForSession(...) call from makeClaudeSessionHandle.close(). | src/server/agent.ts |
| ws-router.ts | In case "chat.cancel" handler, call agent.toolCallbackService.cancelAllForChat(chatId, "chat_cancelled") after agent.cancel(chatId). | src/server/ws-router.ts |
| tool-callback.test.ts | Rewrite the two timeout tests as a NEVER_EXPIRES regression (24h jump, still pending). Add onStateChange fires on submit/answer/cancel/cancelAllForChat test. Add auto-allow/auto-deny does NOT fire onStateChange test. | src/server/tool-callback.test.ts |
| Other stubs | Strip cancelAllForSession + tickTimeouts + timeoutMs from stubs in agent.test.ts, kanna-mcp.test.ts, kanna-mcp-tools/grep.test.ts. | grep no longer finds those identifiers under src/. |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| c3-226 Contract row "Durable approval protocol" | Rephrase the IN/OUT contract to mention onStateChange broadcast + no built-in timeout; remove cancelAllForSession from the surface. | c3x write c3-226 --section Contract |
| c3-226 Foundational Flow "Failure — pending timeout" row | Replace with "Failure — chat cancelled / chat deleted" describing the explicit cancelAllForChat paths from ws-router. | c3x write c3-226 --section "Foundational Flow" |
| c3-226 Change Safety table | Add row: "Live-broadcast missing — onStateChange omitted from createToolCallbackService args — Detection: tool-callback.test.ts asserts events fire — Verification: bun test src/server/tool-callback.test.ts". Add row covering session-close no longer cancelling pendings. | c3x write c3-226 --section "Change Safety" |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| bun test src/server/tool-callback.test.ts | Asserts onStateChange fires on submit/answer/cancel/cancelAllForChat (chat-1, 6 events). Asserts NEVER_EXPIRES (24h jump leaves pending open). Asserts auto-allow/auto-deny does NOT broadcast. | tool-callback.test.ts |
| bun test src/server/agent.test.ts + bun test src/server/kanna-mcp.test.ts + bun test src/server/boot.test.ts | Stub shape compile-locks the new ToolCallbackService interface (no cancelAllForSession, no tickTimeouts). | TypeScript build / bun test |
| bun run lint | Drops dead-code references; --max-warnings=0 catches accidental any. | bun run lint |
| ws-router.ts case "chat.cancel" | Runtime path that now reaps pendings on user-initiated cancel; replaces the removed close()-side cascade. | src/server/ws-router.ts:chat.cancel handler |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Keep timeoutMs but lower it to 120s and surface expiresAt to the client | Still hides the broadcast bug as a "drop" — 120s of invisible prompt is the same UX failure as 600s, just shorter. Upstream Claude Code proves no timeout is needed. |
| Keep cancelAllForSession but add a reason: "rotation" flag that skips cancel | Two-state flag on every close() site is a fragile contract — easy to forget to pass "rotation" at one of the four call sites. Removing the cascade entirely and routing through cancelAllForChat from ws-router is mechanically harder to break. |
| Have the read-model push pending broadcasts from inside event-store.ts | Inverts the broadcast direction (event-store would need a router reference), breaks the existing one-way data flow from agent-coordinator → event-store → broadcast. onStateChange is a thin callback at the host boundary and keeps the seam. |
| Use a Bun timer on each waiter instead of a global tickTimeouts | Same drop UX, plus 1 timer per pending — wasteful when the right fix is no timer at all. |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Pending records leak forever in inMemory when the model crashes mid-tool_use and no one cancels | recoverOnStartup fail-closes every pending on server boot; chat.delete / chat.cancel paths clear them mid-process. Worst case: stale record sits until next restart. | bun test src/server/tool-callback.test.ts (server-restart resolves persisted pending as session_closed) |
| Removed cancelAllForSession leaves orphan waiters when a chat's session is rotated and a new pending is opened with a different sessionId (different hmacId) | The old waiter resolves on the next explicit cancel/answer/server-restart; the new pending resolves independently because hmacId differs. The model on resume will re-emit ask_user_question against the new sessionId → fresh pending with broadcast → user prompted. | bun test src/server/agent.test.ts oauth-rotation suite passes (no regression in token-rotation tests). |
| Broadcast holder still null when an early submit fires (recoverOnStartup) | recoverOnStartup only touches records that survived from a previous boot; even if it broadcast, no client is connected yet. The null-coalesce no-op is the correct behaviour. | Manual: server boot replays a pending → resolves to session_closed → no broadcast → client connects → snapshot reflects resolved state. |

## Verification

| Check | Result |
| --- | --- |
| bun test src/server/tool-callback.test.ts | 11 pass / 0 fail (new onStateChange + NEVER_EXPIRES tests included) |
| bun test src/server/agent.test.ts | 86 pass / 0 fail |
| bun test src/server/kanna-mcp.test.ts src/server/boot.test.ts src/server/kanna-mcp-tools/grep.test.ts | 29 pass / 0 fail |
| bun test src/server/ws-router.test.ts | 51 pass / 0 fail |
| bun run lint | exit 0, --max-warnings=0 |
| bun test full suite | 2262 pass / 2 skip / 1 pre-existing flaky (paths-route > returns 404 for unknown project — 31s spawn-server-bundle timeout, unrelated to tool-callback; passes in isolation) |
