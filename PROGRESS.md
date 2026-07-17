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

- 2026-07-17 Extract subagent run read-model (applySubagentEvent, getSubagentRuns, runningSubagentRuns) to event-store-subagent.ts as pure functions; EventStore delegates via fall-through case + thin wrappers + 19 tests. event-store.ts: 2169 → 2069 LOC; new file 156 LOC.
- 2026-07-17 Extract orchestration read-model (applyOrchEvent, toOrchRunSnapshot, nonTerminalOrchTasks, gatedOrchTasks, getOrchRun/Runs/TaskSpec/LastPhaseOutput/Events) to event-store-orch.ts as pure functions; EventStore delegates via thin wrappers + 32 tests. event-store.ts: 2350 → 2169 LOC; new file 312 LOC.
- 2026-07-17 Extract pure helper functions (normalizeSidebarProjectOrder, logSendToStartingProfile, getReplayEventPriority, encodeHistoryCursor, decodeCursor, slashCommandsEqual, coalesceContextWindowUpdates, getHistorySnapshot, getForkedChatTitle + TranscriptPageResult interface) to event-store-helpers.ts + 30 tests. event-store.ts: 2537 → 2351 LOC; new file 206 LOC.
- 2026-07-17 In-file deps builder refactor: extracted buildSpawnClaudeTurnDeps(): SpawnClaudeTurnDeps and buildRunClaudeSessionDeps(): RunClaudeSessionDeps as private helper methods in AgentCoordinator; reduced startClaudeTurn and runClaudeSession to one-liner delegates consistent with the rest of AgentCoordinator's build*Deps() pattern. Added type imports for SpawnClaudeTurnDeps + RunClaudeSessionDeps. agent.ts: 1317 → 1322 LOC (net +5: method headers added; inline object wrapper lines removed).
- 2026-07-17 Extract 5 session-config helpers (resolveClaudeDriverPreference, getEnabledCustomMcpServers, buildOAuthBearers, resolveChatPolicy, killPtyInstance) to claude-session-config-helpers.ts (ClaudeSessionConfigHelpersDeps interface, 5 exported fns; buildClaudeSessionConfigHelpersDeps deps-builder in AgentCoordinator; ensureFreshToken + killProcessTree injected to preserve side-effect seal; removed now-unused mergePolicyOverride + log imports from agent.ts) + 20 tests. agent.ts: 1327 → 1317 LOC; new module 148 LOC + 232 LOC tests.
- 2026-07-17 Extract chat management methods (~106 lines: stopDraining, closeChat, steer, dequeue, forkChat, generateTitleInBackground) to claude-chat-management.ts (ChatManagementDeps interface, 6 exported fns; buildChatManagementDeps deps-builder in AgentCoordinator; removed now-unused logClaudeSteer import from agent.ts) + 22 tests. agent.ts: 1384 → 1327 LOC; new module 251 LOC + 395 LOC tests.
- 2026-07-17 Extract respondTool (~54 lines) to claude-tool-respond.ts (ToolRespondDeps interface, standalone respondTool exported fn; buildToolRespondDeps deps-builder in AgentCoordinator; removed now-unused isRecord + normalizeToolContent imports from agent.ts) + 9 tests. agent.ts: 1425 → 1384 LOC; new file 142 LOC.
- 2026-07-17 Extract recreateActiveTurnFromSession + findLastUserMessageId (~50 lines) to claude-session-rebuild.ts (SessionRebuildDeps interface, 2 exported fns; buildSessionRebuildDeps deps-builder in AgentCoordinator) + 9 tests. agent.ts: 1447 → 1425 LOC; new file 101 LOC.
- 2026-07-17 Extract session state queries + idle-reaper (~57 lines) to claude-session-state-queries.ts (SessionStateQueryDeps interface, 8 exported fns: getActiveStatuses, getWaitStartedAtByChatId, getPendingTool, getDrainingChatIds, getSlashCommandsLoadingChatIds, getClaudeSessionStates, isClaudeSessionIdle, sweepIdleClaudeSessions; buildSessionStateQueryDeps deps-builder in AgentCoordinator) + 25 tests. agent.ts: 1461 → 1447 LOC; new file 160 LOC.
- 2026-07-17 Extract subagent pending tool-response handlers (~50 lines) to claude-subagent-tool-response.ts (SubagentToolResponseDeps interface, 6 exported fns: subagentPendingKey, rejectPendingResolvers, rejectPendingResolversForChat, rejectPendingResolversForRun, respondSubagentTool, cancelSubagentRun; buildSubagentToolResponseDeps deps-builder in AgentCoordinator) + 9 tests. agent.ts: 1476 → 1461 LOC; new file 165 LOC.
- 2026-07-17 Extract slash commands loader (~107 lines) to claude-slash-commands.ts (SlashCommandsDeps interface, ensureSlashCommandsLoaded + mergeLocalCatalog standalone exported fns; buildSlashCommandsDeps deps-builder in AgentCoordinator) + 13 tests. agent.ts: 1553 → 1476 LOC; new file 234 LOC.
- 2026-07-17 Extract send/queue handlers (~205 lines) to claude-send-command.ts (SendCommandDeps interface, 6 exported fns: resolveProvider, getProviderSettings, shouldInjectProactiveCompact, enqueueMessage, dequeueAndStartQueuedMessage, maybeStartNextQueuedMessage, sendCommand; buildSendCommandDeps deps-builder in AgentCoordinator) + 31 tests. agent.ts: 1758 → 1553 LOC; new file ~300 LOC.
- 2026-07-17 Extract cancelChat (~100 lines) to claude-cancel-handler.ts (CancelHandlerDeps interface, standalone cancelChat(deps, chatId, options?) exported fn; buildCancelHandlerDeps deps-builder in AgentCoordinator) + 25 tests. agent.ts: 1854 → 1758 LOC; new file 241 LOC.
- 2026-07-17 Extract runTurn (~135 lines) to claude-turn-runner.ts (RunTurnDeps interface, standalone runTurn exported fn; buildRunTurnDeps deps-builder in AgentCoordinator) + 15 tests. agent.ts: 1969 → 1854 LOC; new file 213 LOC.
- 2026-07-17 Extract subagent provider-run wiring (~140 lines) to claude-subagent-wiring.ts (SubagentWiringDeps interface, 2 exported fns: buildClaudeSubagentStarter, buildSubagentProviderRunForChat; buildSubagentWiringDeps deps-builder in AgentCoordinator) + 8 tests. agent.ts: 2103 → 1969 LOC; new file 324 LOC.
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

