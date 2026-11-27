---
id: c3-226
c3-seal: 1756cd4f7a3bd741a09afbdc06c854d2c2064f0d68b249bd7325d0a1f9618668
title: kanna-mcp-host
type: component
category: feature
parent: c3-2
goal: |-
    Host the in-process MCP server that the Claude session attaches
    to its query, publish the mcp__kanna__* tool surface, and run the
    durable approval protocol that gates beacon tool calls before any
    side-effect runs.
uses:
    - ref-local-first-data
    - ref-strong-typing
    - ref-tool-hydration
    - rule-colocated-bun-test
    - rule-strong-typing
---

# kanna-mcp-host

## Goal

Host the in-process MCP server that the Claude session attaches
to its query, publish the mcp__kanna__* tool surface, and run the
durable approval protocol that gates beacon tool calls before any
side-effect runs.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-2 (server) |
| Parent Goal Slice | "Drive multi-provider agent turns through a single coordinator" — supplies the MCP host every Claude session attaches to |
| Category | feature |
| Lifecycle | One in-process MCP server instance per Claude session, built by createKannaMcpServer and passed to the SDK in options.mcpServers by the agent coordinator |
| Replaceability | Replaceable while the tool-call envelope, durable approval protocol, and mcp__kanna__* tool surface are preserved |

## Purpose

