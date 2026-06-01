---
id: c3-226
c3-seal: d4436e2bc2307d55f5957efa304677f799111e70344eca1603d00bfc00346261
title: kanna-mcp-host
type: component
category: feature
parent: c3-2
goal: |-
    Host the in-process loopback MCP server that the Claude driver attaches
    via `--mcp-config`, expose Kanna-side built-in shims that route through
    the durable approval protocol, and enforce read/write path-deny rules
    before any tool side-effect runs.
uses:
    - ref-local-first-data
    - ref-strong-typing
    - ref-tool-hydration
    - rule-colocated-bun-test
    - rule-strong-typing
---

# kanna-mcp-host

## Goal

Host the in-process loopback MCP server that the Claude driver attaches
via `--mcp-config`, expose Kanna-side built-in shims that route through
the durable approval protocol, and enforce read/write path-deny rules
before any tool side-effect runs.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-2 (server) |
| Parent Goal Slice | "Drive multi-provider agent turns through a single coordinator" — supplies the MCP host every Claude session attaches to |
| Category | feature |
| Lifecycle | One MCP server bound per server process; per-spawn --mcp-config injected by the agent coordinator |
| Replaceability | Replaceable while the tool-call envelope, durable approval protocol, and mcp__kanna__* tool surface are preserved |

## Purpose

