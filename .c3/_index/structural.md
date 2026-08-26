# C3 Structural Index
<!-- hash: sha256:8fd2c75b1ab448e2914b03eaad6467129afbb2ae9207937e5ae17a5f67cfe2d2 -->

## c3-0 — Kanna (system)

## c3-1 — Client (container)
context: c3-0

## c3-101 — socket-client (component)
container: c3-1 | context: c3-0
refs: ref-strong-typing, ref-ws-subscription, rule-strong-typing
files: src/client/app/KannaSocketProvider.tsx, src/client/app/SocketBridge.tsx, src/client/app/pushClient.test.ts, src/client/app/pushClient.ts, src/client/app/socket-protocol.ts, src/client/app/socket.test.ts, src/client/app/socket.ts

## c3-102 — state-stores (component)
container: c3-1 | context: c3-0
refs: ref-colocated-bun-test, ref-strong-typing, ref-zustand-store, rule-colocated-bun-test, rule-strong-typing, rule-zustand-store
files: src/client/stores/**/*.ts

## c3-103 — ui-primitives (component)
container: c3-1 | context: c3-0
refs: ref-strong-typing, rule-strong-typing
files: src/client/components/editor-icons.tsx, src/client/components/ui/**/*.tsx

## c3-104 — pane-layout (component)
container: c3-1 | context: c3-0
refs: ref-colocated-bun-test, ref-strong-typing, ref-zustand-store

## c3-110 — app-shell (component)
container: c3-1 | context: c3-0
refs: ref-cqrs-read-models, ref-ws-subscription
files: src/client/app/App.test.tsx, src/client/app/App.tsx, src/client/app/AppBootstrap.tsx, src/client/app/AppGlobalProvider.tsx, src/client/app/PageHeader.tsx, src/client/app/appRuntime.test.ts, src/client/app/appRuntime.ts, src/client/app/chatFocusPolicy.test.ts, src/client/app/chatFocusPolicy.ts, src/client/app/chatNotifications.ts, src/client/app/derived.ts, src/client/app/sidebarSwipeGesture.ts, src/client/app/useAppGlobalState.test.ts, src/client/app/useAppGlobalState.ts, src/client/app/useKannaState.test.ts, src/client/app/useKannaState.ts, src/client/app/usePushFocus.test.ts, src/client/app/usePushFocus.ts, src/client/components/LocalDev.tsx, src/client/hooks/**/*.ts, src/client/hooks/**/*.tsx, src/client/lib/**/*.ts, src/main.tsx

## c3-111 — sidebar (component)
container: c3-1 | context: c3-0
refs: ref-cqrs-read-models, ref-zustand-store, rule-zustand-store
files: src/client/app/KannaSidebar.tsx, src/client/app/sidebarNumberJump.test.ts, src/client/app/sidebarNumberJump.ts

## c3-112 — chat-page (component)
container: c3-1 | context: c3-0
refs: ref-cqrs-read-models, ref-ws-subscription
files: src/client/app/BackgroundTasksSection.test.tsx, src/client/app/BackgroundTasksSection.tsx, src/client/app/ChatPage.test.ts, src/client/app/ChatPage/**/*.ts, src/client/app/ChatPage/**/*.tsx, src/client/app/LoopProgressSection.test.tsx, src/client/app/LoopProgressSection.tsx, src/client/app/chatNavigator.ts, src/client/app/useRightSidebarToggleAnimation.ts, src/client/app/useStickyChatFocus.ts, src/client/app/useTerminalToggleAnimation.ts

## c3-113 — transcript (component)
container: c3-1 | context: c3-0
refs: ref-provider-adapter, ref-tool-hydration
files: src/client/app/KannaTranscript.store.ts, src/client/app/KannaTranscript.test.tsx, src/client/app/KannaTranscript.tsx, src/client/app/subagent-run-placement.test.ts, src/client/app/subagent-run-placement.ts, src/client/app/transcriptSpacing.test.ts, src/client/app/transcriptSpacing.ts

## c3-114 — messages-renderer (component)
container: c3-1 | context: c3-0
refs: ref-strong-typing, ref-tool-hydration, rule-strong-typing
files: src/client/components/lexical/markdown/**, src/client/components/messages/**/*.ts, src/client/components/messages/**/*.tsx

