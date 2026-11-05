---
id: c3-248
c3-seal: 5680f3639ab7b1b38327c8c5053e6fb7097d1d0eb6c09f2a18f3f496357efb9b
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
| McpSource settings | IN | subscribe mode names resource URIs, an optional items path and item key path that split a resource into messages, and an optional resync interval clamped like the poll interval; poll mode names a tool, args, cursor argument, cursor path, items path, optional item key path and an interval clamped to 5 s to 1 h; both name a server, thread key path, sender path and an InboundHandler | Stored in settings.json through the mcpSources CRUD branch; the server id must exist in customMcpServers; the ws transport is refused | src/shared/mcp-sources/validate.ts |
| Subscribe loop | IN | listen with resourceSubscriptions, then resources/read the notified URI on every resources/updated, after every subscribe (catch-up) and on the optional resync timer; items are split at itemsPath and deduped per item key, or per hash of uri and contents when no items path is set; pushes coalesce into one drain in flight plus one pending; a remote close re-listens with exponential backoff that resets only after a session held for 60 s, a graceful close reconnects after 30 s | A 2025-era server is subscribed per URI only when it advertises resources.subscribe, else the honored set is empty and the source is in error; a read failing with a JSON-RPC error keeps the session, a transport failure or a failed GET stream ends it as remote; closing sends DELETE for the session | src/server/mcp-sources/mcp-source-client.adapter.ts |
| Poll loop | IN | call the tool with the persisted cursor (fetched by the tool fetcher in mcp-source-fetch.ts), read the items at itemsPath, dedupe on the item key or the item hash, deliver, persist the new cursor; polls never overlap and errors back off up to five intervals | The first poll of a cursorless source delivers everything the tool returns; a 401 refreshes the bearer and reconnects once | src/server/mcp-sources/mcp-source-runner.ts |
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
| Two polls overlap and deliver the same page twice | Replacing the timeout chain with an interval | The runner test advances the fake clock during a slow poll and expects one call | bun run test src/server/mcp-sources/mcp-source-runner.test.ts |
| A restart replays the whole history | Dropping the cursor persistence | The runner test restarts over the same cursor port and expects polling to resume from the saved cursor | bun run test src/server/mcp-sources/mcp-source-runner.test.ts |
| A 2025-era server is treated as broken | Removing the typed-error fallback in openListening | The adapter test rejects listen with the typed error and expects subscribeResource per URI | bun run test src/server/mcp-sources/mcp-source-client.adapter.test.ts |
| A source names a server that no longer exists | Removing the serverId check in the settings writer | The settings test expects the create to be refused | bun run test src/server/mcp-sources-settings.test.ts |
| A dead 2025 session is never reopened | Dropping the typed stream failure signal or the lost-on-transport-error rule in the adapter | The adapter tests expect a 404 on the GET stream to end the session as remote and a dead server to end it after a failed read | bun run test src/server/mcp-sources/mcp-source-client.adapter.test.ts |
| A reconnect leaves a server session behind or a read error forces reconnect loops | Removing terminateSession on close, or treating a JSON-RPC error as a lost connection | The adapter tests expect a DELETE with the session id and an open session after a not-found read | bun run test src/server/mcp-sources/mcp-source-client.adapter.test.ts |
| A list resource redelivers its backlog on every push | Keying a subscribe item on the whole payload when an items path is set | The runner test expects a repeated read to deliver only the new item | bun run test src/server/mcp-sources/mcp-source-runner.test.ts |
