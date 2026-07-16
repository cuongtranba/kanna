# Decompose Large Files — Loop Progress

Autonomous refactor: split the 5 largest source files below 600 LOC each,
keeping every gate green. One meaningful extraction per iteration.

## Goal
All 5 target files (src/server/ws-router.ts, src/server/agent.ts, src/server/event-store.ts, src/server/diff-store.ts, src/shared/types.ts) are each under 600 LOC AND lint, typecheck, the full test suite, and c3 check all pass.

## Verify command
```
bash scripts/verify-decomp.sh
```

## Progress (latest first)

- 2026-07-16 Extract project/sessions/sidebar/system/update WS handlers to ws-router-project.ts (system.ping, system.openExternal, update.check/install/reload, project.open/create/remove/setStar/readDiffPatch, sessions.importClaude, sidebar.reorderProjectGroups — 12 handlers, ProjectCommandDeps interface, handleProjectCommand) + 17 tests. ws-router.ts: 1703 → 1617 LOC.
- 2026-07-16 Extract misc WS handlers to ws-router-misc.ts (message.enqueue/steer/dequeue, terminal.create/input/resize/close, stack.create/rename/remove/addProject/removeProject/listWorktrees, share.mint/revoke/list — 16 handlers, MiscCommandDeps interface, handleMiscCommand) + 22 tests. ws-router.ts: 1771 → 1703 LOC.
- 2026-07-16 Extract push WS handlers to ws-router-push.ts (push.identifyDevice, push.subscribe, push.unsubscribe, push.test, push.setProjectMute, push.setFocusedChat — 6 handlers, PushManagerDep/PushCommandDeps interfaces, handlePushCommand) + 11 tests. ws-router.ts: 1800 → 1771 LOC.
- 2026-07-16 Extract agent-ctrl WS handlers to ws-router-agent-ctrl.ts (autoContinue.{accept,reschedule,cancel}, tunnel.{accept,stop,retry}, pty.cancel, pty.kill — 8 handlers, AgentCtrlCommandDeps/TunnelGatewayDep interfaces, handleAgentCtrlCommand) + 12 tests. ws-router.ts: 1835 → 1800 LOC.
- 2026-07-16 Extract orch/workflow/subagent WS handlers to ws-router-orch.ts (orch.run/cancelRun/getRun, workflows.getRun/getAgentTranscript, subagents.getRun — 6 handlers, OrchCommandDeps interface, handleOrchCommand) + 9 tests. ws-router.ts: 1845 → 1835 LOC.
- 2026-07-16 Extract diff/git command handlers to ws-router-diff.ts (15 chat.* diff cases, DiffCommandDeps interface, handleDiffCommand) + 10 tests. ws-router.ts: 1992 → 1845 LOC.
- 2026-07-16 Extract settings/subagent/MCP/LLM/skills command handlers to ws-router-settings.ts (testOAuthToken, resolveMcpTestBearer, runMcpAutoTest, handleSettingsCommand — 23 command cases) + 7 tests. ws-router.ts: 2277 → 1992 LOC.
- 2026-07-16 Extract skill utilities to ws-router-skills.ts (assertSafeSkill*, parseInstalledSkillsLock, listInstalledSkills, searchSkills, buildInstall/UninstallSkillCommand, installSkill, uninstallSkill) + 14 tests. ws-router.ts: 2449 → 2277 LOC.

## Failed approaches

- (none yet)

## Next chunk

ws-router.ts (1617 LOC): extract the remaining 17 direct `chat.*` command handlers into `src/server/ws-router-chat.ts`. Handlers to move: `chat.create` (store.createChat + analytics.track + broadcastChatAndSidebar), `chat.fork` (agent.forkChat + broadcastSidebar), `chat.rename` (store.renameChat + broadcastChatAndSidebar), `chat.archive` (store.archiveChat + broadcastSidebar), `chat.unarchive` (store.unarchiveChat + broadcastChatAndSidebar), `chat.delete` (agent.cancel + listLiveSchedules + cancelAutoContinue + closeChat + toolCallbackService.cancelAllForChat + store.deleteChat + analytics + broadcastSidebar), `chat.markRead` (store.setChatReadState + broadcastChatAndSidebar), `chat.setPolicyOverride` (store.setChatPolicyOverride + broadcastChatAndSidebar), `chat.setDraftProtection` (setDraftProtection dep: `(chatIds: string[]) => void`), `chat.send` (agent.send + agent.getActiveTurnProfile + logSendProfilingFn dep), `chat.cancel` (agent.cancel + toolCallbackService.cancelAllForChat), `chat.stopDraining` (agent.stopDraining), `chat.loadHistory` (store.getChat + store.getMessagesPageBefore), `chat.respondTool` (agent.respondTool), `chat.toolRequestAnswer` (agent.toolCallbackService.answer + store.getToolRequest + broadcastChatAndSidebar), `chat.respondSubagentTool` (agent.respondSubagentTool), `chat.cancelSubagentRun` (agent.cancelSubagentRun).

