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

- 2026-07-17 Extract loop + orchestration command handlers (~220 lines) to claude-loop-orch-commands.ts (LoopOrchCommandDeps interface, 11 exported fns: buildOrchWorker, buildOrchRunContext, runOrchestration, cancelOrchRun, getOrchRunDetail, clearClaudeSessionContext, deliverSubagentToMain, setupLoop, isLoopArmed, stopLoop, listLiveSchedules) + 22 tests. agent.ts: 2300 → 2103 LOC; new file 458 LOC.
- 2026-07-17 Extract auto-continue command handlers (~120 lines) to claude-autocontinue-commands.ts (AutoContinueCommandDeps interface, 8 exported fns: resolveAutoResumeFor, emitAutoContinueEvent, getChatSchedule, requireFuture, fireAutoContinue, acceptAutoContinue, rescheduleAutoContinue, cancelAutoContinue) + 26 tests. agent.ts: 2348 → 2300 LOC; new file 256 LOC.
- 2026-07-17 Extract session error-response handlers (~187 lines) to claude-session-error-handler.ts (SessionErrorHandlerDeps interface, 3 exported fns: handleLimitError, handleLimitDetection, handleAuthFailure; TOKEN_ROTATION_* constants relocated) + 20 tests. agent.ts: 2535 → 2348 LOC; new file 361 LOC.
- 2026-07-17 Extract session lifecycle helpers (~190 lines) to claude-session-lifecycle.ts (SessionLifecycleDeps interface, 8 exported fns: resolveClaudeIdleMs, resolveClaudeMaxResident, hasLiveWorkflow, hasPendingBackgroundTask, closeClaudeSession, maybeRegisterSdkWorkflowsDir, enforceClaudeSessionBudget, buildPoolUnavailableMessage) + 42 tests. agent.ts: 2599 → 2535 LOC; new file 283 LOC.
- 2026-07-17 Extract startClaudeTurn (~242 lines) to claude-session-spawner.ts (SpawnClaudeTurnDeps interface, spawnClaudeTurn exported fn) + 17 tests. agent.ts: 2799 → 2599 LOC; new file 401 LOC.
- 2026-07-17 Extract turn spawning pipeline (startTurnForChat + startTurnAfterTurnStarted) to claude-turn-starter.ts (StartTurnDeps interface, startTurnForChat exported fn) + 12 tests. Moved OAuthPoolUnavailableError to oauth-errors.ts. agent.ts: 3196 → 2799 LOC.
- 2026-07-17 Extract runClaudeSession session event loop to claude-session-runner.ts (RunClaudeSessionDeps) + 14 tests. Moved PendingToolRequest/ActiveTurn/ClaudeSessionState to claude-session-state.ts. agent.ts: 3675 → 3196 LOC.
- 2026-07-17 Extract ClaudeSessionHandle to harness-types.ts and startClaudeSession to claude-session-start.ts + 12 tests. agent.ts: 3892 → 3675 LOC.
- 2026-07-17 Extract isClaudeSteerLoggingEnabled, logClaudeSteer, SendMessageOptions, isSendToStartingProfilingEnabled, elapsedProfileMs, logSendToStartingProfile, SendToStartingProfile to claude-steer-log.ts + 18 tests. agent.ts: 3939 → 3893 LOC.
- 2026-07-17 Extract AsyncMessageQueue, discardedToolResult, toClaudeMessageStream to claude-sdk-queue.ts + 14 tests. agent.ts: 4007 → 3939 LOC.
- 2026-07-17 Extract prompt helpers (escapeXmlAttribute, buildAttachmentHintText, buildPromptText, STEERED_MESSAGE_PREFIX, buildSteeredMessageContent, isPromptTooLongMessage, isNoConversationFoundMessage, toSdkEffort, BACKGROUND_TASK_LAUNCH_RE, backgroundTaskIdsFromToolResult, positiveIntegerFromEnv) to claude-prompt-helpers.ts + 35 tests. agent.ts: 4095 → 4007 LOC.
- 2026-07-17 Extract session-config builders (buildUserMcpServers, resolveSpawnPaths, resolveStackProjects, CLAUDE_TOOLSET, SDK_RESTRICTED_FS_NATIVE_TOOLS, buildTaskNotification, SdkMcpEntry, TASK_NOTIFICATION_RESULT_MAX_CHARS) to claude-session-config.ts + 20 tests. agent.ts: 4219 → 4095 LOC.
- 2026-07-16 Extract buildCanUseTool + buildClaudeEnv + LOOP_BLOCKED_NATIVE_TOOLS + BuildCanUseToolArgs to claude-spawn-helpers.ts + 15 tests. agent.ts: 4378 → 4219 LOC.
- 2026-07-16 Extract Claude SDK harness stream processor to claude-harness-stream.ts (createClaudeHarnessStream — session_token, rate_limit, context_window_updated, result enrichment, api_error scrub, cost attachment) + 12 tests. agent.ts: 4520 → 4378 LOC.
- 2026-07-16 Extract context-window usage math to claude-usage-math.ts (normalizeClaudeUsageSnapshot, resolveFinalTurnUsage, maxClaudeContextWindowFromModelUsage, parseConfiguredContextWindowFromModelId, asRecord, asNumber) + 20 tests. agent.ts: 4614 → 4520 LOC.
- 2026-07-16 Extract Claude SDK message normaliser (ClaudeRawSdkMessage, getClaudeAssistantMessageUsageId, normalizeClaudeStreamMessage, timestamped, private helpers: stringFromUnknown, normalizeMcpServerEntry, normalizeToolContent, isSdkToClaudeMessage) to claude-message-normalizer.ts + 18 tests. agent.ts: 4998 → 4613 LOC.
- 2026-07-16 Extract mergeAppSettingsPatch + fallback builders (resolvedDiffStore, resolvedLlmProvider, resolvedAppSettings) to ws-router-defaults.ts (mergeAppSettingsPatch, buildInitialAppSettingsSnapshot, buildFallbackDiffStore, buildFallbackLlmProvider, buildResolvedAppSettings, ResolvedAppSettings) + 24 tests. ws-router.ts: 1548 → 1280 LOC.
- 2026-07-16 Extract chat WS handlers to ws-router-chat.ts (chat.create/fork/rename/archive/unarchive/delete/markRead/setPolicyOverride/setDraftProtection/send/cancel/stopDraining/loadHistory/respondTool/toolRequestAnswer/respondSubagentTool/cancelSubagentRun — 17 handlers, ChatCommandDeps interface, handleChatCommand) + 18 tests. ws-router.ts: 1617 → 1548 LOC.
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

agent.ts (2103 LOC): the next cohesive group is the **subagent provider-run
wiring** (~170 lines, lines ~1316–1487):

**Subagent builder** (2 methods, ~170 lines):
- `buildClaudeSubagentStarter` — builds the startClaudeSession callback for subagent runs (PTY/SDK dispatch, OAuth, MCP config, pool wiring)
- `buildSubagentProviderRunForChat` — constructs the full ProviderRunStart bundle for a subagent: resolves spawn paths, restriction, delegation context, then calls `buildSubagentProviderRun`

Extract to `src/server/claude-subagent-wiring.ts` with a
`SubagentWiringDeps` interface and corresponding standalone exports.

Survey:
```
grep -n "private buildClaudeSubagentStarter\|private buildSubagentProviderRunForChat" src/server/agent.ts
```

Expected: agent.ts 2103 → ~1940 LOC.

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