**event-store.ts (2069 LOC)**: extract the tool-request read-model into `event-store-tool-requests.ts`.

The tool-request concern (~45 lines of pure logic) operates on `toolRequestsById: Map<string, ToolRequest>`:
- Switch cases in `applyEvent`: `tool_request_put`, `tool_request_resolved` (lines ~728–743)
- `getToolRequest(id)`, `listPendingToolRequests(chatId)`, `scanAllToolRequests()` (lines ~1948–1994)

**Extraction approach**: standalone pure functions `applyToolRequestEvent(toolRequestsById, event)`, `getToolRequestFromMap(toolRequestsById, id)`, `listPendingToolRequestsFromMap(toolRequestsById, chatId)`, `scanAllToolRequestsFromMap(toolRequestsById)`. EventStore delegates. `toolRequestsById` stays in `StoreState`.

IO methods `putToolRequest` and `resolveToolRequest` stay in the class (they call `this.append`).

Survey the boundaries:
```bash
grep -n "tool_request_put\|tool_request_resolved\|toolRequestsById\|getToolRequest\|listPendingTool\|scanAllTool\|putToolRequest\|resolveToolRequest" src/server/event-store.ts
```

Expected: event-store.ts 2069 → ~2030 LOC; new file `event-store-tool-requests.ts` ~80 LOC + tests.

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