## c3-115 — chat-ui-chrome (component)
container: c3-1 | context: c3-0
refs: ref-provider-adapter, ref-zustand-store, rule-zustand-store
files: src/client/components/chat-ui/**/*.ts, src/client/components/chat-ui/**/*.tsx, src/client/components/lexical/config.ts, src/client/components/lexical/nodes/**, src/client/components/lexical/plugins/**, src/client/components/lexical/serialize/**, src/client/components/open-external-menu.tsx

## c3-116 — settings-page (component)
container: c3-1 | context: c3-0
refs: ref-local-first-data, ref-zustand-store, rule-zustand-store
files: src/client/app/McpServersSection.test.tsx, src/client/app/McpServersSection.tsx, src/client/app/ModelsSection.test.tsx, src/client/app/ModelsSection.tsx, src/client/app/SettingsPage.tsx, src/client/app/SubagentsSection.test.tsx, src/client/app/SubagentsSection.tsx, src/client/app/TextSnippetsSection.test.tsx, src/client/app/TextSnippetsSection.tsx, src/client/app/appSettingsCrud.ts, src/client/app/llmProviderDraft.ts, src/client/app/settingsEditorForm.ts, src/client/components/settings/SettingsList.tsx

## c3-117 — local-projects-page (component)
container: c3-1 | context: c3-0
refs: ref-local-first-data, ref-ws-subscription
files: src/client/app/LocalProjectsPage.tsx, src/client/components/NewProjectModal.tsx

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
files: src/client/app/CronJobsPage.tsx, src/client/app/CronJobsSection.tsx, src/client/components/messages/CronArmedMessage.tsx, src/client/components/messages/CronCommandErrorMessage.tsx, src/client/components/messages/CronJobChangeMessage.tsx, src/client/components/messages/CronListMessage.tsx, src/client/components/messages/CronMessages.test.tsx, src/client/components/messages/CronRunMessage.tsx, src/client/components/messages/CronRunSkippedMessage.tsx, src/client/stores/cronJobsStore.ts

## c3-2 — Server (container)
context: c3-0

## c3-201 — cli-entry (component)
container: c3-2 | context: c3-0
refs: ref-local-first-data
files: src/server/cli-bootstrap.adapter.ts, src/server/cli-runtime.test.ts, src/server/cli-runtime.ts, src/server/cli-supervisor.adapter.ts, src/server/cli.ts

## c3-202 — http-ws-server (component)
container: c3-2 | context: c3-0
refs: ref-local-first-data, ref-ws-subscription
files: src/server/app-settings.ts, src/server/http-api-routes.ts, src/server/http-dispatcher.ts, src/server/http-static.ts, src/server/server.ts

## c3-203 — auth (component)
container: c3-2 | context: c3-0
refs: ref-local-first-data
files: src/client/app/PasswordScreen.store.ts, src/server/auth.test.ts, src/server/auth.ts

## c3-204 — paths-config (component)
container: c3-2 | context: c3-0
refs: ref-local-first-data
files: src/server/machine-name.adapter.ts, src/server/paths.ts, src/server/project-paths.test.ts, src/server/project-paths.ts

## c3-205 — events-schema (component)
container: c3-2 | context: c3-0
refs: ref-event-sourcing, ref-strong-typing, rule-strong-typing
files: src/server/events.ts, src/server/harness-types.ts

## c3-206 — event-store (component)
container: c3-2 | context: c3-0
refs: ref-colocated-bun-test, ref-event-sourcing, ref-local-first-data, rule-colocated-bun-test
files: src/server/chat-op-log.test.ts, src/server/chat-op-log.ts, src/server/chat-ops-parity.test.ts, src/server/event-store-messages.adapter.test.ts, src/server/event-store-messages.adapter.ts, src/server/event-store-write-ops.test.ts, src/server/event-store-write-ops.ts, src/server/event-store.test.ts, src/server/event-store.ts

## c3-207 — read-models (component)
container: c3-2 | context: c3-0
refs: ref-cqrs-read-models, ref-strong-typing, rule-strong-typing
files: src/server/read-models.test.ts, src/server/read-models.ts

## c3-208 — ws-router (component)
container: c3-2 | context: c3-0
refs: ref-colocated-bun-test, ref-cqrs-read-models, ref-ws-subscription, rule-colocated-bun-test
files: src/server/chat-ops-diff.test.ts, src/server/chat-ops-diff.ts, src/server/ws-router.test.ts, src/server/ws-router.ts

## c3-209 — process-utils (component)
container: c3-2 | context: c3-0
refs: ref-strong-typing, rule-strong-typing
files: src/server/process-utils.adapter.ts, src/server/process-utils.test.ts

## c3-210 — agent-coordinator (component)
container: c3-2 | context: c3-0
refs: ref-colocated-bun-test, ref-event-sourcing, ref-provider-adapter, ref-tool-hydration, rule-colocated-bun-test
reverse deps: adr-20260617-subagent-id-or-name-resolution, adr-20260617-subagent-trigger-mode
files: src/server/agent.test.ts, src/server/agent.ts, src/server/claude-context-commands.test.ts, src/server/claude-context-commands.ts, src/server/claude-send-command.test.ts, src/server/claude-send-command.ts, src/server/claude-session-lifecycle.test.ts, src/server/claude-session-lifecycle.ts, src/server/claude-session-runner.test.ts, src/server/claude-session-runner.ts, src/server/claude-session-state-queries.test.ts, src/server/claude-session-state-queries.ts, src/server/claude-session-state.ts, src/server/claude-turn-starter.ts, src/server/history-primer.test.ts, src/server/history-primer.ts, src/server/mention-parser.test.ts, src/server/mention-parser.ts, src/server/proactive-compact.test.ts, src/server/proactive-compact.ts, src/server/subagent-entry-cap.test.ts, src/server/subagent-orchestrator.test.ts, src/server/subagent-orchestrator.ts, src/server/subagent-provider-run.test.ts, src/server/subagent-provider-run.ts

## c3-211 — codex-app-server (component)
container: c3-2 | context: c3-0
refs: ref-provider-adapter, ref-strong-typing, rule-strong-typing
files: src/server/codex-app-server-protocol.ts, src/server/codex-app-server.test.ts, src/server/codex-app-server.ts

## c3-212 — provider-catalog (component)
container: c3-2 | context: c3-0
refs: ref-provider-adapter
files: src/server/provider-catalog.test.ts, src/server/provider-catalog.ts

## c3-213 — quick-response (component)
container: c3-2 | context: c3-0
refs: ref-provider-adapter
files: src/server/generate-commit-message.test.ts, src/server/generate-commit-message.ts, src/server/generate-title.ts, src/server/llm-provider.test.ts, src/server/llm-provider.ts, src/server/quick-response.test.ts, src/server/quick-response.ts, src/server/title-generation.live.test.ts

## c3-214 — discovery (component)
container: c3-2 | context: c3-0
refs: ref-local-first-data
files: src/server/claude-session-importer.adapter.ts, src/server/claude-session-importer.test.ts, src/server/claude-session-mapper.test.ts, src/server/claude-session-mapper.ts, src/server/claude-session-parser.adapter.ts, src/server/claude-session-parser.test.ts, src/server/claude-session-scanner.adapter.ts, src/server/claude-session-scanner.test.ts, src/server/claude-session-types.ts, src/server/discovery.adapter.ts, src/server/discovery.test.ts

## c3-215 — diff-store (component)
container: c3-2 | context: c3-0
refs: ref-tool-hydration
files: src/server/diff-store.test.ts, src/server/diff-store.ts

## c3-216 — terminal-manager (component)
container: c3-2 | context: c3-0
refs: ref-ws-subscription
files: src/server/terminal-manager.test.ts, src/server/terminal-manager.ts, src/server/terminal-pid-registry.test.ts

## c3-217 — uploads (component)
container: c3-2 | context: c3-0
refs: ref-local-first-data
files: src/server/uploads.test.ts, src/server/uploads.ts

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
files: src/server/external-open.test.ts, src/server/external-open.ts

## c3-222 — keybindings (component)
container: c3-2 | context: c3-0
refs: ref-local-first-data
files: src/server/keybindings.test.ts, src/server/keybindings.ts

## c3-223 — cloudflare-tunnel (component)
container: c3-2 | context: c3-0
refs: ref-cqrs-read-models, ref-strong-typing, ref-ws-subscription, rule-strong-typing
files: src/server/cloudflare-tunnel/**/*.ts

