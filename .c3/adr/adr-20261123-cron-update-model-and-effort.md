---
id: adr-20261123-cron-update-model-and-effort
c3-seal: b2b17fe47269799ea944aa146e19acfad152702d7bf2993fbc70835f6a133ecb
title: cron-update-model-and-effort
type: adr
goal: Make a cron job's model and Claude reasoning effort editable in place through `cron.update`, the `/cron update` grammar and the `update_cron` MCP tool, and make `cron.update` reject a patch carrying an unknown key instead of acknowledging a no-op.
status: done
date: "2026-11-23"
---

## Goal

Make a cron job's model and Claude reasoning effort editable in place through `cron.update`, the `/cron update` grammar and the `update_cron` MCP tool, and make `cron.update` reject a patch carrying an unknown key instead of acknowledging a no-op.

## Context

`cronJobPatchSchema` was a plain `z.object` with instruction, mode, schedule and scheduleText. Zod strips unknown keys, so `kanna_command cron.update {patch:{model:"claude-sonnet-5-5"}}` parsed to an empty patch, emitted a no-op `cron_updated` and returned ok; `list_cron_jobs` showed the model unchanged. A job's model was set only at arm time, and its reasoning effort was never stored: `fireCronJob` hard-coded the default effort for a `[1m]` model and passed no options otherwise. Owners cutting cron token cost had no way to move a job to a cheaper model or lower effort short of removing and re-arming it.

## Decision

`CronJobPatch` gains `model` and `modelOptions` (the provider-keyed `ModelOptions` shape `chat.send` takes) and `cronJobPatchSchema` becomes a `z.strictObject` whose `modelOptions` uses a new `strictModelOptionsSchema`, so an unknown key at either level fails the command. `cron_updated` carries `model` and `modelOptions` only when the job has them, and the read model applies them only when present, so events logged before this change replay without wiping an armed model. A patched `modelOptions` merges per provider into the stored one. `fireCronJob` enqueues the stored model and options, forcing the 1M window for a `[1m]` model id. The grammar adds `/cron update <id> model <modelId>` and `/cron update <id> effort <level>`, and `update_cron` adds the two fields, so every surface shares one parser. Making the event carry model fields only when defined was chosen over a full-state overwrite because an overwrite would reset the model of every job whose log holds an older `cron_updated`.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-233 | component | update merges model and modelOptions into cron_updated; read model and fire path honour them; update_cron gains model and effort | c3-233#n14208@v1:sha256:99c1feac1d8b0a70c5478c0181a871ffa7936c28823c87303ba943927462c391 | Purpose states the strict patch, the conditional model fields and the fire-time options |
| c3-311 | component | parseCronCommand update grammar gains model and effort fields; CronJobPatch gains model and modelOptions | c3-311#n15523@v1:sha256:ab840ead5334ac4bbb03646f512dfdc688b765e19e31af53471ff5778db08eb6 | Purpose lists the new update fields |

## Verification

| Check | Result |
| --- | --- |
| bun run test src/server/cron src/shared/cron src/shared/commands src/server/kanna-mcp.test.ts | a model or effort update changes the derived job; a legacy cron_updated keeps the armed model; a fire enqueues the stored effort; cron.update rejects unknown patch keys |
| bun run check | exits 0 |
