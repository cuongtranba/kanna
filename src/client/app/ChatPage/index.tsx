import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, type ComponentProps, type DragEvent, type RefObject } from "react"
import type { DomPort } from "../../ports/domPort"
import type { TimerPort } from "../../ports/timerPort"
import { domAdapter } from "../../adapters/dom.adapter"
import { timerAdapter } from "../../adapters/timer.adapter"
import { isMobileViewport } from "../../lib/viewport"
import { type LegendListRef } from "@legendapp/list/react"
import { useNavigate, useOutletContext } from "react-router-dom"
import type { ChatInputHandle } from "../../components/chat-ui/ChatInput"
import { ChatNavbar } from "../../components/chat-ui/ChatNavbar"
import { RightSidebar } from "../../components/chat-ui/RightSidebar"
import { useAppDialog } from "../../components/ui/app-dialog"
import { Card, CardContent } from "../../components/ui/card"
import { actionMatchesEvent, getResolvedKeybindings } from "../../lib/keybindings"
import { computeSessionTotals, deriveLatestContextWindowSnapshot } from "../../lib/contextWindow"
import {
  DEFAULT_RIGHT_SIDEBAR_SIZE,
  DEFAULT_RIGHT_SIDEBAR_VISIBILITY_STATE,
  useRightSidebarStore,
} from "../../stores/rightSidebarStore"
import { useChatPageStore } from "../../stores/chatPageStore"
import { ChatTabScopedStore } from "../../stores/chatTabScopedStore"
import { DEFAULT_PROJECT_TERMINAL_LAYOUT, useTerminalLayoutStore } from "../../stores/terminalLayoutStore"
import { useTerminalPreferencesStore } from "../../stores/terminalPreferencesStore"
import { TERMINAL_TOGGLE_ANIMATION_DURATION_MS } from "../terminalToggleAnimation"
import { usePushFocus } from "../usePushFocus"
import { useStickyChatFocus } from "../useStickyChatFocus"
import type { KannaState } from "../useKannaState"
import { getNextMeasuredInputHeight, getTranscriptPaddingBottom } from "../useKannaState"
import { EMPTY_SCHEDULES } from "../KannaTranscript"
import { useShareStore } from "../../components/share/share-store"
import type { ShareCommandResult } from "../../../shared/session-share/protocol"
import { ChatInputDock } from "./ChatInputDock"
import { ChatTranscriptViewport } from "./ChatTranscriptViewport"
import { TerminalWorkspaceShell } from "./TerminalWorkspaceShell"
import { useChatPageSidebarActions, EMPTY_DIFF_SNAPSHOT } from "./useChatPageSidebarActions"
import {
  EMPTY_STATE_TEXT,
  EMPTY_STATE_TYPING_INTERVAL_MS,
  hasFileDragTypes,
} from "./utils"
import { useWorkflowsStore, selectRuns } from "../../stores/workflowsStore"
import { useShallow } from "zustand/react/shallow"
import type { WorkflowRun } from "../../../shared/workflow-types"
import type { TranscriptEntry } from "../../../shared/types"
import { collectPanes, createDefaultLayout, type PaneLayout, type SplitPosition } from "../../lib/paneTree"
import { usePaneLayoutStore } from "../../stores/paneLayoutStore"
import { SplitContainer } from "../../components/panes/SplitContainer"
import { PaneShell, type SplitArgs } from "../../components/panes/PaneShell"
import { isTypingTarget, resolvePaneCommand } from "../../components/panes/paneKeyboard"
import { PaneDndProvider } from "../../components/panes/PaneDndProvider"
import type { PaneContentRegistry } from "../../components/panes/paneContentRegistry"
import type { TabPresentationContext } from "../../components/panes/tabPresentation"

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

