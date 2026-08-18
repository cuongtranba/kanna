---
id: adr-20260818-cron-arm-confirmation
title: cron-arm-confirmation
status: done
---

# cron-arm-confirmation

## Decision

After a user types a `/cron` command that arms successfully, the host escalates
a review turn via `createCronConfirm` so the model can present the full job
configuration and ask the user to confirm, adjust, or disarm it before it runs
unattended. Applies only to the typed `/cron` path — `arm_cron` already
instructs the model to confirm in-turn.

## Before

A typed `/cron` arm produced only a `cron_armed` transcript card with no
interactive follow-up. The user had no affordance to catch a misconfigured
schedule (e.g., a typo in `0 9 * * *` that is invisible because the user
believed they typed what they meant) without reading the card carefully and
typing a second command.

## After

`createCronConfirm` (mirroring `createCronRepair`) enqueues a
`formatCronConfirmRequest` prompt after every successful typed arm and drains
the queue. The model presents the full `CronArmSummary` and calls
`AskUserQuestion` — options: Confirm / Change schedule / Change mode /
Change instruction / Disarm. On a change the model arms the corrected line and
removes the old job.

## Four bounds (each load-bearing)

1. **One confirmation per `jobId`.** A re-arm of the same line is a new job and
   gets its own confirmation. Bounded memory at 32 entries per chat.
2. **Stands aside for a queued user message.** Their explicit turn outranks this
   host-initiated one — same rule as `createCronRepair`.
3. **Typed path only.** `armCron` (the `arm_cron` MCP tool path) overrides
   `cronConfirm: undefined` at the call site — the tool result already instructs
   the model to call `AskUserQuestion`, so double-confirming degrades rather
   than improves the experience.
4. **Never throws into the send path.** A failed enqueue or drain is logged and
   swallowed; a working cron job survives the loss.

## Gate

`KANNA_CRON_CONFIRM=disabled` turns the escalation off; the `validate_cron` and
`arm_cron` tools are unaffected.

## Components changed

- c3-233 (cron-scheduler): `createCronConfirm`, `CronConfirmDeps`, `CronConfirm`
  in `src/server/cron/confirm.ts`; `cronConfirm` dep added to `CronCommandDeps`
  in `src/server/cron/commands.ts`; wired in `src/server/agent-deps-builders.ts`;
  `armCron` in `src/server/agent-coordinator.ts` overrides `cronConfirm:
  undefined`.
- c3-311 (cron-domain): `formatCronConfirmRequest` in
  `src/shared/cron/confirm-report.ts`.