## c3-224 — oauth-token-pool (component)
container: c3-2 | context: c3-0
refs: ref-local-first-data, ref-strong-typing, rule-colocated-bun-test, rule-strong-typing
files: src/server/oauth-pool/**/*.ts

## c3-225 — claude-pty-driver (component)
container: c3-2 | context: c3-0
refs: ref-colocated-bun-test, ref-event-sourcing, ref-provider-adapter, rule-colocated-bun-test, rule-strong-typing
files: src/server/claude-pty/**

## c3-226 — kanna-mcp-host (component)
container: c3-2 | context: c3-0
refs: ref-local-first-data, ref-strong-typing, ref-tool-hydration, rule-colocated-bun-test, rule-strong-typing
files: src/server/mcp-oauth.adapter.ts, src/server/mcp-validator.ts

## c3-227 — auto-continue (component)
container: c3-2 | context: c3-0
refs: ref-cqrs-read-models, ref-event-sourcing, ref-strong-typing, rule-colocated-bun-test, rule-strong-typing
files: src/server/auto-continue/**/*.ts

## c3-228 — session-share (component)
container: c3-2 | context: c3-0
refs: ref-cqrs-read-models, ref-event-sourcing, ref-local-first-data, ref-side-effect-adapter, ref-strong-typing

## c3-229 — workflow-status (component)
container: c3-2 | context: c3-0
refs: ref-cqrs-read-models, ref-event-sourcing, ref-provider-adapter, ref-side-effect-adapter, ref-strong-typing, ref-tool-hydration, ref-ws-subscription, ref-zustand-store, rule-colocated-bun-test, rule-strong-typing, rule-zustand-store
files: src/client/app/WorkflowAgentTranscriptPanel.store.ts, src/client/app/WorkflowAgentTranscriptPanel.test.tsx, src/client/app/WorkflowAgentTranscriptPanel.tsx, src/client/app/WorkflowsPage.store.ts, src/client/app/WorkflowsPage.test.tsx, src/client/app/WorkflowsPage.tsx, src/client/app/WorkflowsSection.store.ts, src/client/app/WorkflowsSection.tsx, src/client/components/messages/WorkflowMessage.tsx, src/client/lib/workflowGrouping.test.ts, src/client/lib/workflowGrouping.ts, src/client/stores/workflowsStore.ts, src/server/agent-transcript-parse.test.ts, src/server/agent-transcript-parse.ts, src/server/watched-registry.test.ts, src/server/watched-registry.ts, src/server/workflow-agent-transcript-io.adapter.test.ts, src/server/workflow-agent-transcript-io.adapter.ts, src/server/workflow-registry.test.ts, src/server/workflow-registry.ts, src/server/workflow-watch-io.adapter.test.ts, src/server/workflow-watch-io.adapter.ts, src/shared/workflow-types.test.ts, src/shared/workflow-types.ts