Define `ChatCommandDeps` with:
- `store`: Pick of EventStore (`createChat`, `renameChat`, `archiveChat`, `unarchiveChat`, `deleteChat`, `setChatReadState`, `setChatPolicyOverride`, `getChat`, `getMessagesPageBefore`, `getToolRequest`)
- `agent`: duck-typed Pick (`send`, `forkChat`, `cancel`, `cancelAutoContinue`, `listLiveSchedules`, `closeChat`, `stopDraining`, `respondTool`, `respondSubagentTool`, `cancelSubagentRun`, `getActiveTurnProfile`, `toolCallbackService?: { cancelAllForChat, answer } | null`)
- `analytics`: `{ track: (event: string) => void }`
- `setDraftProtection: (chatIds: string[]) => void` — wraps `ws.data.protectedDraftChatIds = new Set(chatIds)` in caller
- `logSendProfilingFn: (traceId: string | null | undefined, startedAt: number | null | undefined, stage: string, details?: Record<string, unknown>) => void` — wraps `logSendToStartingProfile` in caller
- `send: (envelope: ServerEnvelope) => number | undefined` — note: chat.send needs the byte count returned by send()
- `broadcastChatAndSidebar: (chatId: string) => Promise<void>`
- `broadcastSidebar: () => Promise<void>` — wraps `broadcastFilteredSnapshots({ includeSidebar: true })`

Create `handleChatCommand(deps, command, id): Promise<boolean>`. Add `ws-router-chat.test.ts` with at least 10 tests covering chat.create, chat.delete, chat.send, chat.cancel, chat.toolRequestAnswer, and sidebar broadcast behavior. Wire the 17 case labels + delegate call in ws-router.ts. Verify targeted lint/typecheck/test, commit, push, update this file.

## Worker rules (every subagent MUST follow)

1. You are on branch `refactor/decompose-large-files` in the main worktree. Do NOT switch branches. Commit here.
2. **C3 first**: before editing a file, run `c3x lookup <file>` (binary: `bash ~/.claude/skills/c3/bin/c3x.sh lookup <file>`) to load its component + refs. After editing, if you touched a component boundary / public contract, run `/c3 sweep` or author a `/c3 change` unit so `c3x check` stays green (it is part of the verify oracle).
3. **Extract, do not rewrite**: move cohesive chunks into new sibling modules with named exports. Preserve behavior exactly. Keep the original file as the public facade re-exporting/delegating where callers expect it.
4. **Side-effect seal**: any file doing IO must be `*.adapter.ts` or match an exempt glob. Never add `eslint-disable`.
5. **Strong typing**: named exports for every boundary type, no `any`.
6. **Colocated tests**: every new module gets a colocated `*.test.ts(x)`. Test only the files you created/changed (`bun test --conditions production src/path/new.test.ts`) — do NOT run the full suite (the loop's verify does that).
7. **Stable-ref selectors**: any new `use*Store` selector returns a stable ref (see CLAUDE.md render-loop rule).
8. Make ONE cohesive extraction, run the targeted checks, `git add` the specific files, commit with a clear message, then `git push origin refactor/decompose-large-files`.
9. Update this PROGRESS.md: append a line under `## Progress`, and rewrite `## Next chunk` to the next logical extraction. Then terminate.

## Chunk plan (high level — refine as you go)

- **ws-router.ts (2449)** → per-domain sub-routers: chat, diff, settings, workflows, orchestration, subagents, mcp, tool-callback. Each `ws-router-<domain>.ts` owns its command handlers; `ws-router.ts` becomes a thin dispatcher.
- **agent.ts (4998)** → sub-coordinators: claude-session-lifecycle, turn-orchestration, oauth-pool wiring, subagent-orchestration wiring, workflow-registration, loop+orchestration wiring, background-task keepalive, session-sweeper/idle-reaper. `AgentCoordinator` composes them.
- **event-store.ts (2537)** → split: core append/replay, snapshot fold, read-model derivations, orchestration-event application, subscriptions.
- **diff-store.ts (2251)** → split by concern (parsing/adapter IO vs domain read-model vs subscriptions).
- **shared/types.ts (2108)** → split by domain: chat/message types, provider+model catalog, settings types, subagent/orch types. Keep `types.ts` re-exporting for compat.