function useEmptyStateTyping(showEmptyState: boolean, activeChatId: string | null, timer: TimerPort) {
  const typedEmptyStateText = useChatPageStore((s) => s.typedEmptyStateText)
  const isEmptyStateTypingComplete = useChatPageStore((s) => s.isEmptyStateTypingComplete)
  const setTypedEmptyStateText = useChatPageStore((s) => s.setTypedEmptyStateText)
  const setIsEmptyStateTypingComplete = useChatPageStore((s) => s.setIsEmptyStateTypingComplete)
  const resetEmptyStateTyping = useChatPageStore((s) => s.resetEmptyStateTyping)

  useEffect(() => {
    if (!showEmptyState) return

    resetEmptyStateTyping()

    let characterIndex = 0
    const interval = timer.setInterval(() => {
      characterIndex += 1
      setTypedEmptyStateText(EMPTY_STATE_TEXT.slice(0, characterIndex))

      if (characterIndex >= EMPTY_STATE_TEXT.length) {
        timer.clearInterval(interval)
        setIsEmptyStateTypingComplete(true)
      }
    }, EMPTY_STATE_TYPING_INTERVAL_MS)

    return () => timer.clearInterval(interval)
  }, [showEmptyState, activeChatId, resetEmptyStateTyping, setTypedEmptyStateText, setIsEmptyStateTypingComplete, timer])

  return { typedEmptyStateText, isEmptyStateTypingComplete }
}

function usePageFileDrop(args: {
  hasSelectedProject: boolean
  onFilesDropped: (files: File[]) => void
}) {
  const isPageFileDragActive = useChatPageStore((s) => s.isPageFileDragActive)
  const setIsPageFileDragActive = useChatPageStore((s) => s.setIsPageFileDragActive)
  const pageFileDragDepthRef = useRef(0)

  const hasDraggedFiles = useCallback((event: DragEvent) => hasFileDragTypes(event.dataTransfer?.types ?? []), [])

  const handleTranscriptDragEnter = useCallback((event: DragEvent) => {
    if (!hasDraggedFiles(event) || !args.hasSelectedProject) return
    event.preventDefault()
    pageFileDragDepthRef.current += 1
    setIsPageFileDragActive(true)
  }, [args.hasSelectedProject, hasDraggedFiles, setIsPageFileDragActive])

  const handleTranscriptDragOver = useCallback((event: DragEvent) => {
    if (!hasDraggedFiles(event) || !args.hasSelectedProject) return
    event.preventDefault()
    event.dataTransfer.dropEffect = "copy"
    if (!isPageFileDragActive) {
      setIsPageFileDragActive(true)
    }
  }, [args.hasSelectedProject, hasDraggedFiles, isPageFileDragActive, setIsPageFileDragActive])

  const handleTranscriptDragLeave = useCallback((event: DragEvent) => {
    if (!hasDraggedFiles(event) || !args.hasSelectedProject) return
    event.preventDefault()
    pageFileDragDepthRef.current = Math.max(0, pageFileDragDepthRef.current - 1)
    if (pageFileDragDepthRef.current === 0) {
      setIsPageFileDragActive(false)
    }
  }, [args.hasSelectedProject, hasDraggedFiles, setIsPageFileDragActive])

  const handleTranscriptDrop = useCallback((event: DragEvent) => {
    if (!hasDraggedFiles(event) || !args.hasSelectedProject) return
    event.preventDefault()
    pageFileDragDepthRef.current = 0
    setIsPageFileDragActive(false)
    args.onFilesDropped([...event.dataTransfer.files])
  }, [args, hasDraggedFiles, setIsPageFileDragActive])

  return {
    isPageFileDragActive,
    handleTranscriptDragEnter,
    handleTranscriptDragOver,
    handleTranscriptDragLeave,
    handleTranscriptDrop,
  }
}

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

