---
id: adr-20260805-loop-chunk-label
c3-seal: ccce50389a66433205e349ba942b2cab33cbb554572ef4afe69dd3dc13d8cb6e
title: loop-chunk-label
type: adr
goal: 'Make each row of the Loop Progress panel read as the chunk it worked on, instead of the identical server-rendered boilerplate that opens every loop delegation prompt. Two channels: the orchestrator names the chunk in a `[chunk: …]` marker at the head of the worker prompt, and — when it does not — the host reads the chunk deterministically from the plan''s `## Next chunk`. The second channel requires `KannaMcpArgs.getArmedLoop`, which was declared and consumed but never passed by any caller, so wire it end-to-end; that repair also un-hides `run_verify` and stops a worktree loop resolving its tracking file against the chat cwd.'
status: proposed
date: "2026-08-05"
---

## Goal

Make each row of the Loop Progress panel read as the chunk it worked on, instead of the identical server-rendered boilerplate that opens every loop delegation prompt. Two channels: the orchestrator names the chunk in a `[chunk: …]` marker at the head of the worker prompt, and — when it does not — the host reads the chunk deterministically from the plan's `## Next chunk`. The second channel requires `KannaMcpArgs.getArmedLoop`, which was declared and consumed but never passed by any caller, so wire it end-to-end; that repair also un-hides `run_verify` and stops a worktree loop resolving its tracking file against the chat cwd.

## Context

An armed loop rendered its Progress panel as three identical rows:

```
Progress                                    ● Loop running
Do the next chunk in PROGRESS-session-tabs.md. All work happens in /home/cuong/…
Do the next chunk in PROGRESS-session-tabs.md. All work happens in /home/cuong/…
Do the next chunk in PROGRESS-session-tabs.md. All work happens in /home/cuong/…
```

`SubagentRunSnapshot.label` exists precisely to prevent that — its docstring says a row should read "as the chunk it worked on rather than an opaque run id". It is computed by `deriveChunkLabel(prompt)` (`src/shared/loop-progress.ts`), the first non-blank line of the spawn prompt. That heuristic holds for an ad-hoc delegation, where the model authored the prompt. It fails for a loop, because a loop's prompt is **not** model-authored: `renderLoopPrompt` (`src/server/loop-template.ts`) joins the worker brief into ONE line beginning `Do the next chunk in <file>. All work happens in <workdir>.` and the orchestrator is instructed to reproduce it verbatim. Capped at 80 chars that boilerplate *is* the label, identically every iteration. The delegation prompt carries zero chunk identity; the chunk exists only in the tracking file's `## Next chunk`.

Tracing the deterministic fix surfaced a second, independent defect. `KannaMcpArgs.getArmedLoop` — the per-call armed-loop accessor added by adr-20260805-loop-oracle-hardening — is read by `buildTrackingDocToolList` and `buildRunVerifyToolList` but was **never supplied** by either construction site (`createKannaMcpServer` in `claude-session-start.ts`, `startKannaMcpHttpServer` in `claude-pty/driver.ts`). Consequences in production: `run_verify` never registered, so the memoized oracle was dead code; and the tracking-doc tools always resolved against the chat cwd, so a loop armed with `workdir` = sibling worktree wrote its progress into the wrong checkout — the same wrong-file class as defect 3 of adr-20260805.

## Decision

Two channels, first-match-wins, so a label can never fall back to boilerplate.

**Channel 1 — the `[chunk: …]` marker.** The rendered worker prompt opens with `[chunk: <one-line summary of the Next chunk you just read>]`, and step 4 states that this is the single substitution the orchestrator makes in an otherwise verbatim call. `deriveChunkLabel` consults `parseChunkMarker` first, so the existing derivation point needs no new caller. A bracketed marker rather than a prose prefix because the worker prompt is a single joined line — any prose form would need sentence-splitting to cut the label out. The marker also follows the contract already in this template, whose worker brief asks the model to substitute `<date>`, `<chunk>` and `<the single next chunk, or DONE…>`.

