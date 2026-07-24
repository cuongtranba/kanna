---
id: adr-20260724-slash-picker-local-only
c3-seal: 1aa8665fbde182501b6073f40d5997921d8d6a3fd523bf7e69dcaac7a6c9eaae
title: slash-picker-local-only
type: adr
goal: |-
    Populate the composer `/` picker **exclusively** from the local disk-scanned
    catalog restricted to **project + personal (user) scopes**, and **remove the
    Claude Code CLI initialization** (ephemeral `claude` spawn + `getSupportedCommands()`)
    from every slash-command load path. The picker must fill instantly from disk and
    never block on a subprocess spawn.
status: accepted
date: "2026-07-24"
---

# slash-picker-local-only

## Goal

Populate the composer `/` picker **exclusively** from the local disk-scanned
catalog restricted to **project + personal (user) scopes**, and **remove the
Claude Code CLI initialization** (ephemeral `claude` spawn + `getSupportedCommands()`)
from every slash-command load path. The picker must fill instantly from disk and
never block on a subprocess spawn.

## Context

`ensureSlashCommandsLoaded` (`src/server/claude-slash-commands.ts`) fired on
chat-open and, for a chat with no live session, cold-spawned the ~265 MB `claude`
binary purely to read built-in command names via `getSupportedCommands()`,
merging them with the local catalog. On WSL2 / CLI ≥2.1.x (no `system_init` row)
that await stalled to the 15 s hard timeout, leaving the picker on an empty
loading skeleton — observed as a "hang". Two further paths re-injected the CLI
list on every real turn: `claude-session-spawner.ts` (post-spawn refresh) and
`claude-session-runner.ts` (on the `system_init` event). The local catalog
(`c3-231`, project + personal + plugin) is already available synchronously from
disk with no spawn. Supersedes `adr-20260623-local-skill-catalog`, whose design
merged the local catalog **on top of** the CLI list; this reverses the CLI half.

## Decision

Make the local catalog the SOLE source of the picker's commands, filtered to
project + personal scopes (plugin scope and CLI built-ins excluded). Rewrite
`ensureSlashCommandsLoaded` to read `LocalCatalogService.list(cwd)`, filter to
`scope ∈ {project, personal}`, and record — no session spawn, no timeout, no
oauth lease, no CLI command cache. Delete the two post-spawn / `system_init` CLI
refresh paths and the now-dead `SlashCommandCache` + `mergeLocalCatalog(cli, local)`
helper. `LocalCatalogService` itself is unchanged (it still scans all three
scopes); the scope restriction is applied at the consumer. Chosen over keeping a
CLI fallback because the spawn is the sole hang source and the local catalog
already covers everything the user authored locally.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-210 | component | Owns ensureSlashCommandsLoaded; the CLI ephemeral spawn + getSupportedCommands merge is removed, and the local catalog is loaded once on chat-open rather than merged "at every record site" | c3-210#n6882@v1:sha256:ac139195d649863daa63b0f248486009c4b6fc7f97171613fd7ced17a48dba01 | Update the c3-231 governance row to describe local-only sourcing |
| c3-231 | component | Its documented Business Flow said the coordinator merges the local list into the CLI list and falls back to the CLI list when a scan throws; local (project+personal) is now the sole source and a scan failure yields an empty list | c3-231#n8034@v1:sha256:02d767c244d8b222ef069c673bb636f0aa9bf2c7a12e2c3ddb0710dd20e1f0c8 | Update Business Flow Primary-path + scan-failure rows |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Keep the CLI fetch but show the local catalog optimistically first | Still spawns the 265 MB binary per fresh cwd and keeps the stall/timeout code path; the user explicitly asked to remove the CLI init entirely |
| Include plugin-scope entries too | "local + user scope" excludes plugin; plugin/marketplace entries are the bulk of the 200+ noise the user wants gone |
| Cache the CLI list longer to hide the spawn | The first chat in every cwd still pays the cold-spawn cost, and CLI ≥2.1.x can never resolve system_init |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Built-in CLI commands (/model, /clear) no longer appear in the picker | Intentional per the decision; these are CLI REPL commands, not Kanna actions | Manual: press / and confirm only project + personal skills list |
| A chat that already recorded a CLI list (pre-change data) keeps showing it | The already-loaded guard skips reload; a fresh chat loads the new local-only list | New chat in a fresh cwd shows local-only commands |

## Verification

| Check | Result |
| --- | --- |
| bun test --conditions production src/server/claude-slash-commands.test.ts src/server/agent.test.ts src/server/claude-session-spawner.test.ts src/server/claude-session-runner.test.ts | pass |
| bun run typecheck && bun run lint | clean |
| Manual (agent-browser, real binary): fresh-cwd chat, press / | list appears instantly, only project + personal skills, no plugin x:y entries, grep "spawning ephemeral" server.log empty |
