---
id: adr-20261110-remove-websearch-shim
c3-seal: 3970573ac3955ee8a3c71e61ca5c746e970721e2954c66c33233fde97eb7ec7a
title: remove-websearch-shim
type: adr
goal: Stop registering the `websearch` built-in shim on the Kanna MCP host, so that under `KANNA_MCP_TOOL_CALLBACKS=1` the host exposes seven gated shims (`read`, `glob`, `grep`, `bash`, `edit`, `write`, `webfetch`) instead of eight.
status: done
date: "2026-11-10"
---

## Goal

Stop registering the `websearch` built-in shim on the Kanna MCP host, so that under `KANNA_MCP_TOOL_CALLBACKS=1` the host exposes seven gated shims (`read`, `glob`, `grep`, `bash`, `edit`, `write`, `webfetch`) instead of eight.

## Context

The `websearch` shim (`src/server/kanna-mcp-tools/websearch.ts`) never performed a search: its handler always returned `isError: true` with "WebSearch unavailable in this environment". The native `WebSearch` tool stays in `CLAUDE_TOOLSET` (`claude-session-config.ts`) whether or not the shims are enabled, so the shim only offered the model a second, always-failing web-search tool beside a working one. A prompt audit of the model-facing tool surface flagged it under "don't expose tools that are invalid in the current configuration".

## Decision

Delete the shim and its test, drop it from `BUILTIN_SHIM_FACTORIES` in `kanna-mcp.ts`, and update c3-226 so its Purpose and flag-off row count seven shims and the "Alternate — websearch" row is removed. Native `WebSearch` remains the only web-search tool, which is the behaviour that already worked.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-226 | component | Purpose and Business Flow named the websearch stub among the gated shims | c3-226#n13443@v1:sha256:fd6a0d04832d3d2357a70bc58ed8bc678ee0e3e3c7a545161bf7992f8d2aba35 "Owns the Kanna MCP host runtime: builds the in-process SDK MCP server" | Purpose and flag-off row now count seven shims; websearch row removed |

## Verification

| Check | Result |
| --- | --- |
| bun run test src/server/kanna-mcp.test.ts | the registered shim list no longer contains websearch |
| bun run check | exits 0 |
