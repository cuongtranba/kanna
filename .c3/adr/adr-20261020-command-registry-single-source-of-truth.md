---
id: adr-20261020-command-registry-single-source-of-truth
c3-seal: 227a43ddb376d0a37e4e87065c7e81a2fed6c0a573b08b473a2621d9f6dd5196
title: command-registry-single-source-of-truth
type: adr
goal: Record the decision to make a command registry in src/shared/commands the single source of truth for every WebSocket command that the browser and the remote MCP server dispatch. One defineCommand entry per command carries its zod params, summary, risk and remote policy. The ClientCommand union is derived from the registry, parseClientCommand validates a command with the same schema at the WS router and at kanna_command, and kanna_commands publishes a JSON Schema of each command's params.
status: proposed
date: "2026-10-20"
---

## Goal

Record the decision to make a command registry in src/shared/commands the single source of truth for every WebSocket command that the browser and the remote MCP server dispatch. One defineCommand entry per command carries its zod params, summary, risk and remote policy. The ClientCommand union is derived from the registry, parseClientCommand validates a command with the same schema at the WS router and at kanna_command, and kanna_commands publishes a JSON Schema of each command's params.

## Context

The command surface was described four times and only the names were checked. The ClientCommand union in protocol.ts held 153 types, COMMAND_CATALOG in remote-mcp held the summaries, a free-text params string and a risk per command, and two tests compared the names with regular expressions over source text. Nothing validated params at runtime: the WS router cast the decoded envelope and kanna_command spread arbitrary JSON into a command. The risk value unavailable marked twelve commands that MCP refuses, push.* and chat.setDraftProtection and webhooks.*, and gave no reason in code. A malformed command therefore reached its handler, and ws-router-service-bus handled every serviceBus.* type by resetting the store.

## Decision

Each command is declared once with defineCommand(type, spec) in a per-domain file under src/shared/commands and the index assembles them. The spec holds a zod object for the params without the type field, a summary, a risk of read, write, destructive or local, and a remote policy that is either allowed or excluded with a required reason. The domain is the part of the type before the first dot. defineCommand extends the params with the type literal, so ClientCommand is the output type of that union of schemas and adding a command means adding one entry. The output type is used, not the input type, because the MCP SDK OAuth schemas inside the settings patch coerce and transform values; for every other schema the two are identical. Nested domain types get named schemas in a schema.ts file beside the owning type, and a compile-time assertParity check between each schema and its type fails the build when either drifts, including an optional field the schema lacks. parseClientCommand returns the typed command or an error naming the command and the failing path. The WS router calls it before origin stamping and answers an error envelope for the same id on failure, kanna_command calls it after refusing an excluded command with that command's reason, and unknown keys are stripped. kanna_commands lists type, domain, summary, risk, remote policy and params as a JSON Schema from z.toJSONSchema. command-catalog.ts is deleted and the serviceBus handler now matches serviceBus.resetStore exactly.

## Results

Every command declares the shape of its ack result. defineCommand requires a result zod schema, so a command cannot ship without one, and CommandResult of a command is the output type of that schema. A command that acks with nothing declares noResult, a shared z.undefined(). ackResult has two forms: ackResult(id, command, result) takes the CommandResult of the command being answered, and ackResult(id, command) compiles only for a command declared with noResult, so a handler returning another shape, or a result for a command that has none, fails to compile. In JSON Schema noResult renders as an object with only a description and a not clause of an empty schema, which matches no value and so says the result key is absent; the description adds that the remote MCP server reports such an ack as {"ok":true}. kanna_commands therefore lists a resultSchema for every command.

KannaSocket.command is generic over the command it is given: command(command) resolves to the result type its registry entry declares. The overload that took an explicit type argument is gone from the socket and from the CommandPort, so a cast of a reply is no longer expressible, and the untyped-command-results budget that counted those casts is deleted. The ack envelope's result is the union of every command's result type, which replaced the loose CommandAckResult; egress redaction now drops an ack of a settings or LLM provider command that is not the snapshot it expects instead of re-serialising it as JSON.

The client never parses a result at runtime, since transcripts and history pages are hot paths. The schema is the type source and the server enforces it. TranscriptEntry, its tool calls and ChatHistoryPage have schemas in transcript-types.schema.ts and tool-call-types.schema.ts that the client only reads as types. A TypeScript type that already exists for a result is tied to its schema by assertParity, and a type that only the server used (the board sync summaries, the card page, the worktree cleanup outcome, the inbox page, the Claude import counts) is now derived from the schema. The GitHub release payload behind settings.getChangelog has a schema that covers only the fields the client reads. A runtime parse in the production ack path was rejected because the compile-time check already covers every handler that goes through ackResult and a JSON round trip would cost every command.

The one handler that does not use ackResult is backgroundTasks.getOutput, which replies with a snapshot envelope of type background-task-output instead of an ack. Its schema describes that snapshot, a parity check ties it to ServerSnapshot, and the remote MCP server returns the same JSON. The typed domains were migrated in four steps: git and diff, settings and system, project, session, stack, terminal, skill and package, and then chat, message, cron, workflow, generative UI, board, share, push, inbox and webhook. Behavioural tests dispatch real commands through dispatchCommand over temporary repositories, in-memory stores and the shared webhook harness, and require each ack to parse with the registry schema. Client call sites whose asserted type disagreed with the reply were fixed: chat.send always returns a chatId, terminal.create never returns null, and the board pull reply carries the queued count and the per-binding results.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-302 | component | Owns the shared command registry, the schema files and the derived ClientCommand type | c3-302#n14332@v1:sha256:18df2cce3d5da782a2f726f49907832043b65687adc8e43a7f3f06e26de19f9d | protocol.ts imports the registry as a type only so the client bundle does not gain zod; no any, unknown or casts |
| c3-208 | component | Validates every WS command before dispatch and before origin stamping | c3-208#n12173@v1:sha256:0a88c8f3f4316e1806f5f5ab5e45b217d578ef26131e68c411ba10c8de9f8703 | The router test drives a malformed command over handleMessage |
| c3-242 | component | kanna_command validates with the registry and refuses excluded commands with their reason, kanna_commands returns JSON Schemas | c3-242#n13968@v1:sha256:bc58ee0aa10b303c27ad164572d0daa581311cc926d2c72a0c991f50a8ae2a4d | The remote tools test runs against a real server and the real MCP SDK |

## Compliance Refs

| Ref | Why required | Evidence | Action |
| --- | --- | --- | --- |
| ref-strong-typing | Schemas replace casts and the unknown keyword at the command boundary | ref-strong-typing#n15039@v1:sha256:2e46bc7d3b135006d0378a5f1830e9494750682f5a3e1570a696c2bc8d291c82 "TypeScript strict mode; shared types in src/shared/types.ts; protocol envelopes in src/shared/protocol.ts; events in src/server/events.ts." | comply |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Keep the hand-written union and add a bidirectional assignability check per command | Adding a command still means editing the union, the catalog and the check, which is three places instead of one |
| A keyed record of definitions with the type as the key | Pairing a runtime key with its schema output needs a cast; a list of entries that carry their own type literal types without one |
| Reject unknown keys | A client that sends an extra field would break; the handlers only read declared fields, so stripping is safe and matches zod default behaviour |

## Verification

| Check | Result |
| --- | --- |
| bun run typecheck | Passes |
| bun run lint and bun run lint:comments | Pass |
| bun run check:arch | Passes |
| bun run test | Passes |
| c3x check | Exits ok with no new issues |
