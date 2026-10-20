---
id: adr-20261016-remote-mcp-provenance-and-progress
c3-seal: 5df4769ba86bbf3124ff754beae23df552d19d4fc96278179b73d8bb8d7f9a9d
title: remote-mcp-provenance-and-progress
type: adr
goal: Make every message that reaches Kanna through the remote MCP endpoint attributable, followable and safe to retry. A command dispatched by an MCP tool carries a server-stamped origin into the queue, the transcript and the board actor; every tool call lands in a durable audit log; long turns are followed with progress and a wait_for_chat tool instead of one silent blocking call; and an identical request that is already running is never dispatched twice.
status: done
date: "2026-10-16"
---

## Goal

Make every message that reaches Kanna through the remote MCP endpoint attributable, followable and safe to retry. A command dispatched by an MCP tool carries a server-stamped origin into the queue, the transcript and the board actor; every tool call lands in a durable audit log; long turns are followed with progress and a wait_for_chat tool instead of one silent blocking call; and an identical request that is already running is never dispatched twice.

## Context

On 2026-10-16 a ChatGPT user's send_message started chat 8a6f06b1, the 120 second wait expired with no useful answer, and two identical send_message calls then created chats 1bde4c85 and 2c92895b. Three gaps combined. There was no provenance: a message sent over MCP was indistinguishable from one typed in the web UI, and no durable record of tool calls existed, so the duplicates could not be debugged. There was no feedback: send_message blocked up to 120 seconds, answered once at the end, and sent no byte meanwhile; Bun.serve was started without idleTimeout, so its 10 second default closes a silent response, and a Cloudflare tunnel closes one at 125 seconds. And there was no idempotency: a send without chatId always created a chat, and a retry to a busy chat queued a duplicate. Remote board writes were also attributed to the human, so they bypassed the agent_push_disabled hold in board-sync.

## Decision

Origin is a server-stamped fact, not a client claim. The tool registrar builds a RemoteMcpOrigin per call (client id, optional client name from the per-request envelope, via oauth or password, tool, call id) and runs the handler inside an AsyncLocalStorage scope; the runtime wraps dispatchCommand to pass that origin to router.dispatchCommand, which sets it on its synthetic connection. routeCommand is the single stamp point: chat.send and message.enqueue take origin from the connection, and a connection with none (every browser socket) has any client-supplied origin removed. The origin flows through sendCommand, enqueueMessage, QueuedChatMessage and startTurnForChat into UserPromptEntry and is withheld from share snapshots. The same origin becomes a remote_mcp CardActor on board writes, held from tracker push like an agent write unless the binding allows agent pushes. Every registered tool call appends one redacted JSON line to remote-mcp-calls.jsonl in the data directory through the StorageBackend port, with rotation, plus a log line and a kanna.remote_mcp.tool_call counter keyed by tool, outcome and via. Following a turn is one poll implementation (followChat) shared by send_message and the new wait_for_chat; it understands queued messages, honours the request AbortSignal, emits notifications/progress when the client sent a progressToken, and returns done, a cursor and a next instruction that forbids resending. A wait is capped at 100 seconds unless the connection streams (legacy era or progress token), and /mcp requests ask Bun for a 130 second idle timeout. A dedupe store created once per runtime remembers each request for 30 minutes by idempotency key or by client, destination and content hash, and a repeat of a request whose chat is still working follows the original instead of dispatching again. The server also publishes usage instructions to clients.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-242 | component | Owns the tool registrar, audit log, follow loop, dedupe store, instructions and the idle timeout hold for /mcp | c3-242#n13632@v1:sha256:2fcdb8f835e6aba967fd840e435befe498b44c98d89f0ec97900c9af8e388f05 | Purpose, Foundational Flow commands row, Typed intent tools row and new Contract and Change Safety rows rewritten by this unit |
| c3-208 | component | routeCommand stamps or strips origin and dispatchCommand accepts the caller origin | c3-208#n14892@v1:sha256:c1660f4ad438b970174d5bb2188ac27813e5cb85fe5e59fe88d2c67b8df5d097 | A Contract row records the trust boundary |
| c3-232 | component | Board writes from MCP are attributed to a remote_mcp actor and held like agent writes | c3-232#n13133@v1:sha256:c53eedce79b540f17127cf6872961d5620340c8702f71ca5f6404bfde6e5bbef | The Silent tracker close row now names the remote_mcp actor |

