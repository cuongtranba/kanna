import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, type ComponentProps, type RefObject } from "react"
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
import { selectMinColumnWidth, selectScrollbackLines, useAppSettingsStore } from "../../stores/appSettingsStore"
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
  return isMobileViewport(viewportWidth)
}

export interface ChatPagePorts {
  dom?: DomPort
  timer?: TimerPort
}

export function WorkspacePage({ ports = {} }: { ports?: ChatPagePorts } = {}) {
  const dom = ports.dom ?? domAdapter
  const timer = ports.timer ?? timerAdapter
  const state = useOutletContext<KannaState>()
  const dialog = useAppDialog()
  const layoutRootRef = useRef<HTMLDivElement>(null)
  const projectId = state.activeProjectId
  const activeChatId = state.activeChatId
  const { boardId: routeBoardId } = useParams<{ boardId?: string }>()
  const navigate = useNavigate()
  const sidebarData = state.sidebarData
  const chatNavigator = useAppGlobalContext().chatNavigator
  const handleOpenExternal = state.handleOpenExternal
  const terminalProjects = useTerminalLayoutStore((store) => store.projects)
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
  const scrollback = useAppSettingsStore(selectScrollbackLines)
  const minColumnWidth = useAppSettingsStore(selectMinColumnWidth)
  const resolvedKeybindings = useMemo(() => getResolvedKeybindings(state.keybindings), [state.keybindings])

  const hasTerminals = terminalLayout.terminals.length > 0
  const showRightSidebar = Boolean(projectId && rightSidebarVisibility.isVisible)


  const paneLayout = usePaneLayoutStore((s) => s.layout)
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
  const resizeFocusedPane = usePaneLayoutStore((s) => s.resizeFocusedPane)
  const cycleFocusedPaneTab = usePaneLayoutStore((s) => s.cycleFocusedPaneTab)
  const closeFocusedTab = usePaneLayoutStore((s) => s.closeFocusedTab)
  const splitFocusedPane = usePaneLayoutStore((s) => s.splitFocusedPane)
  const moveTabToPane = usePaneLayoutStore((s) => s.moveTabToPane)
  const openTab = usePaneLayoutStore((s) => s.openTab)
  const getPaneLayout = usePaneLayoutStore((s) => s.getLayout)

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

  useEffect(() => {
    const tabs = collectPanes(getPaneLayout().root).flatMap((pane) => pane.tabs)

    for (const terminal of terminalLayout.terminals) {
      const known = tabs.some(
        (tab) => tab.target.kind === "terminal" && tab.target.terminalId === terminal.id,
      )
      if (!known) openTab({ kind: "terminal", terminalId: terminal.id })
    }

    for (const tab of tabs) {
      if (tab.target.kind === "terminal" && !findTerminalOwner(terminalProjects, tab.target.terminalId)) {
        closeTab(tab.tabId)
      }
    }

    const changesTab = tabs.find((tab) => tab.target.kind === "changes")
    if (showRightSidebar && !changesTab) openTab({ kind: "changes" })
    if (!showRightSidebar && changesTab) closeTab(changesTab.tabId)

    if (activeChatId) openTab({ kind: "chat", chatId: activeChatId })
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

  const syncUrlToFocusedChat = useCallback(() => {
    const layout = getPaneLayout()
    const pane = collectPanes(layout.root).find((p) => p.id === layout.focusedPaneId)
    const tab = pane?.tabs.find((t) => t.tabId === pane.focusedTabId)
    if (tab?.target.kind === "chat" && tab.target.chatId !== activeChatId) {
      chatNavigator.openChat(tab.target.chatId)
    }
  }, [getPaneLayout, activeChatId, chatNavigator])

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

  const boardChatFacts = useMemo(() => buildBoardChatFacts(sidebarData), [sidebarData])


  useLayoutWidth(layoutRootRef)


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

  const handleCloseTab = useCallback(
    (tabId: string) => {
      const tab = collectPanes(getPaneLayout().root)
        .flatMap((pane) => pane.tabs)
        .find((candidate) => candidate.tabId === tabId)

      if (tab?.target.kind === "terminal") {
        const owner = findTerminalOwner(terminalProjects, tab.target.terminalId)
        if (owner) handleRemoveTerminal(owner.projectId, tab.target.terminalId)
        else closeTab(tabId)
        return
      }
      if (tab?.target.kind === "changes") {
        if (projectId) toggleRightSidebar(projectId)
        return
      }

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

      const target = event.target
      const command = resolvePaneCommand(
        resolvedKeybindings,
        event,
        isTypingTarget(target instanceof HTMLElement ? target : null),
      )
      if (!command) return

      event.preventDefault()
      switch (command.kind) {
        case "focus":
          focusAdjacentPane(command.direction)
          syncUrlToFocusedChat()
          return
        case "resize":
          resizeFocusedPane(command.direction)
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
  }, [addTerminal, closeFocusedTab, cycleFocusedPaneTab, dom, focusAdjacentPane, handleOpenExternal, handleToggleEmbeddedTerminal, handleToggleRightSidebar, projectId, resizeFocusedPane, resolvedKeybindings, splitFocusedPane, syncUrlToFocusedChat])


  const rightSidebarContentProps = useMemo<ComponentProps<typeof RightSidebar> | null>(() => {
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


  const registry: PaneContentRegistry = {
    board: (target, _pane, _isFocused, isActiveTab) =>
      isActiveTab ? (
        <BoardPane
          boardId={target.boardId}
          socket={state.socket}
          chatFacts={boardChatFacts}
          onOpenBoards={handleOpenBoards}
        />
      ) : null,
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
        <RightSidebar {...rightSidebarContentProps} />
      ) : null,
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
