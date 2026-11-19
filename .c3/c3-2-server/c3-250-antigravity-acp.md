---
id: c3-250
c3-seal: 91e3a9e99806ef1bb46cf1c5b0d8f6f10cf3bc2fbcd1666f80dab2ee9f1ec20c
title: antigravity-acp
type: component
category: feature
parent: c3-2
goal: 'Drive Google''s agy CLI over the Agent Client Protocol on stdio: boot, run turns, translate ACP session updates into coordinator-friendly transcript entries, and expose Kanna''s peer tools to agy through a token-gated loopback MCP endpoint.'
uses:
    - ref-provider-adapter
    - ref-side-effect-adapter
    - ref-strong-typing
    - rule-strong-typing
---

## Goal

Drive Google's agy CLI over the Agent Client Protocol on stdio: boot, run turns, translate ACP session updates into coordinator-friendly transcript entries, and expose Kanna's peer tools to agy through a token-gated loopback MCP endpoint.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-2 (server) |
| Parent Goal Slice | "Provide an Antigravity provider implementation behind the adapter" |
| Category | feature |
| Lifecycle | One agy acp child process per chat or subagent run scope, spawned on the first Antigravity turn and reused until stopSession, a cwd change or process exit |
| Replaceability | Replaceable provided the ACP JSON-RPC contract and the adapter-shaped turn stream are preserved |

## Purpose

Spawns agy acp with --dangerously-skip-permissions, speaks Agent Client Protocol over stdio, and maps session/update notifications onto the transcript entries and tool requests the coordinator already consumes for Claude and Codex. Also owns the AgentToolsBridge HTTP surface that serves list_peer_chats, send_chat_message and wait_for_chat_message to agy. Non-goals: turn orchestration, transcript persistence, queueing and the peer messaging rules themselves, which live in c3-210 and c3-249.

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Precondition | agy v1.5.9 or newer is on PATH and logged in; Kanna never injects credentials | c3-2 |
| Input — stdio port | StdioProcess is the child-process port shared with the Codex driver; only antigravity-spawn.adapter.ts touches child\_process | c3-209 |
| Input — protocol | Typed ACP envelopes decoded with JsonValue narrowing, no casts | c3-301 |
| Initialization | Lazy spawn on the first Antigravity turn; session/new carries developer instructions in \_meta.antigravity.systemPrompt.append; session/new and session/resume mcpServers carry every enabled custom MCP server from the injected ResolveCustomMcpServers port (stdio and http only, every scope), followed by the agent-tools bridge grant for a main scope only (see adr-20261119-custom-mcp-for-codex-and-antigravity) | c3-210 |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Outcome | Antigravity turns flow through the same coordinator path as Claude and Codex | c3-210 |
| Primary path | session/resume with a stored token, falling back to session/new when agy no longer has the session; model and thinking level go through session/set\_config\_option; session/prompt streams session/update notifications into entries | c3-210 |
| Alternate — plan mode | session/set\_mode enters plan mode; the write\_file artifact whose ArtifactMetadata.RequestFeedback is true is the plan document and is proposed through ExitPlanMode | c3-210 |
| Alternate — cancel | session/cancel ends the running turn with a cancelled result | c3-210 |
| Alternate — compaction | agy compacts natively, so /compact is passed through as a prompt instead of a Kanna-driven summary (providerCompactsNatively) | c3-210 |
| Alternate — no fork, no steer | A fork starts a new session and the protocol has no steer request, so peer messages and queued messages wait for the turn to end | c3-249 |
| Failure — child crash | The session is closed, its bearer grant revoked and an error result is surfaced | c3-209 |

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-provider-adapter | ref | Adapter sits behind the coordinator | must follow | No direct UI imports |
| ref-side-effect-adapter | ref | The only child\_process import is antigravity-spawn.adapter.ts | must follow | The manager takes the spawn function as an injected port |
| ref-strong-typing | ref | Typed ACP envelopes | must follow | No any, no casts |
| rule-strong-typing | rule | Compliance target added by c3x wire | wired compliance target beats uncited local prose | Added by c3x wire for explicit compliance review |
| adr-20261117-antigravity-acp-provider | adr | Why ACP over stdio, auto-approve parity and the loopback MCP bridge | decision record | Read before changing the spawn flags or the bridge |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| startSession and startTurn | OUT | Streams adapter-shaped transcript entries and tool requests for a chat or a sub:runId scope | c3-210 | src/server/antigravity-acp.ts |
| Approvals | IN | agy is started with --dangerously-skip-permissions so permission requests never reach Kanna, matching Codex approvalPolicy never | The user's trust is the chat's cwd | src/server/antigravity-spawn.adapter.ts |
| AGENT\_TOOLS\_MCP\_PATH /agent-tools/mcp | IN | POST only JSON-RPC over HTTP; a random 32 byte bearer per main session maps to its chat id; only direct loopback requests with none of Origin, Forwarded, X-Forwarded-For, X-Forwarded-Host, X-Real-IP or CF-Connecting-IP; 403 for non-direct requests, 405 for non-POST, 401 for a missing, unknown or revoked bearer, 404 for the OAuth discovery path | Mounted in c3-202 after remote MCP; the bearer is revoked on stopSession and on failure; subagent scopes get no grant | src/server/agent-tools-bridge.ts |
| Tool outcomes | OUT | The outcome of each bridged call is recorded as the tool\_result of the matching agy tool call, because agy reports none, including when the HTTP call arrives before the ACP tool\_call | The transcript entry pairing stays in the manager | src/server/antigravity-acp.ts |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| ACP envelope drift | agy CLI upgrade | Decode errors at runtime and the fake-process tests | bun run test src/server/antigravity-acp.test.ts |
| Bridge reachable from outside | A change to the loopback or header checks or to bearer lifetime | Bridge tests for 401, 403 and 405 and for revocation on stopSession | bun run test src/server/agent-tools-bridge.test.ts |
| Child leak | Cancel or failure skips the kill path | Antigravity children accumulate | src/server/antigravity-acp.ts |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| src/server/antigravity-acp.ts | c3-250 Contract | ACP request detail | src/server/antigravity-acp.ts |
| src/server/agent-tools-bridge.ts | c3-250 Contract | The security constraints in the Contract row for AGENT\_TOOLS\_MCP\_PATH must survive | src/server/agent-tools-bridge.ts |
| wiki/src/content/docs/features/providers-models.mdx | c3-250 Contract | Wording is free; the prerequisites, the auto-approve note and the limitations must survive | wiki/src/content/docs/features/providers-models.mdx |
