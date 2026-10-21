# C3 Structural Index
<!-- hash: sha256:f8a521c51799a6f26e9c4636d68145d051fbfef3804a3bf156310009095eb299 -->

## c3-0 — Kanna (system)

## c3-1 — Client (container)
context: c3-0

## c3-101 — socket-client (component)
container: c3-1 | context: c3-0
refs: ref-strong-typing, ref-ws-subscription, rule-strong-typing
files: src/client/api/**/*.ts, src/client/app/KannaSocketProvider.tsx, src/client/app/SocketBridge.tsx, src/client/app/pushClient.test.ts, src/client/app/pushClient.ts, src/client/app/socket-protocol.ts, src/client/app/socket.test.ts, src/client/app/socket.ts, src/client/query/**/*.ts

## c3-102 — state-stores (component)
container: c3-1 | context: c3-0
refs: ref-colocated-bun-test, ref-strong-typing, ref-zustand-store, rule-colocated-bun-test, rule-strong-typing, rule-zustand-store
files: src/client/lib/createScopedStore.tsx, src/client/stores/**/*.ts

## c3-103 — ui-primitives (component)
container: c3-1 | context: c3-0
refs: ref-strong-typing, rule-strong-typing
files: src/client/components/CopyButton.store.ts, src/client/components/OpenExternalSelect.store.ts, src/client/components/editor-icons.tsx, src/client/components/ui/**/*.tsx, src/client/components/ui/searchable-select.store.ts, src/client/components/ui/searchable-select.test.ts, src/index.css

## c3-104 — pane-layout (component)
container: c3-1 | context: c3-0
refs: ref-colocated-bun-test, ref-strong-typing, ref-zustand-store
files: src/client/components/panes/**/*.ts, src/client/components/panes/**/*.tsx

## c3-110 — app-shell (component)
container: c3-1 | context: c3-0
refs: ref-cqrs-read-models, ref-ws-subscription
files: src/client/adapters/*.ts, src/client/app/App.test.tsx, src/client/app/App.tsx, src/client/app/AppBootstrap.tsx, src/client/app/AppGlobalProvider.tsx, src/client/app/PageHeader.tsx, src/client/app/appRuntime.test.ts, src/client/app/appRuntime.ts, src/client/app/bulkChatRemoval.ts, src/client/app/chatFocusPolicy.test.ts, src/client/app/chatFocusPolicy.ts, src/client/app/chatNotifications.ts, src/client/app/derived.ts, src/client/app/drawerVisual.ts, src/client/app/forgetDeletedLocally.ts, src/client/app/share-view/**/*.ts, src/client/app/share-view/**/*.tsx, src/client/app/sidebarSwipeGesture.ts, src/client/app/useAppGlobalState.test.ts, src/client/app/useAppGlobalState.ts, src/client/app/useKannaState.scrollback.test.tsx, src/client/app/useKannaState.test.ts, src/client/app/useKannaState.ts, src/client/app/usePushFocus.test.ts, src/client/app/usePushFocus.ts, src/client/app/useWaitingChatTabs.ts, src/client/components/LocalDev.tsx, src/client/components/quick-switcher/**/*.tsx, src/client/hooks/**/*.ts, src/client/hooks/**/*.tsx, src/client/hooks/useBeaconSuggestions.ts, src/client/hooks/useProjectSuggestions.test.ts, src/client/hooks/useProjectSuggestions.ts, src/client/lib/**/*.ts, src/client/lib/beaconMentionChips.ts, src/client/ports/**/*.ts, src/main.tsx, src/vite-env.d.ts

## c3-111 — sidebar (component)
container: c3-1 | context: c3-0
refs: ref-cqrs-read-models, ref-zustand-store, rule-zustand-store
files: src/client/app/KannaSidebar.tsx, src/client/app/SidebarUtilityNav.tsx, src/client/app/sidebarNumberJump.test.ts, src/client/app/sidebarNumberJump.ts

## c3-112 — chat-page (component)
container: c3-1 | context: c3-0
refs: ref-cqrs-read-models, ref-ws-subscription
files: src/client/app/BackgroundTasksSection.store.ts, src/client/app/BackgroundTasksSection.test.tsx, src/client/app/BackgroundTasksSection.tsx, src/client/app/ChatPage.test.ts, src/client/app/ChatPage/**/*.ts, src/client/app/ChatPage/**/*.tsx, src/client/app/LoopProgressSection.test.tsx, src/client/app/LoopProgressSection.tsx, src/client/app/chatNavigator.ts, src/client/app/useRightSidebarToggleAnimation.ts, src/client/app/useStickyChatFocus.ts, src/client/app/useTerminalToggleAnimation.ts, src/client/components/messages/LoopDisarmedMessage.test.tsx, src/client/components/messages/LoopDisarmedMessage.tsx, src/client/components/panes/PageTabContent.tsx

## c3-113 — transcript (component)
container: c3-1 | context: c3-0
refs: ref-provider-adapter, ref-tool-hydration
files: src/client/app/KannaTranscript.test.tsx, src/client/app/KannaTranscript.tsx, src/client/app/subagent-run-placement.test.ts, src/client/app/subagent-run-placement.ts, src/client/app/transcriptActionsContext.tsx, src/client/app/transcriptSpacing.test.ts, src/client/app/transcriptSpacing.ts

## c3-114 — messages-renderer (component)
container: c3-1 | context: c3-0
refs: ref-strong-typing, ref-tool-hydration, rule-strong-typing
files: src/client/components/lexical/markdown/**, src/client/components/messages/**/*.ts, src/client/components/messages/**/*.tsx

## c3-115 — chat-ui-chrome (component)
container: c3-1 | context: c3-0
refs: ref-provider-adapter, ref-zustand-store, rule-zustand-store
files: src/client/components/chat-ui/**/*.ts, src/client/components/chat-ui/**/*.tsx, src/client/components/lexical/config.ts, src/client/components/lexical/nodes/**, src/client/components/lexical/plugins/**, src/client/components/lexical/serialize/**, src/client/components/open-external-menu.tsx, src/client/components/share/**/*.ts, src/client/components/share/**/*.tsx

## c3-116 — settings-page (component)
container: c3-1 | context: c3-0
refs: ref-local-first-data, ref-zustand-store, rule-zustand-store
files: src/client/app/BeaconAliasEditor.tsx, src/client/app/BeaconScopeEditor.tsx, src/client/app/BeaconsSection.test.tsx, src/client/app/BeaconsSection.tsx, src/client/app/CustomProvidersSection.test.tsx, src/client/app/CustomProvidersSection.tsx, src/client/app/KeybindingsSection.tsx, src/client/app/McpServerRow.tsx, src/client/app/McpServersSection.test.tsx, src/client/app/McpServersSection.tsx, src/client/app/ModelsSection.test.tsx, src/client/app/ModelsSection.tsx, src/client/app/PendingSegmentedControl.tsx, src/client/app/SettingsPage.tsx, src/client/app/SkillsSection.tsx, src/client/app/SubagentFormRow.tsx, src/client/app/SubagentScopeFields.tsx, src/client/app/SubagentsSection.test.tsx, src/client/app/SubagentsSection.tsx, src/client/app/TextSnippetsSection.test.tsx, src/client/app/TextSnippetsSection.tsx, src/client/app/appSettingsCrud.ts, src/client/app/legacyProviderDefaults.ts, src/client/app/llmProviderDraft.ts, src/client/app/settingsEditorForm.ts, src/client/app/useProviderCatalog.ts, src/client/app/usePushDeviceActions.ts, src/client/components/settings/PluginsSection.tsx, src/client/components/settings/PushNotificationsSection.tsx, src/client/components/settings/SettingsList.tsx, src/client/components/settings/SkillCard.tsx, src/client/lib/customProviderDraft.ts, src/client/stores/beaconsStore.test.ts, src/client/stores/beaconsStore.ts, src/client/stores/customProvidersSectionStore.ts

## c3-117 — local-projects-page (component)
container: c3-1 | context: c3-0
refs: ref-local-first-data, ref-ws-subscription
files: src/client/app/LocalProjectsPage.tsx, src/client/components/ImportSessionsDialog.tsx, src/client/components/NewProjectModal.tsx

## c3-118 — terminal-workspace (component)
container: c3-1 | context: c3-0
refs: ref-ws-subscription, ref-zustand-store, rule-zustand-store
files: src/client/app/ChatPage/TerminalWorkspaceShell.tsx, src/client/app/terminalLayoutResize.test.ts, src/client/app/terminalLayoutResize.ts, src/client/app/terminalToggleAnimation.test.ts, src/client/app/terminalToggleAnimation.ts

## c3-119 — boards-ui (component)
container: c3-1 | context: c3-0
refs: ref-strong-typing, ref-ws-subscription, ref-zustand-store, rule-colocated-bun-test, rule-zustand-store
files: src/client/app/BoardsRoutePage.test.tsx, src/client/app/BoardsRoutePage.tsx, src/client/components/boards/**/*.ts, src/client/components/boards/**/*.tsx, src/client/lib/boards/**/*.ts, src/client/stores/boardsStore.test.ts, src/client/stores/boardsStore.ts

## c3-120 — cron-ui (component)
container: c3-1 | context: c3-0
refs: rule-colocated-bun-test, rule-strong-typing, rule-zustand-store
files: src/client/app/CronJobEditDialog.store.ts, src/client/app/CronJobEditDialog.tsx, src/client/app/CronJobRow.store.ts, src/client/app/CronJobRow.tsx, src/client/app/CronJobsPage.tsx, src/client/app/CronJobsSection.tsx, src/client/components/messages/CronArmedMessage.tsx, src/client/components/messages/CronCommandErrorMessage.tsx, src/client/components/messages/CronJobChangeMessage.tsx, src/client/components/messages/CronListMessage.tsx, src/client/components/messages/CronMessages.test.tsx, src/client/components/messages/CronRunMessage.tsx, src/client/components/messages/CronRunSkippedMessage.tsx, src/client/stores/cronJobsStore.ts

## c3-121 — plugins-ui (component)
container: c3-1 | context: c3-0
refs: ref-strong-typing, rule-colocated-bun-test, rule-zustand-store
files: src/client/app/KannaPluginsSettingsBranch.tsx, src/client/app/PluginSidebarItems.tsx, src/client/app/PluginsFooterSection.tsx, src/client/app/PluginsFooterSlot.test.tsx, src/client/app/PluginsFooterSlot.tsx, src/client/app/PluginsSection.tsx, src/client/plugins/**/*.ts, src/client/plugins/**/*.tsx, src/client/stores/pluginContributionsStore.ts

## c3-122 — stacks-ui (component)
container: c3-1 | context: c3-0
refs: rule-colocated-bun-test, rule-strong-typing, rule-zustand-store
files: src/client/app/StackBoardsRoutePage.tsx, src/client/app/useStackCommands.ts, src/client/components/chat-ui/sidebar/Stack*.tsx, src/client/components/chat-ui/sidebar/StackChatCreateRow.store.ts

## c3-123 — genui-ui (component)
container: c3-1 | context: c3-0
refs: rule-colocated-bun-test, rule-strong-typing, rule-zustand-store
files: e2e/genui-fixture.ts, e2e/genui.pw.ts, src/client/components/genui/**/*.css, src/client/components/genui/**/*.ts, src/client/components/genui/**/*.tsx, src/client/components/lexical/markdown/kannaUiTransformers.ts, src/client/components/lexical/nodes/KannaUiNode.tsx

## c3-124 — remote-mcp-ui (component)
container: c3-1 | context: c3-0
refs: ref-zustand-store, rule-colocated-bun-test, rule-strong-typing, rule-zustand-store
files: src/client/components/settings/RemoteMcpSection.test.tsx, src/client/components/settings/RemoteMcpSection.tsx, src/client/stores/remoteMcpSectionStore.ts, src/shared/remote-mcp/setup-snippets.test.ts, src/shared/remote-mcp/setup-snippets.ts

## c3-125 — webhooks-ui (component)
container: c3-1 | context: c3-0
refs: ref-ws-subscription, ref-zustand-store, rule-zustand-store
files: src/client/app/WebhookCopyButton.tsx, src/client/app/WebhookCreateDialog.store.ts, src/client/app/WebhookCreateDialog.tsx, src/client/app/WebhookGenericFields.tsx, src/client/app/WebhookRow.tsx, src/client/app/WebhookSecretDialog.tsx, src/client/app/WebhookSlackFields.tsx, src/client/app/WebhookSlackSetup.tsx, src/client/app/WebhookTargetSelect.tsx, src/client/app/WebhooksPage.tsx, src/client/app/webhookCommands.test.ts, src/client/app/webhookCommands.ts, src/client/components/messages/WebhookDeliveryMessage.tsx, src/client/lib/webhookDraft.test.ts, src/client/lib/webhookDraft.ts, src/client/lib/webhookPresentation.test.ts, src/client/lib/webhookPresentation.ts, src/client/lib/webhookTargets.test.ts, src/client/lib/webhookTargets.ts, src/client/stores/webhooksStore.ts

