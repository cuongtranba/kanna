import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, type ComponentProps, type RefObject } from "react"
import type { DomPort } from "../../ports/domPort"
import type { TimerPort } from "../../ports/timerPort"
import { domAdapter } from "../../adapters/dom.adapter"
import { timerAdapter } from "../../adapters/timer.adapter"
import { isMobileViewport } from "../../lib/viewport"
import { useNavigate, useOutletContext, useParams } from "react-router-dom"
import { RightSidebar } from "../../components/chat-ui/RightSidebar"
import { useAppDialog } from "../../components/ui/app-dialog"
import { actionMatchesEvent, getResolvedKeybindings } from "../../lib/keybindings"
import {
  DEFAULT_RIGHT_SIDEBAR_SIZE,
  DEFAULT_RIGHT_SIDEBAR_VISIBILITY_STATE,
  useRightSidebarStore,
} from "../../stores/rightSidebarStore"
import {
  DEFAULT_PROJECT_TERMINAL_LAYOUT,
  findTerminalOwner,
  useTerminalLayoutStore,
} from "../../stores/terminalLayoutStore"
import { useTerminalPreferencesStore } from "../../stores/terminalPreferencesStore"
import { useChatPageStore } from "../../stores/chatPageStore"
import type { KannaState } from "../useKannaState"
import { useAppGlobalContext } from "../AppGlobalProvider"
import { TerminalWorkspaceShell } from "./TerminalWorkspaceShell"
import { useChatPageSidebarActions, EMPTY_DIFF_SNAPSHOT } from "./useChatPageSidebarActions"
import { collectPanes, type SplitPosition } from "../../lib/paneTree"
import { usePaneLayoutStore } from "../../stores/paneLayoutStore"
import { SplitContainer } from "../../components/panes/SplitContainer"
import { PaneShell, type SplitArgs } from "../../components/panes/PaneShell"
import { isTypingTarget, resolvePaneCommand } from "../../components/panes/paneKeyboard"
import { PaneDndProvider } from "../../components/panes/PaneDndProvider"
import type { PaneContentRegistry } from "../../components/panes/paneContentRegistry"
import type { TabPresentationContext } from "../../components/panes/tabPresentation"
import { buildTabPresentationContext } from "./tabPresentationContext"
import { buildBoardChatFacts } from "../../lib/boards/boardChatFacts"
import { useBoardsStore } from "../../stores/boardsStore"
import { ChatTabRoot } from "./ChatTabRoot"
import { BoardPane } from "../../components/boards/BoardPane"
import { ChatTabContent } from "./ChatTabContent"

export {
  getIgnoreFolderEntryFromDiffPath,
  hasFileDragTypes,
  shouldAutoFollowTranscriptResize,
} from "./utils"

// `min-h-0` is load-bearing: this div is a flex item, and a flex item's
// automatic min-height is its content size. Without it, a long transcript
// expands this root past 100dvh, cascading down to the LegendList scroll
// container (clientHeight === scrollHeight) so it can no longer scroll —
// most visible on phones. Do not drop min-h-0.
export const CHAT_PAGE_LAYOUT_ROOT_CLASS = "flex-1 flex flex-col min-h-0 min-w-0 relative"

function useLayoutWidth(ref: RefObject<HTMLDivElement | null>) {
  const layoutWidth = useChatPageStore((s) => s.layoutWidth)
  const setLayoutWidth = useChatPageStore((s) => s.setLayoutWidth)

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return

    const updateWidth = () => {
      const nextWidth = element.clientWidth
      const current = useChatPageStore.getState().layoutWidth
      if (Math.abs(current - nextWidth) >= 1) {
        setLayoutWidth(nextWidth)
      }
    }

    const observer = new ResizeObserver(updateWidth)
    observer.observe(element)
    updateWidth()

    return () => observer.disconnect()
  }, [ref, setLayoutWidth])

  return layoutWidth
}

