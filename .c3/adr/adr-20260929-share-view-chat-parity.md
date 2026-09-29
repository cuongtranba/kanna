---
id: adr-20260929-share-view-chat-parity
c3-seal: 153fb988dca780f660e86c9e263e75f2eb599802d3a13286cbaf7a0d049083af
title: share-view-chat-parity
type: adr
goal: Make a shared chat link render the way the chat renders, including the data behind generative views. The share snapshot moves from a flattened, share-only message list (version 1) to the chat's own transcript entries filtered by an allowlist (version 2), and every non-inline kanna-ui dataset is frozen into the snapshot at mint so the public viewer can answer view queries without a server.
status: accepted
date: "2026-09-29"
---

## Goal

Make a shared chat link render the way the chat renders, including the data behind generative views. The share snapshot moves from a flattened, share-only message list (version 1) to the chat's own transcript entries filtered by an allowlist (version 2), and every non-inline kanna-ui dataset is frozen into the snapshot at mint so the public viewer can answer view queries without a server.

## Context

A version 1 snapshot kept only a tool call's name and raw input, dropped the Claude tool id so results could not be joined to calls, and dropped every entry kind the projection did not list. The share page then rendered that list with its own components, so tool calls appeared as raw JSON boxes while the chat collapsed them into tool rows. The share page's GenUI host had no dataset query function, so every file- or MCP-backed view showed "Live data is not included in a shared view". The viewer is unauthenticated and has no chat, no workspace and no MCP access, so live queries are impossible there by design.

## Decision

The snapshot carries TranscriptEntry values chosen by shareableEntries: prompts, assistant text and thinking, tool calls and results, results, API errors, refusals, and compaction and interrupt markers. It excludes system init, account info, attachments, cron and loop records, hidden entries, and every debugRaw except the tool_use_result sidecar the tool cards need. The share page renders them with processTranscriptMessages, buildResolvedTranscriptRows and TranscriptRowFrame, the chat's own pipeline, under the existing read-only render options. At mint, GenUIDatasetService.freeze loads each non-inline dataset under the chat's own authorization, so the path deny rules, realpath containment and the MCP approval gate all still apply, and it keeps only the columns the declaration reads. The rows are stored under datasetFreezeKey, and the share page's GenUI host answers queries locally with runDatasetQuery, so period, comparison and drill-down still work. Version 1 snapshots are upgraded in the viewer by normalizing each tool call and pairing results with calls in order. Rejected: rewriting each view's datasets to inline rows, because the spec parser caps inline data at 500 rows and 64 KB, and a server query endpoint for share tokens, because it would expose the chat's workspace and MCP servers to anyone holding a link.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-228 | component | Builds the version 2 snapshot and freezes datasets at mint | c3-228#n12066@v1:sha256:dd76ab7b82d066d40d5d20c25a33ba1accd8967052b304c8e4dceccfe22ad617 "Mint time-limited read-only share tokens for finished Kanna chat sessions, persist frozen snapshots under ~/.kanna/shares/, serve them at /share/:token without " | Allowlist reviewed for private fields |
| c3-306 | component | ChatSnapshot becomes a union of version 1 and version 2 with FrozenDataset | c3-306#n13084@v1:sha256:ca83235580ea4929ffcc5d16c12a94e41dbc099d5a4012dae13ae966b6d35156 "Expose share/tunnel types used on both client and server (QR payload, public URL shape)." | Readers branch on version |

## Verification

| Check | Result |
| --- | --- |
| bun run test src/server/session-share/snapshot-builder.test.ts | Account email, attachment paths and raw payloads are absent; datasets are frozen under their key |
| bun run test src/client/app/share-view/ShareViewPage.test.tsx | Tool calls render as chat tool rows for version 1 and version 2; a view shows frozen data |
| bun run test src/server/genui/dataset-service.test.ts | Frozen rows keep only declared columns; an unapproved MCP tool is never called |