## c3-126 — inbox-ui (component)
container: c3-1 | context: c3-0
refs: ref-strong-typing, ref-ws-subscription, ref-zustand-store, rule-zustand-store
files: src/client/app/InboxActivityRow.tsx, src/client/app/InboxFilterBar.tsx, src/client/app/InboxPage.test.tsx, src/client/app/InboxPage.tsx, src/client/app/InboxReplyComposer.test.tsx, src/client/app/InboxReplyComposer.tsx, src/client/app/InboxThreadDetail.tsx, src/client/app/InboxThreadRow.tsx, src/client/app/useInboxToasts.test.tsx, src/client/app/useInboxToasts.ts, src/client/lib/inboxCommands.ts, src/client/lib/inboxFilter.test.ts, src/client/lib/inboxFilter.ts, src/client/lib/inboxPresentation.test.ts, src/client/lib/inboxPresentation.ts, src/client/stores/inboxStore.test.ts, src/client/stores/inboxStore.ts

## c3-2 — Server (container)
context: c3-0

## c3-201 — cli-entry (component)
container: c3-2 | context: c3-0
refs: ref-local-first-data
files: src/server/cli-bootstrap.adapter.ts, src/server/cli-runtime.test.ts, src/server/cli-runtime.ts, src/server/cli-supervisor.adapter.ts, src/server/cli.ts, src/types/bun-process-signals.d.ts

## c3-202 — http-ws-server (component)
container: c3-2 | context: c3-0
refs: ref-local-first-data, ref-ws-subscription
files: src/server/analytics.ts, src/server/app-settings-io.adapter.ts, src/server/app-settings.ts, src/server/beacon-connection.test.ts, src/server/beacon-connection.ts, src/server/beacon-crypto.test.ts, src/server/beacon-crypto.ts, src/server/beacon-pairing-host.ts, src/server/beacon-pairing.test.ts, src/server/beacon-pairing.ts, src/server/beacon-registry.test.ts, src/server/beacon-registry.ts, src/server/beacon-services.test.ts, src/server/beacon-services.ts, src/server/beacon-settings.test.ts, src/server/beacon-settings.ts, src/server/beacon-transfer-files.adapter.ts, src/server/beacon-transfer-files.ts, src/server/beacon-transfer-host.ts, src/server/beacon-transfer-http.adapter.ts, src/server/beacon-transfer-http.test.ts, src/server/beacon-transfer-tickets.ts, src/server/custom-providers-settings.ts, src/server/fs-stat.adapter.ts, src/server/http-api-routes.ts, src/server/http-dispatcher.ts, src/server/http-route-inventory.test.ts, src/server/http-static.ts, src/server/input-validation.ts, src/server/json-boundary.ts, src/server/server-data-dir.test.ts, src/server/server-io.adapter.ts, src/server/server.ts

## c3-203 — auth (component)
container: c3-2 | context: c3-0
refs: ref-local-first-data
files: src/client/app/PasswordScreen.store.ts, src/server/auth-backend.ts, src/server/auth.test.ts, src/server/auth.ts, src/server/better-auth-oauth.adapter.ts, src/server/better-auth.adapter.ts

## c3-204 — paths-config (component)
container: c3-2 | context: c3-0
refs: ref-local-first-data
files: src/server/machine-name.adapter.ts, src/server/paths-fs.adapter.ts, src/server/paths.ts, src/server/project-directory.adapter.ts, src/server/project-paths-io.adapter.ts, src/server/project-paths.test.ts, src/server/project-paths.ts, src/server/projectFileRelocation.adapter.ts

## c3-205 — events-schema (component)
container: c3-2 | context: c3-0
refs: ref-event-sourcing, ref-strong-typing, rule-strong-typing
files: src/server/events.ts, src/server/harness-types.ts

## c3-206 — event-store (component)
container: c3-2 | context: c3-0
refs: ref-colocated-bun-test, ref-event-sourcing, ref-local-first-data, rule-colocated-bun-test
files: src/server/chat-op-log.test.ts, src/server/chat-op-log.ts, src/server/chat-ops-parity.test.ts, src/server/event-store-*.ts, src/server/event-store-messages.adapter.test.ts, src/server/event-store-messages.adapter.ts, src/server/event-store-write-ops.test.ts, src/server/event-store-write-ops.ts, src/server/event-store.project-delete.test.ts, src/server/event-store.test.ts, src/server/event-store.ts, src/server/storage/backend.ts, src/server/storage/fs-storage.adapter.ts, src/server/storage/in-memory-storage.ts

## c3-207 — read-models (component)
container: c3-2 | context: c3-0
refs: ref-cqrs-read-models, ref-strong-typing, rule-strong-typing
files: src/server/read-models.test.ts, src/server/read-models.ts

## c3-208 — ws-router (component)
container: c3-2 | context: c3-0
refs: ref-colocated-bun-test, ref-cqrs-read-models, ref-ws-subscription, rule-colocated-bun-test
files: src/server/chat-ops-diff.test.ts, src/server/chat-ops-diff.ts, src/server/live-block-throttle.test.ts, src/server/live-block-throttle.ts, src/server/project-kanna-files.adapter.test.ts, src/server/project-kanna-files.adapter.ts, src/server/ws-router-ack.ts, src/server/ws-router-agent-ctrl.ts, src/server/ws-router-broadcast.ts, src/server/ws-router-chat.ts, src/server/ws-router-command-results.test.ts, src/server/ws-router-coverage.test.ts, src/server/ws-router-defaults.ts, src/server/ws-router-diff.ts, src/server/ws-router-envelope.ts, src/server/ws-router-io.adapter.ts, src/server/ws-router-misc.ts, src/server/ws-router-plugins.test.ts, src/server/ws-router-plugins.ts, src/server/ws-router-project-files.test.ts, src/server/ws-router-project-files.ts, src/server/ws-router-project.ts, src/server/ws-router-settings.ts, src/server/ws-router-skills.ts, src/server/ws-router-utils.ts, src/server/ws-router.test.ts, src/server/ws-router.ts

## c3-209 — process-utils (component)
container: c3-2 | context: c3-0
refs: ref-strong-typing, rule-strong-typing
files: src/server/process-utils.adapter.ts, src/server/process-utils.test.ts

## c3-210 — agent-coordinator (component)
container: c3-2 | context: c3-0
refs: ref-colocated-bun-test, ref-event-sourcing, ref-provider-adapter, ref-tool-hydration, rule-colocated-bun-test
reverse deps: adr-20260617-subagent-id-or-name-resolution, adr-20260617-subagent-trigger-mode
files: src/server/agent-app-settings-view.ts, src/server/agent-coordinator-types.ts, src/server/agent-coordinator.ts, src/server/agent.test.ts, src/server/agent.ts, src/server/background-task-output-io.adapter.ts, src/server/background-task-output-registry.ts, src/server/beacon-mention-prompt.test.ts, src/server/beacon-mention-prompt.ts, src/server/claude-autocontinue-commands.ts, src/server/claude-cancel-handler.ts, src/server/claude-chat-management.ts, src/server/claude-context-commands.test.ts, src/server/claude-context-commands.ts, src/server/claude-harness-stream.ts, src/server/claude-live-block.ts, src/server/claude-live-publisher.ts, src/server/claude-loop-commands.ts, src/server/claude-message-normalizer.ts, src/server/claude-prompt-helpers.ts, src/server/claude-sdk-queue.ts, src/server/claude-send-command.test.ts, src/server/claude-send-command.ts, src/server/claude-session-config-helpers.ts, src/server/claude-session-error-handler.ts, src/server/claude-session-lifecycle.test.ts, src/server/claude-session-lifecycle.ts, src/server/claude-session-runner.test.ts, src/server/claude-session-runner.ts, src/server/claude-session-spawner.ts, src/server/claude-session-start.ts, src/server/claude-session-state-queries.test.ts, src/server/claude-session-state-queries.ts, src/server/claude-session-state.ts, src/server/claude-spawn-helpers.ts, src/server/claude-steer-log.ts, src/server/claude-subagent-tool-response.ts, src/server/claude-subagent-wiring.ts, src/server/claude-tool-respond.ts, src/server/claude-turn-runner.ts, src/server/claude-turn-starter-types.ts, src/server/claude-turn-starter.ts, src/server/claude-usage-math.ts, src/server/compaction.test.ts, src/server/compaction.ts, src/server/history-primer.test.ts, src/server/history-primer.ts, src/server/loop-integrate-io.adapter.ts, src/server/loop-prompt-parallel.ts, src/server/loop-template-io.adapter.ts, src/server/loop-template.ts, src/server/loop-verify-cache.ts, src/server/loop-verify-io.adapter.ts, src/server/loop-wake-prompt.ts, src/server/loop-wake-recovery.test.ts, src/server/loop-wake-recovery.ts, src/server/mention-parser.test.ts, src/server/mention-parser.ts, src/server/mermaid-guard.ts, src/server/mermaid-parse.adapter.ts, src/server/model-escalation.ts, src/server/pending-tool-slot.ts, src/server/proactive-compact.test.ts, src/server/proactive-compact.ts, src/server/project-mention-attach.test.ts, src/server/project-mention-attach.ts, src/server/project-process-env.ts, src/server/queued-message-recovery.ts, src/server/subagent-entry-cap.adapter.ts, src/server/subagent-entry-cap.test.ts, src/server/subagent-orchestrator.test.ts, src/server/subagent-orchestrator.ts, src/server/subagent-provider-run.test.ts, src/server/subagent-provider-run.ts, src/server/subagent-transcript-io.adapter.ts, src/server/subagent-transcript-registry.ts, src/server/tracking-file-lock.test.ts, src/server/tracking-file-lock.ts

## c3-211 — codex-app-server (component)
container: c3-2 | context: c3-0
refs: ref-provider-adapter, ref-strong-typing, rule-strong-typing
files: src/server/codex-app-server-decode.ts, src/server/codex-app-server-protocol.ts, src/server/codex-app-server.test.ts, src/server/codex-app-server.ts, src/server/codex-rollout-to-thread-item.ts, src/server/codex-session-types.ts, src/server/codex-spawn.adapter.ts, src/server/codex-tool-payloads.ts, src/server/codex-transcript-translator.ts

## c3-212 — provider-catalog (component)
container: c3-2 | context: c3-0
refs: ref-provider-adapter
files: src/server/llm-provider-store.adapter.ts, src/server/provider-catalog.test.ts, src/server/provider-catalog.ts, src/server/sdk-endpoint.ts, src/shared/custom-provider-presets.ts, src/shared/custom-providers.test.ts, src/shared/custom-providers.ts

## c3-213 — quick-response (component)
container: c3-2 | context: c3-0
refs: ref-provider-adapter
files: src/server/generate-commit-message.test.ts, src/server/generate-commit-message.ts, src/server/generate-title.ts, src/server/llm-provider.test.ts, src/server/llm-provider.ts, src/server/quick-response.test.ts, src/server/quick-response.ts, src/server/title-generation.live.test.ts

## c3-214 — discovery (component)
container: c3-2 | context: c3-0
refs: ref-local-first-data
files: src/server/claude-session-importer.adapter.ts, src/server/claude-session-importer.test.ts, src/server/claude-session-mapper.test.ts, src/server/claude-session-mapper.ts, src/server/claude-session-parser.adapter.ts, src/server/claude-session-parser.test.ts, src/server/claude-session-scanner.adapter.ts, src/server/claude-session-scanner.test.ts, src/server/claude-session-types.ts, src/server/codex-session-scanner.adapter.ts, src/server/discovery.adapter.ts, src/server/discovery.test.ts, src/server/followed-session-io.adapter.ts, src/server/followed-session-registry.ts, src/server/imported-subagents-dir.ts

## c3-215 — diff-store (component)
container: c3-2 | context: c3-0
refs: ref-tool-hydration
files: src/server/diff-store-*.ts, src/server/diff-store.test.ts, src/server/diff-store.ts

## c3-216 — terminal-manager (component)
container: c3-2 | context: c3-0
refs: ref-ws-subscription
files: src/server/terminal-manager-io.adapter.ts, src/server/terminal-manager.test.ts, src/server/terminal-manager.ts, src/server/terminal-pid-registry.adapter.ts, src/server/terminal-pid-registry.test.ts

## c3-217 — uploads (component)
container: c3-2 | context: c3-0
refs: ref-local-first-data
files: src/client/lib/uploadFile.adapter.test.ts, src/client/lib/uploadFile.adapter.ts, src/server/http-file-response.ts, src/server/tus-uploads.adapter.ts, src/server/uploads.adapter.ts, src/server/uploads.test.ts, src/server/uploads.ts

## c3-218 — share (component)
container: c3-2 | context: c3-0
refs: ref-local-first-data
files: src/server/share.test.ts, src/server/share.ts

## c3-219 — update-manager (component)
container: c3-2 | context: c3-0
refs: ref-cqrs-read-models, ref-strong-typing, rule-strong-typing
files: src/server/update-manager.test.ts, src/server/update-manager.ts, src/server/update-strategy.test.ts, src/server/update-strategy.ts

## c3-220 — restart (component)
container: c3-2 | context: c3-0
refs: ref-ws-subscription
files: src/server/restart.test.ts, src/server/restart.ts

## c3-221 — external-open (component)
container: c3-2 | context: c3-0
refs: ref-local-first-data
files: src/server/external-open.test.ts, src/server/external-open.ts, src/server/wsl.adapter.ts

## c3-222 — keybindings (component)
container: c3-2 | context: c3-0
refs: ref-local-first-data
files: src/server/keybindings-store.adapter.ts, src/server/keybindings.test.ts, src/server/keybindings.ts

## c3-223 — cloudflare-tunnel (component)
container: c3-2 | context: c3-0
refs: ref-cqrs-read-models, ref-strong-typing, ref-ws-subscription, rule-strong-typing
files: src/server/cloudflare-tunnel/**/*.ts