## c3-230 — openrouter-models (component)
container: c3-2 | context: c3-0
refs: ref-cqrs-read-models, ref-side-effect-adapter, ref-strong-typing, rule-colocated-bun-test
reverse deps: adr-20260618-adr-20260618-openrouter-sdk-provider

## c3-231 — local-catalog (component)
container: c3-2 | context: c3-0
refs: ref-colocated-bun-test, ref-local-first-data, ref-side-effect-adapter

## c3-232 — boards (component)
container: c3-2 | context: c3-0
refs: ref-cqrs-read-models, ref-local-first-data, ref-side-effect-adapter, ref-strong-typing, rule-colocated-bun-test, rule-mcp-name-reserved
files: src/server/board-*.ts, src/server/kanna-mcp-boards.test.ts, src/server/kanna-mcp-boards.ts, src/server/ws-router-boards.test.ts, src/server/ws-router-boards.ts

## c3-233 — cron-scheduler (component)
container: c3-2 | context: c3-0
refs: ref-cqrs-read-models, ref-event-sourcing, rule-colocated-bun-test, rule-strong-typing
files: src/server/cron/**/*.ts

## c3-234 — observability (component)
container: c3-2 | context: c3-0
refs: ref-local-first-data, rule-colocated-bun-test
files: scripts/grafana-alerts.ts, scripts/perf-alert-issue.ts, src/ops/alerting/**/*.ts, src/server/observability.ts, src/server/otel-config.ts, src/server/otel.adapter.ts, src/server/test-helpers/metric-recorder.ts, src/server/ws-router-observability.ts

