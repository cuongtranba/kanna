import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, type ComponentProps, type RefObject } from "react"
import type { DomPort } from "../../ports/domPort"
import type { TimerPort } from "../../ports/timerPort"
import { domAdapter } from "../../adapters/dom.adapter"
import { timerAdapter } from "../../adapters/timer.adapter"
import { isMobileViewport } from "../../lib/viewport"
import { useOutletContext } from "react-router-dom"
import { RightSidebar } from "../../components/chat-ui/RightSidebar"
import { useAppDialog } from "../../components/ui/app-dialog"
import { actionMatchesEvent, getResolvedKeybindings } from "../../lib/keybindings"
import {
  DEFAULT_RIGHT_SIDEBAR_SIZE,
  DEFAULT_RIGHT_SIDEBAR_VISIBILITY_STATE,
  useRightSidebarStore,
} from "../../stores/rightSidebarStore"
import { DEFAULT_PROJECT_TERMINAL_LAYOUT, useTerminalLayoutStore } from "../../stores/terminalLayoutStore"
import { useTerminalPreferencesStore } from "../../stores/terminalPreferencesStore"
import { useChatPageStore } from "../../stores/chatPageStore"
import type { KannaState } from "../useKannaState"
import { TerminalWorkspaceShell } from "./TerminalWorkspaceShell"
import { useChatPageSidebarActions, EMPTY_DIFF_SNAPSHOT } from "./useChatPageSidebarActions"
import { collectPanes, createDefaultLayout, type PaneLayout, type SplitPosition } from "../../lib/paneTree"
import { usePaneLayoutStore } from "../../stores/paneLayoutStore"
import { SplitContainer } from "../../components/panes/SplitContainer"
import { PaneShell, type SplitArgs } from "../../components/panes/PaneShell"
import { isTypingTarget, resolvePaneCommand } from "../../components/panes/paneKeyboard"
import { PaneDndProvider } from "../../components/panes/PaneDndProvider"
import type { PaneContentRegistry } from "../../components/panes/paneContentRegistry"
import type { TabPresentationContext } from "../../components/panes/tabPresentation"
import { ChatTabRoot } from "./ChatTabRoot"
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

/** Stable default used as a fallback before a project's layout is seeded. */
const EMPTY_PANE_LAYOUT: PaneLayout = createDefaultLayout()

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