## c3-224 — oauth-token-pool (component)
container: c3-2 | context: c3-0
refs: ref-local-first-data, ref-strong-typing, rule-colocated-bun-test, rule-strong-typing
files: src/server/oauth-pool/**/*.ts

## c3-226 — kanna-mcp-host (component)
container: c3-2 | context: c3-0
refs: ref-local-first-data, ref-strong-typing, ref-tool-hydration, rule-colocated-bun-test, rule-strong-typing
files: src/server/canonical-args.ts, src/server/kanna-mcp-beacon-transfer.test.ts, src/server/kanna-mcp-beacon-transfer.ts, src/server/kanna-mcp-beacon.test.ts, src/server/kanna-mcp-beacon.ts, src/server/kanna-mcp-tool.ts, src/server/kanna-mcp-tools/**/*.ts, src/server/kanna-mcp.test.ts, src/server/kanna-mcp.ts, src/server/mcp-bearer.ts, src/server/mcp-oauth.adapter.ts, src/server/mcp-validator.ts, src/server/oauth-errors.ts, src/server/permission-gate.test.ts, src/server/permission-gate.ts, src/server/structured-doc-io.adapter.ts, src/server/tool-callback.test.ts, src/server/tool-callback.ts, src/shared/structured-doc/**/*.ts

## c3-227 — auto-continue (component)
container: c3-2 | context: c3-0
refs: ref-cqrs-read-models, ref-event-sourcing, ref-strong-typing, rule-colocated-bun-test, rule-strong-typing
files: src/server/auto-continue/**/*.ts

## c3-228 — session-share (component)
container: c3-2 | context: c3-0
refs: ref-cqrs-read-models, ref-event-sourcing, ref-local-first-data, ref-side-effect-adapter, ref-strong-typing
files: src/server/session-share/**/*.ts, src/server/share-defaults.adapter.ts

## c3-229 — workflow-status (component)
container: c3-2 | context: c3-0
refs: ref-cqrs-read-models, ref-event-sourcing, ref-provider-adapter, ref-side-effect-adapter, ref-strong-typing, ref-tool-hydration, ref-ws-subscription, ref-zustand-store, rule-colocated-bun-test, rule-strong-typing, rule-zustand-store
files: src/client/app/WorkflowAgentTranscriptPanel.store.ts, src/client/app/WorkflowAgentTranscriptPanel.test.tsx, src/client/app/WorkflowAgentTranscriptPanel.tsx, src/client/app/WorkflowsPage.store.ts, src/client/app/WorkflowsPage.test.tsx, src/client/app/WorkflowsPage.tsx, src/client/app/WorkflowsSection.store.ts, src/client/app/WorkflowsSection.tsx, src/client/components/messages/WorkflowMessage.tsx, src/client/lib/workflowGrouping.test.ts, src/client/lib/workflowGrouping.ts, src/client/stores/workflowsStore.ts, src/server/agent-transcript-parse.test.ts, src/server/agent-transcript-parse.ts, src/server/claude-projects-path.adapter.test.ts, src/server/claude-projects-path.adapter.ts, src/server/output-ring.test.ts, src/server/output-ring.ts, src/server/watched-registry.test.ts, src/server/watched-registry.ts, src/server/workflow-agent-transcript-io.adapter.test.ts, src/server/workflow-agent-transcript-io.adapter.ts, src/server/workflow-registry.test.ts, src/server/workflow-registry.ts, src/server/workflow-watch-io.adapter.test.ts, src/server/workflow-watch-io.adapter.ts, src/shared/workflow-types.test.ts, src/shared/workflow-types.ts

## c3-230 — openrouter-models (component)
container: c3-2 | context: c3-0
refs: ref-cqrs-read-models, ref-side-effect-adapter, ref-strong-typing, rule-colocated-bun-test
reverse deps: adr-20260618-adr-20260618-openrouter-sdk-provider
files: src/server/openrouter-models-io.adapter.ts, src/server/openrouter-models.ts

## c3-231 — local-catalog (component)
container: c3-2 | context: c3-0
refs: ref-colocated-bun-test, ref-local-first-data, ref-side-effect-adapter
files: src/server/claude-slash-commands.test.ts, src/server/claude-slash-commands.ts, src/server/local-catalog-io.adapter.test.ts, src/server/local-catalog-io.adapter.ts, src/server/local-catalog.test.ts, src/server/local-catalog.ts, src/server/skill-invocation.test.ts, src/server/skill-invocation.ts, src/shared/slash-expansion.test.ts, src/shared/slash-expansion.ts

## c3-232 — boards (component)
container: c3-2 | context: c3-0
refs: ref-cqrs-read-models, ref-local-first-data, ref-side-effect-adapter, ref-strong-typing, rule-colocated-bun-test, rule-mcp-name-reserved
files: src/server/board-*.ts, src/server/github-cli.adapter.ts, src/server/github-issues.adapter.ts, src/server/kanna-mcp-boards.test.ts, src/server/kanna-mcp-boards.ts, src/server/worktree-store.adapter.ts, src/server/ws-router-boards.test.ts, src/server/ws-router-boards.ts

## c3-233 — cron-scheduler (component)
container: c3-2 | context: c3-0
refs: ref-cqrs-read-models, ref-event-sourcing, rule-colocated-bun-test, rule-strong-typing
files: src/server/cron/**/*.ts

## c3-234 — observability (component)
container: c3-2 | context: c3-0
refs: ref-local-first-data, rule-colocated-bun-test
files: scripts/grafana-alerts.ts, scripts/perf-alert-issue.ts, src/ops/alerting/**/*.ts, src/server/memory-ceiling.test.ts, src/server/memory-ceiling.ts, src/server/observability.ts, src/server/otel-config.ts, src/server/otel.adapter.ts, src/server/test-helpers/metric-recorder.ts, src/server/ws-router-observability.ts

## c3-235 — secret-scanning (component)
container: c3-2 | context: c3-0
refs: ref-local-first-data
files: .githooks/pre-commit, .github/workflows/gitleaks.yml, .gitleaks.toml, src/server/gitleaks-hook.test.ts

## c3-236 — architecture-budget (component)
container: c3-2 | context: c3-0
refs: ref-side-effect-adapter, ref-strong-typing, rule-colocated-bun-test
files: scripts/check-complexity-limits.ts, src/ops/architecture/budget-scan.adapter.ts, src/ops/architecture/budget.ts, src/ops/architecture/cjs-interop-scan.adapter.ts, src/ops/architecture/cjs-interop.ts

## c3-237 — package-autoupdate (component)
container: c3-2 | context: c3-0
refs: ref-side-effect-adapter
files: src/server/app-settings-package-updates.ts, src/server/claude-plugin-update-applier.adapter.ts, src/server/claude-plugin-update-checker.adapter.ts, src/server/codex-plugin-update-applier.adapter.ts, src/server/codex-plugin-update-checker.adapter.ts, src/server/package-inventory-io.adapter.test.ts, src/server/package-inventory-io.adapter.ts, src/server/package-update-appliers-boot.adapter.ts, src/server/package-update-manager.test.ts, src/server/package-update-manager.ts, src/server/skill-update-applier.adapter.test.ts, src/server/skill-update-applier.adapter.ts, src/server/skill-update-checker.adapter.test.ts, src/server/skill-update-checker.adapter.ts

## c3-238 — plugin-system (component)
container: c3-2 | context: c3-0
refs: ref-event-sourcing, ref-side-effect-adapter, ref-strong-typing, rule-colocated-bun-test
files: src/server/__fixtures__/plugins/**, src/server/kanna-mcp-plugins.test.ts, src/server/kanna-mcp-plugins.ts, src/server/plugin-cli-dispatch.test.ts, src/server/plugin-cli-dispatch.ts, src/server/plugin-cli.ts, src/server/plugin-http-routes.ts, src/server/plugin-system-acceptance.test.tsx, src/server/plugins/**/*.ts

## c3-239 — stacks (component)
container: c3-2 | context: c3-0
refs: ref-strong-typing, rule-colocated-bun-test
files: src/server/agent.stack-spawn.test.ts, src/server/claude-session-config.ts, src/server/event-store.stack-methods.test.ts, src/server/ws-router.stack.test.ts

## c3-240 — genui (component)
container: c3-2 | context: c3-0
refs: ref-side-effect-adapter, rule-colocated-bun-test
files: src/server/genui/*.ts, src/server/turn-end-guard.ts, src/server/ws-router-genui.ts

## c3-241 — beacon-daemon (component)
container: c3-2 | context: c3-0
refs: ref-side-effect-adapter
files: apps/beacon-desktop/**/*, apps/beacon-win7/**/*, scripts/beacon-desktop-icons.ts, scripts/build-beacon-desktop.ts, scripts/build-beacon.ts, src/beacon/activity.test.ts, src/beacon/activity.ts, src/beacon/desktop/**/*.ts, src/beacon/desktop/**/*.tsx, src/beacon/desktop/view/beacon-desktop.css, src/beacon/entry.adapter.ts, src/beacon/fs.adapter.test.ts, src/beacon/fs.adapter.ts, src/beacon/host-os.ts, src/beacon/key-store.adapter.test.ts, src/beacon/key-store.adapter.ts, src/beacon/main.test.ts, src/beacon/main.ts, src/beacon/pair-client.adapter.ts, src/beacon/ports.ts, src/beacon/runner.test.ts, src/beacon/runner.ts, src/beacon/self-update.adapter.test.ts, src/beacon/self-update.adapter.ts, src/beacon/self-update.test.ts, src/beacon/self-update.ts, src/beacon/session.test.ts, src/beacon/session.ts, src/beacon/shell.adapter.test.ts, src/beacon/shell.adapter.ts, src/beacon/state-store.adapter.ts, src/beacon/supervisor.test.ts, src/beacon/supervisor.ts, src/beacon/transfer.adapter.ts, src/beacon/transport.adapter.ts, src/beacon/version.test.ts, src/beacon/version.ts

## c3-242 — remote-mcp (component)
container: c3-2 | context: c3-0
refs: ref-side-effect-adapter, ref-strong-typing, ref-ws-subscription, rule-colocated-bun-test, rule-strong-typing
files: src/ops/parity/remote-mcp-docs.test.ts, src/server/better-auth-oauth.adapter.ts, src/server/command-origin-stamp.ts, src/server/project-file-path.ts, src/server/remote-mcp/**/*.ts, src/shared/command-origin.ts, src/shared/remote-mcp/topics.ts, src/shared/settings/remote-mcp.test.ts, src/shared/settings/remote-mcp.ts

## c3-243 — webhooks (component)
container: c3-2 | context: c3-0
refs: ref-local-first-data, ref-side-effect-adapter, ref-strong-typing
files: src/server/test-helpers/slack-harness.ts, src/server/test-helpers/slack-hook-harness.ts, src/server/test-helpers/webhook-harness.ts, src/server/webhooks/slack/slack-api.adapter.test.ts, src/server/webhooks/slack/slack-api.adapter.ts, src/server/webhooks/slack/slack-api.ts, src/server/webhooks/slack/slack-events.test.ts, src/server/webhooks/slack/slack-events.ts, src/server/webhooks/slack/slack-http.test.ts, src/server/webhooks/slack/slack-prompt.test.ts, src/server/webhooks/slack/slack-prompt.ts, src/server/webhooks/slack/slack-service.test.ts, src/server/webhooks/slack/slack-service.ts, src/server/webhooks/slack/slack-signature.test.ts, src/server/webhooks/slack/slack-signature.ts, src/server/webhooks/slack/slack-task-tracker.ts, src/server/webhooks/slack/slack-thread-store.adapter.test.ts, src/server/webhooks/slack/slack-thread-store.adapter.ts, src/server/webhooks/slack/slack-threads.ts, src/server/webhooks/webhook-auth.ts, src/server/webhooks/webhook-boot.ts, src/server/webhooks/webhook-delivery.test.ts, src/server/webhooks/webhook-delivery.ts, src/server/webhooks/webhook-filter.ts, src/server/webhooks/webhook-http-routes.test.ts, src/server/webhooks/webhook-http-routes.ts, src/server/webhooks/webhook-rate-limit.ts, src/server/webhooks/webhook-registry.test.ts, src/server/webhooks/webhook-registry.ts, src/server/webhooks/webhook-service.ts, src/server/webhooks/webhook-store.adapter.test.ts, src/server/webhooks/webhook-store.adapter.ts, src/server/ws-router-webhooks.ts, src/shared/webhooks/slack.ts, src/shared/webhooks/template.test.ts, src/shared/webhooks/template.ts, src/shared/webhooks/types.ts, src/shared/webhooks/validate.test.ts, src/shared/webhooks/validate.ts

## c3-244 — push-notifications (component)
container: c3-2 | context: c3-0
refs: ref-event-sourcing, ref-local-first-data, ref-side-effect-adapter
files: src/server/push/**/*.ts, src/server/ws-router-push.ts, src/shared/settings/push.ts, src/shared/vapid-subject.ts

