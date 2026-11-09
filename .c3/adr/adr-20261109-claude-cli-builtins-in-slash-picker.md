---
id: adr-20261109-claude-cli-builtins-in-slash-picker
c3-seal: 8a7cfdd58a20e34ff98c6e7ac4e52fbc0f2e3b2afcff4d952aae1cb139e880dc
title: claude-cli-builtins-in-slash-picker
type: adr
goal: 'Make the composer `/` picker list Claude Code''s own built-in commands (such as /doctor, /context, /init, /security-review) for chats whose provider lets the Claude Code harness resolve `/name` itself. The commands come from the SDK''s `supportedCommands()` rows marked `builtin: true` and from `commands_changed` pushes, recorded by a server-wide catalog that persists across restarts and is merged into the project-commands list with the new scope `cli`.'
status: done
date: "2026-11-09"
---

# List Claude Code built-in commands in the slash picker

## Goal

Make the composer `/` picker list Claude Code's own built-in commands (such as /doctor, /context, /init, /security-review) for chats whose provider lets the Claude Code harness resolve `/name` itself. The commands come from the SDK's `supportedCommands()` rows marked `builtin: true` and from `commands_changed` pushes, recorded by a server-wide catalog that persists across restarts and is merged into the project-commands list with the new scope `cli`.

## Context

The picker is fed by the project-commands topic: `localCommandsForCwd` returns Kanna's three builtins plus the disk scan of `LocalCatalogService`. Commands bundled inside the Claude CLI have no file on disk, so they never appeared, even though the SDK reported them in `system_init` and typing `/doctor` already reached the CLI untouched (Claude chats skip Kanna's own slash expansion). Users saw /doctor in the Claude Code terminal picker but not in Kanna, and in one chat the model tried to invoke it through the Skill tool and was refused because the skill disables model invocation. c3-231 listed "route claude CLI commands" as a non-goal and its primary path said "no CLI merge", which this decision reverses for the picker only.

## Decision

Add a global catalog (`src/server/claude-cli-commands.ts`) owned by the agent coordinator. Every Claude session calls `supportedCommands()` once after the query is created, and `toClaudeMessageStream` forwards `commands_changed` messages; both feed `record`, which keeps only builtin rows, drops names starting with an underscore, ignores empty or identical lists, saves to `claude-cli-commands.json` in the data dir through an adapter, and triggers a full broadcast. `localCommandsForCwd` orders the list as Kanna builtins, then CLI built-ins, then disk entries, dropping only names that collide with a Kanna builtin. The client hides scope `cli` rows unless `providerExpandsSlashCommands(provider)` is true, so Codex chats never offer commands their harness cannot run, while disk entries that share a CLI name stay available to them. The rows are global rather than per project because built-in rows belong to Claude Code itself, and persisting them means the picker is complete right after a restart, before any session starts.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-231 | component | The picker list it feeds now merges recorded Claude Code built-ins, reversing its no-CLI-merge non-goal; new Contract and Derived Materials rows for the CLI catalog | c3-231#n13748@v1:sha256:02061f393d5b847d734452edf73563570baf2aa5ddf1bf1453e79fec30ea6fbe | ref-side-effect-adapter: file IO stays in claude-cli-commands-file.adapter.ts; ref-colocated-bun-test: tests next to source |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Use the names from system\_init slash\_commands | Names only, no descriptions or argument hints, no builtin marker, and they arrive per chat transcript rather than as a server-owned list |
| Spawn a probe query per project when the topic is first read | Starts an extra CLI process with the user's MCP servers on every restart; the persisted list from real sessions is cheaper and authoritative |
| Keep the list only in memory | After every Kanna restart the picker would lack the built-ins until a Claude session started |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| A Codex chat offers a CLI-only command | Client filters scope cli by providerExpandsSlashCommands | SlashCommandTypeaheadPlugin.test.tsx Codex case |
| A failed or empty SDK reply wipes the saved list | record ignores empty lists; supportedCommands errors are logged and dropped | claude-cli-commands.test.ts |

## Verification

| Check | Result |
| --- | --- |
| bun run test src/server/claude-slash-commands src/server/claude-cli-commands src/client/components/lexical/plugins/SlashCommandTypeaheadPlugin | 3 files, 37 tests passed |
| bun run lint, bun run typecheck, bun run check:arch | clean |