## c3-235 — secret-scanning (component)
container: c3-2 | context: c3-0
refs: ref-local-first-data
files: .githooks/pre-commit, .github/workflows/gitleaks.yml, .gitleaks.toml, src/server/gitleaks-hook.test.ts

## c3-236 — architecture-budget (component)
container: c3-2 | context: c3-0
refs: ref-side-effect-adapter, ref-strong-typing, rule-colocated-bun-test
files: src/ops/architecture/budget-scan.adapter.ts, src/ops/architecture/budget.ts

## c3-3 — Shared (container)
context: c3-0

## c3-301 — types (component)
container: c3-3 | context: c3-0
refs: ref-strong-typing, rule-strong-typing
files: src/shared/analytics.ts, src/shared/kanna-system-prompt.test.ts, src/shared/kanna-system-prompt.ts, src/shared/mask-oauth-key.test.ts, src/shared/mask-oauth-key.ts, src/shared/mention-pattern.ts, src/shared/permission-policy.test.ts, src/shared/permission-policy.ts, src/shared/projectFileUrl.test.ts, src/shared/projectFileUrl.ts, src/shared/types.test.ts, src/shared/types.ts

## c3-302 — protocol (component)
container: c3-3 | context: c3-0
refs: ref-strong-typing, ref-ws-subscription, rule-strong-typing
files: src/shared/chat-ops.test.ts, src/shared/chat-ops.ts, src/shared/protocol.ts

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
files: src/shared/share.ts

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

## ref-colocated-bun-test — Colocated Bun Test (ref)
reverse deps: c3-102, c3-104, c3-206, c3-208, c3-210, c3-225, c3-231, c3-303, c3-310
citers: c3-102, c3-104, c3-206, c3-208, c3-210, c3-225, c3-231, c3-303, c3-310

## ref-cqrs-read-models — CQRS Read Models (ref)
reverse deps: c3-110, c3-111, c3-112, c3-207, c3-208, c3-219, c3-223, c3-227, c3-228, c3-229, c3-230, c3-232, c3-233
citers: c3-110, c3-111, c3-112, c3-207, c3-208, c3-219, c3-223, c3-227, c3-228, c3-229, c3-230, c3-232, c3-233

## ref-event-sourcing — Event Sourcing (ref)
reverse deps: c3-205, c3-206, c3-210, c3-225, c3-227, c3-228, c3-229, c3-233
citers: c3-205, c3-206, c3-210, c3-225, c3-227, c3-228, c3-229, c3-233

## ref-local-first-data — Local-First Data (ref)
reverse deps: c3-116, c3-117, c3-201, c3-202, c3-203, c3-204, c3-206, c3-214, c3-217, c3-218, c3-221, c3-222, c3-224, c3-226, c3-228, c3-231, c3-232, c3-234, c3-235, c3-305
citers: c3-116, c3-117, c3-201, c3-202, c3-203, c3-204, c3-206, c3-214, c3-217, c3-218, c3-221, c3-222, c3-224, c3-226, c3-228, c3-231, c3-232, c3-234, c3-235, c3-305

## ref-provider-adapter — Provider Adapter (ref)
reverse deps: c3-113, c3-115, c3-210, c3-211, c3-212, c3-213, c3-225, c3-229
citers: c3-113, c3-115, c3-210, c3-211, c3-212, c3-213, c3-225, c3-229

## ref-side-effect-adapter — side-effect-adapter (ref)
reverse deps: c3-228, c3-229, c3-230, c3-231, c3-232, c3-236
citers: c3-228, c3-229, c3-230, c3-231, c3-232, c3-236

