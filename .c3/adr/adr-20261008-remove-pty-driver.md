---
id: adr-20261008-remove-pty-driver
c3-seal: 1586be08d352c40d043bdfd8a3acf25c622fda30d0ad428ebeae835d3bbba9a3
title: remove-pty-driver
type: adr
goal: Remove the deprecated PTY Claude driver. Every Claude and OpenRouter chat, subagent run and keep-alive session already runs through `startClaudeSession` on the Agent SDK; this change deletes the code that launched the `claude` CLI under a pseudo-terminal and tailed its transcript JSONL (`src/server/claude-pty/**`), the loopback HTTP MCP server only that driver needed, the PTY status panel, and the `KANNA_CLAUDE_DRIVER` and `claudeDriver.preference` selectors, and it retires component c3-225 (claude-pty-driver).
status: accepted
date: "2026-10-08"
---

## Goal

Remove the deprecated PTY Claude driver. Every Claude and OpenRouter chat, subagent run and keep-alive session already runs through `startClaudeSession` on the Agent SDK; this change deletes the code that launched the `claude` CLI under a pseudo-terminal and tailed its transcript JSONL (`src/server/claude-pty/**`), the loopback HTTP MCP server only that driver needed, the PTY status panel, and the `KANNA_CLAUDE_DRIVER` and `claudeDriver.preference` selectors, and it retires component c3-225 (claude-pty-driver).

## Context

The PTY driver existed to keep Pro/Max subscription billing, and it duplicated a lot to do it: a second MCP server transport, a second event parser with a parity matrix against the SDK stream, its own OAuth and trust-dialog handling, an instance registry with a live status panel, and a 1095-line driver module pinned over the architecture budget. Every shared file around the session (the coordinator, spawner, lifecycle, cancel handler, turn starter, runner and subagent wiring) branched on the driver preference. The user confirmed the driver is deprecated.

Constraints that shaped the removal: settings files in the wild may carry `claudeDriver.preference: "pty"` and must load without a "settings were reset" notice; turn logs written before this change carry `runConfig.driver`; and several PTY-adjacent pieces are used by SDK sessions and must stay: the idle-timeout and session-limit settings under `claudeDriver.lifecycle`, `pushChannelPrompt` for keep-alive subagents, the background-task launch-text regex that serves as the SDK version-skew fallback, `OutputRing`, the Claude project path helpers, and the SDK workflow-directory registration. The embedded terminal (`terminal-manager*`, c3-216, c3-118) is a different feature and is untouched.

## Decision

Delete the driver and everything that existed only for it, in one change, after relocating the shared helpers: `claude-pty/jsonl-path.adapter.ts` becomes `claude-projects-path.adapter.ts` (`computeJsonlPath` had no other caller and is dropped) and `claude-pty/output-ring.ts` becomes `output-ring.ts`. Strip the driver branches from the shared server, client and protocol files rather than leaving a dormant flag, and remove the unused `getSupportedCommands` from `ClaudeSessionHandle`.

Compatibility is handled at the edges instead of with a deprecation period. `normalizeClaudeDriverSettings` drops a saved `preference` silently and keeps `lifecycle`; `KANNA_CLAUDE_DRIVER=pty` logs one warning at boot and is otherwise ignored; `KANNA_PTY_BACKGROUND_TASK_MAX_MS` is renamed `KANNA_CLAUDE_BACKGROUND_TASK_MAX_MS` with the old name read as a fallback; `TurnRunConfig.driver` becomes optional so old turn logs still describe themselves and new turns do not write it. The lifecycle constants lose their PTY names. The architecture budget follows the code: the driver and `server.ts` module allowances are deleted, `settings-bound-throws` drops to 13 and the `complexity` ceiling to 127.

