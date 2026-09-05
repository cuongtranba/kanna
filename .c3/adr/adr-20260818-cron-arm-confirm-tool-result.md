---
id: adr-20260818-cron-arm-confirm-tool-result
c3-seal: 29224db7a074c67ce7d689d503eb32425ae18e5363fdbb3c051ce178eb5ca7dd
title: cron-arm-confirm-tool-result
type: adr
goal: After a successful `arm_cron` call, return the job id, the full `CronArmSummary`, and an explicit `AskUserQuestion` instruction so the model presents the configuration for user confirmation before the job runs unchecked.
status: done
date: "2026-08-18"
---

## Goal

After a successful `arm_cron` call, return the job id, the full `CronArmSummary`, and an explicit `AskUserQuestion` instruction so the model presents the configuration for user confirmation before the job runs unchecked.

## Context

`arm_cron` previously returned `Armed.\n<formatCronArmSummary(...)>` as a flat text block. The job id was absent — so the model had no way to issue `/cron remove <jobId>` if the user chose to disarm after review. The tool description only covered the pre-arm ambiguity rule; there was no post-arm review contract.

Because `arm_cron` commits the `cron_armed` event before returning (arm-first, review-second), an unanswered or timed-out question leaves the job armed — the correct direction to fail. The review is a prompt contract, not a gate.

`runCronCommand` returned `Promise<void>`; the job id was generated inside the function but never surfaced to callers. Every interface that declared `runCronCommand` or `armCron` used `void` / `Promise<void>`, so there was no channel for the id.

## Decision

Change `runCronCommand` to return `Promise<string | null>` — the job id for successful arm commands, `null` for all other commands. Thread this through `AgentCoordinator.runCronCommand` (`Promise<string | null>`), `AgentCoordinator.armCron` (`Promise<{ jobId: string }>`), and every interface that declares either method (`claude-send-command.ts`, `ws-router-agent-ctrl.ts`, `claude-session-spawner.ts`, `claude-session-start.ts`, `claude-pty/driver.ts`, `agent-coordinator-types.ts`, `kanna-mcp.ts`).

The `arm_cron` tool result now reads:

```
Armed as <jobId>.
<formatCronArmSummary(summary)>

Now show this configuration to the user and confirm it with AskUserQuestion —
options: Confirm / Change schedule / Change mode / Change instruction / Disarm.
If they choose a change, call arm_cron again with the corrected line and
remove the old job with `/cron remove <jobId>`.
```

The `ARM_CRON_DESCRIPTION` gains a post-arm review rule alongside the existing pre-arm ambiguity rule.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-233 | component | runCronCommand return type widened from void to string \| null; armCron return type widened to { jobId } | src/server/cron/commands.ts, src/server/agent-coordinator.ts | arm_cron post-review prompt contract; jobId now surfaced through the command chain |
| c3-226 | component | arm_cron tool result contract changed: now includes jobId, AskUserQuestion instruction, and remove-old-job path | src/server/kanna-mcp.ts | buildCronToolList armCron return type updated |

## Verification

| Check | Result |
| --- | --- |
| bun test --conditions production src/server/kanna-mcp.test.ts | arm_cron: 7 tests pass (job id in result, AskUserQuestion instruction, description covers both rules) |
| bun test --conditions production src/server/cron/commands.test.ts | 18 tests pass |
| bun run test | 6489 pass, 0 fail |
| bun run lint | 0 errors, 0 warnings |
| bun run typecheck | 0 errors |
