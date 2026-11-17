---
id: adr-20261117-antigravity-acp-provider
c3-seal: 520c99c71491ed2c5bd7fa87e2387b5ea2a015fc62cb8b4f4a0ac70b17e50fe5
title: antigravity-acp-provider
type: adr
goal: Add Antigravity (Google's agy CLI) as a fifth agent provider by driving agy over the Agent Client Protocol on stdio, running it with auto-approved permissions for parity with Codex, and serving Kanna's three peer-messaging tools to it through a bearer-gated loopback HTTP MCP endpoint.
status: proposed
date: "2026-11-17"
---

## Goal

Add Antigravity (Google's agy CLI) as a fifth agent provider by driving agy over the Agent Client Protocol on stdio, running it with auto-approved permissions for parity with Codex, and serving Kanna's three peer-messaging tools to it through a bearer-gated loopback HTTP MCP endpoint.

## Context

agy 1.5.9 offers two ways to drive it from another process. Print mode (agy -p --output-format stream-json) streams events but has no approval requests, no cancel and no MCP server registration, so a turn cannot be stopped and the agent cannot be given Kanna tools. agy acp speaks Agent Client Protocol: session/new with developer instructions and mcpServers, session/resume, session/set_config_option for model and thinking level, session/set_mode for plan mode, session/cancel and session/prompt with session/update notifications. Codex reaches Kanna's peer tools through in-process dynamicTools on its app-server, which ACP has no equivalent for. The peer tools (list_peer_chats, send_chat_message, wait_for_chat_message) live behind CodexKannaTools and must reach a chat id, so a transport has to carry the chat identity. The constraints are the IO seal (child_process only in an adapter), no casts or unknown in production types, and the existing coordinator turn contract shared by Claude and Codex.

## Decision

Use ACP over stdio. AntigravityAcpManager (src/server/antigravity-acp.ts) owns one agy child per chat or subagent scope behind the StdioProcess port that Codex now shares, with antigravity-spawn.adapter.ts as the only spawn site. Developer instructions go in _meta.antigravity.systemPrompt.append on session/new and persist across resume; session/resume falls back to session/new when agy lost the session; /compact is passed through because agy compacts natively; a fork starts a new session and there is no steering. agy is spawned with --dangerously-skip-permissions, so approvals are auto-granted, which matches Codex approvalPolicy never with a danger-full-access sandbox; no permission card is ever shown. The peer tools are served by AgentToolsBridge (src/server/agent-tools-bridge.ts) as an HTTP MCP server at /agent-tools/mcp, mounted in http-dispatcher.ts after remote MCP. Each main session gets a random 32 byte bearer mapped to its chat id and handed to agy in session/new and session/resume mcpServers headers. The endpoint answers only direct loopback POSTs that carry none of Origin, Forwarded, X-Forwarded-For, X-Forwarded-Host, X-Real-IP or CF-Connecting-IP; it returns 403 for anything else, 405 for non-POST, 401 for a missing, unknown or revoked bearer and 404 for its OAuth discovery path. The bearer is revoked on stopSession and on failure, the request timeout is lifted with server.timeout(req, 0) so wait_for_chat_message can hold the request, and subagent scopes get no grant. agy reports no result for MCP calls, so the bridge outcome is recorded as the tool_result of the agy tool call, including when the HTTP call arrives before the ACP tool_call.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-250 | component | New component owning the ACP manager, protocol, translator, spawn adapter and the loopback peer tools bridge | c3-250#n14914@v1:sha256:e044a9cd055556df8753c3ee7a12c968c8fa60e9c9fc93c1ce7e6bf78025cdd7 | Reviewed against ref-provider-adapter, ref-side-effect-adapter and ref-strong-typing: spawn only in the adapter, typed ACP decoding, bridge constraints in the Contract |
| c3-210 | component | The coordinator, turn starter, send-command and subagent provider run gain an antigravity branch; turn-end-guards.ts is extracted from agent-coordinator.ts to stay under its pin | c3-210#n12794@v1:sha256:ca6753652cc74facb772fe9c0b2c181c8ccf8285292b29d8bde2240ded58671b | Reviewed against ref-provider-adapter: the provider stays behind the coordinator and the shared turn contract |
| c3-211 | component | The Codex driver now takes the shared StdioProcess port instead of its own process interface | c3-211#n12875@v1:sha256:4b18a555164c24e622a310d778b4c6c3cfced1867fabd8aa0b169ebd14a91753 | Reviewed against ref-side-effect-adapter: spawning stays in codex-spawn.adapter.ts |
| c3-249 | component | Owns the peer tools the bridge serves and the construction of the bridge and the Antigravity manager in create-peer-messaging.ts; mid-turn delivery returns false for Antigravity so its messages queue | c3-249#n14828@v1:sha256:c7eeb7d3718edd7ba14344e59b64960deb60f759db9bf15a59b8a6d27eda0eba | Reviewed against ref-strong-typing: bridge JSON is narrowed with isJsonObject |
| c3-202 | component | http-dispatcher.ts mounts the bridge after remote MCP and server.ts rehydrates scheduled work through the extracted scheduled-work-rehydrate.ts | c3-202#n12355@v1:sha256:2e868029505a294cb79ac3750f443e489fdca9fb37d30d865fbfc0e47ac582e0 | The bridge route runs before auth gating on its own bearer, so its loopback and header checks are the access control |

## Compliance Refs

| Ref | Why required | Evidence | Action |
| --- | --- | --- | --- |
| ref-provider-adapter | The Antigravity runtime sits behind the coordinator like Claude and Codex | ref-provider-adapter#n15719@v1:sha256:6c354267518fab769e6ba895dc71c3d27f8216ea10e1cb84a52a488e8ff7e972 | comply |
| ref-side-effect-adapter | Spawning agy happens only in antigravity-spawn.adapter.ts | ref-side-effect-adapter#n15751@v1:sha256:d97da3a35cbbfc743202e4b37a53c5ae837c6f8c802bdd22685991e0bfe439ee | comply |
| ref-strong-typing | ACP and MCP JSON is narrowed with isJsonObject, no casts | ref-strong-typing#n15790@v1:sha256:390cd8fee6d22c17530c1b9551d02cbd40ea33c56574b7ebc313f21961a707af | comply |
| ref-event-sourcing | Antigravity turns reach the event store through the coordinator unchanged | ref-event-sourcing#n15653@v1:sha256:1ff5f5fcbeeb85e1ccfe24b3e3e63babaec81436d2a50381b8e0b560132fd0aa | comply |
| ref-tool-hydration | Antigravity tool calls and bridge outcomes hydrate into tool entries and results | ref-tool-hydration#n15823@v1:sha256:376e5fee261bd3b463633f19523020439854d9bd11ddc28ff5cffe12d8ed485e | comply |
| ref-colocated-bun-test | New tests sit next to their modules | ref-colocated-bun-test#n15585@v1:sha256:21109196beee9320d022834bf1118ff1f09000f2d2b1009e74dd42bb16896135 | comply |
| ref-local-first-data | The bridge stores nothing; bearer grants live in memory only | ref-local-first-data#n15686@v1:sha256:6b71d8a9c2f48d47b9acda0a867f9936d76727141dc2efbbdfead90101e7fd49 | comply |
| ref-ws-subscription | Provider selection and settings flow through the existing typed WebSocket protocol | ref-ws-subscription#n15856@v1:sha256:856dbc5b26887801a91ee1acf2a59bd940bd7592ddaa57b46a8689de86dd07cc | comply |

## Compliance Rules

| Rule | Why required | Evidence | Action |
| --- | --- | --- | --- |
| rule-strong-typing | Protocol decoding and the bridge cross a JSON boundary | rule-strong-typing#n15984@v1:sha256:7e110467821b764c655f13db69c1331592e23c71af38ac5825037c97b15ea180 | comply |
| rule-colocated-bun-test | The new tests are colocated | rule-colocated-bun-test#n15922@v1:sha256:48dcb9602c7cfb6e2a8b3933fc13f87f51f51520d2d99aaa9ab9569233ccff2b | comply |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| ACP runtime | Manager, protocol decoding, translator, spawn adapter and the shared StdioProcess port | src/server/antigravity-acp.ts |
| Peer tools bridge | Bearer grants, loopback and header checks, JSON-RPC dispatch and outcome recording | src/server/agent-tools-bridge.ts |
| Catalog and settings | Antigravity models, efforts, plan mode and the Providers defaults row | src/shared/provider-model-types.ts |
| Docs | Providers page, peer messaging, subagents, slash commands and install pages, plus the kanna-providers skill | wiki/src/content/docs/features/providers-models.mdx |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| Fake ACP process tests | Exercise session setup, resume fallback, plan mode, cancel and tool outcome ordering without agy | src/server/antigravity-acp.test.ts |
| Bridge tests | Cover 401, 403, 405, bearer revocation and tool dispatch | src/server/agent-tools-bridge.test.ts |
| IO seal lint | Only the adapter files may import child\_process | bun run lint |
| Architecture pins | Extractions keep agent-coordinator.ts and server.ts under their pins | bun run check:arch |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Print mode with --output-format stream-json | No approval requests, no cancel and no MCP registration, so turns cannot be stopped and Kanna tools cannot be offered |
| A stdio MCP relay subprocess for the peer tools | Needs a second process per session and a side channel to the server to carry the chat identity, while agy already accepts http MCP servers with headers |
| Reusing the remote /mcp endpoint with its OAuth allowlist | Requires the user's credentials or an OAuth flow agy cannot complete and exposes the full command catalog instead of three tools |
| Surfacing agy permission requests as Kanna approval cards | agy is run with --dangerously-skip-permissions for parity with Codex approvalPolicy never; the protocol path adds a second approval model for no change in trust |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| The bridge is reached by another local user, a browser page or a proxied client | Bearer per session, direct loopback only, no Origin or forwarding headers, 403 otherwise, bearer revoked on stop and failure | src/server/agent-tools-bridge.test.ts |
| A held wait\_for\_chat\_message request is cut by the server timeout | server.timeout(req, 0) on every bridged request | src/server/http-dispatcher.ts |
| agy changes its ACP schema | Decoding is narrowed and fails closed into an error result; the fake-process tests pin the shapes used | src/server/antigravity-acp.test.ts |
| Auto-approved tools edit files without asking | Same trust model as Codex; documented in the providers page | wiki/src/content/docs/features/providers-models.mdx |

## Verification

| Check | Result |
| --- | --- |
| bun run test src/server/antigravity-acp.test.ts src/server/agent-tools-bridge.test.ts | Required green before merge |
| bun run check, bun run check:arch and bun run lint | Required green before merge |
| bun run test src/ops/skills | Required green before merge |
| c3x check and c3x lookup src/server/antigravity-acp.ts | Component resolves to c3-250 |
| Live run against agy 1.5.9 covering chat, model and effort, plan mode, cancel, resume, a peer message and a subagent | Required before merge |