function useTranscriptPaddingBottom() {
  const inputRef = useRef<HTMLDivElement>(null)
  const inputHeight = ChatTabScopedStore.useScopedStore((s) => s.inputHeight)
  const setInputHeight = ChatTabScopedStore.useScopedStore((s) => s.setInputHeight)
  const chatTabStoreApi = ChatTabScopedStore.useScopedStoreApi()

  const syncInputHeight = useCallback(() => {
    const element = inputRef.current
    if (!element) return
    const measuredHeight = element.getBoundingClientRect().height
    const current = chatTabStoreApi.getState().inputHeight
    const next = getNextMeasuredInputHeight(current, measuredHeight)
    if (next !== current) {
      setInputHeight(next)
    }
  }, [setInputHeight, chatTabStoreApi])

  useLayoutEffect(() => {
    const element = inputRef.current
    if (!element) return

    const observer = new ResizeObserver(() => {
      syncInputHeight()
    })
    observer.observe(element)
    syncInputHeight()
    return () => observer.disconnect()
  }, [syncInputHeight])

  return {
    inputRef,
    syncInputHeight,
    transcriptPaddingBottom: getTranscriptPaddingBottom(inputHeight),
  }
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
  const { handleCancel, handleOpenExternal } = state
  const dialog = useAppDialog()
  const layoutRootRef = useRef<HTMLDivElement>(null)
  const transcriptListRef = useRef<LegendListRef | null>(null)
  const isAtEndRef = useRef(true)
  const showScrollTimeoutRef = useRef<number | null>(null)
  const chatCardRef = useRef<HTMLDivElement>(null)
  const chatInputElementRef = useRef<HTMLTextAreaElement>(null)
  const chatInputRef = useRef<ChatInputHandle | null>(null)
  const { inputRef, syncInputHeight, transcriptPaddingBottom } = useTranscriptPaddingBottom()
  const showScrollToBottom = ChatTabScopedStore.useScopedStore((s) => s.showScrollToBottom)
  const setShowScrollToBottom = ChatTabScopedStore.useScopedStore((s) => s.setShowScrollToBottom)
  const navigate = useNavigate()
  const handleOpenPtyChat = useCallback((chatId: string) => {
    navigate(`/chat/${chatId}`)
  }, [navigate])
  const showEmptyState = state.messages.length === 0 && state.runtime?.title === "New Chat"
  const projectId = state.activeProjectId
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
  const editorPreset = useTerminalPreferencesStore((store) => store.editorPreset)
  const editorCommandTemplate = useTerminalPreferencesStore((store) => store.editorCommandTemplate)
  const resolvedKeybindings = useMemo(() => getResolvedKeybindings(state.keybindings), [state.keybindings])
  const contextWindowSnapshot = useMemo(
    () => deriveLatestContextWindowSnapshot(state.chatSnapshot?.messages ?? []),
    [state.chatSnapshot?.messages]
  )
  const sessionTotals = useMemo(
    () => computeSessionTotals(
      state.chatSnapshot?.messages ?? [],
      Object.values(state.chatSnapshot?.subagentRuns ?? {}),
    ),
    [state.chatSnapshot?.messages, state.chatSnapshot?.subagentRuns],
  )

  const hasTerminals = terminalLayout.terminals.length > 0
  const showTerminalPane = Boolean(projectId && terminalLayout.isVisible && hasTerminals)
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

  const { typedEmptyStateText, isEmptyStateTypingComplete } = useEmptyStateTyping(showEmptyState, state.activeChatId, timer)

  useStickyChatFocus({
    rootRef: chatCardRef,
    fallbackRef: chatInputElementRef,
    enabled: state.hasSelectedProject,
    canCancel: state.canCancel,
  })

  usePushFocus({ socket: state.socket, activeChatId: state.activeChatId })

  const enqueueDroppedFiles = useCallback((files: File[]) => {
    if (!state.hasSelectedProject || files.length === 0) {
      return
    }
    chatInputRef.current?.enqueueFiles(files)
  }, [state.hasSelectedProject])

  const {
    isPageFileDragActive,
    handleTranscriptDragEnter,
    handleTranscriptDragOver,
    handleTranscriptDragLeave,
    handleTranscriptDrop,
  } = usePageFileDrop({
    hasSelectedProject: state.hasSelectedProject,
    onFilesDropped: enqueueDroppedFiles,
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
  const clearShowScrollTimeout = useCallback(() => {
    if (showScrollTimeoutRef.current !== null) {
      timer.clearTimeout(showScrollTimeoutRef.current)
      showScrollTimeoutRef.current = null
    }
  }, [timer])

  const onIsAtEndChange = useCallback((isAtEnd: boolean) => {
    if (isAtEndRef.current === isAtEnd) return
    isAtEndRef.current = isAtEnd
    if (isAtEnd) {
      clearShowScrollTimeout()
      setShowScrollToBottom(false)
      return
    }

    clearShowScrollTimeout()
    showScrollTimeoutRef.current = timer.setTimeout(() => {
      setShowScrollToBottom(true)
      showScrollTimeoutRef.current = null
    }, 150)
  }, [clearShowScrollTimeout, setShowScrollToBottom, timer])

  const syncIsAtEndFromList = useCallback(() => {
    const state = transcriptListRef.current?.getState?.()
    if (state) {
      onIsAtEndChange(state.isAtEnd)
    }
  }, [onIsAtEndChange])

  const scrollToTranscriptEnd = useCallback(async (animated = true) => {
    isAtEndRef.current = true
    clearShowScrollTimeout()
    setShowScrollToBottom(false)
    await transcriptListRef.current?.scrollToEnd?.({ animated })
  }, [clearShowScrollTimeout, setShowScrollToBottom])

  const handleChatSubmit = useCallback(async (
    content: string,
    options?: Parameters<typeof state.handleSend>[1],
  ) => {
    await scrollToTranscriptEnd(false)
    await state.handleSend(content, options)
  }, [scrollToTranscriptEnd, state])

  const handleAutoContinueAccept = useCallback((scheduleId: string, scheduledAt: number) => {
    const chatId = state.activeChatId
    if (!chatId) return
    void state.socket.command({ type: "autoContinue.accept", chatId, scheduleId, scheduledAt }).catch(() => {})
  }, [state.activeChatId, state.socket])

  const handleAutoContinueReschedule = useCallback((scheduleId: string, scheduledAt: number) => {
    const chatId = state.activeChatId
    if (!chatId) return
    void state.socket.command({ type: "autoContinue.reschedule", chatId, scheduleId, scheduledAt }).catch(() => {})
  }, [state.activeChatId, state.socket])

  const handleAutoContinueCancel = useCallback((scheduleId: string) => {
    const chatId = state.activeChatId
    if (!chatId) return
    void state.socket.command({ type: "autoContinue.cancel", chatId, scheduleId }).catch(() => {})
  }, [state.activeChatId, state.socket])

  const sendTunnelAccept = useCallback(async (tunnelId: string): Promise<void> => {
    const chatId = state.activeChatId
    if (!chatId) return
    await state.socket.command({ type: "tunnel.accept", chatId, tunnelId })
  }, [state.activeChatId, state.socket])

  const sendTunnelStop = useCallback(async (tunnelId: string): Promise<void> => {
    const chatId = state.activeChatId
    if (!chatId) return
    await state.socket.command({ type: "tunnel.stop", chatId, tunnelId })
  }, [state.activeChatId, state.socket])

  const sendTunnelRetry = useCallback(async (tunnelId: string): Promise<void> => {
    const chatId = state.activeChatId
    if (!chatId) return
    await state.socket.command({ type: "tunnel.retry", chatId, tunnelId })
  }, [state.activeChatId, state.socket])

  const handleCancelSubagentRun = useCallback((chatId: string, runId: string) => {
    void state.socket.command({ type: "chat.cancelSubagentRun", chatId, runId }).catch(() => {})
  }, [state.socket])

  const workflowRuns = useWorkflowsStore(useShallow(selectRuns(state.activeChatId ?? "")))

  const handleGetWorkflowRunDetail = useCallback(async (runId: string): Promise<WorkflowRun | null> => {
    const chatId = state.activeChatId
    if (!chatId) return null
    return state.socket.command<WorkflowRun | null>({ type: "workflows.getRun", chatId, runId })
  }, [state.activeChatId, state.socket])

  const handleGetSubagentTranscript = useCallback(async (agentId: string): Promise<TranscriptEntry[]> => {
    const chatId = state.activeChatId
    if (!chatId) return []
    return state.socket.command<TranscriptEntry[]>({ type: "subagents.getRun", chatId, agentId })
  }, [state.activeChatId, state.socket])

  const shareShares = useShareStore((s) => s.listForChat(state.activeChatId ?? ""))
  const addShare = useShareStore((s) => s.addShare)
  const removeShare = useShareStore((s) => s.removeShare)

  const handleShareMint = useCallback(async (chatId: string): Promise<void> => {
    const reply = await state.socket.command<ShareCommandResult>({
      type: "share.mint",
      payload: { chatId },
    })
    if (reply.ok && reply.kind === "mint") {
      addShare(chatId, reply.data.summary)
    }
  }, [addShare, state.socket])

  const handleShareRevoke = useCallback(async (tokenId: string): Promise<void> => {
    const chatId = state.activeChatId
    if (!chatId) return
    const reply = await state.socket.command<ShareCommandResult>({
      type: "share.revoke",
      payload: { tokenId },
    })
    if (reply.ok) {
      removeShare(chatId, tokenId)
    }
  }, [removeShare, state.activeChatId, state.socket])

  useEffect(() => {
    return () => clearShowScrollTimeout()
  }, [clearShowScrollTimeout])

  useEffect(() => {
    isAtEndRef.current = true
    clearShowScrollTimeout()
    setShowScrollToBottom(false)
  }, [clearShowScrollTimeout, setShowScrollToBottom, state.activeChatId])

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

  useEffect(() => {
    const frameId = timer.requestAnimationFrame(() => {
      syncIsAtEndFromList()
    })
    const timeoutId = timer.setTimeout(() => {
      syncIsAtEndFromList()
    }, TERMINAL_TOGGLE_ANIMATION_DURATION_MS)

    return () => {
      timer.cancelAnimationFrame(frameId)
      timer.clearTimeout(timeoutId)
    }
  }, [showTerminalPane, syncIsAtEndFromList, timer])

  useEffect(() => {
    return dom.addWindowListener("resize", () => {
      syncIsAtEndFromList()
    })
  }, [dom, syncIsAtEndFromList])

  useEffect(() => {
    if (!isAtEndRef.current) {
      return
    }

    let secondFrame: number | null = null
    const firstFrame = timer.requestAnimationFrame(() => {
      void transcriptListRef.current?.scrollToEnd?.({ animated: false })
      secondFrame = timer.requestAnimationFrame(() => {
        void transcriptListRef.current?.scrollToEnd?.({ animated: false })
      })
    })

    return () => {
      timer.cancelAnimationFrame(firstFrame)
      if (secondFrame !== null) {
        timer.cancelAnimationFrame(secondFrame)
      }
    }
  }, [
    state.commandError,
    state.isDraining,
    state.isProcessing,
    state.messages.length,
    state.queuedMessages.length,
    state.runtimeStatus,
    timer,
  ])

  // ─── Content registry ────────────────────────────────────────────────────────

  const rightSidebarContentProps = useMemo<ComponentProps<typeof ChatSidebarContent> | null>(() => {
    if (!projectId) {
      return null
    }

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

  // ─── Chat card ───────────────────────────────────────────────────────────────

  const chatCard = (
    <Card
      ref={chatCardRef}
      className="bg-background h-full flex flex-col overflow-hidden border-0 rounded-none relative"
      onDragEnter={handleTranscriptDragEnter}
      onDragOver={handleTranscriptDragOver}
      onDragLeave={handleTranscriptDragLeave}
      onDrop={handleTranscriptDrop}
    >
      <CardContent className="flex flex-1 min-h-0 flex-col overflow-hidden p-0 relative">
        <ChatNavbar
          sidebarCollapsed={state.sidebarCollapsed}
          onOpenSidebar={state.openSidebar}
          onExpandSidebar={state.expandSidebar}
          onNewChat={state.handleCompose}
          localPath={state.navbarLocalPath}
          embeddedTerminalVisible={showTerminalPane}
          onToggleEmbeddedTerminal={projectId ? handleToggleEmbeddedTerminal : undefined}
          rightSidebarVisible={showRightSidebar}
          onToggleRightSidebar={projectId ? handleToggleRightSidebar : undefined}
          onOpenExternal={handleOpenExternal}
          editorPreset={editorPreset}
          editorCommandTemplate={editorCommandTemplate}
          platform={state.localProjects?.machine.platform}
          finderShortcut={resolvedKeybindings.bindings.openInFinder}
          editorShortcut={resolvedKeybindings.bindings.openInEditor}
          terminalShortcut={resolvedKeybindings.bindings.toggleEmbeddedTerminal}
          rightSidebarShortcut={resolvedKeybindings.bindings.toggleRightSidebar}
          branchName={state.chatDiffSnapshot?.branchName}
          homeDir={state.localProjects?.machine.homeDir}
          hasGitRepo={state.chatDiffSnapshot?.status !== "no_repo"}
          gitStatus={state.chatDiffSnapshot?.status}
          timings={state.runtime?.timings}
          status={state.runtime?.status}
          socket={state.socket}
          onOpenPtyChat={handleOpenPtyChat}
          currentChatId={state.activeChatId ?? undefined}
          shareShares={shareShares}
          onShareMint={handleShareMint}
          onShareRevoke={handleShareRevoke}
        />
        <ChatTranscriptViewport
          activeChatId={state.activeChatId}
          listRef={transcriptListRef}
          messages={state.messages}
          queuedMessages={state.queuedMessages}
          transcriptPaddingBottom={transcriptPaddingBottom}
          localPath={state.runtime?.localPath}
          latestToolIds={state.latestToolIds}
          isHistoryLoading={state.isHistoryLoading}
          hasOlderHistory={state.hasOlderHistory}
          isProcessing={state.isProcessing}
          runtimeStatus={state.runtimeStatus}
          isDraining={state.isDraining}
          commandError={state.commandError}
          loadOlderHistory={state.loadOlderHistory}
          onStopDraining={state.handleStopDraining}
          onSteerQueuedMessage={state.handleSteerQueuedMessage}
          onRemoveQueuedMessage={state.handleRemoveQueuedMessage}
          onOpenLocalLink={state.handleOpenLocalLink}
          editorPreset={editorPreset}
          editorCommandTemplate={editorCommandTemplate}
          platform={state.localProjects?.machine.platform}
          onAskUserQuestionSubmit={state.handleAskUserQuestion}
          onExitPlanModeConfirm={state.handleExitPlanMode}
          onToolRequestAnswer={state.handleToolRequestAnswer}
          onSubagentAskUserQuestionSubmit={state.handleSubagentAskUserQuestion}
          onSubagentExitPlanModeSubmit={state.handleSubagentExitPlanMode}
          schedules={state.chatSnapshot?.schedules ?? EMPTY_SCHEDULES}
          onAutoContinueAccept={handleAutoContinueAccept}
          onAutoContinueReschedule={handleAutoContinueReschedule}
          onAutoContinueCancel={handleAutoContinueCancel}
          tunnels={state.chatSnapshot?.tunnels}
          liveTunnelId={state.chatSnapshot?.liveTunnelId}
          onTunnelAccept={sendTunnelAccept}
          onTunnelStop={sendTunnelStop}
          onTunnelRetry={sendTunnelRetry}
          subagentRuns={state.chatSnapshot?.subagentRuns}
          onCancelSubagentRun={handleCancelSubagentRun}
          loopProgress={state.chatSnapshot?.loopProgress}
          workflowRuns={workflowRuns.length > 0 ? workflowRuns : undefined}
          backgroundTasks={state.runtime?.backgroundTasks}
          getWorkflowRunDetail={handleGetWorkflowRunDetail}
          getSubagentTranscript={handleGetSubagentTranscript}
          showScrollButton={showScrollToBottom && state.messages.length > 0}
          onIsAtEndChange={onIsAtEndChange}
          scrollToBottom={() => scrollToTranscriptEnd(true)}
          typedEmptyStateText={typedEmptyStateText}
          isEmptyStateTypingComplete={isEmptyStateTypingComplete}
          isPageFileDragActive={isPageFileDragActive}
          showEmptyState={showEmptyState}
        />
      </CardContent>

      <ChatInputDock
        inputRef={inputRef}
        onLayoutChange={syncInputHeight}
        chatInputRef={chatInputRef}
        chatInputElementRef={chatInputElementRef}
        activeChatId={state.activeChatId}
        previousPrompt={state.previousPrompt}
        hasSelectedProject={state.hasSelectedProject}
        canCancel={state.canCancel}
        projectId={projectId}
        activeProvider={state.runtime?.provider ?? null}
        availableProviders={state.availableProviders}
        contextWindowSnapshot={contextWindowSnapshot}
        sessionTotals={sessionTotals}
        onSubmit={handleChatSubmit}
        onCancel={handleCancel}
      />
    </Card>
  )

  // ─── Registry ────────────────────────────────────────────────────────────────

  const registry: PaneContentRegistry = {
    chat: () => chatCard,
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
        chatCard
      )}
    </div>
  )
}