## c3-245 — docs-site (component)
container: c3-2 | context: c3-0
files: .github/workflows/wiki-deploy.yml, wiki/astro.config.mjs, wiki/package.json, wiki/scripts/**/*.ts, wiki/src/components/*.astro, wiki/src/content.config.ts, wiki/src/sidebar.mjs

## c3-246 — service-bus (component)
container: c3-2 | context: c3-0
refs: ref-event-sourcing, ref-side-effect-adapter, ref-strong-typing
files: src/client/app/ServiceBusConsumersGroup.tsx, src/client/app/ServiceBusEmbeddedGroup.tsx, src/client/app/ServiceBusFields.tsx, src/client/app/ServiceBusSection.test.tsx, src/client/app/ServiceBusSection.tsx, src/client/app/ServiceBusStreamGroup.tsx, src/server/service-bus-settings.ts, src/server/service-bus/event-store-tap.test.ts, src/server/service-bus/event-store-tap.ts, src/server/service-bus/in-memory-service-bus.test.ts, src/server/service-bus/in-memory-service-bus.ts, src/server/service-bus/jetstream-reconcile.test.ts, src/server/service-bus/jetstream-reconcile.ts, src/server/service-bus/nats-mirror-queue.test.ts, src/server/service-bus/nats-mirror-queue.ts, src/server/service-bus/nats-mirror.test.ts, src/server/service-bus/nats-mirror.ts, src/server/service-bus/nats-server-install.adapter.test.ts, src/server/service-bus/nats-server-install.adapter.ts, src/server/service-bus/nats-server-process.adapter.test.ts, src/server/service-bus/nats-server-process.adapter.ts, src/server/service-bus/nats-server-release.ts, src/server/service-bus/nats-service-bus.adapter.integration.test.ts, src/server/service-bus/nats-service-bus.adapter.ts, src/server/service-bus/service-bus-boot.test.ts, src/server/service-bus/service-bus-boot.ts, src/server/service-bus/service-bus.ts, src/server/service-bus/store-event-subjects.test.ts, src/server/service-bus/store-event-subjects.ts, src/server/ws-router-service-bus.ts, src/shared/release-sums.ts, src/shared/service-bus/envelope.test.ts, src/shared/service-bus/envelope.ts, src/shared/service-bus/jetstream-config.test.ts, src/shared/service-bus/jetstream-config.ts

## c3-247 — inbox (component)
container: c3-2 | context: c3-0
refs: ref-event-sourcing, ref-side-effect-adapter, ref-strong-typing
files: src/server/inbound/deliver-inbound.test.ts, src/server/inbound/deliver-inbound.ts, src/server/inbound/inbox-reply.test.ts, src/server/inbound/inbox-reply.ts, src/server/inbox/inbox-boot.ts, src/server/inbox/inbox-log.adapter.test.ts, src/server/inbox/inbox-log.adapter.ts, src/server/inbox/inbox-projection.ts, src/server/inbox/inbox-registry.test.ts, src/server/inbox/inbox-registry.ts, src/server/kanna-mcp-inbox.test.ts, src/server/kanna-mcp-inbox.ts, src/server/ws-router-inbox.ts, src/shared/inbound/handler.ts, src/shared/inbound/reply-prompt.test.ts, src/shared/inbound/reply-prompt.ts, src/shared/inbound/template.test.ts, src/shared/inbound/template.ts, src/shared/inbox/describe.test.ts, src/shared/inbox/describe.ts, src/shared/inbox/events.ts, src/shared/inbox/policy.test.ts, src/shared/inbox/policy.ts, src/shared/inbox/types.ts

## c3-248 — mcp-sources (component)
container: c3-2 | context: c3-0
refs: ref-provider-adapter, ref-side-effect-adapter, ref-strong-typing
files: src/client/app/McpSourceForm.tsx, src/client/app/McpSourcesSection.test.tsx, src/client/app/McpSourcesSection.tsx, src/client/lib/mcpSourceDraft.test.ts, src/client/lib/mcpSourceDraft.ts, src/client/lib/mcpSourcePresentation.test.ts, src/client/lib/mcpSourcePresentation.ts, src/client/stores/mcpSourcesSectionStore.ts, src/client/stores/mcpSourcesStore.ts, src/server/mcp-sources-settings.test.ts, src/server/mcp-sources-settings.ts, src/server/mcp-sources/mcp-source-client.adapter.test.ts, src/server/mcp-sources/mcp-source-client.adapter.ts, src/server/mcp-sources/mcp-source-cursor-store.adapter.test.ts, src/server/mcp-sources/mcp-source-cursor-store.adapter.ts, src/server/mcp-sources/mcp-source-runner.test.ts, src/server/mcp-sources/mcp-source-runner.ts, src/server/mcp-sources/mcp-sources-boot.ts, src/shared/mcp-sources/presets.ts, src/shared/mcp-sources/types.ts, src/shared/mcp-sources/validate.test.ts, src/shared/mcp-sources/validate.ts

## c3-3 — Shared (container)
context: c3-0

## c3-301 — types (component)
container: c3-3 | context: c3-0
refs: ref-strong-typing, rule-strong-typing
files: src/shared/analytics.ts, src/shared/app-settings-types.ts, src/shared/builtin-commands.ts, src/shared/chat-activity.ts, src/shared/chat-tasks/**/*.ts, src/shared/claude-api-error-classification.ts, src/shared/claude-session-id.ts, src/shared/codex-error-classification.ts, src/shared/core-types.ts, src/shared/design/**/*.ts, src/shared/dynamic-module.ts, src/shared/equality.ts, src/shared/errors.ts, src/shared/git-diff-types.ts, src/shared/json.test.ts, src/shared/json.ts, src/shared/kanna-system-prompt.test.ts, src/shared/kanna-system-prompt.ts, src/shared/lazyModule.ts, src/shared/log.ts, src/shared/loop-progress.ts, src/shared/mask-oauth-key.test.ts, src/shared/mask-oauth-key.ts, src/shared/mcp-types.ts, src/shared/mention-pattern.ts, src/shared/mermaid*.ts, src/shared/pane-tab-width.ts, src/shared/permission-policy.test.ts, src/shared/permission-policy.ts, src/shared/project-mention.test.ts, src/shared/project-mention.ts, src/shared/projectFileUrl.test.ts, src/shared/projectFileUrl.ts, src/shared/provider-model-types.ts, src/shared/settings/**/*.ts, src/shared/skill-agents.ts, src/shared/subagent-types.ts, src/shared/task-doc.test.ts, src/shared/task-doc.ts, src/shared/terminal-scrollback.ts, src/shared/tool-call-types.ts, src/shared/transcript-types.ts, src/shared/turn-model-selection.ts, src/shared/types.test.ts, src/shared/types.ts

## c3-302 — protocol (component)
container: c3-3 | context: c3-0
refs: ref-strong-typing, ref-ws-subscription, rule-strong-typing
files: src/ops/parity/http-route-inventory.test.ts, src/shared/app-settings-types.schema.ts, src/shared/beacon-alias.test.ts, src/shared/beacon-alias.ts, src/shared/beacon-config.schema.ts, src/shared/beacon-config.ts, src/shared/beacon-pair-link.test.ts, src/shared/beacon-pair-link.ts, src/shared/beacon-protocol.test.ts, src/shared/beacon-protocol.ts, src/shared/beacon-scope.test.ts, src/shared/beacon-scope.ts, src/shared/beacon-status.test.ts, src/shared/beacon-status.ts, src/shared/beacon-tool-request.ts, src/shared/beacon-tools.ts, src/shared/beacon-transfer.ts, src/shared/boards/types.schema.ts, src/shared/chat-ops.test.ts, src/shared/chat-ops.ts, src/shared/command-origin.schema.ts, src/shared/commands/**/*.ts, src/shared/core-types.schema.ts, src/shared/cron/types.schema.ts, src/shared/custom-providers.schema.ts, src/shared/git-diff-types.schema.ts, src/shared/http-routes.test.ts, src/shared/http-routes.ts, src/shared/inbound/handler.schema.ts, src/shared/inbox/types.schema.ts, src/shared/live-block.ts, src/shared/mcp-sources/types.schema.ts, src/shared/mcp-types.schema.ts, src/shared/permission-policy.schema.ts, src/shared/protocol.ts, src/shared/provider-model-types.schema.ts, src/shared/service-bus/jetstream-config.schema.ts, src/shared/session-share/types.schema.ts, src/shared/settings/settings.schema.ts, src/shared/subagent-types.schema.ts, src/shared/tool-call-types.schema.ts, src/shared/transcript-types.schema.ts, src/shared/type-parity.ts, src/shared/types.schema.ts, src/shared/webhooks/types.schema.ts, src/shared/workflow-types.schema.ts

## c3-303 — tools (component)
container: c3-3 | context: c3-0
refs: ref-colocated-bun-test, ref-strong-typing, ref-tool-hydration, rule-colocated-bun-test, rule-strong-typing
files: src/shared/tools.test.ts, src/shared/tools.ts

## c3-304 — ports (component)
container: c3-3 | context: c3-0
refs: ref-strong-typing, rule-strong-typing
files: src/shared/dev-ports.test.ts, src/shared/dev-ports.ts, src/shared/ports.ts

## c3-305 — branding (component)
container: c3-3 | context: c3-0
refs: ref-local-first-data
files: src/shared/branding.test.ts, src/shared/branding.ts

## c3-306 — share-shared (component)
container: c3-3 | context: c3-0
refs: ref-strong-typing, rule-strong-typing
files: src/shared/session-share/**/*.ts, src/shared/share.ts

## c3-307 — token-pricing (component)
container: c3-3 | context: c3-0
refs: ref-strong-typing
files: src/shared/token-pricing.ts

## c3-310 — boards-domain (component)
container: c3-3 | context: c3-0
refs: ref-colocated-bun-test, ref-strong-typing, rule-colocated-bun-test, rule-strong-typing
files: src/shared/boards/**/*.ts

## c3-311 — cron-domain (component)
container: c3-3 | context: c3-0
refs: rule-colocated-bun-test, rule-strong-typing
files: src/shared/cron/**/*.ts

## c3-312 — packages-shared (component)
container: c3-3 | context: c3-0
refs: ref-side-effect-adapter, ref-strong-typing, rule-colocated-bun-test
files: src/shared/packages/parse-claude-plugin-marketplace.test.ts, src/shared/packages/parse-claude-plugin-marketplace.ts, src/shared/packages/parse-claude-plugins.test.ts, src/shared/packages/parse-claude-plugins.ts, src/shared/packages/parse-codex-plugins.test.ts, src/shared/packages/parse-codex-plugins.ts, src/shared/packages/parse-skill-lock.test.ts, src/shared/packages/parse-skill-lock.ts, src/shared/packages/skill-update-classifier.test.ts, src/shared/packages/skill-update-classifier.ts, src/shared/packages/tag-order.test.ts, src/shared/packages/tag-order.ts, src/shared/packages/types.ts

## c3-313 — plugins-shared (component)
container: c3-3 | context: c3-0
refs: ref-side-effect-adapter, ref-strong-typing, rule-colocated-bun-test
files: src/shared/plugins/**/*.ts, src/shared/plugins/kanna-plugin.d.ts

## c3-314 — stacks-domain (component)
container: c3-3 | context: c3-0
refs: rule-colocated-bun-test, rule-strong-typing
files: src/shared/stack-activity.test.ts, src/shared/stack-activity.ts

