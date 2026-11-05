---
id: adr-20261105-mcp-source-subscribe-spec-flow
c3-seal: f9af6a74e955a1f25ad434479ce0c1c9d78544a966037a3eeaa8a7e8d16eae8d
title: mcp-source-subscribe-spec-flow
type: adr
goal: Record the decision to make MCP source subscribe mode follow the MCP resource flow, a notification of resources/updated answered by resources/read, split a resource into items that are deduped one by one, catch up after every subscribe and on an optional resync timer, notice a dead session, and end the HTTP session on close. The protocol era and the fetch strategy become two separate adapter seams, and a tool call on a notification is rejected as off-spec.
status: accepted
date: "2026-11-05"
---

## Goal

Record the decision to make MCP source subscribe mode follow the MCP resource flow, a notification of resources/updated answered by resources/read, split a resource into items that are deduped one by one, catch up after every subscribe and on an optional resync timer, notice a dead session, and end the HTTP session on close. The protocol era and the fetch strategy become two separate adapter seams, and a tool call on a notification is rejected as off-spec.

## Context

Subscribe mode delivered the whole resource payload as one item keyed by the hash of uri and contents, so a resource that holds a list redelivered every message on every change. Nothing read the resource after subscribing, so messages that arrived while Kanna was disconnected were missed. A 2025-era streamable HTTP session whose GET stream failed with 404 only raised onerror and never onclose, so the source stayed listening on a dead session. Remote drops always waited about one second although the docs promised exponential backoff, the legacy path sent resources/subscribe without checking the negotiated resources.subscribe capability and reported every URI as honored, and close never sent the DELETE the spec recommends, leaving one server session behind per reconnect. zalo-mcp now pushes resources/updated for zalo://inbox, which exposed all of this. Neither revision specifies catch-up, coalescing or cursors, so those are client policy.

## Decision

Subscribe mode always reads resources: on a notification (of the notified URI, which may be a sub-resource, so it is not matched against the subscribed URIs), once after each subscribe, and every resyncIntervalMs when set. An optional itemsPath and itemKeyPath split the resource into items keyed by the field or a hash; with no itemsPath the legacy whole-payload item and key are kept so stored sources behave as before. Fetching is a seam in mcp-source-fetch.ts: fetcherFor switches exhaustively on mode between a resource fetcher and the tool fetcher poll mode already used, and the runner drains through one shared path. The subscription protocol is the other seam in mcp-source-client.adapter.ts, chosen by the typed MethodNotSupportedByProtocolVersion error; the 2025 path subscribes only when resources.subscribe is advertised. Liveness belongs to the adapter: closed resolves remote on onclose, on ClientHttpFailedToOpenStream, or when a read or tool call fails with anything but a ProtocolError, so a resource-not-found answer never reconnects. close sends terminateSession first. Drains coalesce into one in flight plus one pending URI set, and the backoff attempt resets only after a session held for 60 seconds. Presets become a registry of input templates of either mode, and the Zalo preset becomes a subscribe source.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-248 | component | Owns the subscribe loop, the new fetch seam, the client adapter, the settings contract and the preset and form | c3-248#n14362@v1:sha256:f1eb23d705679ccb0edd5c5d85bdd67c054da3deff5b97eac6e68862b8a317d5 | Review ref-provider-adapter, ref-side-effect-adapter and ref-strong-typing: the protocol era stays behind McpSourceConnection, the SDK stays in the adapter, JSON stays JsonValue |
| c3-248 | component | McpSource settings gain itemsPath, itemKeyPath and resyncIntervalMs on subscribe sources, defaulted when a stored source lacks them | c3-248#n14361@v1:sha256:2eefcbb13ee7b695b80239f44b8a5f364e7ccfa1b9a8f9f36387fe987f869dc5 | Stored sources must load unchanged and the zod and TypeScript shapes stay in parity |
| c3-302 | component | types.schema.ts carries the new subscribe fields in the input, patch and stored schemas | c3-302#n14457@v1:sha256:cdbf6975e8a35b0d03558be6822dfae166482c24fb86b0433f60e8167f5c91e4 | assertParity keeps the schema and the interfaces equal |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Call a cursor tool such as zalo_get_messages when a resources/updated arrives | The spec answer to a notification is resources/read of the notified URI, and a tool call ties a source to one server's tool names; cursor tools stay in poll mode |
| Treat the whole resource as one item and rely on the 256 key ring | A list resource redelivers every message on each change and the ring evicts old keys, so the backlog returns |
| Detect a dead session by heartbeat pings in the runner | The runner would need SDK knowledge; the SDK already reports the typed stream failure and a failed request, so the adapter owns liveness and the runner keeps one closed signal |
| Reconnect on any failed read, including JSON-RPC errors | A resource-not-found answer proves the server is alive, so reconnecting would loop on a bad URI instead of reporting it |
| Hard-code the Zalo shape in the runner | The runner stays free of server-specific code; a preset is data over the same items path, item key and resync fields |

## Verification

| Check | Result |
| --- | --- |
| bun run test src/server/mcp-sources src/server/mcp-sources-settings.test.ts src/shared/mcp-sources src/client/lib/mcpSourceDraft.test.ts src/client/app/McpSourcesSection.test.tsx | Passes, covering per-item dedupe, coalescing, resync, reconnect on a lost connection, no reconnect on a protocol error, exponential backoff, the capability gate, the 404 stream, DELETE on close and the legacy stored source |
| bun run check:arch | Passes with no pin changed |
| c3x check | Exits ok with no new issues |