Owns the Kanna MCP host runtime: builds the in-process HTTP MCP server
that publishes `mcp__kanna__*` tools, registers the durable approval
protocol used by `ask_user_question`, `exit_plan_mode`, and
`delegate_subagent`, and enforces read/write path-deny on the eight
built-in shims (`read`, `glob`, `grep`, `bash`, `edit`, `write`,
`webfetch`, `websearch`) gated by `KANNA_MCP_TOOL_CALLBACKS`. Non-goals:
turn orchestration (c3-210), Claude PTY transport (c3-225), Codex App
Server (c3-211), provider/model normalization (c3-212). The host never
performs the actual filesystem or network side-effect itself; each shim
delegates to the same node primitives the native tools would call after
the approval protocol clears.

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Precondition | Spawn-time --mcp-config written to point Claude at the loopback HTTP MCP server; auth/session token gated by c3-203 | c3-210 |
| Input — tool call | Claude (or Codex) issues an mcp__kanna__* tool call through MCP transport | c3-210 |
| State — pending request | Each interactive call (ask/exit-plan/delegate) registers a durable pending record in tool-callback.ts; survives restart and replays on reconnect as pending_tool_request | c3-205 |
| Live broadcast | createToolCallbackService fires onStateChange(chatId) after every persisted state change; server.ts wires this to router.scheduleChatStateBroadcast so the UI sees the new pending the moment the model emits the call (no longer waiting for an unrelated event to flush the read model) | c3-208 |
| Shared dep — event store | Pending and resolved tool requests append events to the JSONL log | c3-206 |
| Shared dep — paths-config | readPathDeny / writePathDeny resolved against ~/.kanna/data and project roots | c3-204 |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Outcome | Kanna-owned tool implementations run with the same approval UX whether the model used SDK canUseTool or the native built-in shims | c3-210 |
| Primary path | Tool call → shim → path-deny check → durable approval (if interactive) → execute → return MCP result | c3-205 |
| Alternate — feature flag off | Default KANNA_MCP_TOOL_CALLBACKS=0: native built-ins handle reads/writes; only ask_user_question, exit_plan_mode, delegate_subagent shims stay active under PTY (issue #215) | N.A - documented in CLAUDE.md "Tool Callback Feature Flag" |
| Alternate — websearch | Stub: always returns isError: true — external web search integration out of scope | N.A - documented stub in CLAUDE.md |
| Failure — chat cancelled / chat deleted | ws-router's chat.cancel and chat.delete handlers call cancelAllForChat(chatId, reason), resolving every open ask-style record as {kind:"deny", canceled:<reason>}. Replaces the prior session-close cascade which mis-fired on transparent rotation/sweep respawns. | c3-208 |
| Failure — server restart | recoverOnStartup() fail-closes every still-pending record as session_closed so no MCP turn hangs forever across reboots; no wall-clock timeout fires while the server is running | c3-206 |

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-tool-hydration | ref | MCP tool envelopes still normalize through src/shared/tools.ts before the UI renders them | must follow | shims share the same hydration path as native tool calls |
| ref-local-first-data | ref | Pending records persist under ~/.kanna/data; HTTP MCP only binds localhost | must follow | path-deny defaults block leaving project root |
| ref-strong-typing | ref | Every shim arg/result has a named type at the MCP boundary | must follow | rule-strong-typing applies |
| rule-strong-typing | rule | No any/unknown at the MCP envelope or path-deny surface | wired compliance target | enforces typed inputs across the host |
| rule-colocated-bun-test | rule | Every shim has a colocated <name>.test.ts next to its source | wired compliance target | applies to all of kanna-mcp-tools/** |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| mcp__kanna__* tool surface | OUT | Set of MCP tools published to Claude/Codex; envelope matches MCP spec; KANNA_MCP_TOOL_CALLBACKS flag selects which shims register | c3-210 | src/server/kanna-mcp.ts |
| Loopback HTTP MCP server | IN | HTTP endpoint Claude PTY/SDK attaches via --mcp-config; bound to 127.0.0.1 only | c3-202 | src/server/kanna-mcp-http.ts |
| Durable approval protocol | IN/OUT | Register pending request, push to UI, await resolution; pendings survive process restart and replay as pending_tool_request entries. Surface methods: submit, answer, cancel, cancelAllForChat, recoverOnStartup. createToolCallbackService accepts an onStateChange(chatId) hook fired after every persisted state change inside submit's persistPut and answer/cancel/cancelAllForChat's persistResolve; server.ts wires this to router.scheduleChatStateBroadcast so the UI receives pending_tool_request the same tick the model emits the tool_use. Pendings resolve through three explicit paths: user answer, ws-router cancelAllForChat triggered by chat.cancel and chat.delete, or recoverOnStartup fail-close on server boot. | c3-208 | src/server/tool-callback.ts |
| Path deny enforcement | IN | readPathDeny + writePathDeny reject paths outside allowed roots before shim execution | c3-204 | src/server/permission-gate.ts |
| Channel notification push | OUT | McpServer declares experimental capabilities claude/channel + claude/channel/permission; exposes pushChannelPrompt(content) which sends a single notifications/claude/channel notification, and channelClientReady which resolves when the spawned claude has acknowledged channel registration. Used by one-shot subagent PTY spawns (c3-225) to deliver the initial prompt without typing it into the TUI | c3-225 | src/server/kanna-mcp-http.ts, src/server/claude-pty/channel-notification.ts |
| delegate_subagent keep_alive param | OUT | keep_alive boolean on delegate_subagent. When true and the target is a Claude subagent, the run stays live and the reply text carries the live run_id; non-claude targets return isError. Routes to c3-210 delegateRun with keepAlive | c3-210 | src/server/kanna-mcp.ts, src/server/kanna-mcp-tools/delegate-subagent.ts |
| send_subagent_message tool | OUT | Takes run_id plus prompt, drives one follow-up turn into a live keep-alive session, blocks until that turn finishes, returns the subagent reply text or isError NO_LIVE_SESSION. Routes to c3-210 sendToLiveRun | c3-210 | src/server/kanna-mcp.ts |
| close_subagent tool | OUT | Takes run_id, closes a live keep-alive session and frees its process. Routes to c3-210 closeLiveRun | c3-210 | src/server/kanna-mcp.ts |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| Path-deny bypass | Edit removes the gate from a shim path | Add a deny-rule test; grep for direct fs writes inside shims | bun test src/server/permission-gate.test.ts |
| Durable approval drift | Edit forgets to persist a new interactive tool kind | tool-callback.test.ts asserts every interactive shim registers | bun test src/server/tool-callback.test.ts |
| Loopback bind escapes | Code change opens the MCP HTTP server beyond 127.0.0.1 | http-ws-server test asserts bind host | bun test src/server/kanna-mcp-http.test.ts |
| Native built-in re-enabled under PTY for AskUserQuestion/ExitPlanMode | --disallowedTools list misses entries | grep for AskUserQuestion in PTY spawn args | bun test src/server/claude-pty/driver.test.ts |
| Channel capability declaration dropped | Edit removes experimental['claude/channel'] from McpServer options | grep for claude/channel in kanna-mcp-http.ts | bun test src/server/kanna-mcp-http.test.ts |
| pushChannelPrompt called more than once per one-shot spawn | Driver wiring re-pushes on apparent stall | grep for pushChannelPrompt callers; single-call assertion in driver.test.ts | bun test src/server/claude-pty/driver.test.ts |
| Live broadcast missing on new pending — UI never shows the prompt | createToolCallbackService called without onStateChange, or persistPut/persistResolve refactored to skip the notify(chatId) hook | tool-callback.test.ts asserts 6 events for submit/answer/cancel/cancelAllForChat sequence, and zero events for auto-allow/auto-deny | bun test src/server/tool-callback.test.ts |
| Session-close cancel cascade re-introduced — denies asks mid-rotation | A future edit re-adds args.toolCallback.cancelAllForSession in makeClaudeSessionHandle.close, or any equivalent close()-side cancel call | grep for cancelAllForSession in src/ returns hits, or oauth-rotation tests show pendings denied mid-turn | bun test src/server/agent.test.ts (oauth-rotation suite); grep -r cancelAllForSession src/ |
| Pending leak — model crashes mid-tool_use with no cancel path | recoverOnStartup not run on boot (initToolCallbackOnBoot replaced with createToolCallbackService) | boot.test.ts asserts recoverOnStartup is called before service is returned | bun test src/server/boot.test.ts |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| src/server/kanna-mcp.ts | Contract (mcp__kanna__* tool surface) | Tool registration order | src/server/kanna-mcp.ts |
| src/server/kanna-mcp-http.ts | Contract (loopback HTTP MCP server) | HTTP framing detail | src/server/kanna-mcp-http.ts |
| src/server/kanna-mcp-tools/**/*.ts | Contract (each shim implements one MCP tool) | Per-tool argument shape | src/server/kanna-mcp-tools/ |
| src/server/tool-callback.ts | Contract (durable approval protocol) | Persistence backend detail | src/server/tool-callback.ts |
| src/server/permission-gate.ts | Contract (path deny enforcement) | Allow-list detail | src/server/permission-gate.ts |
| src/server/claude-pty/channel-notification.ts | Contract (channel notification push) | Payload builder shape | src/server/claude-pty/channel-notification.ts |
