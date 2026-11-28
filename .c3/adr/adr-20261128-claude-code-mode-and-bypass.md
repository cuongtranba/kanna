---
id: adr-20261128-claude-code-mode-and-bypass
c3-seal: 265744f93cc8bf91f0ae7942dfb793500947a79147035a3a2da242f1073c4be7
title: claude-code-mode-and-bypass
type: adr
goal: Run Claude chats in Claude Code "Code Mode" by default with an app-level off switch, and run them in the `bypassPermissions` ("yolo") permission mode, falling back to `acceptEdits` where the CLI refuses bypass. Code Mode lets Claude batch many tool calls into one script, which cuts round trips; Kanna adds no per-call approval step in front of it.
status: proposed
date: "2026-11-28"
---

## Goal

Run Claude chats in Claude Code "Code Mode" by default with an app-level off switch, and run them in the `bypassPermissions` ("yolo") permission mode, falling back to `acceptEdits` where the CLI refuses bypass. Code Mode lets Claude batch many tool calls into one script, which cuts round trips; Kanna adds no per-call approval step in front of it.

## Context

Kanna started every Claude session with `permissionMode: "acceptEdits"` and never enabled Code Mode. Code Mode turns on in Agent SDK apps only through the `query()` `settings` option (`settings.env.CLAUDE_CODE_EXPERIMENTAL_CODE_MODE = "1"`); the plain `env` option is ignored for that variable, which was measured on SDK 0.3.332 (CLI 2.1.332). The CLI owns eligibility: an older model, an endpoint provider, or a `tools` list without REPL starts the session without Code Mode and emits only a `code-mode-opt-in` notification. A session started in Code Mode cannot be resumed without the flag or on an ineligible model; the CLI fails with an error result containing "This session was started in Code Mode" that ends "so it can't be resumed." The calls a Code Mode script makes arrive on the SDK stream as ordinary tool_use and tool_result messages, so PreToolUse hooks (loop guard, Inbox guard) and `canUseTool` for AskUserQuestion still fire. `bypassPermissions` needs the `allowDangerouslySkipPermissions` option, and the CLI exits when run as root unless `IS_SANDBOX=1` or `CLAUDE_CODE_BUBBLEWRAP` is set.

## Decision

`AppSettingsSnapshot.claudeCodeMode` (default true, edited from Settings, Providers) is read at spawn time by `spawnClaudeTurn` and by the subagent starter, and passed as `StartClaudeSessionArgs.codeMode`. `startClaudeSession` passes `CLAUDE_CODE_MODE_SETTINGS` as the SDK `settings` option only when it is true. The setting is not part of the respawn fingerprint, so toggling it never respawns a live session; it applies to new sessions. Kanna adds no model eligibility rule; the CLI decides. One function in `claude-session-start.ts` owns the permission mode (plan, else bypassPermissions when allowed, else acceptEdits) and serves both the `query()` start and `setPermissionMode`. `allowDangerouslySkipPermissions` is set whenever bypass is allowed, including plan-mode starts, so a later switch from plan works. Bypass is allowed unless the process is root without a sandbox marker; `claude-bypass-permissions.adapter.ts` computes that and `StartClaudeSessionDeps` injects it. The SDK call is injected as a `query` port. The retry predicate for a missing session is renamed `isUnresumableSessionMessage` and also matches the Code Mode refusal, so a refused resume reruns on a fresh session primed with history, the path PR #1505 added for "No conversation found". Alternative rejected: a Kanna-side model eligibility check, which would duplicate rules the CLI changes between releases.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-210 | component | Session start, the spawner, the subagent starter and the turn-failure classifier change the permission mode, pass Code Mode settings and widen the fresh-session retry | c3-210#n13024@v1:sha256:665854e925315d2fa9d4149dd4217fe6acb53b625fd6cc26cd6a06f52f22c20a "agent-coordinator" | ref-provider-adapter: both providers keep one transcript model; the IO seal is kept by the new adapter |
| c3-301 | component | AppSettingsSnapshot and AppSettingsPatch gain claudeCodeMode with its zod schema | c3-301#n15184@v1:sha256:8d8460221bf4eb295f964884b40a9ba6302a9c2af2f9b1997cbed42fda139de8 "types" | ref-strong-typing: the field is a plain boolean and both schema and interface carry it |
| c3-116 | component | The Providers settings branch gains a Code Mode row on the pending segmented control | c3-116#n11968@v1:sha256:1c5d8a9a14ec80d93f633ef1f3b0f812c227b8fe873544f12b236a45fcbec8bd "settings-page" | kanna-react-style: the write goes through runPendingAction |

## Verification

| Check | Result |
| --- | --- |
| bun run test src/server/claude-session-start.test.ts src/server/claude-session-spawner.test.ts src/server/app-settings.test.ts src/server/agent.test.ts src/server/claude-prompt-helpers.test.ts | Code Mode settings only when codeMode is true, bypass and acceptEdits mapping, no respawn on toggle, claudeCodeMode default and round trip, Code Mode refusal reruns on a fresh session |
| bun run lint, bun run typecheck, bun run lint:comments, bun run check:arch | exit 0 |
| c3x check | exits 0 |
