---
id: adr-20261107-remote-mcp-push-event-feed
c3-seal: 20afc864c49a322e83c3bd4a604655d4c5e8d3e5f3c667743d4ad86d0665018b
title: remote-mcp-push-event-feed
type: adr
goal: Let an external MCP client learn that a chat turn ended, a chat was created, an approval is waiting or a cron run fired without polling, by pushing resource updates over subscriptions/listen from an in-memory event feed and offering the same feed to clients that cannot listen through a long-poll tool.
status: accepted
date: "2026-11-07"
---

## Goal

Let an external MCP client learn that a chat turn ended, a chat was created, an approval is waiting or a cron run fired without polling, by pushing resource updates over subscriptions/listen from an in-memory event feed and offering the same feed to clients that cannot listen through a long-poll tool.

## Context

The remote MCP server (c3-242) is stateless: createMcpHandler builds one McpServer per request, and Kanna never called the handler's notify, so a client had to loop on wait_for_chat per chat to find out anything. The facts a client wants already exist on the service bus (c3-246): turn.started, turn.finished, turn.failed, turn.cancelled, chat.created, cron.runStarted, cron.runOutcome and cron.runSkipped, plus chat.toolPending and chat.toolResolved from the change that made a parked AskUserQuestion or ExitPlanMode a store event. The bus was built inside createApplicationServices and not exposed. The SDK delivers notify.resourceUpdated(uri) to every open 2026-07-28 subscriptions/listen stream whose filter holds that exact URI, but honours resourceSubscriptions only when the server advertises resources.subscribe, and McpServer advertised only listChanged. The bus also carries transcript text, inbox, webhook and MCP source messages, none of which an MCP client should receive.

## Decision

Push through the SDK rather than a hand-made stream. The runtime subscribes an event feed to the bus once per subject of an allowlist defined in one table, never to a wildcard. The feed (remote-mcp-event-feed.ts) is a ring of 2000 entries of seq plus envelope, stores each payload after redactSecrets, and addresses a position with a cursor bootId:seq where the boot id is fresh per process. A read after a cursor returns the events strictly after it; a cursor of another boot or one that does not parse returns the latest page with reset true; dropped counts the events evicted between the cursor and the oldest retained one, so a lost event is reported and never silent. After the appends of one microtask the runtime calls notify.resourceUpdated for kanna://events and for kanna://chats/chatId of each chat in the batch, and does nothing while remoteMcp is disabled; stop unsubscribes before it closes the handler. buildRemoteMcpServer registers the subscribe capability and the resources kanna://events and kanna://events with an after query, and the new wait_for_events tool, an mcpOnlyTool so it is audited like every other tool, long-polls the feed for 2025-era clients, capped at the silent wait ceiling of 100 seconds. The feed is in memory on purpose: it is a wake-up and catch-up channel, state is re-read through get_chat, and reset tells the client when to do so. To keep server.ts at its 700 line threshold the two housekeeping intervals move to router-housekeeping.ts.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-242 | component | Gains the event feed, the kanna://events resources, the subscribe capability and the wait_for_events tool, and the runtime now takes the service bus | c3-242#n14330@v1:sha256:582027ede3719787265cef12e055f001a61fc32d4dfb9ec809146d661edf5c42 | ref-strong-typing: the feed page is a named type and payloads stay JsonValue; ref-side-effect-adapter: the feed performs no IO beyond a timer |
| c3-246 | component | Gains a consumer that subscribes per allowlisted subject; the bus is exposed on ApplicationServices | c3-246#n14516@v1:sha256:d22a59a2a8248a7cdc3eee317e8cf42cda9a4574de15cc5265d239c09e9e1787 | ref-event-sourcing: the feed only sees facts the tap published after they were persisted |

## Compliance Refs

| Ref | Why required | Evidence | Action |
| --- | --- | --- | --- |
| ref-ws-subscription | The feed is a second push channel beside the WebSocket subscriptions; it reads the bus the store already feeds and never reads the store directly | ref-ws-subscription#n15514@v1:sha256:262446a7d1764e15397e60f10d9b4c55fae08bc956461d99a6bf0e2c5c62eada | comply |
| ref-side-effect-adapter | The feed and the runtime wiring perform no IO; the only effect is a timer for the long poll and the SDK transport owns the stream | ref-side-effect-adapter#n15410@v1:sha256:cdbf6975e8a35b0d03558be6822dfae166482c24fb86b0433f60e8167f5c91e4 | comply |
| ref-strong-typing | Feed pages, entries and the cursor are named types and payloads stay JsonValue | ref-strong-typing#n15448@v1:sha256:eaa7509d80f8a56b00105ed5d46af5a604bfae2e81889e9dac7d7a095fbf5009 | comply |
| ref-event-sourcing | The feed sees only facts the EventStore tap published after they were persisted, so a client never reads an event the log does not hold | ref-event-sourcing#n15311@v1:sha256:ee0316401639d91b6d6f6b1c3615cf7eab1abbd5cbf9cef319474a29c2567775 | comply |

## Compliance Rules

| Rule | Why required | Evidence | Action |
| --- | --- | --- | --- |
| rule-colocated-bun-test | The feed and the push path each get a colocated test that imports from vite-plus/test and uses no mocks | rule-colocated-bun-test#n15580@v1:sha256:2bc20e87f7c1e3aabe46c42732cca6d91bf2f72516544a2924fe9870e8df4385 | comply |
| rule-strong-typing | The feed page and the cursor are named types, payloads stay JsonValue and no cast or unknown was added | rule-strong-typing#n15642@v1:sha256:eaa7509d80f8a56b00105ed5d46af5a604bfae2e81889e9dac7d7a095fbf5009 | comply |

## Verification

| Check | Result |
| --- | --- |
| bun run test src/server/remote-mcp/remote-mcp-event-feed.test.ts src/server/remote-mcp/remote-mcp-event-feed-push.test.ts | A listening modern client is pushed an update when a turn finishes, reads kanna.turn.finished after its cursor, and reading the returned cursor again yields nothing; a cursor of another boot reports reset; wait_for_events resolves with the event that arrives and a parked question is kanna.chat.toolPending; a reader behind the ring is told how many events were dropped; a transcript subject is refused and a secret value is masked |
| bun run check:arch | architecture ratchets pass without raising a pin |
| ~/.claude/skills/c3/bin/c3x.sh check | the c3 documents are in sync |
