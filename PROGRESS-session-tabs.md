# Session tabs — one tab per open chat

## Goal
Session tabs: one tab per open chat, N open = N tabs, keyboard switching, two chat tabs render two different live transcripts side by side

## Verify command
```
bash scripts/verify-session-tabs.sh
```

## Progress (latest first)

- 2026-08-05 0.3 DONE — useAppGlobalState.ts created (~550 lines): 8 global
  socket topics, UI-restart machinery, focus/visibility listeners, all
  settings/MCP/LLM + sidebar/project/stack/import handlers extracted from
  useKannaState; re-exports keep all consumers unchanged; useKannaState spread-in
  pattern; ast-grep + lint + typecheck + 4879 pass / 0 fail. Commit 0ca141ab.

- 2026-08-05 0.2 DONE — chatStateStore created (ChatSlice × 7 fields,
  optimisticProcessing keyed by scopeId, releaseChat, selectChatSlice,
  EMPTY_CHAT_SLICE); 8 fields + 9 actions removed from kannaStateStore; ~30
  call sites in useKannaState threaded with activeChatId; 10 new tests (3
  mandatory isolation/releaseChat/stable-ref + 7 migrated applyChatOpsEvent
  tests); ast-grep + lint + typecheck + 4879 pass / 0 fail.

- 2026-08-05 0.1 DONE — WebSocket hoisted to KannaSocketProvider; 2 consumers
  open exactly 1 connection (new test); cast-free fakePorts added; suite
  4871 pass / 0 fail. Commit 1a18a110.

## Failed approaches

- Typing test fakes with `as unknown as DomPort` — the cast hid a missing
  `addServiceWorkerMessageListener` and the test died at runtime inside
  `KannaSocket.start()`. Declaring the fake as `DomPort` made the compiler name
  12 more missing members. Never cast a fake.
- Plain `cmd+1..9` for tab jumping — browsers own those keys; a page cannot
  intercept them.

## Next chunk

**0.4 — AppGlobalProvider: mount useAppGlobalState exactly once at KannaLayout.**

Create `src/client/app/AppGlobalProvider.tsx` that mounts `useAppGlobalState()`
exactly once at `KannaLayout` and provides the result via React context.
`useKannaState` reads it from context instead of calling the hook directly.

After this, duplicate global subscriptions are impossible BY CONSTRUCTION.
Do NOT add dedupe/refcounting inside `socket.ts`.

Test: two hook instances + recording fake socket → each global topic subscribed ONCE.

Verify with `bun run verify:client-arch`. Baseline 4879 pass / 0 fail.

## Context for every worker (read this first)

You are one iteration of a long refactor. Your context is fresh; this file is
the only memory. Work in `/home/cuong/repo/kanna/.worktrees/session-tabs`
(branch `feat/session-tabs`).

**Feature.** Clicking a session in the sidebar opens a TAB named after that
session. N open sessions = N tabs. Keyboard switches tabs. Two chat tabs
dragged into two split panes render two DIFFERENT live transcripts at once.

**Why it is not a small change.** `src/client/app/useKannaState.ts` (2,615
lines) is mounted exactly ONCE (`App.tsx`, `KannaLayout`) with the route
chatId, and broadcasts ~100 fields through `<Outlet context>`. All chat state
sits in the ONE singleton `src/client/stores/kannaStateStore.ts`. A second
instance would clobber the first. The pane tree already supports everything
else.

**Non-negotiable rules (from CLAUDE.md — violating these fails CI):**
- No `any` / `as unknown as` casts. Type fakes as the port interface so the
  compiler reports missing members.
- Zustand selectors must return STABLE refs. Never inline `?? []` / `?? {}` —
  use a module-level `EMPTY_*` const. This is React error #185 and there is an
  ast-grep rule for it.
- Never pass an inline arrow as a direct argument to a custom `use*` hook.
- `bun run lint` runs with `--max-warnings=0`, and `exhaustive-deps` is a
  WARNING — so extracting an effect means fixing its deps in the SAME chunk or
  CI goes red.
- Tests colocated next to source. Run with `--conditions production`.
- Never edit `.c3/` files by hand; use the `c3x` CLI.

**After each chunk:** `bun run verify:client-arch`
(ast-grep + lint + typecheck + full test). Baseline is 4871 pass / 0 fail —
never land a chunk that lowers it.

## Plan (phases in order — do NOT skip ahead)

Pure refactor, no behaviour change: 0.2–0.4, 0.6, 0.8, 0.9, 1.6.
Behaviour change: 1.1–1.5, 2, 3.

- **0.1 DONE** — WebSocket hoisted into `KannaSocketProvider` (mounts once,
  inside auth, above router). `ports.socket` overrides for tests. Reusable
  cast-free fakes at `src/client/lib/testing/fakePorts.ts`.