## ref-strong-typing — Strong Typing Policy (ref)
reverse deps: c3-101, c3-102, c3-103, c3-104, c3-114, c3-119, c3-205, c3-207, c3-209, c3-211, c3-219, c3-223, c3-224, c3-226, c3-227, c3-228, c3-229, c3-230, c3-232, c3-236, c3-301, c3-302, c3-303, c3-304, c3-306, c3-307, c3-310
citers: c3-101, c3-102, c3-103, c3-104, c3-114, c3-119, c3-205, c3-207, c3-209, c3-211, c3-219, c3-223, c3-224, c3-226, c3-227, c3-228, c3-229, c3-230, c3-232, c3-236, c3-301, c3-302, c3-303, c3-304, c3-306, c3-307, c3-310

## ref-tool-hydration — Tool Call Hydration (ref)
reverse deps: c3-113, c3-114, c3-210, c3-215, c3-226, c3-229, c3-303
citers: c3-113, c3-114, c3-210, c3-215, c3-226, c3-229, c3-303

## ref-ws-subscription — WebSocket Subscription (ref)
reverse deps: c3-101, c3-110, c3-112, c3-117, c3-118, c3-119, c3-202, c3-208, c3-216, c3-220, c3-223, c3-229, c3-302
citers: c3-101, c3-110, c3-112, c3-117, c3-118, c3-119, c3-202, c3-208, c3-216, c3-220, c3-223, c3-229, c3-302

## ref-zustand-store — Zustand Store Pattern (ref)
reverse deps: c3-102, c3-104, c3-111, c3-115, c3-116, c3-118, c3-119, c3-229
citers: c3-102, c3-104, c3-111, c3-115, c3-116, c3-118, c3-119, c3-229

## rule-colocated-bun-test — colocated-bun-test (rule)
reverse deps: c3-102, c3-119, c3-120, c3-206, c3-208, c3-210, c3-224, c3-225, c3-226, c3-227, c3-229, c3-230, c3-232, c3-233, c3-234, c3-236, c3-303, c3-310, c3-311
citers: c3-102, c3-119, c3-120, c3-206, c3-208, c3-210, c3-224, c3-225, c3-226, c3-227, c3-229, c3-230, c3-232, c3-233, c3-234, c3-236, c3-303, c3-310, c3-311

## rule-mcp-name-reserved — mcp-name-reserved (rule)
reverse deps: c3-232
citers: c3-232

## rule-strong-typing — strong-typing (rule)
reverse deps: c3-101, c3-102, c3-103, c3-114, c3-120, c3-205, c3-207, c3-209, c3-211, c3-219, c3-223, c3-224, c3-225, c3-226, c3-227, c3-229, c3-233, c3-301, c3-302, c3-303, c3-304, c3-306, c3-310, c3-311
citers: c3-101, c3-102, c3-103, c3-114, c3-120, c3-205, c3-207, c3-209, c3-211, c3-219, c3-223, c3-224, c3-225, c3-226, c3-227, c3-229, c3-233, c3-301, c3-302, c3-303, c3-304, c3-306, c3-310, c3-311

## rule-zustand-store — zustand-store (rule)
reverse deps: c3-102, c3-111, c3-115, c3-116, c3-118, c3-119, c3-120, c3-229
citers: c3-102, c3-111, c3-115, c3-116, c3-118, c3-119, c3-120, c3-229