Owns the Kanna MCP host runtime: builds the in-process SDK MCP server
(`createSdkMcpServer`, no HTTP endpoint) that publishes `mcp__kanna__*`
tools, and runs the durable approval protocol (`tool-callback.ts`, decided by
`permission-gate.ts`) that every beacon tool call submits to before it
runs. The model's native `AskUserQuestion` and `ExitPlanMode` do not use
this protocol: they reach the UI through `canUseTool` → `onToolRequest` →
`PendingToolSlots` and are answered by `respondTool` (c3-210). The host
ships no file or shell shims; native built-ins do reads and writes.
Non-goals: turn orchestration (c3-210), Codex App Server (c3-211),
provider/model normalization (c3-212).

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Precondition | startClaudeSession builds the in-process Kanna MCP server and passes it in options.mcpServers beside the user's custom MCP servers | c3-210 |
| Input — tool call | Claude (or Codex) issues an mcp__kanna__* tool call through MCP transport | c3-210 |
| State — pending request | Each beacon tool call that policy routes to ask registers a durable pending record in tool-callback.ts; it replays on reconnect as pending_tool_request and is fail-closed as session_closed on server restart | c3-205 |
| Live broadcast | createToolCallbackService fires onStateChange(chatId) after every persisted state change; server.ts wires this to router.scheduleChatStateBroadcast so the UI sees the new pending the moment the model emits the call (no longer waiting for an unrelated event to flush the read model) | c3-208 |
| Shared dep — event store | Pending and resolved tool requests append events to the JSONL log | c3-206 |
| Shared dep — paths-config | readPathDeny / writePathDeny resolved against ~/.kanna/data and project roots | c3-204 |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Outcome | Beacon tool calls run only after the durable approval protocol allows them, with the same approval card whether the request is answered from the browser or the remote MCP answer_tool_request tool | c3-210 |
| Primary path | Beacon tool call → permission-gate verdict (beacon scope, per-run allowed roots) → durable approval when the verdict is ask → execute → return MCP result | c3-205 |
| Failure — chat cancelled / chat deleted | ws-router's chat.cancel and chat.delete handlers call cancelAllForChat(chatId, reason), resolving every open ask-style record as {kind:"deny", canceled:<reason>}. Replaces the prior session-close cascade which mis-fired on transparent rotation/sweep respawns. | c3-208 |
| Failure — server restart | recoverOnStartup() fail-closes every still-pending record as session_closed so no MCP turn hangs forever across reboots; no wall-clock timeout fires while the server is running | c3-206 |

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-tool-hydration | ref | MCP tool envelopes still normalize through src/shared/tools.ts before the UI renders them | must follow | shims share the same hydration path as native tool calls |
| ref-local-first-data | ref | Pending records persist under ~/.kanna/data; the MCP server is in-process and opens no port | must follow | path-deny defaults block leaving project root |
| ref-strong-typing | ref | Every mcp__kanna__* tool arg/result has a named type at the MCP boundary | must follow | rule-strong-typing applies |
| rule-strong-typing | rule | No any/unknown at the MCP envelope or path-deny surface | wired compliance target | enforces typed inputs across the host |
| rule-colocated-bun-test | rule | Every kanna-mcp-tools module has a colocated <name>.test.ts next to its source | wired compliance target | applies to all of kanna-mcp-tools/** |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| mcp__kanna__* tool surface | OUT | Set of MCP tools published to Claude/Codex; envelope matches MCP spec; no feature flag selects the set and no file or shell shims are registered | c3-210 | src/server/kanna-mcp.ts |
| In-process MCP server | IN | createKannaMcpServer builds an SDK MCP server that startClaudeSession passes in options.mcpServers beside the user's custom servers; there is no HTTP endpoint and no port | c3-210 | src/server/kanna-mcp.ts |
| Durable approval protocol | IN/OUT | Register pending request, push to UI, await resolution; pendings survive process restart and replay as pending_tool_request entries. Surface methods: submit, answer, cancel, cancelAllForChat, recoverOnStartup. createToolCallbackService accepts an onStateChange(chatId) hook fired after every persisted state change inside submit's persistPut and answer/cancel/cancelAllForChat's persistResolve; server.ts wires this to router.scheduleChatStateBroadcast so the UI receives pending_tool_request the same tick the model emits the tool_use. Pendings resolve through three explicit paths: user answer, ws-router cancelAllForChat triggered by chat.cancel and chat.delete, or recoverOnStartup fail-close on server boot. | c3-208 | src/server/tool-callback.ts |
| Path deny enforcement | IN | permission-gate.policy.evaluate decides each durable approval before the tool runs: beacon scope rules, readPathDeny and writePathDeny, layered with per-run KannaMcpArgs.restrictedAllowedPaths so a folder-restricted subagent auto-denies any path resolving outside its allowed roots BEFORE the chat-level deny check (isInsideAny from path-containment.ts) | c3-204 | src/server/permission-gate.ts |
| delegate_subagent keep_alive param | OUT | keep_alive boolean on delegate_subagent. When true and the target is a Claude subagent, the run stays live and the reply text carries the live run_id; non-claude targets return isError. Routes to c3-210 delegateRun with keepAlive | c3-210 | src/server/kanna-mcp.ts, src/server/kanna-mcp-tools/delegate-subagent.ts |
| send_subagent_message tool | OUT | Takes run_id plus prompt, drives one follow-up turn into a live keep-alive session, blocks until that turn finishes, returns the subagent reply text or isError NO_LIVE_SESSION. Routes to c3-210 sendToLiveRun | c3-210 | src/server/kanna-mcp.ts |
| close_subagent tool | OUT | Takes run_id, closes a live keep-alive session and frees its process. Routes to c3-210 closeLiveRun | c3-210 | src/server/kanna-mcp.ts |
| Per-run path-deny scope | IN | KannaMcpArgs.restrictedAllowedPaths threads through the kanna-mcp host into the beacon approval context and onto ToolCallbackSubmitArgs / EvaluateArgs; permission-gate.policy.evaluate auto-denies any path resolving outside the listed roots; lifetime is the subagent run (cleared with the spawn) | c3-210 | src/server/kanna-mcp.ts, src/server/permission-gate.ts, src/server/tool-callback.ts |
| preview_file tool | OUT | Takes a path argument (and a label to title the card); resolveWorkspaceFile applies the same path-safety as offer_download, infers MIME via inferAttachmentContentType, and gates on isPreviewableMime (accepts text/, image/, audio/, video/, application/json, application/pdf after stripping mime params; rejects others with a "use offer_download" hint). Builds the content URL via buildLocalFileContentUrl (/api/local-file?path=<abs>) so files written in a worktree chat resolve — NOT the project-scoped URL. Returns a {kind:"file_preview", contentUrl, relativePath, fileName, displayName, size, mimeType} result that hydrates through c3-303 into a tap-to-open preview card (FilePreviewSheet, origin=preview_file, Share only, no download). Read-only: does not touch the durable approval protocol | c3-303 | src/server/kanna-mcp.ts, src/server/uploads.ts |
| validate_mermaid tool | OUT | Takes one source (a diagram without its ``` fence) and answers VALID, or isError: true carrying the offending line, mermaid's caret excerpt and an actionable hint (formatMermaidDefect). isError is deliberate — it is what makes the model treat the reply as work to redo rather than a note. Registered by buildValidateMermaidToolList whenever a chatId is present, so subagents get it too; one tool() call registers it on the in-process server. Backed by KannaMcpArgs.parseMermaid, defaulting to mermaid-parse.adapter.ts — the only server module that loads mermaid, which installs a measured-minimum DOM shim ONLY around await import("mermaid") and restores it in a finally, standing down entirely when a real document already exists. Read-only: does not touch the durable approval protocol | c3-114 | src/server/kanna-mcp.ts, src/server/mermaid-parse.adapter.ts, src/shared/mermaid-validate.ts |
| validate_cron + arm_cron tools | OUT | validate_cron takes a complete /cron line and returns the schedule in words plus its next three fire times, or isError with the failing part; arm_cron schedules one. Both answer from c3-233 previewCronCommand so they cannot disagree. validate_cron gates on a chat alone; arm_cron additionally needs the injected armCron capability, supplied for main chats only (delegationContext.depth === 0) like setup_loop — a subagent chat must not leave recurring work behind | c3-233 | src/server/kanna-mcp.ts, src/server/kanna-mcp.test.ts |
| MCP skill host | IN/OUT | McpSkillHost is the single owner of MCP-served skill state: a registry keyed by server id and skill URI, filled by skills/list through a pooled SDK 2.x client per server wrapped in SkillsClient (stdio, http and sse; ws reports skills need http, sse or stdio) over the servers createCustomMcpServerResolver returns with skills not false. Each listing is cached for the server ttlMs clamped to 60 s to 10 min (default 5 min) and refreshed at boot, on a customMcpServers change and lazily on expiry; roster waits for an in-flight refresh at most 3 s and then returns the cache, so a slow server never blocks a spawn. Nothing is persisted. The qualified name is server:name, the skill path when two skills on one server share a name, and mcp:server:name when it collides with a local name, so an MCP skill never shadows a local one | c3-210 | src/server/mcp-skills/mcp-skill-host.ts, src/server/mcp-skills/mcp-skill-client.adapter.ts, src/server/mcp-skills/mcp-skills-boot.ts |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| Path-deny bypass | Edit lets a beacon tool run without its permission-gate verdict, or drops restrictedAllowedPaths from the approval context | Add a deny-rule test; grep kanna-mcp-beacon.ts for a run path that skips authorize | bun test src/server/permission-gate.test.ts |
| Durable approval drift | Edit adds a tool that needs approval but forgets to submit it to the protocol | tool-callback.test.ts and kanna-mcp-beacon tests assert submit, answer and deny round-trips | bun test src/server/tool-callback.test.ts |
| Live broadcast missing on new pending — UI never shows the prompt | createToolCallbackService called without onStateChange, or persistPut/persistResolve refactored to skip the notify(chatId) hook | tool-callback.test.ts asserts 6 events for submit/answer/cancel/cancelAllForChat sequence, and zero events for auto-allow/auto-deny | bun test src/server/tool-callback.test.ts |
| Session-close cancel cascade re-introduced — denies asks mid-rotation | A future edit re-adds args.toolCallback.cancelAllForSession in makeClaudeSessionHandle.close, or any equivalent close()-side cancel call | grep for cancelAllForSession in src/ returns hits, or oauth-rotation tests show pendings denied mid-turn | bun test src/server/agent.test.ts (oauth-rotation suite); grep -r cancelAllForSession src/ |
| Pending leak — model crashes mid-tool_use with no cancel path | recoverOnStartup not run on boot (initToolCallbackOnBoot replaced with createToolCallbackService) | boot.test.ts asserts recoverOnStartup is called before service is returned | bun test src/server/boot.test.ts |
| Mermaid validation silently disabled — the DOM shim stops satisfying mermaid | A mermaid upgrade changes what DOMPurify or initialize touch, or the shim is "simplified"; every parse then throws and every diagram reads as valid | Under bun test the happy-dom preload masks a broken shim entirely, so the adapter suite drives a SUBPROCESS with no happy-dom and asserts both verdicts plus zero leaked globals | bun test --conditions production src/server/mermaid-parse.adapter.test.ts |
| MCP skill content trusted or unverified | An edit lets read\_resource read a URI outside a loaded skill's manifest, skips SkillsClient.read verification, lets a dot or dot-dot segment pass the root check, or lets an MCP skill take a local name | mcp-skill-host.test.ts asserts a tampered SKILL.md and supporting file are refused, a read before load, another server and %2e%2E escapes fail, and a colliding name is prefixed mcp: | bun run test src/server/mcp-skills/ |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| src/server/kanna-mcp.ts | Contract (mcp__kanna__* tool surface) | Tool registration order | src/server/kanna-mcp.ts |
| src/server/kanna-mcp-tools/**/*.ts | Contract (each module implements one MCP tool) | Per-tool argument shape | src/server/kanna-mcp-tools/ |
| src/server/tool-callback.ts | Contract (durable approval protocol) | Persistence backend detail | src/server/tool-callback.ts |
| src/server/permission-gate.ts | Contract (path deny enforcement) | Allow-list detail | src/server/permission-gate.ts |
| src/server/mcp-skills/\*\*/\*.ts | Contract (MCP skill host) | Fake port and clock in tests | src/server/mcp-skills/ |
