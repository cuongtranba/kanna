repo: cuongtranba/kanna
branch: main

## Last sync

date: 2026-09-05T07:46:31Z

### Updated in this project

- Recreated the Kanna chat shell (sidebar, navbar, transcript, empty state, composer) from source
- Lifted the full oklch token palette, type scale and shell geometry from `src/index.css`
- Copied the exact lucide icon set the UI uses into `icons.js`
- Built a scroll-driven motion showcase + handoff spec on top of the recreation
- Added a mobile/PWA pass grounded in sidebarSwipeGesture.ts and viewport.ts
- Added Boards and Settings motion chapters from KannaBoard.tsx and SettingsPage.tsx
- Hardened the reveal layer: no content is hidden by an animation that may not run

## Screen map

| Project screen | Repo files |
| --- | --- |
| Kanna Shell.dc.html — app frame | src/client/app/App.tsx, src/client/lib/shellChrome.ts, src/index.css, index.html |
| Kanna Shell.dc.html — sidebar | src/client/app/KannaSidebar.tsx, src/client/app/SidebarUtilityNav.tsx, src/client/components/chat-ui/sidebar/ChatRow.tsx, src/client/components/chat-ui/sidebar/LocalProjectsSection.tsx, src/client/stores/kannaSidebarStore.ts |
| Kanna Shell.dc.html — chat navbar | src/client/components/chat-ui/ChatNavbar.tsx, src/client/components/ui/card.tsx, src/client/lib/statusLabel.ts, src/client/lib/stateMark.ts, src/client/components/ui/state-mark.tsx, src/client/components/ui/reduction.tsx |
| Kanna Shell.dc.html — transcript | src/client/app/ChatPage/ChatTranscriptViewport.tsx, src/client/app/ChatPage/ChatTabContent.tsx, src/client/app/ChatPage/utils.ts, src/client/components/messages/UserMessage.tsx, src/client/components/messages/TextMessage.tsx, src/client/components/messages/ToolCallMessage.tsx, src/client/components/messages/shared.tsx, src/client/components/messages/ProcessingMessage.tsx, src/client/components/ui/animated-shiny-text.tsx |
| Kanna Shell.dc.html — composer | src/client/components/chat-ui/ChatInput.tsx, src/client/components/chat-ui/ChatPreferenceControls.tsx, src/client/components/chat-ui/SessionTokenPill.tsx, src/client/components/chat-ui/ContextWindowMeter.tsx, src/client/components/ui/button.tsx |
| Kanna Motion.dc.html — ch. 01–04, 07 | all of the above (motion layer added on top) |
| Kanna Motion.dc.html — ch. 05 Boards | src/client/components/boards/KannaBoard.tsx, src/client/lib/boards/columnStyle.ts, src/client/lib/boards/cardWorkSignal.ts |
| Kanna Motion.dc.html — ch. 06 Settings | src/client/app/SettingsPage.tsx (sidebarItems, SettingsRow), src/client/components/settings/SettingsList.tsx |
| Kanna Mobile.dc.html | src/client/app/sidebarSwipeGesture.ts, src/client/lib/viewport.ts, src/client/hooks/useIsStandalone.ts, src/client/hooks/useIsMobile.ts, src/client/app/KannaSidebar.tsx (mobile overlay), src/client/components/chat-ui/ChatNavbar.tsx (mobile status row), src/client/components/chat-ui/ChatInput.tsx (Chat settings dialog) |

## Notes

Icons in `icons.js` are the lucide glyphs the app imports, copied from lucide-icons/lucide@main.