## File Map
src/client/app/KannaSocketProvider.tsx → c3-101
src/client/app/SocketBridge.tsx → c3-101
src/client/app/pushClient.test.ts → c3-101
src/client/app/pushClient.ts → c3-101
src/client/app/socket-protocol.ts → c3-101
src/client/app/socket.test.ts → c3-101
src/client/app/socket.ts → c3-101
src/client/stores/**/*.ts → c3-102
src/client/components/editor-icons.tsx → c3-103
src/client/components/ui/**/*.tsx → c3-103
src/client/app/App.test.tsx → c3-110
src/client/app/App.tsx → c3-110
src/client/app/AppBootstrap.tsx → c3-110
src/client/app/AppGlobalProvider.tsx → c3-110
src/client/app/PageHeader.tsx → c3-110
src/client/app/appRuntime.test.ts → c3-110
src/client/app/appRuntime.ts → c3-110
src/client/app/chatFocusPolicy.test.ts → c3-110
src/client/app/chatFocusPolicy.ts → c3-110
src/client/app/chatNotifications.ts → c3-110
src/client/app/derived.ts → c3-110
src/client/app/sidebarSwipeGesture.ts → c3-110
src/client/app/useAppGlobalState.test.ts → c3-110
src/client/app/useAppGlobalState.ts → c3-110
src/client/app/useKannaState.test.ts → c3-110
src/client/app/useKannaState.ts → c3-110
src/client/app/usePushFocus.test.ts → c3-110
src/client/app/usePushFocus.ts → c3-110
src/client/components/LocalDev.tsx → c3-110
src/client/hooks/**/*.ts → c3-110
src/client/hooks/**/*.tsx → c3-110
src/client/lib/**/*.ts → c3-110
src/main.tsx → c3-110
src/client/app/KannaSidebar.tsx → c3-111
src/client/app/sidebarNumberJump.test.ts → c3-111
src/client/app/sidebarNumberJump.ts → c3-111
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
src/client/app/KannaTranscript.store.ts → c3-113
src/client/app/KannaTranscript.test.tsx → c3-113
src/client/app/KannaTranscript.tsx → c3-113
src/client/app/subagent-run-placement.test.ts → c3-113
src/client/app/subagent-run-placement.ts → c3-113
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
src/client/app/McpServersSection.test.tsx → c3-116
src/client/app/McpServersSection.tsx → c3-116
src/client/app/ModelsSection.test.tsx → c3-116
src/client/app/ModelsSection.tsx → c3-116
src/client/app/SettingsPage.tsx → c3-116
src/client/app/SubagentsSection.test.tsx → c3-116
src/client/app/SubagentsSection.tsx → c3-116
src/client/app/TextSnippetsSection.test.tsx → c3-116
src/client/app/TextSnippetsSection.tsx → c3-116
src/client/app/appSettingsCrud.ts → c3-116
src/client/app/llmProviderDraft.ts → c3-116
src/client/app/settingsEditorForm.ts → c3-116
src/client/components/settings/SettingsList.tsx → c3-116
src/client/app/LocalProjectsPage.tsx → c3-117
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
src/server/cli-bootstrap.adapter.ts → c3-201
src/server/cli-runtime.test.ts → c3-201
src/server/cli-runtime.ts → c3-201
src/server/cli-supervisor.adapter.ts → c3-201
src/server/cli.ts → c3-201
src/server/app-settings.ts → c3-202
src/server/http-api-routes.ts → c3-202
src/server/http-dispatcher.ts → c3-202
src/server/http-static.ts → c3-202
src/server/server.ts → c3-202
src/client/app/PasswordScreen.store.ts → c3-203
src/server/auth.test.ts → c3-203
src/server/auth.ts → c3-203
src/server/machine-name.adapter.ts → c3-204
src/server/paths.ts → c3-204
src/server/project-paths.test.ts → c3-204
src/server/project-paths.ts → c3-204
src/server/events.ts → c3-205
src/server/harness-types.ts → c3-205
src/server/chat-op-log.test.ts → c3-206
src/server/chat-op-log.ts → c3-206
src/server/chat-ops-parity.test.ts → c3-206
src/server/event-store-messages.adapter.test.ts → c3-206
src/server/event-store-messages.adapter.ts → c3-206
src/server/event-store-write-ops.test.ts → c3-206
src/server/event-store-write-ops.ts → c3-206
src/server/event-store.test.ts → c3-206
src/server/event-store.ts → c3-206
src/server/read-models.test.ts → c3-207
src/server/read-models.ts → c3-207
src/server/chat-ops-diff.test.ts → c3-208
src/server/chat-ops-diff.ts → c3-208
src/server/ws-router.test.ts → c3-208
src/server/ws-router.ts → c3-208
src/server/process-utils.adapter.ts → c3-209
src/server/process-utils.test.ts → c3-209
src/server/agent.test.ts → c3-210
src/server/agent.ts → c3-210
src/server/claude-context-commands.test.ts → c3-210
src/server/claude-context-commands.ts → c3-210
src/server/claude-send-command.test.ts → c3-210
src/server/claude-send-command.ts → c3-210
src/server/claude-session-lifecycle.test.ts → c3-210
src/server/claude-session-lifecycle.ts → c3-210
src/server/claude-session-runner.test.ts → c3-210
src/server/claude-session-runner.ts → c3-210
src/server/claude-session-state-queries.test.ts → c3-210
src/server/claude-session-state-queries.ts → c3-210
src/server/claude-session-state.ts → c3-210
src/server/claude-turn-starter.ts → c3-210
src/server/history-primer.test.ts → c3-210
src/server/history-primer.ts → c3-210
src/server/mention-parser.test.ts → c3-210
src/server/mention-parser.ts → c3-210
src/server/proactive-compact.test.ts → c3-210
src/server/proactive-compact.ts → c3-210
src/server/subagent-entry-cap.test.ts → c3-210
src/server/subagent-orchestrator.test.ts → c3-210
src/server/subagent-orchestrator.ts → c3-210
src/server/subagent-provider-run.test.ts → c3-210
src/server/subagent-provider-run.ts → c3-210
src/server/codex-app-server-protocol.ts → c3-211
src/server/codex-app-server.test.ts → c3-211
src/server/codex-app-server.ts → c3-211
src/server/provider-catalog.test.ts → c3-212
src/server/provider-catalog.ts → c3-212
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
src/server/discovery.adapter.ts → c3-214
src/server/discovery.test.ts → c3-214
src/server/diff-store.test.ts → c3-215
src/server/diff-store.ts → c3-215
src/server/terminal-manager.test.ts → c3-216
src/server/terminal-manager.ts → c3-216
src/server/terminal-pid-registry.test.ts → c3-216
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
src/server/keybindings.test.ts → c3-222
src/server/keybindings.ts → c3-222
src/server/cloudflare-tunnel/**/*.ts → c3-223
src/server/oauth-pool/**/*.ts → c3-224
src/server/claude-pty/** → c3-225
src/server/mcp-oauth.adapter.ts → c3-226
src/server/mcp-validator.ts → c3-226
src/server/auto-continue/**/*.ts → c3-227
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
src/server/board-*.ts → c3-232
src/server/kanna-mcp-boards.test.ts → c3-232
src/server/kanna-mcp-boards.ts → c3-232
src/server/ws-router-boards.test.ts → c3-232
src/server/ws-router-boards.ts → c3-232
src/server/cron/**/*.ts → c3-233
scripts/grafana-alerts.ts → c3-234
scripts/perf-alert-issue.ts → c3-234
src/ops/alerting/**/*.ts → c3-234
src/server/observability.ts → c3-234
src/server/otel-config.ts → c3-234
src/server/otel.adapter.ts → c3-234
src/server/test-helpers/metric-recorder.ts → c3-234
src/server/ws-router-observability.ts → c3-234
.githooks/pre-commit → c3-235
.github/workflows/gitleaks.yml → c3-235
.gitleaks.toml → c3-235
src/server/gitleaks-hook.test.ts → c3-235
src/ops/architecture/budget-scan.adapter.ts → c3-236
src/ops/architecture/budget.ts → c3-236
src/shared/analytics.ts → c3-301
src/shared/kanna-system-prompt.test.ts → c3-301
src/shared/kanna-system-prompt.ts → c3-301
src/shared/mask-oauth-key.test.ts → c3-301
src/shared/mask-oauth-key.ts → c3-301
src/shared/mention-pattern.ts → c3-301
src/shared/permission-policy.test.ts → c3-301
src/shared/permission-policy.ts → c3-301
src/shared/projectFileUrl.test.ts → c3-301
src/shared/projectFileUrl.ts → c3-301
src/shared/types.test.ts → c3-301
src/shared/types.ts → c3-301
src/shared/chat-ops.test.ts → c3-302
src/shared/chat-ops.ts → c3-302
src/shared/protocol.ts → c3-302
src/shared/tools.test.ts → c3-303
src/shared/tools.ts → c3-303
src/shared/dev-ports.test.ts → c3-304
src/shared/dev-ports.ts → c3-304
src/shared/ports.ts → c3-304
src/shared/branding.test.ts → c3-305
src/shared/branding.ts → c3-305
src/shared/share.ts → c3-306
src/shared/token-pricing.ts → c3-307
src/shared/boards/**/*.ts → c3-310
src/shared/cron/**/*.ts → c3-311
