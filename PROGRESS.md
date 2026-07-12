# useState → Zustand Migration Progress

## Goal
`bun run migrate:verify` exits 0 in `.worktrees/zustand-migration`
(zero useState violations + check + full test suite green).

## Worker rules (every subagent MUST follow)
- Work ONLY in `/home/cuong/repo/kanna/.worktrees/zustand-migration` (branch `zustand-migration`). Commit there.
- Before editing a file: `c3x lookup <file>` for component context.
- Singleton feature state → store in `src/client/stores/<feature>Store.ts` (follow `rightSidebarStore.ts` conventions: typed interface, actions in store, `persist` only when the old state was persisted).
- Per-instance component state (component rendered N times) → colocated `<Component>.store.ts` using `createScopedStore` from `src/client/lib/createScopedStore.tsx`; wrap the component subtree in its `Provider`.
- Derived data via selectors; collections use a module-level `EMPTY` constant or `useShallow` — NEVER inline `?? []` / `?? {}` in a selector (React error #185).
- No behavior change. No new features. No `any`. No `eslint-disable`.
- Acceptance per task:
  1. `bun scripts/usestate-ratchet.ts` passes AND total strictly decreased; run `bun scripts/usestate-ratchet.ts --update` after verifying.
  2. Zero ast-grep hits remain in the task's files (check the per-file table).
  3. `bun test --conditions production <touched test files and colocated tests>` passes.
  4. `bunx eslint <touched files> --max-warnings=0` passes.
  5. `bun run typecheck` passes.
  6. Commit with message `refactor(zustand): migrate <module> off useState`, update this file (mark task done, set Next chunk), then terminate.

## Tasks (priority order; call-site counts at baseline)
- [ ] T1 App state hub: `src/client/app/useKannaState.ts` (30)
- [ ] T2 ChatPage: `src/client/app/ChatPage/index.tsx` (8), `ChatTranscriptViewport.tsx` (2), `useChatPageSidebarActions.ts` (2), `src/client/app/useTerminalToggleAnimation.ts` (1)
- [ ] T3 Composer: `src/client/components/chat-ui/ChatInput.tsx` (5), `src/client/hooks/useMentionSuggestions.ts` (1), `src/client/components/lexical/plugins/SlashCommandTypeaheadPlugin.tsx` (1), `MentionTypeaheadPlugin.tsx` (1), `src/client/components/lexical/markdown/MessageCodeBlock.tsx` (1)
- [ ] T4 Sidebar: `src/client/app/KannaSidebar.tsx` (15), `src/client/components/chat-ui/sidebar/Menus.tsx` (1), `StackChatCreateRow.tsx` (4), `StackCreatePanel.tsx` (2)
- [ ] T5 RightSidebar: `src/client/components/chat-ui/RightSidebar.tsx` (31)
- [ ] T6 Chat-UI misc: `ChatNavbar.tsx` (1), `AutoContinueCard.tsx` (2), `TranscriptActionCard.tsx` (2), `ChatPreferenceControls.tsx` (3), `ChatPolicyDialog.tsx` (5), `PtyInstancesIndicator.tsx` (1), `src/client/components/NewProjectModal.tsx` (3)
- [ ] T7 App shell: `src/client/app/App.tsx` (4), `KannaTranscript.tsx` (1), `share-view/SharePage.tsx` (1), `src/client/components/LocalDev.tsx` (1), `open-external-menu.tsx` (1)
- [ ] T8 Terminal: `src/client/components/chat-ui/TerminalWorkspace.tsx` (3), `TerminalPane.tsx` (2)
- [ ] T9 Messages A (multi-instance — use createScopedStore): `SubagentTaskMessage.tsx` (5), `MermaidDiagram.tsx` (4), `MermaidZoomModal.tsx` (3), `ThinkingBlock.tsx` (1), `HighlightedCode.tsx` (1), `shared.tsx` (3) — all under `src/client/components/messages/`
- [ ] T10 Messages B (multi-instance): `SystemMessage.tsx` (3), `ExitPlanModeMessage.tsx` (4), `AskUserQuestionInteractive.tsx` (3), `AskUserQuestionMessage.tsx` (2), `UserMessage.tsx` (1), `AccountInfoMessage.tsx` (1), `ImageGenerationMessage.tsx` (1), `PreviewFileMessage.tsx` (2), `OfferDownloadMessage.tsx` (2), `LocalFileLinkCard.tsx` (2)
- [ ] T11 File preview: `src/client/components/messages/file-preview/FilePreviewSheet.tsx` (1), `useViewportFetch.ts` (4), `bodies/textLoader.ts` (2), `bodies/TableBody.tsx` (2), `bodies/CodeBody.tsx` (1)
- [ ] T12 SettingsPage: `src/client/app/SettingsPage.tsx` (42)
- [ ] T13 McpServersSection: `src/client/app/McpServersSection.tsx` (18)
- [ ] T14 Settings sections: `ModelsSection.tsx` (7), `SubagentsSection.tsx` (7), `TextSnippetsSection.tsx` (5), `src/client/components/chat-ui/OAuthTokenPoolCard.tsx` (5)
- [ ] T15 Workflows: `src/client/app/WorkflowsPage.tsx` (3), `WorkflowsSection.tsx` (2), `WorkflowAgentTranscriptPanel.tsx` (4)
- [ ] T16 Final sweep: `src/client/components/share/SharePopover.tsx` (1) + any file still listed by `bun scripts/usestate-ratchet.ts --zero`; then run `bun run migrate:verify` and fix everything until it exits 0

## Progress (latest first)
- 2026-07-12 Tooling landed (rule, ratchet, baseline report, createScopedStore). Loop not yet started.

## Failed approaches
- (none yet)

## Next chunk
T1 App state hub: migrate `src/client/app/useKannaState.ts` (30 call sites) off useState into zustand store(s) in `src/client/stores/`. Follow ALL Worker rules above, satisfy all 6 acceptance criteria, update this file, then terminate.
