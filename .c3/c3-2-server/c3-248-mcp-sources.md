---
id: c3-248
c3-seal: ff7949cda8ff435c6fcf4ed95ec05119957c49e7c6885259aec68d59f7907d63
title: mcp-sources
type: component
category: feature
parent: c3-2
goal: Let Kanna itself hold a long-lived connection to a user-configured MCP server and turn the messages that server exposes, by resource subscription or by polling a list tool, into inbox threads, so a conversation that happens on another service reaches the user and their agent without the model having to poll.
uses:
    - ref-provider-adapter
    - ref-side-effect-adapter
    - ref-strong-typing
---

## Goal

Let Kanna itself hold a long-lived connection to a user-configured MCP server and turn the messages that server exposes, by resource subscription or by polling a list tool, into inbox threads, so a conversation that happens on another service reaches the user and their agent without the model having to poll.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-2 Server |
| Runtime | In-process. startMcpSources builds one McpSourceRunner over the sources in settings; each enabled source owns one client connection and one loop; cursors and dedupe keys persist in mcp-source-cursors.json under the data dir. |
| Consumers | c3-247 inbox receives every item through deliverInbound; c3-208 ws-router serves the mcp-sources status topic; c3-116 settings-page edits the sources through the mcpSources patch branch; c3-226 kanna-mcp-host owns the OAuth bearer helper the runner reuses. |
| Boundary | Owns source configuration, the subscribe and poll loops, dedupe and cursor state, and the status snapshot. It does not own the MCP server credentials (customMcpServers does), does not decide verdicts, and never replies to a sender. |

## Purpose

Owns the MCP sources feature: the McpSource contract with its subscribe and poll modes and the Zalo preset, the AppSettings mcpSources CRUD branch and normaliser, the McpSourceRunner with its reconcile, backoff, legacy fallback, dedupe ring and persisted cursor, the client adapter on the 2.x MCP client, the cursor store adapter, the mcp-sources status topic and the Settings section. Non-goals: it does not support the ws transport, does not call a source tool to send anything, and keeps item counts in memory only.

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-side-effect-adapter | ref | The MCP client and its transports live in mcp-source-client.adapter.ts and the cursor file in mcp-source-cursor-store.adapter.ts; the runner is pure over injected ports | Mandatory | Tests drive the runner with a fake connector, an in-memory cursor port and a fake clock. |
| ref-strong-typing | ref | Tool results and resource contents are JsonValue; poll args are a JsonObject validated with isJsonObject; sources are parsed field by field from settings | Mandatory | The 2.x client is confined to one adapter; the validator and GenUI stay on the 1.x SDK. |
| ref-provider-adapter | ref | One connector port with one adapter per protocol era: subscriptions/listen on 2026-07-28 servers, resources/subscribe on 2025-era servers, both behind McpSourceConnection | Mandatory | The fallback is chosen by the typed MethodNotSupportedByProtocolVersion error, never by sniffing. |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| McpSource settings | IN | subscribe mode names resource URIs; poll mode names a tool, args, cursor argument, cursor path, items path, optional item key path and an interval clamped to 5 s to 1 h; both name a server, thread key path, sender path and an InboundHandler | Stored in settings.json through the mcpSources CRUD branch; the server id must exist in customMcpServers; the ws transport is refused | src/shared/mcp-sources/validate.ts |
| Subscribe loop | IN | listen with resourceSubscriptions, read each updated resource, dedupe on the hash of uri and contents, deliver; a remote close re-listens with exponential backoff, a graceful close reconnects after 30 s | A 2025-era server falls back to resources/subscribe per URI; an empty honored filter is an error state | src/server/mcp-sources/mcp-source-client.adapter.ts |
| Poll loop | IN | call the tool with the persisted cursor, read the items at itemsPath, dedupe on the item key or the item hash, deliver, persist the new cursor; polls never overlap and errors back off up to five intervals | The first poll of a cursorless source delivers everything the tool returns; a 401 refreshes the bearer and reconnects once | src/server/mcp-sources/mcp-source-runner.ts |
| Delivery | OUT | Every item becomes an InboundDelivery with source kind mcp, the thread key and sender resolved from the item, and the source handler, through deliverInbound | The inbox thread, card and handler prompt follow the inbox contract unchanged | src/server/mcp-sources/mcp-sources-boot.ts |
| mcp-sources topic | OUT | McpSourcesSnapshot with one status per source: state, last error, last item time, item count, honored URIs and cursor | Item counts are runtime only and reset at boot; the cursor survives | src/server/mcp-sources/mcp-sources-boot.ts |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| CLAUDE.md MCP sources section | c3-248 Contract | Wording is free; the legacy fallback, the first-poll and the separate-process caveats must survive | CLAUDE.md |
| wiki/src/content/docs/guides/user/mcp-sources.md | c3-248 Contract | Wording and examples are free; the two modes and the Zalo preset shape must match | wiki/src/content/docs/guides/user/mcp-sources.md |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| Two polls overlap and deliver the same page twice | Replacing the timeout chain with an interval | The runner test advances the fake clock during a slow poll and expects one call | bun test --conditions production src/server/mcp-sources/mcp-source-runner.test.ts |
| A restart replays the whole history | Dropping the cursor persistence | The runner test restarts over the same cursor port and expects polling to resume from the saved cursor | bun test --conditions production src/server/mcp-sources/mcp-source-runner.test.ts |
| A 2025-era server is treated as broken | Removing the typed-error fallback in openListening | The adapter test rejects listen with the typed error and expects subscribeResource per URI | bun test --conditions production src/server/mcp-sources/mcp-source-client.adapter.test.ts |
| A source names a server that no longer exists | Removing the serverId check in the settings writer | The settings test expects the create to be refused | bun test --conditions production src/server/mcp-sources-settings.test.ts |
