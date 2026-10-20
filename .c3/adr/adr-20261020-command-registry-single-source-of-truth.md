---
id: adr-20261020-command-registry-single-source-of-truth
c3-seal: 6305078cfa01de5f5286a3c2471354c1b51f0360ad7df7c45eccab258ffa34e1
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

A command may also declare the shape of its ack result. defineCommand takes an optional result zod schema, and CommandResult of a command is the output type of that schema, or CommandAckResult for a command that declares none, so a command is migrated one at a time and the rest keep compiling. KannaSocket.command is generic over the command it is given: command(command) resolves to the result type its registry entry declares, and the client falls back to JsonValue for an undeclared one because the value crossed a JSON wire. The form of command that takes an explicit type argument stays as an overload until the last such call is gone, and the untyped-command-results budget counts what is left.

The client never parses a result at runtime, since transcripts and history pages are hot paths. The schema is the type source and the server enforces it. A handler sends its ack through ackResult in ws-router-ack.ts, whose result parameter is the CommandResult of the command being answered, so a handler returning a different shape fails to compile. A TypeScript type that already exists for a result is tied to its schema by assertParity, and a type that only the server used is now derived from the schema. A behavioural test dispatches real git commands through dispatchCommand over a temporary repository and requires each ack to parse with the schema in the registry. A runtime parse in the production ack path was rejected because the compile-time check already covers every handler that goes through ackResult and a JSON round trip would cost every command.

kanna_commands lists a resultSchema, rendered from the output side of the schema, for each command that declares one and omits it for the rest. The git and diff domain is the pilot: chat.initGit, chat.getGitHubPublishInfo, chat.checkGitHubRepoAvailability, chat.publishToGitHub, chat.listBranches, chat.previewMergeBranch, chat.mergeBranch, chat.syncBranch, chat.checkoutBranch, chat.createBranch, chat.generateCommitMessage, chat.commitDiffs, chat.discardDiffFile, chat.ignoreDiffFile and project.readDiffPatch. chat.refreshDiffs acks without a result and has no slot.

The settings and system domain is the second: settings.readKeybindings, settings.writeKeybindings, settings.readAppSettings, settings.writeAppSettings, settings.writeAppSettingsPatch, appSettings.setCloudflareTunnel, appSettings.setClaudeAuth, appSettings.testOAuthToken, settings.readLlmProvider, settings.writeLlmProvider, settings.validateLlmProvider, settings.listOpenRouterModels, settings.getChangelog, settings.testMcpServer, settings.startMcpOAuth, settings.completeMcpOAuth, subagent.create, subagent.update, subagent.delete, update.check, update.install, update.reload, beacons.mintPairingCode and beacons.update. AppSettingsSnapshot, KeybindingsSnapshot, LlmProviderSnapshot and every type nested in them are tied to their schemas by assertParity. The getChangelog schema covers only the release fields the client reads, because the payload is GitHub's. system.ping and system.openExternal ack without a result.

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
