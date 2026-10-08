# Agent SDK built-ins — Progress

Moving Kanna's hand-built agent code onto Claude Agent SDK built-ins, one PR per
unit. **Read `PLAN-agent-sdk-builtins.md` for the design, the decisions and the
per-PR file lists.**

## Goal

Fix the cost, policy and restricted-subagent bugs, remove the deprecated PTY
driver, and replace each hand-built piece with the SDK built-in, with every gate
green.

## Verify command

```
bun run check && bun run test && bun run check:arch && bun run lint:limits
```

## Progress (latest first)

- 2026-10-08 PR 3 (`refactor/remove-pty-driver`, #1206) — the PTY driver is
  gone: `src/server/claude-pty/**`, the loopback HTTP MCP server and channel
  push, the `ask_user_question` / `exit_plan_mode` stand-ins and
  `forceInteractiveToolCallbacks`, the PTY status panel and `pty-instances`
  topic, the `kanna-pty` skill, and every driver-preference branch.
  `claude-projects-path.adapter.ts` and `output-ring.ts` were relocated out of
  `claude-pty/`. Compatibility: a saved `claudeDriver.preference` is dropped
  silently with `lifecycle` kept (pinned by an `app-settings` test);
  `KANNA_CLAUDE_DRIVER=pty` logs one boot warning, so `src/server/server.ts`
  still names that variable — the plan's "grep comes back empty" check holds for
  `claude-pty` only; `KANNA_PTY_BACKGROUND_TASK_MAX_MS` is read as a fallback for
  `KANNA_CLAUDE_BACKGROUND_TASK_MAX_MS`; `TurnRunConfig.driver` is optional.
  Budget: the driver and `server.ts` allowances are deleted,
  `settings-bound-throws` drops to 13 and the `complexity` ceiling to 127
  (`runClaudeSession` fell from 131 to 122, so `SettingsPage` is now the peak).
  c3: adr-20261008-remove-pty-driver retires c3-225 and updates c3-206, 210,
  224, 226, 227, 229, 234 and 307. Suite 8143 pass / 0 fail; check, check:arch,
  lint:limits, lint:usestate, ast-grep test and lint:comments green.
- 2026-09-23 PR 2 (`fix/loop-guard-pretooluse`, #1150) — the armed-loop edit
  guard moved from `buildCanUseTool` to a PreToolUse hook
  (`buildLoopGuardHooks` in `claude-session-start.ts`) composed with the
  compaction hooks, because under `acceptEdits` the SDK approves in-cwd edits
  before `canUseTool` is ever asked. Denies `Edit`, `Write`, `NotebookEdit` and
  the subagent tool under both `Task` and `Agent`; `MultiEdit` dropped from
  `LOOP_BLOCKED_NATIVE_TOOLS`. Suite 8389 pass / 0 fail; check, check:arch,
  lint:limits and check:commits green.
- 2026-09-23 PR 1 (`fix/claude-cost-running-total`, #1149) — per-turn cost from the SDK
  running total. `createClaudeHarnessStream` now emits `costUsd` as the
  difference from the previous `total_cost_usd` and stores the raw value as
  `cumulativeCostUsd`; a respawned process reads it back through
  `EventStore.getLatestClaudeCumulativeCostUsd` as its baseline. Keep-alive
  subagent runs add up their turns. c3: adr-20260923-claude-cost-running-total
  updates the c3-307 Derived Materials rows. Suite 8402 pass / 0 fail; check,
  check:arch and lint:limits green.

## Next

PR 4 — `fix/policy-pretooluse-hook`: enforce the chat policy and subagent
folder restrictions with a deny-only PreToolUse hook over native tool names,
stop stripping `SDK_RESTRICTED_FS_NATIVE_TOOLS` from restricted subagents, and
delete the 8 `mcp__kanna__*` built-in stand-ins. Today a restricted subagent
has file tools only through those stand-ins, and only with
`KANNA_MCP_TOOL_CALLBACKS=1`.

## Decisions

- Session import stays hand-built: the SDK's `getSessionMessages` has no
  per-message timestamp or `toolUseResult`, both of which the importer needs.
- MCP `type: "ws"` is accepted by the bundled CLI; only the SDK `.d.ts` omits
  it. It gets typed, not removed.
- The chat policy is enforced deny-only through a PreToolUse hook; an `ask`
  verdict keeps today's behaviour.

## Failed approaches

- None yet.