- **0.2** — New `src/client/stores/chatStateStore.ts`: `chats: Record<chatId,
  ChatSlice>` where ChatSlice = `{chatSnapshot, olderHistoryEntries,
  isHistoryLoading, historyCursor, hasOlderHistory, chatReady,
  chatResyncNonce}`. Every action takes chatId FIRST
  (`setChatSnapshot(chatId, value)`, `applyChatOpsEvent(chatId, event)`), plus
  `releaseChat(chatId)`. Move `optimisticProcessing` to keyed by `scopeId`.
  **Leave `optimisticUserPrompts` alone** — entries already carry `scopeId` and
  `reconcileOptimisticUserPrompts` already filters by it. Do NOT rename
  `kannaStateStore.ts` (~90 references); it stays as the app-global store.
  Thread `activeChatId` at the ~30 call sites in `useKannaState.ts`.
  Export a module-level `EMPTY_CHAT_SLICE` and a `selectChatSlice(state,
  chatId)` helper so a missing chat yields a STABLE ref.
  Behaviour-neutral: only one key is ever live today.
  **Write `src/client/stores/chatStateStore.test.ts`** — seed two chats, apply
  a chat-ops event to one, assert the other's slice is reference-identical.

- **0.3** — Extract app-global concerns out of `useKannaState` into new
  `src/client/app/useAppGlobalState.ts`: the 8 global socket topics (sidebar,
  local-projects, update, keybindings, app-settings, push-config,
  pty-instances, followed-sessions), the UI-restart machinery + the
  `"kanna:ui-update-restart"` key, the focus/visibilitychange listeners, and
  the settings/MCP/LLM + sidebar/project/stack/import handlers.
  `useKannaState` calls it internally and spreads the result, so `KannaState`
  stays byte-identical and NO consumer changes.

- **0.4** — New `src/client/app/AppGlobalProvider.tsx` mounts
  `useAppGlobalState()` exactly once at `KannaLayout`; `useKannaState` reads it
  from context. After this, duplicate global subscriptions are impossible BY
  CONSTRUCTION. Do NOT add dedupe/refcounting inside `socket.ts` — a dedupe
  layer would have to replay the last snapshot to late subscribers and redo
  resubscribe-on-reconnect; that is real protocol surface for a problem that
  disappears when the mount count is 1.
  Test: two hook instances + recording fake socket → each global topic
  subscribed ONCE.

- **0.5** — New `src/client/app/chatNavigator.ts` port
  (`openChat` / `closeChat` / `goHome`) replacing all 10 internal `navigate()`
  calls in `useKannaState.ts` (lines ~1518, 1806, 1868, 2067, 2165, 2177, 2189,
  2203, 2296, 2408). Router implementation = today's behaviour verbatim,
  provided by `AppGlobalProvider`. Categories: "made a chat, show it" →
  openChat (1806, 1868, 2067, 2189, 2296); "what I showed is gone" → closeChat
  (1518, 2165, 2177, 2203); "nowhere to compose" → goHome (2408).

- **0.6** — Move `project-git` + `project-commands` subscriptions to app-global,
  subscribing once per DISTINCT projectId (the one real dedupe case: two tabs,
  same project). `projectDiffSnapshots` is already keyed by projectId.

- **0.7** — Pure predicate `isPrimaryChatInstance` + its own test; gate the
  route-affecting effects (the not-in-sidebar bounce ~1505-1519,
  `setSelectedProjectId` ~1521, `chat.markRead` ~1529) so a BACKGROUND tab can
  never yank the app or steal push focus.

- **0.8** — New per-chat-tab scoped store via the existing
  `src/client/lib/createScopedStore.tsx`. Move in: `composerStore`
  (attachments, currentText, mentionQuery, slashQuery, uploadError,
  selectedAttachmentId), `chatNavbarStore.sharePopoverOpen`, and — important —
  `toolGroupExpanded` / `inputHeight` / `showScrollToBottom` OUT of
  `paneScopedStore`, because retention mounts several tabs inside ONE pane
  provider, so those are per-chat-TAB not per-pane. Leave `layoutWidth`,
  `tabRecency`, `diffRenderMode`, `localLinkMenuTarget` on the pane. Leave
  `chatInputStore.drafts` alone (already chatId-keyed).

- **0.9** — Split `src/client/app/ChatPage/index.tsx` (1,029 lines) into
  `ChatPageShell` (panes, registry, terminal/changes wiring; reads the Outlet)
  and new `src/client/app/ChatPage/ChatTabRoot.tsx` which takes `{chatId}`,
  mounts `useKannaState(chatId)` + the scoped provider, and renders the chat
  card. Registry still passes the ROUTE chatId in this chunk. Keep the ~40
  `state.x` reads verbatim — only their source moves.