export function ChatPage({ ports = {} }: { ports?: ChatPagePorts } = {}) {
  const dom = ports.dom ?? domAdapter
  const timer = ports.timer ?? timerAdapter
  const state = useOutletContext<KannaState>()
  const dialog = useAppDialog()
  const layoutRootRef = useRef<HTMLDivElement>(null)
  const projectId = state.activeProjectId
  const handleOpenExternal = state.handleOpenExternal
  const projectTerminalLayout = useTerminalLayoutStore((store) => (projectId ? store.projects[projectId] : undefined))
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

  const storedPaneLayout = usePaneLayoutStore((s) => projectId ? s.layouts[projectId] : undefined)
  const paneLayout = storedPaneLayout ?? EMPTY_PANE_LAYOUT

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

  // One-time seed from the legacy terminal + sidebar stores when the project
  // first loads.  seedFromLegacy is a no-op if the layout already exists.
  useEffect(() => {
    if (!projectId) return
    seedFromLegacy(projectId, {
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
    if (!projectId) return

    const tabs = collectPanes(getPaneLayout(projectId).root).flatMap((pane) => pane.tabs)
    const terminalIds = new Set(terminalLayout.terminals.map((terminal) => terminal.id))

    for (const id of terminalIds) {
      const known = tabs.some(
        (tab) => tab.target.kind === "terminal" && tab.target.terminalId === id,
      )
      if (!known) openTab(projectId, { kind: "terminal", terminalId: id })
    }

    for (const tab of tabs) {
      if (tab.target.kind === "terminal" && !terminalIds.has(tab.target.terminalId)) {
        closeTab(projectId, tab.tabId)
      }
    }

    const changesTab = tabs.find((tab) => tab.target.kind === "changes")
    if (showRightSidebar && !changesTab) openTab(projectId, { kind: "changes" })
    if (!showRightSidebar && changesTab) closeTab(projectId, changesTab.tabId)
  }, [projectId, terminalLayout.terminals, showRightSidebar, openTab, closeTab, getPaneLayout])

  // Stable pane action callbacks.
  const handleSelectTab = useCallback(
    (tabId: string) => { if (projectId) focusTab(projectId, tabId) },
    [projectId, focusTab],
  )
  const handleSplitPane = useCallback(
    ({ tabId, paneId, position }: SplitArgs) => {
      if (!projectId) return
      splitPane(projectId, { tabId, targetPaneId: paneId, position })
    },
    [projectId, splitPane],
  )
  const handleFocusPane = useCallback(
    (paneId: string) => { if (projectId) focusPane(projectId, paneId) },
    [projectId, focusPane],
  )
  const handleResizeGroup = useCallback(
    (groupId: string, sizes: number[]) => { if (projectId) setGroupSizes(projectId, groupId, sizes) },
    [projectId, setGroupSizes],
  )

  // Drag-and-drop: drop a tab into a pane's middle to merge, onto an edge to split.
  const handleMoveTab = useCallback(
    (tabId: string, toPaneId: string) => { if (projectId) moveTabToPane(projectId, tabId, toPaneId) },
    [projectId, moveTabToPane],
  )
  const handleSplitWithTab = useCallback(
    (tabId: string, paneId: string, position: SplitPosition) => {
      if (!projectId) return
      splitPane(projectId, { tabId, targetPaneId: paneId, position })
    },
    [projectId, splitPane],
  )

  // Tab-strip presentation context: terminal titles from the legacy store.
  const presentation = useMemo<TabPresentationContext>(
    () => ({
      terminalTitles: Object.fromEntries(
        terminalLayout.terminals.map((t) => [t.id, t.title]),
      ),
    }),
    [terminalLayout.terminals],
  )

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
      if (!projectId) return

      const tab = collectPanes(getPaneLayout(projectId).root)
        .flatMap((pane) => pane.tabs)
        .find((candidate) => candidate.tabId === tabId)

      if (tab?.target.kind === "terminal") {
        handleRemoveTerminal(projectId, tab.target.terminalId)
        return
      }
      if (tab?.target.kind === "changes") {
        toggleRightSidebar(projectId)
        return
      }

      closeTab(projectId, tabId)
    },
    [projectId, closeTab, getPaneLayout, handleRemoveTerminal, toggleRightSidebar],
  )
  useEffect(() => {
    function handleGlobalKeydown(event: KeyboardEvent) {
      if (!projectId) return
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
      switch (command.kind) {
        case "focus":
          focusAdjacentPane(projectId, command.direction)
          return
        case "split":
          splitFocusedPane(projectId, command.position)
          return
        case "closeTab":
          closeFocusedTab(projectId)
          return
        case "cycleTab":
          cycleFocusedPaneTab(projectId, command.delta)
      }
    }

    return dom.addWindowListener("keydown", handleGlobalKeydown)
  }, [addTerminal, closeFocusedTab, cycleFocusedPaneTab, dom, focusAdjacentPane, handleOpenExternal, handleToggleEmbeddedTerminal, handleToggleRightSidebar, projectId, resolvedKeybindings, splitFocusedPane])

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

  // ─── Registry ────────────────────────────────────────────────────────────────

  const registry: PaneContentRegistry = {
    // Each chat tab gets its own ChatTabScopedStore.Provider via ChatTabRoot so
    // composer state, scroll position, etc. are independent per tab.
    chat: () => (
      <ChatTabRoot>
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
    terminal: (target, _pane, isFocused) =>
      projectId === null ? null : (
        <TerminalWorkspaceShell
          projectId={projectId}
          terminalLayout={{
            ...terminalLayout,
            terminals: terminalLayout.terminals.filter((t) => t.id === target.terminalId),
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
      ),
  }

  // ─── Layout ──────────────────────────────────────────────────────────────────

  return (
    <div ref={layoutRootRef} className={CHAT_PAGE_LAYOUT_ROOT_CLASS}>
      {projectId ? (
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
        // No project selected — render the chat card directly (no pane shell).
        // Still wrapped in ChatTabRoot so ChatTabScopedStore.useScopedStore()
        // calls inside ChatTabContent don't crash.
        <ChatTabRoot>
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