export function shouldUseMobileRightSidebarOverlay(viewportWidth: number) {
  // Pure function retained for tests. The pane layout handles all viewports
  // through SplitContainer so this no longer drives a separate overlay render —
  // but the breakpoint semantics are preserved so callers depending on the
  // 768 px boundary are not surprised.
  return isMobileViewport(viewportWidth)
}

type ChatSidebarContentProps = ComponentProps<typeof RightSidebar>

const ChatSidebarContent = memo((props: ChatSidebarContentProps) => {
  return (
    <RightSidebar
      {...props}
      diffs={props.diffs ?? EMPTY_DIFF_SNAPSHOT}
    />
  )
})

export interface ChatPagePorts {
  dom?: DomPort
  timer?: TimerPort
}

/**
 * The pane workspace — one shared tree of splits and tabs, mounted by every
 * route that shows one.
 *
 * Route-neutral on purpose. A chat is one tab KIND among four, so nothing here
 * requires a chat: `activeChatId` is nullable and every chat-specific effect is
 * guarded on it, and what decides whether the workspace paints is
 * `workspaceHasTabs`, not whether a chat exists. That is what lets `/boards/:projectId/:boardId`
 * mount the same component and get the tab strip, splits and persistence for
 * free — the earlier attempt at board-beside-chat instead manufactured a chat
 * nobody asked for, because the workspace was reachable only from `/chat/:chatId`.
 *
 * The directory keeps the `ChatPage` name: the chat TAB's own components live
 * beside this file.
 */