- **1.1** — `src/client/lib/paneTree/types.ts`: `{kind:"chat"}` →
  `{kind:"chat"; chatId: string}`. `tabTarget.ts`: `buildTabId` →
  `` `chat_${part(chatId)}` `` (reuse the existing length-prefix `part()`);
  drop `"chat"` from `SINGLETON_KINDS`; `normalizeTabTarget` requires a
  non-empty chatId else returns null; `tabTargetsEqual` compares chatId.
  Update the now-false doc comments in `tabTarget.ts:4-11` and
  `paneRetention.ts:20-23`. Fix `tabTarget.test.ts` (it currently asserts
  `isSingletonTabKind("chat") === true`).

- **1.2** — `tabPresentation.ts`: add `chatTitles?: Record<string,string>` to
  `TabPresentationContext` (same shape as the existing `terminalTitles`); chat
  label = title, `closable: true`. Titles come from `sidebarData`
  (`SidebarChatRow{chatId,title,status,unread}`) — a tab stores only an
  ADDRESS, never a label.

- **1.3** — MIGRATION, do not skip. Persisted layouts from v1.11.0 hold
  `{kind:"chat"}` with NO chatId, and `paneLayoutMigration.ts:51` creates one
  too. After 1.1 those normalize to null and are DROPPED — a user would open
  the app to an EMPTY PANE. Fix: on `ChatPage` mount with a route chatId,
  ALWAYS `openTab({kind:"chat", chatId})`. `openTab` is already idempotent, so
  this doubles as the normal open path and self-heals old layouts. Add a test
  that hydrates a legacy layout and asserts a chat tab exists afterwards.

- **1.4** — `KannaSidebar.tsx` `onSelectChat` (~line 353): `openTab(projectId,
  {kind:"chat", chatId})` + focus, then navigate.

- **1.5** — `registry.chat` in ChatPage (~line 970) renders
  `<ChatTabRoot chatId={target.chatId} />` — the line that today ignores its
  target. **Write
  `src/client/app/ChatPage/ChatTabRoot.multi.loop.test.tsx`**: mount TWO
  ChatTabRoots with different chatIds in one tree via `renderForLoopCheck`
  (`src/client/lib/testing/`), assert no loop warnings AND that each shows its
  OWN chat's data. Model it on
  `src/client/components/panes/PaneShell.loop.test.tsx`.

- **1.6** — Split the Outlet context: `<Outlet context={appGlobal}>`.
  `LocalProjectsPage` (10 fields), `SettingsPage` (~25), `WorkflowsPage`
  (`state.socket` only) read ONLY app-global — re-type them to
  `useOutletContext<AppGlobalState>()`; `bun run typecheck` is the audit. Drop
  the deprecated `KannaState` alias.

- **2** — Keyboard. Add `jumpToPaneTab1`..`jumpToPaneTab9` to
  `src/shared/app-settings-types.ts`, defaults `cmd+ctrl+1..9` /
  `ctrl+alt+1..9`. **NOT plain `cmd+1..9`** (browsers reserve it for their own
  tab switching and a page cannot prevent it) and **NOT `cmd+alt+…`** (that is
  `jumpToSidebarChat`, holding it flashes the number overlay). The comment at
  `app-settings-types.ts:226` explains the convention — follow it.
  `cmd+ctrl+9` = LAST tab, per browser convention. Add
  `PaneCommand {kind:"jumpTab"; index}` in `paneKeyboard.ts` + a
  `jumpToPaneTab(projectId, index)` action in `paneLayoutStore.ts`, with tests
  in `paneKeyboard.test.ts`.

- **3** — Lifecycle. Prune tabs whose chat was deleted/archived. Closing the
  last tab leaves an empty pane (already handled). Re-check
  `DEFAULT_RETENTION_CAP = 3` in `paneRetention.ts` now that each mounted
  transcript holds a real subscription; add a retention test with 5 chat tabs
  asserting at most cap+1 stay mounted. Call `releaseChat(chatId)` when a chat
  tab closes so slices cannot leak.

- **4 (C3, required — same PR)** — `c3x` only, never hand-edit `.c3/`.
  Write an ADR that SUPERSEDES the rejected row in
  `.c3/adr/adr-20260805-replace-chatpage-layout-with-pane-tree.md:60`, which
  says "Give each pane its own transcript state provider — Out of scope by
  design — chat is a declared singleton tab". Explain the reversal: the
  singleton was only valid while chat STATE was a singleton; after phase 0 that
  premise is gone. Then `/c3 change` for `c3-104` (pane-layout) and `c3-112`
  (chat-page); both are canvas-clean so `change apply` will not be blocked.