## Compliance Refs

| Ref | Why required | Evidence | Action |
| --- | --- | --- | --- |
| ref-strong-typing | The origin, audit record and dedupe records are typed; the registrar re-parses arguments through the zod schema instead of casting | ref-strong-typing#n14175@v1:sha256:390cd8fee6d22c17530c1b9551d02cbd40ea33c56574b7ebc313f21961a707af | comply |

## Compliance Rules

| Rule | Why required | Evidence | Action |
| --- | --- | --- | --- |
| rule-colocated-bun-test | Each new module has a colocated test and the behaviour is also proven against a real server and the real MCP SDK clients of both eras | rule-colocated-bun-test#n14307@v1:sha256:ce58e026c1076cb18ede38f3a4bd73793f28bf1392d299399571ba446985623f | comply |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| Origin type and stamp | CommandOrigin, the pure stampCommandOrigin, ClientState.commandOrigin and dispatchCommand origin parameter | src/shared/command-origin.ts, src/server/command-origin-stamp.ts, src/server/ws-router.ts |
| Carry-through | origin on QueuedChatMessage, UserPromptEntry, StartTurnForChatArgs and the enqueue and send paths | src/server/claude-send-command.ts, src/server/claude-turn-starter.ts |
| Registrar and audit | ToolRegistrar over McpServer, call scope, audit record builder and storage-backed log | src/server/remote-mcp/remote-mcp-tool-registrar.ts, remote-mcp-audit.ts, remote-mcp-audit-log.ts |
| Follow and dedupe | followChat, wait_for_chat, wait limit, next-step text, dedupe store and send guard | src/server/remote-mcp/send-and-wait.ts, remote-mcp-follow.ts, remote-mcp-follow-view.ts, remote-mcp-dedupe.ts, remote-mcp-send-guard.ts |
| Boards | remote_mcp CardActor, decode, label and the board-sync hold | src/shared/boards/actor.ts, src/server/board-sync.ts |
| UI | UserMessage renders the origin line | src/client/components/messages/UserMessage.tsx |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| Router origin tests | A browser socket cannot label its message; a dispatched origin reaches the agent | src/server/ws-router.test.ts |
| Guard tests | A retried identical request is not dispatched while the first runs; an idempotency key returns the recorded chat | src/server/remote-mcp/remote-mcp-send-guard.test.ts |
| Real-server tests | The prompt carries its origin, the audit file holds one redacted record per call, progress notifications reach clients of both eras | src/server/remote-mcp/remote-mcp-tools.test.ts, src/server/remote-mcp/remote-mcp-http-routes.test.ts |
| Board hold test | A remote_mcp edit is held unless the binding allows agent pushes | src/server/board-sync.test.ts |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Let the client send its own origin in the command | A browser or a forged kanna_command parameter could then label a message as MCP; only the server knows the caller, so the router stamps and strips |
| Thread the origin through every tool as a parameter | Every typed tool calls dispatchCommand through shared helpers; an AsyncLocalStorage scope set once by the registrar reaches all of them without changing a signature |
| Keep one blocking send_message and raise the timeouts | A silent response is closed by Bun after 10 seconds and by a tunnel after 125, and the caller still gets no way to follow a long turn |
| Dedupe in the per-request McpServer | createMcpHandler builds a fresh server per request, so state there is lost; the store lives in the runtime |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| A legitimate repeat of an identical prompt is suppressed | Suppression applies only while the earlier turn or queued copy is still in flight, and an idempotency key is the explicit way to say two calls are one request | bun run test src/server/remote-mcp/remote-mcp-send-guard.test.ts |
| The audit log grows without bound or blocks a tool | One file rotates to .1 at 10 MiB and writes are queued and never throw into the tool | bun run test src/server/remote-mcp/remote-mcp-audit-log.test.ts |
| A held-open request exhausts connections | The hold is 130 seconds and only for requests that passed bearer verification | bun run test src/server/remote-mcp/remote-mcp-http-routes.test.ts |

## Verification

| Check | Result |
| --- | --- |
| bun run test src/server/remote-mcp/ | all pass, including the progress test for both protocol eras |
| bun run typecheck | clean |
| bun run lint | clean |
| bun run check:arch | pass |
