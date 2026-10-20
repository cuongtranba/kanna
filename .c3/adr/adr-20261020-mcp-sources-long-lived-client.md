---
id: adr-20261020-mcp-sources-long-lived-client
c3-seal: 355c67d48824ca206c875b3e4bcacbe2669ad8c0523af0c0f6288d803d41fff6
title: mcp-sources-long-lived-client
type: adr
goal: Record the decision to make Kanna a long-lived MCP client for user-chosen servers so that messages those servers expose, by resource subscription on protocol revision 2026-07-28 or by polling a list tool, enter the Inbox through the same deliverInbound path as webhooks, with the new component (c3-248) owning sources, loops, cursors and the Settings section.
status: done
date: "2026-10-20"
---

## Goal

Record the decision to make Kanna a long-lived MCP client for user-chosen servers so that messages those servers expose, by resource subscription on protocol revision 2026-07-28 or by polling a list tool, enter the Inbox through the same deliverInbound path as webhooks, with the new component (c3-248) owning sources, loops, cursors and the Settings section.

## Context

Kanna only ever used MCP request and response: the Settings connect test, the OAuth completion check and the GenUI datasets. Nothing held a connection or received a notification, so a message arriving at the user's Zalo MCP server reached nobody unless the model happened to poll. The inbox (c3-247) now gives every inbound message a thread, a handler chat and a reply path, and the user asked for both the subscription pattern of the 2026-07-28 revision and tool polling, because the Zalo server exposes only a list tool with a cursor. The 2.x MCP client already sat in devDependencies for the remote MCP tests and implements subscriptions/listen; the 1.x SDK that the validator and GenUI use does not know the revision.

## Decision

Add the mcp-sources component: an McpSource contract with subscribe and poll modes and a Zalo preset; an AppSettings mcpSources CRUD branch so sources ride settings.json beside the servers they reference and need no new CRUD commands; an McpSourceRunner that reconciles the configured sources, keeps one connection per source, subscribes with subscriptions/listen and falls back to resources/subscribe on the typed MethodNotSupportedByProtocolVersion error, polls on a timeout chain that never overlaps, dedupes on a persisted ring and persists the cursor in mcp-source-cursors.json; a client adapter on the 2.x MCP client confined to one file; an mcp-sources status topic; and a Settings section with the preset. Every item becomes an InboundDelivery through deliverInbound, so threads, cards, handler prompts and replies are the inbox's unchanged contract. The ws transport is refused because the 2.x client ships none. This wins over polling from the model, which spends tokens and misses messages between turns, and over a per-source delivery path, which would duplicate the inbox contract.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-248 | component | New owner of sources, loops, cursors, the status topic and the Settings section | c3-248#n15143@v1:sha256:24f32f0d0b97f6fe0343171db90fc218aa4d7e5fa57a812d1d8f2bd0a95a2822 | The 2.x client and the cursor file are adapters; the runner is pure over injected ports and tested with fakes |
| c3-247 | component | Gains a second inbound source kind through deliverInbound and resolves MCP source handlers for reply and push | c3-247#n14054@v1:sha256:5eb479aae315bdc30c5d43bffa3e2de572e696a55673cd581a020947b110a1d2 | The delivery contract is unchanged; the handler resolver composes the webhook and source resolvers |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| Contract | McpSource types, validation, Zalo preset | src/shared/mcp-sources/ |
| Settings | mcpSources CRUD branch, normaliser, server id check | src/server/mcp-sources-settings.ts, src/server/app-settings.ts |
| Runner and adapters | McpSourceRunner, client adapter with legacy fallback, cursor store, boot and topic | src/server/mcp-sources/ |
| Bearer | resolveMcpBearer moved to src/server/mcp-bearer.ts and re-exported | src/server/mcp-bearer.ts, src/server/ws-router-settings.ts |
| Settings UI | McpSourcesSection, McpSourceForm, stores, draft and presentation helpers | src/client/app/McpSourcesSection.tsx |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Let the model poll the source tool during turns | Spends tokens on every turn and misses messages between turns; the user asked for Kanna to hold the connection |
| Retrofit the validator and GenUI onto the 2.x client | A larger change with no user-visible gain; the two client generations coexist in separate adapters |
| Store sources in their own file | They carry no secret, and the servers they reference already live in settings.json |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| The first poll of a cursorless source spawns one chat per thread at once on a busy account | Documented in CLAUDE.md and the wiki; notify mode opts a source out of pre-handling | bun test --conditions production src/server/mcp-sources/mcp-source-runner.test.ts |
| A stdio source runs a second server process with its own state | The form help text and the wiki say to prefer http or sse | bun test --conditions production src/server/mcp-sources/mcp-source-client.adapter.test.ts |
| A server honours no subscription and the source looks alive | An empty honored filter is an error state in the status snapshot | bun test --conditions production src/server/mcp-sources/mcp-source-runner.test.ts |

## Verification

| Check | Result |
| --- | --- |
| bun run typecheck, lint, lint:comments, lint:usestate, ast-grep test, check:arch | clean, no pin changed |
| bun run test | passes |
| bun run build:client and check:bundle | entry under the 350000 gzip budget |