This is a `refactor`, not a breaking change: no supported behaviour is lost, because the removed mode was opt-in and deprecated.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-225 | component | Retired. The PTY driver, its transcript follower, TUI control, smoke test, PID and instance registries and CLI argument builder are deleted; the two helpers SDK sessions still need (Claude project path helpers, OutputRing) were moved out first | c3-225#n11925@v1:sha256:4a2c8826ac2e9bf058a3159aaf8fb48125730012f5a1d5a31f2f92ec595cdbb4 "Run the `claude` CLI under a pseudo-terminal, tail the on-disk transcript JSONL it writes under `~/.claude/projects/<encoded-cwd>/<session>.jsonl` as " | Retire. ref-provider-adapter and ref-event-sourcing keep governing c3-210 and c3-211; no ref or rule listed on c3-225 is left without a component |
| c3-210 | component | startClaudeSessionPTY, the driver preference resolver, the PTY branches in the cancel handler, lifecycle, turn starter, runner and subagent wiring, and the PtyInstanceRegistry wiring are removed; the background-task, compaction, LiveTurnSource and restriction rows lose their PTY clauses | c3-210#n11167@v1:sha256:ca6753652cc74facb772fe9c0b2c181c8ccf8285292b29d8bde2240ded58671b "Drive turn lifecycle across providers: start/cancel/resume Claude + Codex sessions, emit normalized transcript events." | ref-provider-adapter and ref-event-sourcing still apply: one Claude provider path remains and it emits HarnessEvents |
| c3-226 | component | The loopback HTTP MCP server, the channel-notification push, the ask_user_question and exit_plan_mode MCP stand-ins and the forceInteractiveToolCallbacks flag are deleted; the host is the in-process SDK MCP server only. The schedule_wakeup row documented a tool removed earlier and named the PTY driver, so it goes too | c3-226#n12005@v1:sha256:45261301f0a6af409208173fa9380d0a5c9d87a9ac356e8bd6bbf30c673b194b "Host the in-process loopback MCP server that the Claude driver attaches" | N.A - the mcp__kanna__* surface SDK sessions see is unchanged; native AskUserQuestion and ExitPlanMode already reach the durable approval protocol through canUseTool |
| c3-229 | component | Documented as PTY-only and fed by the PTY driver. SDK sessions register their workflows directory through maybeRegisterSdkWorkflowsDir, so the rows now say that, and the registry methods are named register and unregister as in code. The relocated claude-projects-path.adapter.ts and output-ring.ts are bound here | c3-229#n12221@v1:sha256:9c5e41d21a790c0400e25a6e5eaa788e5170938887d4c602d44ee6d61a9f841a "Watch Claude Code `wf_<runId>.json` sidecar files from disk, maintain a per-chat in-memory WorkflowRegistry read-model, broadcast WorkflowsSnapshot up" | N.A - WorkflowsSnapshot and the registry contract are unchanged |
| c3-224 | component | Change Safety rows described a PTY smoke-probe race and a PTY cold-boot stampede | c3-224#n11860@v1:sha256:83958c80216d6403486ea7946a485eaee4d3dcf444f5415be21e7ed47ac69aa9 "Own the multi-token Anthropic OAuth pool: pick the right token per chat turn, prevent two chats from sharing one token, mark tokens limited/errored on" | N.A - token pool behaviour is unchanged |
| c3-227 | component | The Purpose non-goals named c3-225 as the Claude transport | c3-227#n12082@v1:sha256:0ef718fb27e7c02a2e8fbf87c689c52d8fff12f8b2db15415c79e8d40e8dca12 "Detect provider rate-limit and auth-error endings on a Kanna chat," | N.A - auto-continue behaviour is unchanged |
| c3-234 | component | The TURN_COST_USD sparsity explanation named PTY-mode turns | c3-234#n12542@v1:sha256:d59fc951cc8df1a7c5bc914eb1c4f62301248537f392a7f83757ef212fbd2263 "Own the server's process- and turn-level observability: the pure instrument facade domain code calls, the single adapter that exports it, and the aler" | N.A - metric names and labels are unchanged |
| c3-307 | component | The Business Flow row for the PTY enrichment path cited c3-225 | c3-307#n13210@v1:sha256:3596a9966f403184a5051831f84aa6a937dea6d985c6a06b543fb43fd7e8f94b "Compute per-turn USD token cost and resolve model price schedules shared by client and server." | N.A - pricing math is unchanged |
| c3-104 | component | The tab status indicator row calls the badge the PTY session glyph | c3-104#n9902@v1:sha256:eb1b8c8fc7e97b9a50a0677918ba1db11fa3f7441c3de4dc1510844b09db89e7 "Own the user-editable pane tree: the split/close/move/focus algebra, its persistence as one workspace shared by every project, and the resizable rende" | N.A - the glyph and its table are unchanged |
| c3-206 | component | A tail-read note attributes dedup safety to PTY resume | c3-206#n10948@v1:sha256:e04d56e73404382bba111d31d12fd30ce75cd0fa5acbb6ba5811a68709533460 "Append events to JSONL, replay on boot, compact to snapshot.json when the log exceeds 2 MB." | N.A - the dedup rule is unchanged |
| c3-2 | container | Parent delta: Responsibilities no longer list the Claude CLI under PTY or a loopback MCP server, and the Components rows for c3-226 and c3-229 are reworded; the c3-225 row leaves with the retire | c3-2#n10648@v1:sha256:87984e312939cc03eed326c220cafc5c1bc82c40e789678100477a162a4901ce "Run the local Bun backend: serve HTTP+WebSocket on localhost, coordinate Claude + Codex agent turns, persist events, and broadcast derived read models" | Parent Delta: updated |
| ref-side-effect-adapter | N.A - ref (governing ref, text edit) | The leaf-IO example list named src/server/claude-pty/pty-process.adapter.ts | ref-side-effect-adapter#n13672@v1:sha256:d97da3a35cbbfc743202e4b37a53c5ae837c6f8c802bdd22685991e0bfe439ee "Keep every `node:fs`, `node:child_process`, `node:http`/`https`, `bun:sqlite`/`better-sqlite3`/`pg`, and `Bun.spawn`/`Bun.$`/`Bun.file`/`Bun.serve`/`B" | N.A - the rule is unchanged, only the example |
| rule-mcp-name-reserved | N.A - rule (governing rule, text edit) | The rule listed the PTY buildMcpConfigJson filter among its enforcement sites | rule-mcp-name-reserved#n13875@v1:sha256:14b198db67176b15a6f8ec8867c7a09d1960aec6a98bb33e1fc658ec05e52de3 "User MCP server names registered in `customMcpServers` must never equal" | N.A - still enforced at storage and in buildUserMcpServers |
| c3-0 | system | N.A - named only to complete the top-down descent | N.A - ancestor escape | N.A - no delta |
| c3-1 | container | N.A - named only to complete the top-down descent | N.A - ancestor escape | N.A - no delta |
| c3-3 | container | N.A - named only to complete the top-down descent | N.A - ancestor escape | N.A - no delta |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Keep the driver behind KANNA_CLAUDE_DRIVER=pty and stop maintaining it | The branches in the coordinator, spawner, lifecycle, cancel handler, turn starter and runner would stay, so every change to a session path still had to reason about a driver nobody tests; an unmaintained transport rots silently while still being selectable |
| Keep claudeDriver.preference and reject or reset a saved pty value | A saved value would raise the settings-were-reset notice for a setting that no longer exists, for users who chose it long ago; dropping the key silently and keeping lifecycle loses nothing |
| Remove claudeDriver.lifecycle together with the driver | SDK sessions use the idle timeout and the resident-session limit; deleting them would change behaviour for every user and orphan the Settings rows |
| Delete NoticeBanner with the PTY banner that was its only consumer | It is a generic, tested primitive with four variants; removing it is a separate decision from removing the driver |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| A claude process left by the old version is no longer reaped at boot, because the PID registry file is not read any more | Closing the pseudo-terminal master hangs the CLI up, so the window is a crash followed directly by an upgrade; the leftover claude-pty.json is inert | N.A - not automatable; documented here |
| A stale browser tab still subscribes to the removed pty-instances topic or sends pty.cancel and pty.kill | The tab reloads after a self-update; an unknown command falls through to the router default, and the topic falls through to the chat branch with no chat id | bun run test src/server/ws-router.test.ts src/server/ws-router-coverage.test.ts |
| Something SDK sessions use turns out to have lived only under claude-pty | The helpers found by grep were relocated first, and an orphan scan of production modules and exports before and after the change found only NoticeBanner and formatAge newly unused | bun run check and bun run test |
| An existing settings file with a pty preference raises a reset notice or loses its lifecycle values | The normalizer ignores the key and keeps lifecycle; one test loads such a file through the public settings API | bun run test src/server/app-settings.test.ts |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| src/ops/architecture/budget.ts | The module allowances for the driver and server.ts are gone, settings-bound-throws is pinned at 13 and the complexity pin at 127, so none of them can grow back unnoticed | bun run check:arch and bun run lint:limits |
| src/server/app-settings.test.ts | Pins that a settings file with preference pty loads with no warning and keeps its lifecycle values | bun run test src/server/app-settings.test.ts |
| grep over src | The only remaining reference to the removed driver name or its env var is the boot warning in src/server/server.ts | grep -rn "claude-pty\|KANNA_CLAUDE_DRIVER" src |

## Verification

| Check | Result |
| --- | --- |
| bun run check | typecheck, lint, client build and bundle budget pass |
| bun run test | all suites pass, none skipped |
| bun run check:arch and bun run lint:limits | pass; all four ESLint ceilings are tight |
| bun run lint:usestate, bunx ast-grep test, bun run lint:comments | pass |
| bun run check:commits --range origin/main..HEAD | every commit and the PR title parse for release-please |
| c3x check | no new issues; the stale code glob for c3-225 is gone with the fact |