export function WorkspacePage({ ports = {} }: { ports?: ChatPagePorts } = {}) {
  const dom = ports.dom ?? domAdapter
  const timer = ports.timer ?? timerAdapter
  const state = useOutletContext<KannaState>()
  const dialog = useAppDialog()
  const layoutRootRef = useRef<HTMLDivElement>(null)
  const projectId = state.activeProjectId
  // The chat named by the URL. Distinct from a tab's own chatId: it says which
  // tab should be focused, not which chat any given tab renders.
  const activeChatId = state.activeChatId
  // The board named by the URL, on `/boards/:projectId/:boardId`. Undefined on
  // every other route, which is what keeps this component route-neutral.
  const { boardId: routeBoardId } = useParams<{ boardId?: string }>()
  const navigate = useNavigate()
  const sidebarData = state.sidebarData
  const chatNavigator = useAppGlobalContext().chatNavigator
  const handleOpenExternal = state.handleOpenExternal
  // Every project's terminals, not just the active one's: the workspace is
  // shared, so a terminal tab resolves its own owner (see findTerminalOwner).
  const terminalProjects = useTerminalLayoutStore((store) => store.projects)
  // Every project's boards, for the same reason: a board tab outlives the
  // project the user is currently looking at.
  const boardsByOwner = useBoardsStore((store) => store.boardsByOwner)
  const boardViews = useBoardsStore((store) => store.viewByBoard)
  const projectTerminalLayout = projectId ? terminalProjects[projectId] : undefined
  const terminalLayout = projectTerminalLayout ?? DEFAULT_PROJECT_TERMINAL_LAYOUT
  const projectRightSidebarVisibility = useRightSidebarStore((store) => (projectId ? store.projects[projectId] : undefined))
  const rightSidebarVisibility = projectRightSidebarVisibility ?? DEFAULT_RIGHT_SIDEBAR_VISIBILITY_STATE
  const globalRightSidebarSize = useRightSidebarStore((store) => store.size)
  const addTerminal = useTerminalLayoutStore((store) => store.addTerminal)
  const removeTerminal = useTerminalLayoutStore((store) => store.removeTerminal)
  const toggleVisibility = useTerminalLayoutStore((store) => store.toggleVisibility)
  const setTerminalSizes = useTerminalLayoutStore((store) => store.setTerminalSizes)
  const toggleRightSidebar = useRightSidebarStore((store) => store.toggleVisibility)
  const scrollback = useTerminalPreferencesStore((store) => store.scrollbackLines)
  const minColumnWidth = useTerminalPreferencesStore((store) => store.minColumnWidth)
  const resolvedKeybindings = useMemo(() => getResolvedKeybindings(state.keybindings), [state.keybindings])

  const hasTerminals = terminalLayout.terminals.length > 0
  const showRightSidebar = Boolean(projectId && rightSidebarVisibility.isVisible)

  // ─── Pane layout ────────────────────────────────────────────────────────────

  // One workspace for the whole app — deliberately NOT filtered by project, so
  // a chat opened in project B joins the chats already open from project A
  // instead of swapping the arrangement out.
  const paneLayout = usePaneLayoutStore((s) => s.layout)
  // What decides whether the panel shows: the workspace holds a tab. No project
  // filter — an empty tree only happens on the very first render, before the
  // reconcile effect opens a tab for the chat in the URL.
  const workspaceHasTabs = useMemo(
    () => collectPanes(paneLayout.root).some((pane) => pane.tabs.length > 0),
    [paneLayout],
  )

  const seedFromLegacy = usePaneLayoutStore((s) => s.seedFromLegacy)
  const focusPane = usePaneLayoutStore((s) => s.focusPane)
  const focusTab = usePaneLayoutStore((s) => s.focusTab)
  const closeTab = usePaneLayoutStore((s) => s.closeTab)
  const splitPane = usePaneLayoutStore((s) => s.splitPane)
  const setGroupSizes = usePaneLayoutStore((s) => s.setGroupSizes)
  const focusAdjacentPane = usePaneLayoutStore((s) => s.focusAdjacentPane)
  const cycleFocusedPaneTab = usePaneLayoutStore((s) => s.cycleFocusedPaneTab)
  const closeFocusedTab = usePaneLayoutStore((s) => s.closeFocusedTab)
  const splitFocusedPane = usePaneLayoutStore((s) => s.splitFocusedPane)
  const moveTabToPane = usePaneLayoutStore((s) => s.moveTabToPane)
  const openTab = usePaneLayoutStore((s) => s.openTab)
  const getPaneLayout = usePaneLayoutStore((s) => s.getLayout)

  // One-time seed from the legacy terminal + sidebar stores, using whichever
  // project the user opens first. seedFromLegacy is a no-op once the workspace
  // holds any tab, so a second project never overwrites it.
  useEffect(() => {
    if (!projectId) return
    seedFromLegacy({
      terminals: terminalLayout.terminals,
      mainSizes: terminalLayout.mainSizes,
      terminalSizes: terminalLayout.terminals.map((t) => t.size),
      changesVisible: rightSidebarVisibility.isVisible,
      changesSizePercent: globalRightSidebarSize ?? DEFAULT_RIGHT_SIDEBAR_SIZE,
    })
  }, [projectId, seedFromLegacy, terminalLayout, rightSidebarVisibility, globalRightSidebarSize])

  // Keep the tree's tabs in step with the two sources that own their existence:
  // the terminal list (server-backed PTYs) and the changes-view toggle.
  //
  // Reconciling here rather than at each call site is what makes the navbar
  // buttons, the keybindings, and the split-terminal action all work — every one
  // of them writes those sources, and none of them knows about panes. Without
  // this the tree could only ever hold the tabs the one-time seed gave it.
  useEffect(() => {
    const tabs = collectPanes(getPaneLayout().root).flatMap((pane) => pane.tabs)

    for (const terminal of terminalLayout.terminals) {
      const known = tabs.some(
        (tab) => tab.target.kind === "terminal" && tab.target.terminalId === terminal.id,
      )
      if (!known) openTab({ kind: "terminal", terminalId: terminal.id })
    }

    // Reap against EVERY project's terminal list, not just the active one. The
    // workspace is shared, so a terminal tab belonging to another project is
    // still live — only a terminal no project claims any more is stale.
    for (const tab of tabs) {
      if (tab.target.kind === "terminal" && !findTerminalOwner(terminalProjects, tab.target.terminalId)) {
        closeTab(tab.tabId)
      }
    }

    // The changes panel is a singleton showing the ACTIVE project's git state,
    // so its tab follows the active project's toggle rather than accumulating.
    const changesTab = tabs.find((tab) => tab.target.kind === "changes")
    if (showRightSidebar && !changesTab) openTab({ kind: "changes" })
    if (!showRightSidebar && changesTab) closeTab(changesTab.tabId)

    // The chat named by the URL always has a tab. openTab is idempotent per
    // target, so revisiting an open chat focuses its tab while visiting a new
    // one adds a tab beside the others — that accumulation is what makes N open
    // chats N tabs, across projects as well as within one. Chat tabs are
    // deliberately NOT reaped the way stale terminal tabs are above: a chat tab
    // outliving the URL is the whole point.
    if (activeChatId) openTab({ kind: "chat", chatId: activeChatId })
    // A board is an address the same way a chat is, so the board named by the
    // URL gets a tab by the same rule. Idempotent per target, so arriving at a
    // board already open focuses it instead of adding a second tab.
    if (routeBoardId) openTab({ kind: "board", boardId: routeBoardId })
  }, [
    terminalLayout.terminals,
    terminalProjects,
    showRightSidebar,
    activeChatId,
    routeBoardId,
    openTab,
    closeTab,
    getPaneLayout,
  ])

  /**
   * Point the URL at whichever chat tab currently holds focus.
   *
   * Called AFTER a user-initiated focus change (tab click, keyboard cycle, pane
   * move) — deliberately not from an effect keyed on the focused tab. Such an
   * effect fights the URL→tab reconcile above: on load, a persisted focus of
   * chat A under a /chat/B URL makes one effect navigate to A while the other
   * re-focuses B, and the two ping-pong. Keeping URL→focus as the only effect
   * makes the flow one-way, and every focus change a user can make passes
   * through here.
   *
   * Reads the store rather than the rendered layout because it runs in the same
   * tick as the action that moved focus, before a re-render.
   */
  const syncUrlToFocusedChat = useCallback(() => {
    const layout = getPaneLayout()
    const pane = collectPanes(layout.root).find((p) => p.id === layout.focusedPaneId)
    const tab = pane?.tabs.find((t) => t.tabId === pane.focusedTabId)
    // Only a focused CHAT tab steers the URL — focusing a terminal or the
    // changes panel must not navigate away from the chat being viewed.
    if (tab?.target.kind === "chat" && tab.target.chatId !== activeChatId) {
      chatNavigator.openChat(tab.target.chatId)
    }
  }, [getPaneLayout, activeChatId, chatNavigator])

  // Stable pane action callbacks.
  const handleSelectTab = useCallback(
    (tabId: string) => {
      focusTab(tabId)
      syncUrlToFocusedChat()
    },
    [focusTab, syncUrlToFocusedChat],
  )
  const handleSplitPane = useCallback(
    ({ tabId, paneId, position }: SplitArgs) => {
      splitPane({ tabId, targetPaneId: paneId, position })
    },
    [splitPane],
  )
  // Clicking into a pane focuses it, so the URL follows to whatever chat that
  // pane is showing — otherwise typing in the left pane would send the message
  // to the chat named by the URL, which is the right pane's.
  const handleFocusPane = useCallback(
    (paneId: string) => {
      focusPane(paneId)
      syncUrlToFocusedChat()
    },
    [focusPane, syncUrlToFocusedChat],
  )
  const handleResizeGroup = useCallback(
    (groupId: string, sizes: number[]) => { setGroupSizes(groupId, sizes) },
    [setGroupSizes],
  )

  // Drag-and-drop: drop a tab into a pane's middle to merge, onto an edge to split.
  const handleMoveTab = useCallback(
    (tabId: string, toPaneId: string) => { moveTabToPane(tabId, toPaneId) },
    [moveTabToPane],
  )
  const handleSplitWithTab = useCallback(
    (tabId: string, paneId: string, position: SplitPosition) => {
      splitPane({ tabId, targetPaneId: paneId, position })
    },
    [splitPane],
  )

  const presentation = useMemo<TabPresentationContext>(
    () => buildTabPresentationContext({ terminalProjects, sidebarData, boardsByOwner, boardViews }),
    [terminalProjects, sidebarData, boardsByOwner, boardViews],
  )

  // Memoized because it reaches a board tab as a prop: a fresh object per
  // render would re-render every card on the board on every keystroke
  // elsewhere in the workspace.
  const boardChatFacts = useMemo(() => buildBoardChatFacts(sidebarData), [sidebarData])

  // ─── Layout width ────────────────────────────────────────────────────────────

  useLayoutWidth(layoutRootRef)

  // ─── Sidebar actions + diff mode ─────────────────────────────────────────────

  const {
    diffRenderMode,
    wrapDiffLines,
    setDiffRenderMode,
    setWrapDiffLines,
    scheduleTerminalDiffRefresh,
    handleOpenDiffFile,
    handleCopyDiffFilePath,
    handleCopyDiffRelativePath,
    handleLoadDiffPatch,
    handleDiscardDiffFile,
    handleIgnoreDiffFile,
    handleIgnoreDiffFolder,
    handleOpenDiffInFinder,
    handleCommitDiffs,
    handleSyncBranch,
    handleGenerateCommitMessage,
    handleInitializeGit,
    handleGetGitHubPublishInfo,
    handleCheckGitHubRepoAvailability,
    handleSetupGitHub,
    handleListBranches,
    handleCheckoutBranch,
    handlePreviewMergeBranch,
    handleMergeBranch,
    handleCreateBranch,
  } = useChatPageSidebarActions({
    state,
    projectId,
    showRightSidebar,
  })

  const handleToggleEmbeddedTerminal = useCallback(() => {
    if (!projectId) return
    if (hasTerminals) {
      toggleVisibility(projectId)
      return
    }

    addTerminal(projectId)
  }, [addTerminal, hasTerminals, projectId, toggleVisibility])

  const handleCloseRightSidebar = useCallback(() => {
    if (!projectId) return
    toggleRightSidebar(projectId)
  }, [projectId, toggleRightSidebar])

  const handleToggleRightSidebar = useCallback(() => {
    if (!projectId) return

    if (showRightSidebar) {
      toggleRightSidebar(projectId)
      return
    }

    if (state.chatDiffSnapshot?.status === "no_repo") {
      void (async () => {
        const confirmed = await dialog.confirm({
          title: "Initialize Git?",
          description: "Initialize a local git repository in this project?",
          confirmLabel: "Init Git",
          cancelLabel: "Cancel",
        })
        if (!confirmed) return

        const result = await handleInitializeGit()
        if (result?.ok && !showRightSidebar) {
          toggleRightSidebar(projectId)
        }
      })()
      return
    }

    toggleRightSidebar(projectId)
  }, [dialog, handleInitializeGit, projectId, showRightSidebar, state.chatDiffSnapshot?.status, toggleRightSidebar])


  const handleRemoveTerminal = useCallback((currentProjectId: string, terminalId: string) => {
    void state.socket.command({ type: "terminal.close", terminalId }).catch(() => {})
    removeTerminal(currentProjectId, terminalId)
  }, [removeTerminal, state.socket])

  // Closing a tab must close whatever OWNS it, or the reconcile effect above
  // simply puts the tab straight back. Defined after handleRemoveTerminal, which
  // it calls.
  const handleCloseTab = useCallback(
    (tabId: string) => {
      const tab = collectPanes(getPaneLayout().root)
        .flatMap((pane) => pane.tabs)
        .find((candidate) => candidate.tabId === tabId)

      if (tab?.target.kind === "terminal") {
        // Close it in the project that OWNS it, which need not be the active
        // one now that the workspace spans projects.
        const owner = findTerminalOwner(terminalProjects, tab.target.terminalId)
        if (owner) handleRemoveTerminal(owner.projectId, tab.target.terminalId)
        else closeTab(tabId)
        return
      }
      if (tab?.target.kind === "changes") {
        if (projectId) toggleRightSidebar(projectId)
        return
      }

      // A chat tab is OWNED by the URL: the reconcile effect re-opens a tab for
      // whatever chat the URL names, so closing the active chat's tab without
      // moving the URL would snap it straight back. Hand over to a sibling chat
      // tab when there is one, else leave the chat route entirely.
      if (tab?.target.kind === "chat") {
        const closingChatId = tab.target.chatId
        const siblingChatId = collectPanes(getPaneLayout().root)
          .flatMap((pane) => pane.tabs)
          .find(
            (candidate) =>
              candidate.tabId !== tabId &&
              candidate.target.kind === "chat" &&
              candidate.target.chatId !== closingChatId,
          )?.target

        closeTab(tabId)

        if (closingChatId === activeChatId) {
          if (siblingChatId?.kind === "chat") chatNavigator.openChat(siblingChatId.chatId)
          else chatNavigator.closeChat()
        }
        return
      }

      closeTab(tabId)
    },
    [
      projectId,
      terminalProjects,
      closeTab,
      getPaneLayout,
      handleRemoveTerminal,
      toggleRightSidebar,
      activeChatId,
      chatNavigator,
    ],
  )
  useEffect(() => {
    function handleGlobalKeydown(event: KeyboardEvent) {
      // Only the project-scoped actions below need a project; the pane commands
      // act on the shared workspace and work whatever the route is showing.
      if (projectId) {
        if (actionMatchesEvent(resolvedKeybindings, "toggleEmbeddedTerminal", event)) {
          event.preventDefault()
          handleToggleEmbeddedTerminal()
          return
        }

        if (actionMatchesEvent(resolvedKeybindings, "toggleRightSidebar", event)) {
          event.preventDefault()
          handleToggleRightSidebar()
          return
        }

        if (actionMatchesEvent(resolvedKeybindings, "openInFinder", event)) {
          event.preventDefault()
          void handleOpenExternal("open_finder")
          return
        }

        if (actionMatchesEvent(resolvedKeybindings, "openInEditor", event)) {
          event.preventDefault()
          void handleOpenExternal("open_editor")
          return
        }

        if (actionMatchesEvent(resolvedKeybindings, "addSplitTerminal", event)) {
          event.preventDefault()
          addTerminal(projectId)
          return
        }
      }

      // Pane commands resolve through one pure mapper, so the whole keyboard
      // surface is testable without a DOM. The typing flag only suppresses
      // MODIFIER-LESS bindings — see resolvePaneCommand.
      const target = event.target
      const command = resolvePaneCommand(
        resolvedKeybindings,
        event,
        isTypingTarget(target instanceof HTMLElement ? target : null),
      )
      if (!command) return

      event.preventDefault()
      // Each of these moves focus, so the URL follows — that is what makes
      // keyboard tab switching actually switch the chat being shown, not just
      // the highlighted tab.
      switch (command.kind) {
        case "focus":
          focusAdjacentPane(command.direction)
          syncUrlToFocusedChat()
          return
        case "split":
          splitFocusedPane(command.position)
          return
        case "closeTab":
          closeFocusedTab()
          syncUrlToFocusedChat()
          return
        case "cycleTab":
          cycleFocusedPaneTab(command.delta)
          syncUrlToFocusedChat()
      }
    }

    return dom.addWindowListener("keydown", handleGlobalKeydown)
  }, [addTerminal, closeFocusedTab, cycleFocusedPaneTab, dom, focusAdjacentPane, handleOpenExternal, handleToggleEmbeddedTerminal, handleToggleRightSidebar, projectId, resolvedKeybindings, splitFocusedPane, syncUrlToFocusedChat])

  // ─── Content registry ────────────────────────────────────────────────────────

  const rightSidebarContentProps = useMemo<ComponentProps<typeof ChatSidebarContent> | null>(() => {
    if (!projectId) return null
    return {
      projectId,
      diffs: state.chatDiffSnapshot ?? EMPTY_DIFF_SNAPSHOT,
      editorLabel: state.editorLabel,
      diffRenderMode,
      wrapLines: wrapDiffLines,
      onOpenFile: handleOpenDiffFile,
      onOpenInFinder: handleOpenDiffInFinder,
      onDiscardFile: handleDiscardDiffFile,
      onIgnoreFile: handleIgnoreDiffFile,
      onIgnoreFolder: handleIgnoreDiffFolder,
      onCopyFilePath: handleCopyDiffFilePath,
      onCopyRelativePath: handleCopyDiffRelativePath,
      onLoadPatch: handleLoadDiffPatch,
      onListBranches: handleListBranches,
      onPreviewMergeBranch: handlePreviewMergeBranch,
      onMergeBranch: handleMergeBranch,
      onCheckoutBranch: handleCheckoutBranch,
      onCreateBranch: handleCreateBranch,
      onGenerateCommitMessage: handleGenerateCommitMessage,
      onInitializeGit: handleInitializeGit,
      onGetGitHubPublishInfo: handleGetGitHubPublishInfo,
      onCheckGitHubRepoAvailability: handleCheckGitHubRepoAvailability,
      onSetupGitHub: handleSetupGitHub,
      onCommit: handleCommitDiffs,
      onSyncWithRemote: handleSyncBranch,
      onDiffRenderModeChange: setDiffRenderMode,
      onWrapLinesChange: setWrapDiffLines,
      onClose: handleCloseRightSidebar,
    }
  }, [
    diffRenderMode,
    handleCheckGitHubRepoAvailability,
    handleCheckoutBranch,
    handleCloseRightSidebar,
    handleCommitDiffs,
    handleCopyDiffFilePath,
    handleCopyDiffRelativePath,
    handleCreateBranch,
    handleDiscardDiffFile,
    handleGenerateCommitMessage,
    handleGetGitHubPublishInfo,
    handleIgnoreDiffFile,
    handleIgnoreDiffFolder,
    handleInitializeGit,
    handleListBranches,
    handleLoadDiffPatch,
    handleMergeBranch,
    handleOpenDiffFile,
    handleOpenDiffInFinder,
    handlePreviewMergeBranch,
    handleSetupGitHub,
    handleSyncBranch,
    projectId,
    setDiffRenderMode,
    setWrapDiffLines,
    state.chatDiffSnapshot,
    state.editorLabel,
    wrapDiffLines,
  ])

  const handleOpenBoards = useCallback(
    (boardsProjectId: string) => {
      void navigate(`/boards/${boardsProjectId}`)
    },
    [navigate],
  )

  // ─── Registry ────────────────────────────────────────────────────────────────

  const registry: PaneContentRegistry = {
    // A board is an ADDRESS like every other tab: it re-subscribes from its
    // boardId, so a persisted layout can never carry stale board content.
    // Rendered only while it is the active tab: the kanban virtualiser sets
    // `visibility: visible` inline on its rows, which escapes the `invisible`
    // class a retained background tab is hidden with and paints cards over the
    // focused chat. A board holds no live stream, so remounting simply
    // re-subscribes and the server pushes a fresh snapshot.
    board: (target, _pane, _isFocused, isActiveTab) =>
      isActiveTab ? (
        <BoardPane
          boardId={target.boardId}
          socket={state.socket}
          chatFacts={boardChatFacts}
          onOpenBoards={handleOpenBoards}
        />
      ) : null,
    // Each chat tab gets its own ChatTabScopedStore.Provider via ChatTabRoot so
    // composer state, scroll position, etc. are independent per tab.
    // The tab's target — not the route — decides which chat it renders, which
    // is what lets two tabs show two different live transcripts side by side.
    chat: (target) => (
      <ChatTabRoot chatId={target.chatId} timer={timer} dom={dom}>
        <ChatTabContent
          timer={timer}
          dom={dom}
          onToggleEmbeddedTerminal={handleToggleEmbeddedTerminal}
          onToggleRightSidebar={handleToggleRightSidebar}
        />
      </ChatTabRoot>
    ),
    changes: () =>
      rightSidebarContentProps ? (
        <ChatSidebarContent {...rightSidebarContentProps} />
      ) : null,
    // `isFocused` is the pane's, so a terminal takes keyboard focus exactly when
    // its pane does. TerminalPane treats 0 as "no request" and focuses on any
    // change, so toggling 0/1 never steals focus from another pane.
    // A terminal tab renders against the project that OWNS the terminal, which
    // is not necessarily the active one — the workspace spans projects, so
    // borrowing `projectId` here would point project A's terminal at project
    // B's cwd the moment you switched chats.
    terminal: (target, _pane, isFocused) => {
      const owner = findTerminalOwner(terminalProjects, target.terminalId)
      if (!owner) return null
      const ownerLayout = terminalProjects[owner.projectId] ?? DEFAULT_PROJECT_TERMINAL_LAYOUT
      return (
        <TerminalWorkspaceShell
          projectId={owner.projectId}
          terminalLayout={{
            ...ownerLayout,
            terminals: [owner.terminal],
          }}
          addTerminal={addTerminal}
          socket={state.socket}
          connectionStatus={state.connectionStatus}
          scrollback={scrollback}
          minColumnWidth={minColumnWidth}
          splitTerminalShortcut={resolvedKeybindings.bindings.addSplitTerminal}
          focusRequestVersion={isFocused ? 1 : 0}
          onTerminalCommandSent={scheduleTerminalDiffRefresh}
          onRemoveTerminal={handleRemoveTerminal}
          onTerminalLayout={setTerminalSizes}
        />
      )
    },
  }

  // ─── Layout ──────────────────────────────────────────────────────────────────

  return (
    <div ref={layoutRootRef} className={CHAT_PAGE_LAYOUT_ROOT_CLASS}>
      {workspaceHasTabs ? (
        <PaneDndProvider onMoveTab={handleMoveTab} onSplitWithTab={handleSplitWithTab}>
          <SplitContainer
            layout={paneLayout}
            renderPane={(pane, isFocused) => (
              <PaneShell
                pane={pane}
                isFocused={isFocused}
                registry={registry}
                presentation={presentation}
                onSelectTab={handleSelectTab}
                onCloseTab={handleCloseTab}
                onSplit={handleSplitPane}
              />
            )}
            onFocusPane={handleFocusPane}
            onResizeGroup={handleResizeGroup}
          />
        </PaneDndProvider>
      ) : (
        // The workspace is empty — the first render before the reconcile effect
        // opens a tab, or a route with no chat at all. Render the chat card
        // directly (no pane shell); the tab addresses the route's chat. Still
        // wrapped in ChatTabRoot so the per-tab providers exist and
        // ChatTabContent's context reads don't crash.
        <ChatTabRoot chatId={state.activeChatId} timer={timer} dom={dom}>
          <ChatTabContent
            timer={timer}
            dom={dom}
            onToggleEmbeddedTerminal={handleToggleEmbeddedTerminal}
            onToggleRightSidebar={handleToggleRightSidebar}
          />
        </ChatTabRoot>
      )}
    </div>
  )
}
