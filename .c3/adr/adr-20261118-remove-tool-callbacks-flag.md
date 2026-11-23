---
id: adr-20261118-remove-tool-callbacks-flag
c3-seal: 3ace064b897b4dd60f218865a85a72e5e6229e0bec90c32dbb8f4ac3b93a6c58
title: remove-tool-callbacks-flag
type: adr
goal: Remove the `KANNA_MCP_TOOL_CALLBACKS` feature flag, so that `AskUserQuestion` and `ExitPlanMode` have exactly one answer path (`buildCanUseTool` → `onToolRequest` → `PendingToolSlots` → `respondTool`) and the Kanna MCP host stops shipping the seven built-in shims (`read`, `glob`, `grep`, `bash`, `edit`, `write`, `webfetch`). The durable approval protocol (`tool-callback.ts`, `permission-gate.ts`, the ToolRequest store, `chat.toolRequestAnswer`) stays, because beacon tool approvals use it on every path.
status: done
date: "2026-11-18"
---

## Goal

Remove the `KANNA_MCP_TOOL_CALLBACKS` feature flag, so that `AskUserQuestion` and `ExitPlanMode` have exactly one answer path (`buildCanUseTool` → `onToolRequest` → `PendingToolSlots` → `respondTool`) and the Kanna MCP host stops shipping the seven built-in shims (`read`, `glob`, `grep`, `bash`, `edit`, `write`, `webfetch`). The durable approval protocol (`tool-callback.ts`, `permission-gate.ts`, the ToolRequest store, `chat.toolRequestAnswer`) stays, because beacon tool approvals use it on every path.

## Context

The flag was added in May 2026 (PR 105 and PR 107) as phase 1a of the Claude PTY driver: PTY mode had no `canUseTool` hook, so Kanna routed the interactive tools and file built-ins through MCP and a durable approval protocol. The PTY driver was removed (adr-20261008-remove-pty-driver), but the flag stayed, defaulting to off. It gated exactly two things: the `canUseTool` branch that sent ask/plan answers to `toolCallback.submit`, and the shim registration in `kanna-mcp.ts`.

Keeping two answer paths for one decision let them drift. The flag-on plan card had no clear-context option and its Edit button sent `user_canceled` instead of the user's feedback; Codex and Antigravity never used it. The "Answer questions?" auto-reject that the troubleshooting page cited the flag for was a PTY-only symptom (commit 23167258). Restart durability is equal on both paths: `recoverOnStartup` closes durable requests as `session_closed`, and `recoverDanglingChatTools` closes parked slots. The shims were not a security control for the main chat, since native Read/Edit/Bash stay available; path-confined subagents are bounded by their exclusive toolset, which never depended on the flag.

`ToolCallbackService` is built unconditionally at boot, and `kanna-mcp-beacon.ts` calls `submit` for every beacon tool, so the protocol itself is not flag-owned.

## Decision

Delete the flag branch in `buildCanUseTool` and its now-dead args, the shim files with their tests and registration, and the `INTERACTIVE_TOOLS` verdict in `permission-gate.ts`. Narrow `PendingToolRequestMessage` to the beacon and generic cards. Keep the durable protocol for beacon approvals. This wins over making the durable protocol the only path, which would rebuild clear-context, plan feedback, Codex/Antigravity support and busy-session protection on the path adr-20260807-pending-tool-slot deliberately deferred. Persisted data needs no migration: ToolRequest events keep their schema because beacon still writes them, and any old ask/plan pending record is fail-closed by `recoverOnStartup` on boot. Path-confined subagents keep no file tools, which is what they already had with the flag off.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-226 | component | Goal, Purpose, flows, contract, safety and derived-material rows described the flag and the seven shims | c3-226#n13670@v1:sha256:36ed55bf289ccb36dda2e5754700673eff77f3c112189b6daf666c194138856d "Owns the Kanna MCP host runtime: builds the in-process SDK MCP server" | Rows now describe one ask/plan path and the durable protocol as the beacon approval path; flag-off row removed |

## Verification

| Check | Result |
| --- | --- |
| grep -rn KANNA_MCP_TOOL_CALLBACKS src scripts e2e rules | no hits |
| bun run check | exits 0 |
| bun run check:arch | passes with lowered pins |
| bun run test | all pass except the pre-existing flaky workflow-watch-io.adapter test |