**Channel 2 — the plan.** When the marker arrives unsubstituted (body still wrapped in `<…>`) or absent, the MCP host reads the armed loop's tracking file and takes the first line of `## Next chunk` (`chunkLabelFromSection`). At delegate time that section IS the chunk being delegated — the worker rewrites it only after finishing — so this needs no model cooperation. It is the channel that makes the fix a guarantee rather than a prompt-engineering hope.

Channel 1 wins on conflict because it is per-delegation: under `parallelism > 1` a turn delegates several chunks and one shared plan section cannot distinguish them.

The label override enters through `delegateRun({label})` → `spawnRun`, which falls back to `deriveChunkLabel(userInstruction)`. The file read stays in `kanna-mcp.ts` (which already imports `structured-doc-io.adapter`), so no IO enters `subagent-orchestrator.ts` and the side-effect seal holds.

**`getArmedLoop` is wired ungated by depth.** `isLoopArmed` is correctly gated to `delegationContext.depth === 0` — only the orchestrator's own tools are blocked. Copying that gate here would be wrong: the tracking-doc tools are deliberately registered for subagents too, and a worker without the loop's `workdirAbs` resolves its `file:` against the chat cwd. Subagent spawns bypass the spawner, so the accessor is threaded separately through `SubagentWiringDeps` → `BuildSubagentProviderRunArgs` → both drivers. `toArmedLoopInfo` is the single `LoopState` → `ArmedLoopInfo` adapter so the two spawn paths cannot drift.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| kanna-mcp tool surface | N.A - src/server/kanna-mcp.ts unmapped | Gains the chunk-label resolver; ArmedLoopInfo gains trackingFileRel; delegate_subagent gains a label override | N.A - unmapped file | Resolver must fail soft — a missing label may never fail a delegation |
| Loop template | N.A - src/server/loop-template.ts unmapped | Worker prompt gains the [chunk: …] marker; requiredSubstrings gains "[chunk:" | N.A - unmapped file | Structural invariant must pin the marker so a later edit cannot drop it |
| Auto-continue event schema | N.A - src/server/auto-continue/** unmapped | loop_armed gains optional trackingFileRel; LoopState gains the nullable field | N.A - unmapped file | Optional on the event so loops armed earlier replay without it |
| Claude session spawn wiring | N.A - claude-session-spawner / claude-subagent-wiring unmapped | Supplies getArmedLoop to both drivers, for main AND subagent spawns | N.A - unmapped file | Must NOT copy isLoopArmed's depth-0 gate |

## Verification

| Check | Result |
| --- | --- |
| bun test --conditions production src/shared/loop-progress.test.ts | 17 pass — marker parse, unsubstituted-placeholder rejection, chunkLabelFromSection over a real ## Next chunk, DONE → empty |
| bun test --conditions production src/server/kanna-mcp.test.ts | 58 pass — incl. 4 new: plan fallback labels a loop delegation chunk 4; substituted marker wins; legacy loop with trackingFileRel: null yields no label and no error; no armed loop leaves ad-hoc delegations untouched |
| bun test --conditions production src/server/kanna-mcp-tools/delegate-subagent.test.ts | 13 pass — incl. a throwing resolver that must not fail the delegation |
| bun test --conditions production src/server/loop-template.test.ts src/server/auto-continue/read-model.test.ts | 74 pass — rendered prompt carries the marker; deriveLoopState replays a legacy loop_armed as trackingFileRel: null |
| bun run test | 4897 pass, 2 skip, 0 fail |
| bun run lint / bun run typecheck / bunx ast-grep test / bun run lint:usestate | all clean |
| Manual, post-merge | Arm a loop with workdir = sibling worktree; over two iterations the panel shows two DIFFERENT chunk names, progress rows land in the worktree's tracking file, and run_verify is offered to the model |