## c3-315 — genui-contract (component)
container: c3-3 | context: c3-0
refs: rule-colocated-bun-test, rule-strong-typing
files: src/shared/genui/*.ts

## ref-colocated-bun-test — Colocated Bun Test (ref)
reverse deps: c3-102, c3-104, c3-206, c3-208, c3-210, c3-231, c3-303, c3-310
citers: c3-102, c3-104, c3-206, c3-208, c3-210, c3-231, c3-303, c3-310

## ref-cqrs-read-models — CQRS Read Models (ref)
reverse deps: c3-110, c3-111, c3-112, c3-207, c3-208, c3-219, c3-223, c3-227, c3-228, c3-229, c3-230, c3-232, c3-233
citers: c3-110, c3-111, c3-112, c3-207, c3-208, c3-219, c3-223, c3-227, c3-228, c3-229, c3-230, c3-232, c3-233

## ref-event-sourcing — Event Sourcing (ref)
reverse deps: c3-205, c3-206, c3-210, c3-227, c3-228, c3-229, c3-233, c3-238, c3-244, c3-246, c3-247
citers: c3-205, c3-206, c3-210, c3-227, c3-228, c3-229, c3-233, c3-238, c3-244, c3-246, c3-247

## ref-local-first-data — Local-First Data (ref)
reverse deps: c3-116, c3-117, c3-201, c3-202, c3-203, c3-204, c3-206, c3-214, c3-217, c3-218, c3-221, c3-222, c3-224, c3-226, c3-228, c3-231, c3-232, c3-234, c3-235, c3-243, c3-244, c3-305
citers: c3-116, c3-117, c3-201, c3-202, c3-203, c3-204, c3-206, c3-214, c3-217, c3-218, c3-221, c3-222, c3-224, c3-226, c3-228, c3-231, c3-232, c3-234, c3-235, c3-243, c3-244, c3-305

## ref-provider-adapter — Provider Adapter (ref)
reverse deps: c3-113, c3-115, c3-210, c3-211, c3-212, c3-213, c3-229, c3-248
citers: c3-113, c3-115, c3-210, c3-211, c3-212, c3-213, c3-229, c3-248

## ref-side-effect-adapter — side-effect-adapter (ref)
reverse deps: c3-228, c3-229, c3-230, c3-231, c3-232, c3-236, c3-237, c3-238, c3-240, c3-241, c3-242, c3-243, c3-244, c3-246, c3-247, c3-248, c3-312, c3-313
citers: c3-228, c3-229, c3-230, c3-231, c3-232, c3-236, c3-237, c3-238, c3-240, c3-241, c3-242, c3-243, c3-244, c3-246, c3-247, c3-248, c3-312, c3-313

## ref-strong-typing — Strong Typing Policy (ref)
reverse deps: c3-101, c3-102, c3-103, c3-104, c3-114, c3-119, c3-121, c3-126, c3-205, c3-207, c3-209, c3-211, c3-219, c3-223, c3-224, c3-226, c3-227, c3-228, c3-229, c3-230, c3-232, c3-236, c3-238, c3-239, c3-242, c3-243, c3-246, c3-247, c3-248, c3-301, c3-302, c3-303, c3-304, c3-306, c3-307, c3-310, c3-312, c3-313
citers: c3-101, c3-102, c3-103, c3-104, c3-114, c3-119, c3-121, c3-126, c3-205, c3-207, c3-209, c3-211, c3-219, c3-223, c3-224, c3-226, c3-227, c3-228, c3-229, c3-230, c3-232, c3-236, c3-238, c3-239, c3-242, c3-243, c3-246, c3-247, c3-248, c3-301, c3-302, c3-303, c3-304, c3-306, c3-307, c3-310, c3-312, c3-313

## ref-tool-hydration — Tool Call Hydration (ref)
reverse deps: c3-113, c3-114, c3-210, c3-215, c3-226, c3-229, c3-303
citers: c3-113, c3-114, c3-210, c3-215, c3-226, c3-229, c3-303

## ref-ws-subscription — WebSocket Subscription (ref)
reverse deps: c3-101, c3-110, c3-112, c3-117, c3-118, c3-119, c3-125, c3-126, c3-202, c3-208, c3-216, c3-220, c3-223, c3-229, c3-242, c3-302
citers: c3-101, c3-110, c3-112, c3-117, c3-118, c3-119, c3-125, c3-126, c3-202, c3-208, c3-216, c3-220, c3-223, c3-229, c3-242, c3-302

## ref-zustand-store — Zustand Store Pattern (ref)
reverse deps: c3-102, c3-104, c3-111, c3-115, c3-116, c3-118, c3-119, c3-124, c3-125, c3-126, c3-229
citers: c3-102, c3-104, c3-111, c3-115, c3-116, c3-118, c3-119, c3-124, c3-125, c3-126, c3-229

## rule-colocated-bun-test — colocated-bun-test (rule)
reverse deps: c3-102, c3-119, c3-120, c3-121, c3-122, c3-123, c3-124, c3-206, c3-208, c3-210, c3-224, c3-226, c3-227, c3-229, c3-230, c3-232, c3-233, c3-234, c3-236, c3-238, c3-239, c3-240, c3-242, c3-303, c3-310, c3-311, c3-312, c3-313, c3-314, c3-315
citers: c3-102, c3-119, c3-120, c3-121, c3-122, c3-123, c3-124, c3-206, c3-208, c3-210, c3-224, c3-226, c3-227, c3-229, c3-230, c3-232, c3-233, c3-234, c3-236, c3-238, c3-239, c3-240, c3-242, c3-303, c3-310, c3-311, c3-312, c3-313, c3-314, c3-315

## rule-mcp-name-reserved — mcp-name-reserved (rule)
reverse deps: c3-232
citers: c3-232

## rule-strong-typing — strong-typing (rule)
reverse deps: c3-101, c3-102, c3-103, c3-114, c3-120, c3-122, c3-123, c3-124, c3-205, c3-207, c3-209, c3-211, c3-219, c3-223, c3-224, c3-226, c3-227, c3-229, c3-233, c3-242, c3-301, c3-302, c3-303, c3-304, c3-306, c3-310, c3-311, c3-314, c3-315
citers: c3-101, c3-102, c3-103, c3-114, c3-120, c3-122, c3-123, c3-124, c3-205, c3-207, c3-209, c3-211, c3-219, c3-223, c3-224, c3-226, c3-227, c3-229, c3-233, c3-242, c3-301, c3-302, c3-303, c3-304, c3-306, c3-310, c3-311, c3-314, c3-315

## rule-zustand-store — zustand-store (rule)
reverse deps: c3-102, c3-111, c3-115, c3-116, c3-118, c3-119, c3-120, c3-121, c3-122, c3-123, c3-124, c3-125, c3-126, c3-229
citers: c3-102, c3-111, c3-115, c3-116, c3-118, c3-119, c3-120, c3-121, c3-122, c3-123, c3-124, c3-125, c3-126, c3-229

## File Map
src/client/api/**/*.ts → c3-101
src/client/app/KannaSocketProvider.tsx → c3-101
src/client/app/SocketBridge.tsx → c3-101
src/client/app/pushClient.test.ts → c3-101
src/client/app/pushClient.ts → c3-101
src/client/app/socket-protocol.ts → c3-101
src/client/app/socket.test.ts → c3-101
src/client/app/socket.ts → c3-101
src/client/query/**/*.ts → c3-101
src/client/lib/createScopedStore.tsx → c3-102
src/client/stores/**/*.ts → c3-102
src/client/components/CopyButton.store.ts → c3-103
src/client/components/OpenExternalSelect.store.ts → c3-103
src/client/components/editor-icons.tsx → c3-103
src/client/components/ui/**/*.tsx → c3-103
src/client/components/ui/searchable-select.store.ts → c3-103
src/client/components/ui/searchable-select.test.ts → c3-103
src/index.css → c3-103
src/client/components/panes/**/*.ts → c3-104
src/client/components/panes/**/*.tsx → c3-104
src/client/adapters/*.ts → c3-110
src/client/app/App.test.tsx → c3-110
src/client/app/App.tsx → c3-110
src/client/app/AppBootstrap.tsx → c3-110
src/client/app/AppGlobalProvider.tsx → c3-110
src/client/app/PageHeader.tsx → c3-110
src/client/app/appRuntime.test.ts → c3-110
src/client/app/appRuntime.ts → c3-110
src/client/app/bulkChatRemoval.ts → c3-110
src/client/app/chatFocusPolicy.test.ts → c3-110
src/client/app/chatFocusPolicy.ts → c3-110
src/client/app/chatNotifications.ts → c3-110
src/client/app/derived.ts → c3-110
src/client/app/drawerVisual.ts → c3-110
src/client/app/forgetDeletedLocally.ts → c3-110
src/client/app/share-view/**/*.ts → c3-110
src/client/app/share-view/**/*.tsx → c3-110
src/client/app/sidebarSwipeGesture.ts → c3-110
src/client/app/useAppGlobalState.test.ts → c3-110
src/client/app/useAppGlobalState.ts → c3-110
src/client/app/useKannaState.scrollback.test.tsx → c3-110
src/client/app/useKannaState.test.ts → c3-110
src/client/app/useKannaState.ts → c3-110
src/client/app/usePushFocus.test.ts → c3-110
src/client/app/usePushFocus.ts → c3-110
src/client/app/useWaitingChatTabs.ts → c3-110
src/client/components/LocalDev.tsx → c3-110
src/client/components/quick-switcher/**/*.tsx → c3-110
src/client/hooks/**/*.ts → c3-110
src/client/hooks/**/*.tsx → c3-110
src/client/hooks/useBeaconSuggestions.ts → c3-110
src/client/hooks/useProjectSuggestions.test.ts → c3-110
src/client/hooks/useProjectSuggestions.ts → c3-110
src/client/lib/**/*.ts → c3-110
src/client/lib/beaconMentionChips.ts → c3-110
src/client/ports/**/*.ts → c3-110
src/main.tsx → c3-110
src/vite-env.d.ts → c3-110
src/client/app/KannaSidebar.tsx → c3-111
src/client/app/SidebarUtilityNav.tsx → c3-111
src/client/app/sidebarNumberJump.test.ts → c3-111
src/client/app/sidebarNumberJump.ts → c3-111
src/client/app/BackgroundTasksSection.store.ts → c3-112
src/client/app/BackgroundTasksSection.test.tsx → c3-112
src/client/app/BackgroundTasksSection.tsx → c3-112
src/client/app/ChatPage.test.ts → c3-112
src/client/app/ChatPage/**/*.ts → c3-112
src/client/app/ChatPage/**/*.tsx → c3-112
src/client/app/LoopProgressSection.test.tsx → c3-112
src/client/app/LoopProgressSection.tsx → c3-112
src/client/app/chatNavigator.ts → c3-112
src/client/app/useRightSidebarToggleAnimation.ts → c3-112
src/client/app/useStickyChatFocus.ts → c3-112
src/client/app/useTerminalToggleAnimation.ts → c3-112
src/client/components/messages/LoopDisarmedMessage.test.tsx → c3-112
src/client/components/messages/LoopDisarmedMessage.tsx → c3-112
src/client/components/panes/PageTabContent.tsx → c3-112
src/client/app/KannaTranscript.test.tsx → c3-113
src/client/app/KannaTranscript.tsx → c3-113
src/client/app/subagent-run-placement.test.ts → c3-113
src/client/app/subagent-run-placement.ts → c3-113
src/client/app/transcriptActionsContext.tsx → c3-113
src/client/app/transcriptSpacing.test.ts → c3-113
src/client/app/transcriptSpacing.ts → c3-113
src/client/components/lexical/markdown/** → c3-114
src/client/components/messages/**/*.ts → c3-114
src/client/components/messages/**/*.tsx → c3-114
src/client/components/chat-ui/**/*.ts → c3-115
src/client/components/chat-ui/**/*.tsx → c3-115
src/client/components/lexical/config.ts → c3-115
src/client/components/lexical/nodes/** → c3-115
src/client/components/lexical/plugins/** → c3-115
src/client/components/lexical/serialize/** → c3-115
src/client/components/open-external-menu.tsx → c3-115
src/client/components/share/**/*.ts → c3-115
src/client/components/share/**/*.tsx → c3-115
src/client/app/BeaconAliasEditor.tsx → c3-116
src/client/app/BeaconScopeEditor.tsx → c3-116
src/client/app/BeaconsSection.test.tsx → c3-116
src/client/app/BeaconsSection.tsx → c3-116
src/client/app/CustomProvidersSection.test.tsx → c3-116
src/client/app/CustomProvidersSection.tsx → c3-116
src/client/app/KeybindingsSection.tsx → c3-116
src/client/app/McpServerRow.tsx → c3-116
src/client/app/McpServersSection.test.tsx → c3-116
src/client/app/McpServersSection.tsx → c3-116
src/client/app/ModelsSection.test.tsx → c3-116
src/client/app/ModelsSection.tsx → c3-116
src/client/app/PendingSegmentedControl.tsx → c3-116
src/client/app/SettingsPage.tsx → c3-116
src/client/app/SkillsSection.tsx → c3-116
src/client/app/SubagentFormRow.tsx → c3-116
src/client/app/SubagentScopeFields.tsx → c3-116
src/client/app/SubagentsSection.test.tsx → c3-116
src/client/app/SubagentsSection.tsx → c3-116
src/client/app/TextSnippetsSection.test.tsx → c3-116
src/client/app/TextSnippetsSection.tsx → c3-116
src/client/app/appSettingsCrud.ts → c3-116
src/client/app/legacyProviderDefaults.ts → c3-116
src/client/app/llmProviderDraft.ts → c3-116
src/client/app/settingsEditorForm.ts → c3-116
src/client/app/useProviderCatalog.ts → c3-116
src/client/app/usePushDeviceActions.ts → c3-116
src/client/components/settings/PluginsSection.tsx → c3-116
src/client/components/settings/PushNotificationsSection.tsx → c3-116
src/client/components/settings/SettingsList.tsx → c3-116
src/client/components/settings/SkillCard.tsx → c3-116
src/client/lib/customProviderDraft.ts → c3-116
src/client/stores/beaconsStore.test.ts → c3-116
src/client/stores/beaconsStore.ts → c3-116
src/client/stores/customProvidersSectionStore.ts → c3-116
src/client/app/LocalProjectsPage.tsx → c3-117
src/client/components/ImportSessionsDialog.tsx → c3-117
src/client/components/NewProjectModal.tsx → c3-117
src/client/app/ChatPage/TerminalWorkspaceShell.tsx → c3-118
src/client/app/terminalLayoutResize.test.ts → c3-118
src/client/app/terminalLayoutResize.ts → c3-118
src/client/app/terminalToggleAnimation.test.ts → c3-118
src/client/app/terminalToggleAnimation.ts → c3-118
src/client/app/BoardsRoutePage.test.tsx → c3-119
src/client/app/BoardsRoutePage.tsx → c3-119
src/client/components/boards/**/*.ts → c3-119
src/client/components/boards/**/*.tsx → c3-119
src/client/lib/boards/**/*.ts → c3-119
src/client/stores/boardsStore.test.ts → c3-119
src/client/stores/boardsStore.ts → c3-119
src/client/app/CronJobEditDialog.store.ts → c3-120
src/client/app/CronJobEditDialog.tsx → c3-120
src/client/app/CronJobRow.store.ts → c3-120
src/client/app/CronJobRow.tsx → c3-120
src/client/app/CronJobsPage.tsx → c3-120
src/client/app/CronJobsSection.tsx → c3-120
src/client/components/messages/CronArmedMessage.tsx → c3-120
src/client/components/messages/CronCommandErrorMessage.tsx → c3-120
src/client/components/messages/CronJobChangeMessage.tsx → c3-120
src/client/components/messages/CronListMessage.tsx → c3-120
src/client/components/messages/CronMessages.test.tsx → c3-120
src/client/components/messages/CronRunMessage.tsx → c3-120
src/client/components/messages/CronRunSkippedMessage.tsx → c3-120
src/client/stores/cronJobsStore.ts → c3-120
src/client/app/KannaPluginsSettingsBranch.tsx → c3-121
src/client/app/PluginSidebarItems.tsx → c3-121
src/client/app/PluginsFooterSection.tsx → c3-121
src/client/app/PluginsFooterSlot.test.tsx → c3-121
src/client/app/PluginsFooterSlot.tsx → c3-121
src/client/app/PluginsSection.tsx → c3-121
src/client/plugins/**/*.ts → c3-121
src/client/plugins/**/*.tsx → c3-121
src/client/stores/pluginContributionsStore.ts → c3-121
src/client/app/StackBoardsRoutePage.tsx → c3-122
src/client/app/useStackCommands.ts → c3-122
src/client/components/chat-ui/sidebar/Stack*.tsx → c3-122
src/client/components/chat-ui/sidebar/StackChatCreateRow.store.ts → c3-122
e2e/genui-fixture.ts → c3-123
e2e/genui.pw.ts → c3-123
src/client/components/genui/**/*.css → c3-123
src/client/components/genui/**/*.ts → c3-123
src/client/components/genui/**/*.tsx → c3-123
src/client/components/lexical/markdown/kannaUiTransformers.ts → c3-123
src/client/components/lexical/nodes/KannaUiNode.tsx → c3-123
src/client/components/settings/RemoteMcpSection.test.tsx → c3-124
src/client/components/settings/RemoteMcpSection.tsx → c3-124
src/client/stores/remoteMcpSectionStore.ts → c3-124
src/shared/remote-mcp/setup-snippets.test.ts → c3-124
src/shared/remote-mcp/setup-snippets.ts → c3-124
src/client/app/WebhookCopyButton.tsx → c3-125
src/client/app/WebhookCreateDialog.store.ts → c3-125
src/client/app/WebhookCreateDialog.tsx → c3-125
src/client/app/WebhookGenericFields.tsx → c3-125
src/client/app/WebhookRow.tsx → c3-125
src/client/app/WebhookSecretDialog.tsx → c3-125
src/client/app/WebhookSlackFields.tsx → c3-125
src/client/app/WebhookSlackSetup.tsx → c3-125
src/client/app/WebhookTargetSelect.tsx → c3-125
src/client/app/WebhooksPage.tsx → c3-125
src/client/app/webhookCommands.test.ts → c3-125
src/client/app/webhookCommands.ts → c3-125
src/client/components/messages/WebhookDeliveryMessage.tsx → c3-125
src/client/lib/webhookDraft.test.ts → c3-125
src/client/lib/webhookDraft.ts → c3-125
src/client/lib/webhookPresentation.test.ts → c3-125
src/client/lib/webhookPresentation.ts → c3-125
src/client/lib/webhookTargets.test.ts → c3-125
src/client/lib/webhookTargets.ts → c3-125
src/client/stores/webhooksStore.ts → c3-125
src/client/app/InboxActivityRow.tsx → c3-126
src/client/app/InboxFilterBar.tsx → c3-126
src/client/app/InboxPage.test.tsx → c3-126
src/client/app/InboxPage.tsx → c3-126
src/client/app/InboxReplyComposer.test.tsx → c3-126
src/client/app/InboxReplyComposer.tsx → c3-126
src/client/app/InboxThreadDetail.tsx → c3-126
src/client/app/InboxThreadRow.tsx → c3-126
src/client/app/useInboxToasts.test.tsx → c3-126
src/client/app/useInboxToasts.ts → c3-126
src/client/lib/inboxCommands.ts → c3-126
src/client/lib/inboxFilter.test.ts → c3-126
src/client/lib/inboxFilter.ts → c3-126
src/client/lib/inboxPresentation.test.ts → c3-126
src/client/lib/inboxPresentation.ts → c3-126
src/client/stores/inboxStore.test.ts → c3-126
src/client/stores/inboxStore.ts → c3-126
src/server/cli-bootstrap.adapter.ts → c3-201
src/server/cli-runtime.test.ts → c3-201
src/server/cli-runtime.ts → c3-201
src/server/cli-supervisor.adapter.ts → c3-201
src/server/cli.ts → c3-201
src/types/bun-process-signals.d.ts → c3-201
src/server/analytics.ts → c3-202
src/server/app-settings-io.adapter.ts → c3-202
src/server/app-settings.ts → c3-202
src/server/beacon-connection.test.ts → c3-202
src/server/beacon-connection.ts → c3-202
src/server/beacon-crypto.test.ts → c3-202
src/server/beacon-crypto.ts → c3-202
src/server/beacon-pairing-host.ts → c3-202
src/server/beacon-pairing.test.ts → c3-202
src/server/beacon-pairing.ts → c3-202
src/server/beacon-registry.test.ts → c3-202
src/server/beacon-registry.ts → c3-202
src/server/beacon-services.test.ts → c3-202
src/server/beacon-services.ts → c3-202
src/server/beacon-settings.test.ts → c3-202
src/server/beacon-settings.ts → c3-202
src/server/beacon-transfer-files.adapter.ts → c3-202
src/server/beacon-transfer-files.ts → c3-202
src/server/beacon-transfer-host.ts → c3-202
src/server/beacon-transfer-http.adapter.ts → c3-202
src/server/beacon-transfer-http.test.ts → c3-202
src/server/beacon-transfer-tickets.ts → c3-202
src/server/custom-providers-settings.ts → c3-202
src/server/fs-stat.adapter.ts → c3-202
src/server/http-api-routes.ts → c3-202
src/server/http-dispatcher.ts → c3-202
src/server/http-route-inventory.test.ts → c3-202
src/server/http-static.ts → c3-202
src/server/input-validation.ts → c3-202
src/server/json-boundary.ts → c3-202
src/server/server-data-dir.test.ts → c3-202
src/server/server-io.adapter.ts → c3-202
src/server/server.ts → c3-202
src/client/app/PasswordScreen.store.ts → c3-203
src/server/auth-backend.ts → c3-203
src/server/auth.test.ts → c3-203
src/server/auth.ts → c3-203
src/server/better-auth-oauth.adapter.ts → c3-203
src/server/better-auth.adapter.ts → c3-203
src/server/machine-name.adapter.ts → c3-204
src/server/paths-fs.adapter.ts → c3-204
src/server/paths.ts → c3-204
src/server/project-directory.adapter.ts → c3-204
src/server/project-paths-io.adapter.ts → c3-204
src/server/project-paths.test.ts → c3-204
src/server/project-paths.ts → c3-204
src/server/projectFileRelocation.adapter.ts → c3-204
src/server/events.ts → c3-205
src/server/harness-types.ts → c3-205
src/server/chat-op-log.test.ts → c3-206
src/server/chat-op-log.ts → c3-206
src/server/chat-ops-parity.test.ts → c3-206
src/server/event-store-*.ts → c3-206
src/server/event-store-messages.adapter.test.ts → c3-206
src/server/event-store-messages.adapter.ts → c3-206
src/server/event-store-write-ops.test.ts → c3-206
src/server/event-store-write-ops.ts → c3-206
src/server/event-store.project-delete.test.ts → c3-206
src/server/event-store.test.ts → c3-206
src/server/event-store.ts → c3-206
src/server/storage/backend.ts → c3-206
src/server/storage/fs-storage.adapter.ts → c3-206
src/server/storage/in-memory-storage.ts → c3-206
src/server/read-models.test.ts → c3-207
src/server/read-models.ts → c3-207
src/server/chat-ops-diff.test.ts → c3-208
src/server/chat-ops-diff.ts → c3-208
src/server/live-block-throttle.test.ts → c3-208
src/server/live-block-throttle.ts → c3-208
src/server/project-kanna-files.adapter.test.ts → c3-208
src/server/project-kanna-files.adapter.ts → c3-208
src/server/ws-router-ack.ts → c3-208
src/server/ws-router-agent-ctrl.ts → c3-208
src/server/ws-router-broadcast.ts → c3-208
src/server/ws-router-chat.ts → c3-208
src/server/ws-router-command-results.test.ts → c3-208
src/server/ws-router-coverage.test.ts → c3-208
src/server/ws-router-defaults.ts → c3-208
src/server/ws-router-diff.ts → c3-208
src/server/ws-router-envelope.ts → c3-208
src/server/ws-router-io.adapter.ts → c3-208
src/server/ws-router-misc.ts → c3-208
src/server/ws-router-plugins.test.ts → c3-208
src/server/ws-router-plugins.ts → c3-208
src/server/ws-router-project-files.test.ts → c3-208
src/server/ws-router-project-files.ts → c3-208
src/server/ws-router-project.ts → c3-208
src/server/ws-router-settings.ts → c3-208
src/server/ws-router-skills.ts → c3-208
src/server/ws-router-utils.ts → c3-208
src/server/ws-router.test.ts → c3-208
src/server/ws-router.ts → c3-208
src/server/process-utils.adapter.ts → c3-209
src/server/process-utils.test.ts → c3-209
src/server/agent-app-settings-view.ts → c3-210
src/server/agent-coordinator-types.ts → c3-210
src/server/agent-coordinator.ts → c3-210
src/server/agent.test.ts → c3-210
src/server/agent.ts → c3-210
src/server/background-task-output-io.adapter.ts → c3-210
src/server/background-task-output-registry.ts → c3-210
src/server/beacon-mention-prompt.test.ts → c3-210
src/server/beacon-mention-prompt.ts → c3-210
src/server/claude-autocontinue-commands.ts → c3-210
src/server/claude-cancel-handler.ts → c3-210
src/server/claude-chat-management.ts → c3-210
src/server/claude-context-commands.test.ts → c3-210
src/server/claude-context-commands.ts → c3-210
src/server/claude-harness-stream.ts → c3-210
src/server/claude-live-block.ts → c3-210
src/server/claude-live-publisher.ts → c3-210
src/server/claude-loop-commands.ts → c3-210
src/server/claude-message-normalizer.ts → c3-210
src/server/claude-prompt-helpers.ts → c3-210
src/server/claude-sdk-queue.ts → c3-210
src/server/claude-send-command.test.ts → c3-210
src/server/claude-send-command.ts → c3-210
src/server/claude-session-config-helpers.ts → c3-210
src/server/claude-session-error-handler.ts → c3-210
src/server/claude-session-lifecycle.test.ts → c3-210
src/server/claude-session-lifecycle.ts → c3-210
src/server/claude-session-runner.test.ts → c3-210
src/server/claude-session-runner.ts → c3-210
src/server/claude-session-spawner.ts → c3-210
src/server/claude-session-start.ts → c3-210
src/server/claude-session-state-queries.test.ts → c3-210
src/server/claude-session-state-queries.ts → c3-210
src/server/claude-session-state.ts → c3-210
src/server/claude-spawn-helpers.ts → c3-210
src/server/claude-steer-log.ts → c3-210
src/server/claude-subagent-tool-response.ts → c3-210
src/server/claude-subagent-wiring.ts → c3-210
src/server/claude-tool-respond.ts → c3-210
src/server/claude-turn-runner.ts → c3-210
src/server/claude-turn-starter-types.ts → c3-210
src/server/claude-turn-starter.ts → c3-210
src/server/claude-usage-math.ts → c3-210
src/server/compaction.test.ts → c3-210
src/server/compaction.ts → c3-210
src/server/history-primer.test.ts → c3-210
src/server/history-primer.ts → c3-210
src/server/loop-integrate-io.adapter.ts → c3-210
src/server/loop-prompt-parallel.ts → c3-210
src/server/loop-template-io.adapter.ts → c3-210
src/server/loop-template.ts → c3-210
src/server/loop-verify-cache.ts → c3-210
src/server/loop-verify-io.adapter.ts → c3-210
src/server/loop-wake-prompt.ts → c3-210
src/server/loop-wake-recovery.test.ts → c3-210
src/server/loop-wake-recovery.ts → c3-210
src/server/mention-parser.test.ts → c3-210
src/server/mention-parser.ts → c3-210
src/server/mermaid-guard.ts → c3-210
src/server/mermaid-parse.adapter.ts → c3-210
src/server/model-escalation.ts → c3-210
src/server/pending-tool-slot.ts → c3-210
src/server/proactive-compact.test.ts → c3-210
src/server/proactive-compact.ts → c3-210
src/server/project-mention-attach.test.ts → c3-210
src/server/project-mention-attach.ts → c3-210
src/server/project-process-env.ts → c3-210
src/server/queued-message-recovery.ts → c3-210
src/server/subagent-entry-cap.adapter.ts → c3-210
src/server/subagent-entry-cap.test.ts → c3-210
src/server/subagent-orchestrator.test.ts → c3-210
src/server/subagent-orchestrator.ts → c3-210
src/server/subagent-provider-run.test.ts → c3-210
src/server/subagent-provider-run.ts → c3-210
src/server/subagent-transcript-io.adapter.ts → c3-210
src/server/subagent-transcript-registry.ts → c3-210
src/server/tracking-file-lock.test.ts → c3-210
src/server/tracking-file-lock.ts → c3-210
src/server/codex-app-server-decode.ts → c3-211
src/server/codex-app-server-protocol.ts → c3-211
src/server/codex-app-server.test.ts → c3-211
src/server/codex-app-server.ts → c3-211
src/server/codex-rollout-to-thread-item.ts → c3-211
src/server/codex-session-types.ts → c3-211
src/server/codex-spawn.adapter.ts → c3-211
src/server/codex-tool-payloads.ts → c3-211
src/server/codex-transcript-translator.ts → c3-211
src/server/llm-provider-store.adapter.ts → c3-212
src/server/provider-catalog.test.ts → c3-212
src/server/provider-catalog.ts → c3-212
src/server/sdk-endpoint.ts → c3-212
src/shared/custom-provider-presets.ts → c3-212
src/shared/custom-providers.test.ts → c3-212
src/shared/custom-providers.ts → c3-212
src/server/generate-commit-message.test.ts → c3-213
src/server/generate-commit-message.ts → c3-213
src/server/generate-title.ts → c3-213
src/server/llm-provider.test.ts → c3-213
src/server/llm-provider.ts → c3-213
src/server/quick-response.test.ts → c3-213
src/server/quick-response.ts → c3-213
src/server/title-generation.live.test.ts → c3-213
src/server/claude-session-importer.adapter.ts → c3-214
src/server/claude-session-importer.test.ts → c3-214
src/server/claude-session-mapper.test.ts → c3-214
src/server/claude-session-mapper.ts → c3-214
src/server/claude-session-parser.adapter.ts → c3-214
src/server/claude-session-parser.test.ts → c3-214
src/server/claude-session-scanner.adapter.ts → c3-214
src/server/claude-session-scanner.test.ts → c3-214
src/server/claude-session-types.ts → c3-214
src/server/codex-session-scanner.adapter.ts → c3-214
src/server/discovery.adapter.ts → c3-214
src/server/discovery.test.ts → c3-214
src/server/followed-session-io.adapter.ts → c3-214
src/server/followed-session-registry.ts → c3-214
src/server/imported-subagents-dir.ts → c3-214
src/server/diff-store-*.ts → c3-215
src/server/diff-store.test.ts → c3-215
src/server/diff-store.ts → c3-215
src/server/terminal-manager-io.adapter.ts → c3-216
src/server/terminal-manager.test.ts → c3-216
src/server/terminal-manager.ts → c3-216
src/server/terminal-pid-registry.adapter.ts → c3-216
src/server/terminal-pid-registry.test.ts → c3-216
src/client/lib/uploadFile.adapter.test.ts → c3-217
src/client/lib/uploadFile.adapter.ts → c3-217
src/server/http-file-response.ts → c3-217
src/server/tus-uploads.adapter.ts → c3-217
src/server/uploads.adapter.ts → c3-217
src/server/uploads.test.ts → c3-217
src/server/uploads.ts → c3-217
src/server/share.test.ts → c3-218
src/server/share.ts → c3-218
src/server/update-manager.test.ts → c3-219
src/server/update-manager.ts → c3-219
src/server/update-strategy.test.ts → c3-219
src/server/update-strategy.ts → c3-219
src/server/restart.test.ts → c3-220
src/server/restart.ts → c3-220
src/server/external-open.test.ts → c3-221
src/server/external-open.ts → c3-221
src/server/wsl.adapter.ts → c3-221
src/server/keybindings-store.adapter.ts → c3-222
src/server/keybindings.test.ts → c3-222
src/server/keybindings.ts → c3-222
src/server/cloudflare-tunnel/**/*.ts → c3-223
src/server/oauth-pool/**/*.ts → c3-224
src/server/canonical-args.ts → c3-226
src/server/kanna-mcp-beacon-transfer.test.ts → c3-226
src/server/kanna-mcp-beacon-transfer.ts → c3-226
src/server/kanna-mcp-beacon.test.ts → c3-226
src/server/kanna-mcp-beacon.ts → c3-226
src/server/kanna-mcp-tool.ts → c3-226
src/server/kanna-mcp-tools/**/*.ts → c3-226
src/server/kanna-mcp.test.ts → c3-226
src/server/kanna-mcp.ts → c3-226
src/server/mcp-bearer.ts → c3-226
src/server/mcp-oauth.adapter.ts → c3-226
src/server/mcp-validator.ts → c3-226
src/server/oauth-errors.ts → c3-226
src/server/permission-gate.test.ts → c3-226
src/server/permission-gate.ts → c3-226
src/server/structured-doc-io.adapter.ts → c3-226
src/server/tool-callback.test.ts → c3-226
src/server/tool-callback.ts → c3-226
src/shared/structured-doc/**/*.ts → c3-226
src/server/auto-continue/**/*.ts → c3-227
src/server/session-share/**/*.ts → c3-228
src/server/share-defaults.adapter.ts → c3-228
src/client/app/WorkflowAgentTranscriptPanel.store.ts → c3-229
src/client/app/WorkflowAgentTranscriptPanel.test.tsx → c3-229
src/client/app/WorkflowAgentTranscriptPanel.tsx → c3-229
src/client/app/WorkflowsPage.store.ts → c3-229
src/client/app/WorkflowsPage.test.tsx → c3-229
src/client/app/WorkflowsPage.tsx → c3-229
src/client/app/WorkflowsSection.store.ts → c3-229
src/client/app/WorkflowsSection.tsx → c3-229
src/client/components/messages/WorkflowMessage.tsx → c3-229
src/client/lib/workflowGrouping.test.ts → c3-229
src/client/lib/workflowGrouping.ts → c3-229
src/client/stores/workflowsStore.ts → c3-229
src/server/agent-transcript-parse.test.ts → c3-229
src/server/agent-transcript-parse.ts → c3-229
src/server/claude-projects-path.adapter.test.ts → c3-229
src/server/claude-projects-path.adapter.ts → c3-229
src/server/output-ring.test.ts → c3-229
src/server/output-ring.ts → c3-229
src/server/watched-registry.test.ts → c3-229
src/server/watched-registry.ts → c3-229
src/server/workflow-agent-transcript-io.adapter.test.ts → c3-229
src/server/workflow-agent-transcript-io.adapter.ts → c3-229
src/server/workflow-registry.test.ts → c3-229
src/server/workflow-registry.ts → c3-229
src/server/workflow-watch-io.adapter.test.ts → c3-229
src/server/workflow-watch-io.adapter.ts → c3-229
src/shared/workflow-types.test.ts → c3-229
src/shared/workflow-types.ts → c3-229
src/server/openrouter-models-io.adapter.ts → c3-230
src/server/openrouter-models.ts → c3-230
src/server/claude-slash-commands.test.ts → c3-231
src/server/claude-slash-commands.ts → c3-231
src/server/local-catalog-io.adapter.test.ts → c3-231
src/server/local-catalog-io.adapter.ts → c3-231
src/server/local-catalog.test.ts → c3-231
src/server/local-catalog.ts → c3-231
src/server/skill-invocation.test.ts → c3-231
src/server/skill-invocation.ts → c3-231
src/shared/slash-expansion.test.ts → c3-231
src/shared/slash-expansion.ts → c3-231
src/server/board-*.ts → c3-232
src/server/github-cli.adapter.ts → c3-232
src/server/github-issues.adapter.ts → c3-232
src/server/kanna-mcp-boards.test.ts → c3-232
src/server/kanna-mcp-boards.ts → c3-232
src/server/worktree-store.adapter.ts → c3-232
src/server/ws-router-boards.test.ts → c3-232
src/server/ws-router-boards.ts → c3-232
src/server/cron/**/*.ts → c3-233
scripts/grafana-alerts.ts → c3-234
scripts/perf-alert-issue.ts → c3-234
src/ops/alerting/**/*.ts → c3-234
src/server/memory-ceiling.test.ts → c3-234
src/server/memory-ceiling.ts → c3-234
src/server/observability.ts → c3-234
src/server/otel-config.ts → c3-234
src/server/otel.adapter.ts → c3-234
src/server/test-helpers/metric-recorder.ts → c3-234
src/server/ws-router-observability.ts → c3-234
.githooks/pre-commit → c3-235
.github/workflows/gitleaks.yml → c3-235
.gitleaks.toml → c3-235
src/server/gitleaks-hook.test.ts → c3-235
scripts/check-complexity-limits.ts → c3-236
src/ops/architecture/budget-scan.adapter.ts → c3-236
src/ops/architecture/budget.ts → c3-236
src/ops/architecture/cjs-interop-scan.adapter.ts → c3-236
src/ops/architecture/cjs-interop.ts → c3-236
src/server/app-settings-package-updates.ts → c3-237
src/server/claude-plugin-update-applier.adapter.ts → c3-237
src/server/claude-plugin-update-checker.adapter.ts → c3-237
src/server/codex-plugin-update-applier.adapter.ts → c3-237
src/server/codex-plugin-update-checker.adapter.ts → c3-237
src/server/package-inventory-io.adapter.test.ts → c3-237
src/server/package-inventory-io.adapter.ts → c3-237
src/server/package-update-appliers-boot.adapter.ts → c3-237
src/server/package-update-manager.test.ts → c3-237
src/server/package-update-manager.ts → c3-237
src/server/skill-update-applier.adapter.test.ts → c3-237
src/server/skill-update-applier.adapter.ts → c3-237
src/server/skill-update-checker.adapter.test.ts → c3-237
src/server/skill-update-checker.adapter.ts → c3-237
src/server/__fixtures__/plugins/** → c3-238
src/server/kanna-mcp-plugins.test.ts → c3-238
src/server/kanna-mcp-plugins.ts → c3-238
src/server/plugin-cli-dispatch.test.ts → c3-238
src/server/plugin-cli-dispatch.ts → c3-238
src/server/plugin-cli.ts → c3-238
src/server/plugin-http-routes.ts → c3-238
src/server/plugin-system-acceptance.test.tsx → c3-238
src/server/plugins/**/*.ts → c3-238
src/server/agent.stack-spawn.test.ts → c3-239
src/server/claude-session-config.ts → c3-239
src/server/event-store.stack-methods.test.ts → c3-239
src/server/ws-router.stack.test.ts → c3-239
src/server/genui/*.ts → c3-240
src/server/turn-end-guard.ts → c3-240
src/server/ws-router-genui.ts → c3-240
apps/beacon-desktop/**/* → c3-241
apps/beacon-win7/**/* → c3-241
scripts/beacon-desktop-icons.ts → c3-241
scripts/build-beacon-desktop.ts → c3-241
scripts/build-beacon.ts → c3-241
src/beacon/activity.test.ts → c3-241
src/beacon/activity.ts → c3-241
src/beacon/desktop/**/*.ts → c3-241
src/beacon/desktop/**/*.tsx → c3-241
src/beacon/desktop/view/beacon-desktop.css → c3-241
src/beacon/entry.adapter.ts → c3-241
src/beacon/fs.adapter.test.ts → c3-241
src/beacon/fs.adapter.ts → c3-241
src/beacon/host-os.ts → c3-241
src/beacon/key-store.adapter.test.ts → c3-241
src/beacon/key-store.adapter.ts → c3-241
src/beacon/main.test.ts → c3-241
src/beacon/main.ts → c3-241
src/beacon/pair-client.adapter.ts → c3-241
src/beacon/ports.ts → c3-241
src/beacon/runner.test.ts → c3-241
src/beacon/runner.ts → c3-241
src/beacon/self-update.adapter.test.ts → c3-241
src/beacon/self-update.adapter.ts → c3-241
src/beacon/self-update.test.ts → c3-241
src/beacon/self-update.ts → c3-241
src/beacon/session.test.ts → c3-241
src/beacon/session.ts → c3-241
src/beacon/shell.adapter.test.ts → c3-241
src/beacon/shell.adapter.ts → c3-241
src/beacon/state-store.adapter.ts → c3-241
src/beacon/supervisor.test.ts → c3-241
src/beacon/supervisor.ts → c3-241
src/beacon/transfer.adapter.ts → c3-241
src/beacon/transport.adapter.ts → c3-241
src/beacon/version.test.ts → c3-241
src/beacon/version.ts → c3-241
src/ops/parity/remote-mcp-docs.test.ts → c3-242
src/server/better-auth-oauth.adapter.ts → c3-242
src/server/command-origin-stamp.ts → c3-242
src/server/project-file-path.ts → c3-242
src/server/remote-mcp/**/*.ts → c3-242
src/shared/command-origin.ts → c3-242
src/shared/remote-mcp/topics.ts → c3-242
src/shared/settings/remote-mcp.test.ts → c3-242
src/shared/settings/remote-mcp.ts → c3-242
src/server/test-helpers/slack-harness.ts → c3-243
src/server/test-helpers/slack-hook-harness.ts → c3-243
src/server/test-helpers/webhook-harness.ts → c3-243
src/server/webhooks/slack/slack-api.adapter.test.ts → c3-243
src/server/webhooks/slack/slack-api.adapter.ts → c3-243
src/server/webhooks/slack/slack-api.ts → c3-243
src/server/webhooks/slack/slack-events.test.ts → c3-243
src/server/webhooks/slack/slack-events.ts → c3-243
src/server/webhooks/slack/slack-http.test.ts → c3-243
src/server/webhooks/slack/slack-prompt.test.ts → c3-243
src/server/webhooks/slack/slack-prompt.ts → c3-243
src/server/webhooks/slack/slack-service.test.ts → c3-243
src/server/webhooks/slack/slack-service.ts → c3-243
src/server/webhooks/slack/slack-signature.test.ts → c3-243
src/server/webhooks/slack/slack-signature.ts → c3-243
src/server/webhooks/slack/slack-task-tracker.ts → c3-243
src/server/webhooks/slack/slack-thread-store.adapter.test.ts → c3-243
src/server/webhooks/slack/slack-thread-store.adapter.ts → c3-243
src/server/webhooks/slack/slack-threads.ts → c3-243
src/server/webhooks/webhook-auth.ts → c3-243
src/server/webhooks/webhook-boot.ts → c3-243
src/server/webhooks/webhook-delivery.test.ts → c3-243
src/server/webhooks/webhook-delivery.ts → c3-243
src/server/webhooks/webhook-filter.ts → c3-243
src/server/webhooks/webhook-http-routes.test.ts → c3-243
src/server/webhooks/webhook-http-routes.ts → c3-243
src/server/webhooks/webhook-rate-limit.ts → c3-243
src/server/webhooks/webhook-registry.test.ts → c3-243
src/server/webhooks/webhook-registry.ts → c3-243
src/server/webhooks/webhook-service.ts → c3-243
src/server/webhooks/webhook-store.adapter.test.ts → c3-243
src/server/webhooks/webhook-store.adapter.ts → c3-243
src/server/ws-router-webhooks.ts → c3-243
src/shared/webhooks/slack.ts → c3-243
src/shared/webhooks/template.test.ts → c3-243
src/shared/webhooks/template.ts → c3-243
src/shared/webhooks/types.ts → c3-243
src/shared/webhooks/validate.test.ts → c3-243
src/shared/webhooks/validate.ts → c3-243
src/server/push/**/*.ts → c3-244
src/server/ws-router-push.ts → c3-244
src/shared/settings/push.ts → c3-244
src/shared/vapid-subject.ts → c3-244
.github/workflows/wiki-deploy.yml → c3-245
wiki/astro.config.mjs → c3-245
wiki/package.json → c3-245
wiki/scripts/**/*.ts → c3-245
wiki/src/components/*.astro → c3-245
wiki/src/content.config.ts → c3-245
wiki/src/sidebar.mjs → c3-245
src/client/app/ServiceBusConsumersGroup.tsx → c3-246
src/client/app/ServiceBusEmbeddedGroup.tsx → c3-246
src/client/app/ServiceBusFields.tsx → c3-246
src/client/app/ServiceBusSection.test.tsx → c3-246
src/client/app/ServiceBusSection.tsx → c3-246
src/client/app/ServiceBusStreamGroup.tsx → c3-246
src/server/service-bus-settings.ts → c3-246
src/server/service-bus/event-store-tap.test.ts → c3-246
src/server/service-bus/event-store-tap.ts → c3-246
src/server/service-bus/in-memory-service-bus.test.ts → c3-246
src/server/service-bus/in-memory-service-bus.ts → c3-246
src/server/service-bus/jetstream-reconcile.test.ts → c3-246
src/server/service-bus/jetstream-reconcile.ts → c3-246
src/server/service-bus/nats-mirror-queue.test.ts → c3-246
src/server/service-bus/nats-mirror-queue.ts → c3-246
src/server/service-bus/nats-mirror.test.ts → c3-246
src/server/service-bus/nats-mirror.ts → c3-246
src/server/service-bus/nats-server-install.adapter.test.ts → c3-246
src/server/service-bus/nats-server-install.adapter.ts → c3-246
src/server/service-bus/nats-server-process.adapter.test.ts → c3-246
src/server/service-bus/nats-server-process.adapter.ts → c3-246
src/server/service-bus/nats-server-release.ts → c3-246
src/server/service-bus/nats-service-bus.adapter.integration.test.ts → c3-246
src/server/service-bus/nats-service-bus.adapter.ts → c3-246
src/server/service-bus/service-bus-boot.test.ts → c3-246
src/server/service-bus/service-bus-boot.ts → c3-246
src/server/service-bus/service-bus.ts → c3-246
src/server/service-bus/store-event-subjects.test.ts → c3-246
src/server/service-bus/store-event-subjects.ts → c3-246
src/server/ws-router-service-bus.ts → c3-246
src/shared/release-sums.ts → c3-246
src/shared/service-bus/envelope.test.ts → c3-246
src/shared/service-bus/envelope.ts → c3-246
src/shared/service-bus/jetstream-config.test.ts → c3-246
src/shared/service-bus/jetstream-config.ts → c3-246
src/server/inbound/deliver-inbound.test.ts → c3-247
src/server/inbound/deliver-inbound.ts → c3-247
src/server/inbound/inbox-reply.test.ts → c3-247
src/server/inbound/inbox-reply.ts → c3-247
src/server/inbox/inbox-boot.ts → c3-247
src/server/inbox/inbox-log.adapter.test.ts → c3-247
src/server/inbox/inbox-log.adapter.ts → c3-247
src/server/inbox/inbox-projection.ts → c3-247
src/server/inbox/inbox-registry.test.ts → c3-247
src/server/inbox/inbox-registry.ts → c3-247
src/server/kanna-mcp-inbox.test.ts → c3-247
src/server/kanna-mcp-inbox.ts → c3-247
src/server/ws-router-inbox.ts → c3-247
src/shared/inbound/handler.ts → c3-247
src/shared/inbound/reply-prompt.test.ts → c3-247
src/shared/inbound/reply-prompt.ts → c3-247
src/shared/inbound/template.test.ts → c3-247
src/shared/inbound/template.ts → c3-247
src/shared/inbox/describe.test.ts → c3-247
src/shared/inbox/describe.ts → c3-247
src/shared/inbox/events.ts → c3-247
src/shared/inbox/policy.test.ts → c3-247
src/shared/inbox/policy.ts → c3-247
src/shared/inbox/types.ts → c3-247
src/client/app/McpSourceForm.tsx → c3-248
src/client/app/McpSourcesSection.test.tsx → c3-248
src/client/app/McpSourcesSection.tsx → c3-248
src/client/lib/mcpSourceDraft.test.ts → c3-248
src/client/lib/mcpSourceDraft.ts → c3-248
src/client/lib/mcpSourcePresentation.test.ts → c3-248
src/client/lib/mcpSourcePresentation.ts → c3-248
src/client/stores/mcpSourcesSectionStore.ts → c3-248
src/client/stores/mcpSourcesStore.ts → c3-248
src/server/mcp-sources-settings.test.ts → c3-248
src/server/mcp-sources-settings.ts → c3-248
src/server/mcp-sources/mcp-source-client.adapter.test.ts → c3-248
src/server/mcp-sources/mcp-source-client.adapter.ts → c3-248
src/server/mcp-sources/mcp-source-cursor-store.adapter.test.ts → c3-248
src/server/mcp-sources/mcp-source-cursor-store.adapter.ts → c3-248
src/server/mcp-sources/mcp-source-runner.test.ts → c3-248
src/server/mcp-sources/mcp-source-runner.ts → c3-248
src/server/mcp-sources/mcp-sources-boot.ts → c3-248
src/shared/mcp-sources/presets.ts → c3-248
src/shared/mcp-sources/types.ts → c3-248
src/shared/mcp-sources/validate.test.ts → c3-248
src/shared/mcp-sources/validate.ts → c3-248
src/shared/analytics.ts → c3-301
src/shared/app-settings-types.ts → c3-301
src/shared/builtin-commands.ts → c3-301
src/shared/chat-activity.ts → c3-301
src/shared/chat-tasks/**/*.ts → c3-301
src/shared/claude-api-error-classification.ts → c3-301
src/shared/claude-session-id.ts → c3-301
src/shared/codex-error-classification.ts → c3-301
src/shared/core-types.ts → c3-301
src/shared/design/**/*.ts → c3-301
src/shared/dynamic-module.ts → c3-301
src/shared/equality.ts → c3-301
src/shared/errors.ts → c3-301
src/shared/git-diff-types.ts → c3-301
src/shared/json.test.ts → c3-301
src/shared/json.ts → c3-301
src/shared/kanna-system-prompt.test.ts → c3-301
src/shared/kanna-system-prompt.ts → c3-301
src/shared/lazyModule.ts → c3-301
src/shared/log.ts → c3-301
src/shared/loop-progress.ts → c3-301
src/shared/mask-oauth-key.test.ts → c3-301
src/shared/mask-oauth-key.ts → c3-301
src/shared/mcp-types.ts → c3-301
src/shared/mention-pattern.ts → c3-301
src/shared/mermaid*.ts → c3-301
src/shared/pane-tab-width.ts → c3-301
src/shared/permission-policy.test.ts → c3-301
src/shared/permission-policy.ts → c3-301
src/shared/project-mention.test.ts → c3-301
src/shared/project-mention.ts → c3-301
src/shared/projectFileUrl.test.ts → c3-301
src/shared/projectFileUrl.ts → c3-301
src/shared/provider-model-types.ts → c3-301
src/shared/settings/**/*.ts → c3-301
src/shared/skill-agents.ts → c3-301
src/shared/subagent-types.ts → c3-301
src/shared/task-doc.test.ts → c3-301
src/shared/task-doc.ts → c3-301
src/shared/terminal-scrollback.ts → c3-301
src/shared/tool-call-types.ts → c3-301
src/shared/transcript-types.ts → c3-301
src/shared/turn-model-selection.ts → c3-301
src/shared/types.test.ts → c3-301
src/shared/types.ts → c3-301
src/ops/parity/http-route-inventory.test.ts → c3-302
src/shared/app-settings-types.schema.ts → c3-302
src/shared/beacon-alias.test.ts → c3-302
src/shared/beacon-alias.ts → c3-302
src/shared/beacon-config.schema.ts → c3-302
src/shared/beacon-config.ts → c3-302
src/shared/beacon-pair-link.test.ts → c3-302
src/shared/beacon-pair-link.ts → c3-302
src/shared/beacon-protocol.test.ts → c3-302
src/shared/beacon-protocol.ts → c3-302
src/shared/beacon-scope.test.ts → c3-302
src/shared/beacon-scope.ts → c3-302
src/shared/beacon-status.test.ts → c3-302
src/shared/beacon-status.ts → c3-302
src/shared/beacon-tool-request.ts → c3-302
src/shared/beacon-tools.ts → c3-302
src/shared/beacon-transfer.ts → c3-302
src/shared/boards/types.schema.ts → c3-302
src/shared/chat-ops.test.ts → c3-302
src/shared/chat-ops.ts → c3-302
src/shared/command-origin.schema.ts → c3-302
src/shared/commands/**/*.ts → c3-302
src/shared/core-types.schema.ts → c3-302
src/shared/cron/types.schema.ts → c3-302
src/shared/custom-providers.schema.ts → c3-302
src/shared/git-diff-types.schema.ts → c3-302
src/shared/http-routes.test.ts → c3-302
src/shared/http-routes.ts → c3-302
src/shared/inbound/handler.schema.ts → c3-302
src/shared/inbox/types.schema.ts → c3-302
src/shared/live-block.ts → c3-302
src/shared/mcp-sources/types.schema.ts → c3-302
src/shared/mcp-types.schema.ts → c3-302
src/shared/permission-policy.schema.ts → c3-302
src/shared/protocol.ts → c3-302
src/shared/provider-model-types.schema.ts → c3-302
src/shared/service-bus/jetstream-config.schema.ts → c3-302
src/shared/session-share/types.schema.ts → c3-302
src/shared/settings/settings.schema.ts → c3-302
src/shared/subagent-types.schema.ts → c3-302
src/shared/tool-call-types.schema.ts → c3-302
src/shared/transcript-types.schema.ts → c3-302
src/shared/type-parity.ts → c3-302
src/shared/types.schema.ts → c3-302
src/shared/webhooks/types.schema.ts → c3-302
src/shared/workflow-types.schema.ts → c3-302
src/shared/tools.test.ts → c3-303
src/shared/tools.ts → c3-303
src/shared/dev-ports.test.ts → c3-304
src/shared/dev-ports.ts → c3-304
src/shared/ports.ts → c3-304
src/shared/branding.test.ts → c3-305
src/shared/branding.ts → c3-305
src/shared/session-share/**/*.ts → c3-306
src/shared/share.ts → c3-306
src/shared/token-pricing.ts → c3-307
src/shared/boards/**/*.ts → c3-310
src/shared/cron/**/*.ts → c3-311
src/shared/packages/parse-claude-plugin-marketplace.test.ts → c3-312
src/shared/packages/parse-claude-plugin-marketplace.ts → c3-312
src/shared/packages/parse-claude-plugins.test.ts → c3-312
src/shared/packages/parse-claude-plugins.ts → c3-312
src/shared/packages/parse-codex-plugins.test.ts → c3-312
src/shared/packages/parse-codex-plugins.ts → c3-312
src/shared/packages/parse-skill-lock.test.ts → c3-312
src/shared/packages/parse-skill-lock.ts → c3-312
src/shared/packages/skill-update-classifier.test.ts → c3-312
src/shared/packages/skill-update-classifier.ts → c3-312
src/shared/packages/tag-order.test.ts → c3-312
src/shared/packages/tag-order.ts → c3-312
src/shared/packages/types.ts → c3-312
src/shared/plugins/**/*.ts → c3-313
src/shared/plugins/kanna-plugin.d.ts → c3-313
src/shared/stack-activity.test.ts → c3-314
src/shared/stack-activity.ts → c3-314
src/shared/genui/*.ts → c3-315
