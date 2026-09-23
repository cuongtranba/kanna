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

- 2026-09-23 PR 1 (`fix/claude-cost-running-total`) — per-turn cost from the SDK
  running total. `createClaudeHarnessStream` now emits `costUsd` as the
  difference from the previous `total_cost_usd` and stores the raw value as
  `cumulativeCostUsd`; a respawned process reads it back through
  `EventStore.getLatestClaudeCumulativeCostUsd` as its baseline. Keep-alive
  subagent runs add up their turns. c3: adr-20260923-claude-cost-running-total
  updates the c3-307 Derived Materials rows. Suite 8402 pass / 0 fail; check,
  check:arch and lint:limits green.

## Next

PR 2 — `fix/loop-guard-pretooluse`: replace the loop branch of `buildCanUseTool`
with a PreToolUse hook composed with the compaction hooks.

## Decisions

- Session import stays hand-built: the SDK's `getSessionMessages` has no
  per-message timestamp or `toolUseResult`, both of which the importer needs.
- MCP `type: "ws"` is accepted by the bundled CLI; only the SDK `.d.ts` omits
  it. It gets typed, not removed.
- The chat policy is enforced deny-only through a PreToolUse hook; an `ask`
  verdict keeps today's behaviour.

## Failed approaches

- None yet.
