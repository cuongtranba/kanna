# useState violation report (2026-07-12)

Total: 337 violations across 60 files.

| File | Violations |
| --- | --- |
| src/client/app/App.tsx | 5 |
| src/client/app/ChatPage/ChatTranscriptViewport.tsx | 3 |
| src/client/app/ChatPage/index.tsx | 9 |
| src/client/app/ChatPage/useChatPageSidebarActions.ts | 3 |
| src/client/app/KannaSidebar.tsx | 16 |
| src/client/app/KannaTranscript.tsx | 2 |
| src/client/app/McpServersSection.tsx | 19 |
| src/client/app/ModelsSection.tsx | 8 |
| src/client/app/SettingsPage.tsx | 43 |
| src/client/app/share-view/SharePage.tsx | 2 |
| src/client/app/SubagentsSection.tsx | 8 |
| src/client/app/TextSnippetsSection.tsx | 6 |
| src/client/app/useKannaState.ts | 31 |
| src/client/app/useTerminalToggleAnimation.ts | 2 |
| src/client/app/WorkflowAgentTranscriptPanel.tsx | 5 |
| src/client/app/WorkflowsPage.tsx | 4 |
| src/client/app/WorkflowsSection.tsx | 3 |
| src/client/components/chat-ui/AutoContinueCard.tsx | 3 |
| src/client/components/chat-ui/ChatInput.tsx | 6 |
| src/client/components/chat-ui/ChatNavbar.tsx | 2 |
| src/client/components/chat-ui/ChatPolicyDialog.tsx | 6 |
| src/client/components/chat-ui/ChatPreferenceControls.tsx | 4 |
| src/client/components/chat-ui/OAuthTokenPoolCard.tsx | 6 |
| src/client/components/chat-ui/PtyInstancesIndicator.tsx | 2 |
| src/client/components/chat-ui/RightSidebar.tsx | 32 |
| src/client/components/chat-ui/sidebar/Menus.tsx | 2 |
| src/client/components/chat-ui/sidebar/StackChatCreateRow.tsx | 5 |
| src/client/components/chat-ui/sidebar/StackCreatePanel.tsx | 3 |
| src/client/components/chat-ui/TerminalPane.tsx | 3 |
| src/client/components/chat-ui/TerminalWorkspace.tsx | 4 |
| src/client/components/chat-ui/TranscriptActionCard.tsx | 3 |
| src/client/components/lexical/markdown/MessageCodeBlock.tsx | 2 |
| src/client/components/lexical/plugins/MentionTypeaheadPlugin.tsx | 2 |
| src/client/components/lexical/plugins/SlashCommandTypeaheadPlugin.tsx | 2 |
| src/client/components/LocalDev.tsx | 2 |
| src/client/components/messages/AccountInfoMessage.tsx | 2 |
| src/client/components/messages/AskUserQuestionInteractive.tsx | 4 |
| src/client/components/messages/AskUserQuestionMessage.tsx | 3 |
| src/client/components/messages/ExitPlanModeMessage.tsx | 5 |
| src/client/components/messages/file-preview/bodies/CodeBody.tsx | 2 |
| src/client/components/messages/file-preview/bodies/TableBody.tsx | 3 |
| src/client/components/messages/file-preview/bodies/textLoader.ts | 3 |
| src/client/components/messages/file-preview/FilePreviewSheet.tsx | 2 |
| src/client/components/messages/file-preview/useViewportFetch.ts | 5 |
| src/client/components/messages/HighlightedCode.tsx | 2 |
| src/client/components/messages/ImageGenerationMessage.tsx | 2 |
| src/client/components/messages/LocalFileLinkCard.tsx | 3 |
| src/client/components/messages/MermaidDiagram.tsx | 5 |
| src/client/components/messages/MermaidZoomModal.tsx | 4 |
| src/client/components/messages/OfferDownloadMessage.tsx | 3 |
| src/client/components/messages/PreviewFileMessage.tsx | 3 |
| src/client/components/messages/shared.tsx | 4 |
| src/client/components/messages/SubagentTaskMessage.tsx | 6 |
| src/client/components/messages/SystemMessage.tsx | 4 |
| src/client/components/messages/ThinkingBlock.tsx | 2 |
| src/client/components/messages/UserMessage.tsx | 2 |
| src/client/components/NewProjectModal.tsx | 4 |
| src/client/components/open-external-menu.tsx | 2 |
| src/client/components/share/SharePopover.tsx | 2 |
| src/client/hooks/useMentionSuggestions.ts | 2 |

## Violations by module (call sites, allowlist excluded)

| Module | Call sites | Files | Effort |
| --- | --- | --- | --- |
| Settings (SettingsPage + sections + OAuthTokenPoolCard) | 84 | 6 | L |
| Chat UI shell (RightSidebar, navbar, cards, dialogs, NewProjectModal) | 48 | 8 | L |
| App state hub (useKannaState) | 30 | 1 | L |
| Sidebar (KannaSidebar + stack rows/panels + Menus) | 22 | 4 | M |
| Messages cards batch B (system/plan/question/user/account/image/preview/download/link) | 21 | 10 | M |
| Messages cards batch A (subagent/mermaid/thinking/code/shared) | 17 | 6 | M |
| ChatPage (index, viewport, sidebar actions, terminal toggle) | 13 | 4 | M |
| File preview (sheet, viewport fetch, bodies) | 10 | 5 | M |
| Workflows (page, section, transcript panel) | 9 | 3 | S |
| Composer (ChatInput, mention suggestions, lexical plugins) | 9 | 5 | M |
| App shell (App, KannaTranscript, SharePage, LocalDev, open-external-menu) | 8 | 5 | S |
| Terminal (workspace, pane) | 5 | 2 | S |
| Share (SharePopover) | 1 | 1 | S |
| **Total** | **277** | **60** | ~16 loop iterations |

Estimated effort: one loop iteration (background subagent run) per PROGRESS.md
task; L modules may take multiple iterations. Expected wall-clock: 2–4 days of
unattended loop execution including test runs.
