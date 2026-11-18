---
id: adr-20261118-c3-2-mcp-host-framing
c3-seal: cb5805d782adbe16e2e9456d484371468e81f0b8ebf2d50894633f6418d79cfa
title: c3-2-mcp-host-framing
type: adr
goal: 'Bring the server container''s framing of c3-226 in line with adr-20261118-remove-tool-callbacks-flag: the Responsibilities line and the c3-226 Goal Contribution row in c3-2 still describe built-in shims and interactive tool requests on a durable protocol that survives restart.'
status: done
date: "2026-11-18"
---

## Goal

Bring the server container's framing of c3-226 in line with adr-20261118-remove-tool-callbacks-flag: the Responsibilities line and the c3-226 Goal Contribution row in c3-2 still describe built-in shims and interactive tool requests on a durable protocol that survives restart.

## Context

adr-20261118-remove-tool-callbacks-flag removed the `KANNA_MCP_TOOL_CALLBACKS` flag and the seven `mcp__kanna__*` file and shell shims, and patched c3-226 itself. The parent container c3-2 was not patched in that unit, so two of its blocks still name the shims, and the Responsibilities line claims the durable protocol survives restart, which it does not: `recoverOnStartup` fail-closes pending records as `session_closed` on boot.

## Decision

Patch the two c3-2 blocks so they say what c3-226 now owns: the in-process MCP server for the `mcp__kanna__*` tool surface, and the durable approval protocol that gates beacon tool calls. No other c3-2 content changes.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-2 | container | Responsibilities line and the c3-226 Goal Contribution row named the removed shims | c3-2#n12344@v1:sha256:58b6728ddbd3f22bcb965314f404b287b7add8fd1fa45eb7f4ebf9f12fbb9015 "Host the in-process MCP server for the" | Parent Delta: updated; wording only, no membership change |

## Verification

| Check | Result |
| --- | --- |
| c3x check | ok |
