import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, type DragEvent } from "react"
import { turnDurationsFromMessages } from "../../lib/reduction"
import type { DomPort } from "../../ports/domPort"
import type { TimerPort } from "../../ports/timerPort"
import { type LegendListRef } from "@legendapp/list/react"
import { useNavigate } from "react-router-dom"
import { ChatInput, type ChatInputHandle } from "../../components/chat-ui/ChatInput"
import { ChatNavbar } from "../../components/chat-ui/ChatNavbar"
import { Card, CardContent } from "../../components/ui/card"
import { computeSessionTotals, deriveLatestContextWindowSnapshot } from "../../lib/contextWindow"
import { getResolvedKeybindings } from "../../lib/keybindings"
import {
  DEFAULT_RIGHT_SIDEBAR_VISIBILITY_STATE,
  useRightSidebarStore,
} from "../../stores/rightSidebarStore"
import { DEFAULT_PROJECT_TERMINAL_LAYOUT, useTerminalLayoutStore } from "../../stores/terminalLayoutStore"
import { selectEditorCommandTemplate, selectEditorPreset, useAppSettingsStore } from "../../stores/appSettingsStore"
import { TERMINAL_TOGGLE_ANIMATION_DURATION_MS } from "../terminalToggleAnimation"
import { useStickyChatFocus } from "../useStickyChatFocus"
import { usePushFocus } from "../usePushFocus"
import { getNextMeasuredInputHeight, getTranscriptPaddingBottom } from "../useKannaState"
import { useChatTabState } from "./ChatTabRoot"
import { EMPTY_CRON_JOBS, EMPTY_SCHEDULES } from "../KannaTranscript"
import { findRetryPromptForResult } from "../../lib/retryPrompt"
import { useShareStore } from "../../components/share/share-store"
import type { ShareCommandResult } from "../../../shared/session-share/protocol"
import { ChatTranscriptViewport } from "./ChatTranscriptViewport"
import { TranscriptActionsProvider, type TranscriptActionsContextValue } from "../transcriptActionsContext"
import { hasFileDragTypes, EMPTY_STATE_TEXT, EMPTY_STATE_TYPING_INTERVAL_MS } from "./utils"
import { useWorkflowsStore, selectRuns } from "../../stores/workflowsStore"
import { useShallow } from "zustand/react/shallow"
import type { WorkflowRun } from "../../../shared/workflow-types"
import type { SubagentRunSnapshot, TranscriptEntry } from "../../../shared/types"
import { useChatPageStore } from "../../stores/chatPageStore"
import { ChatTabScopedStore } from "../../stores/chatTabScopedStore"
import { useKannaStateStore } from "../../stores/kannaStateStore"

const EMPTY_MUTED_CHAT_IDS: string[] = []
const EMPTY_SUBAGENT_RUNS: Record<string, SubagentRunSnapshot> = {}


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


export interface ChatTabContentProps {
  timer: TimerPort
  dom: DomPort
  onToggleEmbeddedTerminal: () => void
  onToggleRightSidebar: () => void
}

export function ChatTabContent({
  timer,
  dom,
  onToggleEmbeddedTerminal,
  onToggleRightSidebar,
}: ChatTabContentProps) {
  const state = useChatTabState()

  const transcriptListRef = useRef<LegendListRef | null>(null)
  const isAtEndRef = useRef(true)
  const showScrollTimeoutRef = useRef<number | null>(null)
  const chatCardRef = useRef<HTMLDivElement>(null)
  const chatInputElementRef = useRef<HTMLTextAreaElement>(null)
  const chatInputRef = useRef<ChatInputHandle | null>(null)

  const { inputRef, syncInputHeight, transcriptPaddingBottom } = useTranscriptPaddingBottom()
  const showScrollToBottom = ChatTabScopedStore.useScopedStore((s) => s.showScrollToBottom)
  const setShowScrollToBottom = ChatTabScopedStore.useScopedStore((s) => s.setShowScrollToBottom)
  const setToolGroupExpanded = ChatTabScopedStore.useScopedStore((s) => s.setToolGroupExpanded)

  const handleToolGroupExpandedChange = useCallback((groupId: string, next: boolean) => {
    setToolGroupExpanded((current) => (
      current[groupId] === next
        ? current
        : { ...current, [groupId]: next }
    ))
  }, [setToolGroupExpanded])

  const navigate = useNavigate()
  const handleOpenPtyChat = useCallback((chatId: string) => {
    navigate(`/chat/${chatId}`)
  }, [navigate])

  const projectId = state.activeProjectId
  const projectTerminalLayout = useTerminalLayoutStore((store) => (projectId ? store.projects[projectId] : undefined))
  const terminalLayout = projectTerminalLayout ?? DEFAULT_PROJECT_TERMINAL_LAYOUT
  const projectRightSidebarVisibility = useRightSidebarStore((store) => (projectId ? store.projects[projectId] : undefined))
  const rightSidebarVisibility = projectRightSidebarVisibility ?? DEFAULT_RIGHT_SIDEBAR_VISIBILITY_STATE
  const editorPreset = useAppSettingsStore(selectEditorPreset)
  const editorCommandTemplate = useAppSettingsStore(selectEditorCommandTemplate)

  const hasTerminals = terminalLayout.terminals.length > 0
  const showTerminalPane = Boolean(projectId && terminalLayout.isVisible && hasTerminals)
  const showRightSidebar = Boolean(projectId && rightSidebarVisibility.isVisible)

  const resolvedKeybindings = useMemo(() => getResolvedKeybindings(state.keybindings), [state.keybindings])
  const contextWindowSnapshot = useMemo(
    () => deriveLatestContextWindowSnapshot(state.chatSnapshot?.messages ?? []),
    [state.chatSnapshot?.messages],
  )
  const sessionTotals = useMemo(
    () => computeSessionTotals(
      state.chatSnapshot?.messages ?? [],
      Object.values(state.chatSnapshot?.subagentRuns ?? {}),
    ),
    [state.chatSnapshot?.messages, state.chatSnapshot?.subagentRuns],
  )

  const turnDurationsMs = useMemo(
    () => turnDurationsFromMessages(state.messages),
    [state.messages],
  )

  const showEmptyState = state.messages.length === 0 && state.runtime?.title === "New Chat"


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
    const listState = transcriptListRef.current?.getState?.()
    if (listState) {
      onIsAtEndChange(listState.isAtEnd)
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

  const retryContextRef = useRef({ messages: state.messages, submit: handleChatSubmit })
  useEffect(() => {
    retryContextRef.current = { messages: state.messages, submit: handleChatSubmit }
  }, [state.messages, handleChatSubmit])

  const handleRetryFailedTurn = useCallback(async (resultMessageId: string) => {
    const { messages, submit } = retryContextRef.current
    const prompt = findRetryPromptForResult(messages, resultMessageId)
    if (!prompt) return
    await submit(prompt.content, { attachments: prompt.attachments })
  }, [])


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

  const handleCronRemove = useCallback((jobId: string) => {
    const chatId = state.activeChatId
    if (!chatId) return
    void state.socket.command({ type: "cron.remove", chatId, jobId }).catch(() => {})
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


  const transcriptActionsValue = useMemo<TranscriptActionsContextValue>(() => ({
    onAskUserQuestionSubmit: state.handleAskUserQuestion,
    onExitPlanModeConfirm: state.handleExitPlanMode,
    onToolRequestAnswer: state.handleToolRequestAnswer,
    onAutoContinueAccept: handleAutoContinueAccept,
    onAutoContinueReschedule: handleAutoContinueReschedule,
    onAutoContinueCancel: handleAutoContinueCancel,
    onRetryFailedTurn: handleRetryFailedTurn,
    onCronRemove: handleCronRemove,
    schedules: state.chatSnapshot?.schedules ?? EMPTY_SCHEDULES,
    cronJobs: state.chatSnapshot?.cronJobs ?? EMPTY_CRON_JOBS,
    chatId: state.activeChatId ?? undefined,
    onToolGroupExpandedChange: handleToolGroupExpandedChange,
    onSubagentAskUserQuestionSubmit: state.handleSubagentAskUserQuestion,
    onSubagentExitPlanModeSubmit: state.handleSubagentExitPlanMode,
    subagentRuns: state.chatSnapshot?.subagentRuns ?? EMPTY_SUBAGENT_RUNS,
    editorPreset,
    editorCommandTemplate,
    onCancelSubagentRun: handleCancelSubagentRun,
    getSubagentTranscript: handleGetSubagentTranscript,
    platform: state.localProjects?.machine.platform ?? "darwin",
    tunnels: state.chatSnapshot?.tunnels,
    liveTunnelId: state.chatSnapshot?.liveTunnelId,
    onTunnelAccept: sendTunnelAccept,
    onTunnelStop: sendTunnelStop,
    onTunnelRetry: sendTunnelRetry,
    queuedMessages: state.queuedMessages,
    runtimeStatus: state.runtimeStatus,
    isDraining: state.isDraining,
    commandError: state.commandError,
    onStopDraining: state.handleStopDraining,
    onSteerQueuedMessage: state.handleSteerQueuedMessage,
    onRemoveQueuedMessage: state.handleRemoveQueuedMessage,
    loopProgress: state.chatSnapshot?.loopProgress,
    workflowRuns: workflowRuns.length > 0 ? workflowRuns : undefined,
    backgroundTasks: state.runtime?.backgroundTasks,
    getWorkflowRunDetail: handleGetWorkflowRunDetail,
    localPath: state.runtime?.localPath,
    latestToolIds: state.latestToolIds,
    isProcessing: state.isProcessing,
  }), [
    state.handleAskUserQuestion,
    state.handleExitPlanMode,
    state.handleToolRequestAnswer,
    handleAutoContinueAccept,
    handleAutoContinueReschedule,
    handleAutoContinueCancel,
    handleRetryFailedTurn,
    handleCronRemove,
    state.chatSnapshot?.schedules,
    state.chatSnapshot?.cronJobs,
    state.activeChatId,
    handleToolGroupExpandedChange,
    state.handleSubagentAskUserQuestion,
    state.handleSubagentExitPlanMode,
    state.chatSnapshot?.subagentRuns,
    editorPreset,
    editorCommandTemplate,
    handleCancelSubagentRun,
    handleGetSubagentTranscript,
    state.localProjects?.machine.platform,
    state.chatSnapshot?.tunnels,
    state.chatSnapshot?.liveTunnelId,
    sendTunnelAccept,
    sendTunnelStop,
    sendTunnelRetry,
    state.queuedMessages,
    state.runtimeStatus,
    state.isDraining,
    state.commandError,
    state.handleStopDraining,
    state.handleSteerQueuedMessage,
    state.handleRemoveQueuedMessage,
    state.chatSnapshot?.loopProgress,
    workflowRuns,
    state.runtime?.backgroundTasks,
    handleGetWorkflowRunDetail,
    state.runtime?.localPath,
    state.latestToolIds,
    state.isProcessing,
  ])


  const mutedChatIds = useKannaStateStore((s) => s.pushConfig?.preferences.mutedChatIds ?? EMPTY_MUTED_CHAT_IDS)
  const isSilent = state.activeChatId != null && mutedChatIds.includes(state.activeChatId)
  const handleToggleSilent = useCallback(() => {
    const chatId = state.activeChatId
    if (!chatId) return
    void state.socket.command({ type: "push.setChatMute", chatId, muted: !isSilent }).catch(() => {})
  }, [state.activeChatId, state.socket, isSilent])


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


  useStickyChatFocus({
    rootRef: chatCardRef,
    fallbackRef: chatInputElementRef,
    enabled: state.hasSelectedProject,
    canCancel: state.canCancel,
  })

  usePushFocus({ socket: state.socket, activeChatId: state.activeChatId })

  const enqueueDroppedFiles = useCallback((files: File[]) => {
    if (!state.hasSelectedProject || files.length === 0) return
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

  const { typedEmptyStateText, isEmptyStateTypingComplete } = useEmptyStateTyping(showEmptyState, state.activeChatId, timer)


  useEffect(() => {
    return () => clearShowScrollTimeout()
  }, [clearShowScrollTimeout])

  useEffect(() => {
    isAtEndRef.current = true
    clearShowScrollTimeout()
    setShowScrollToBottom(false)
  }, [clearShowScrollTimeout, setShowScrollToBottom, state.activeChatId])

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
    if (!isAtEndRef.current) return

    let secondFrame: number | null = null
    const firstFrame = timer.requestAnimationFrame(() => {
      void transcriptListRef.current?.scrollToEnd?.({ animated: false })
      secondFrame = timer.requestAnimationFrame(() => {
        void transcriptListRef.current?.scrollToEnd?.({ animated: false })
      })
    })

    return () => {
      timer.cancelAnimationFrame(firstFrame)
      if (secondFrame !== null) timer.cancelAnimationFrame(secondFrame)
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


  return (
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
          turnDurationsMs={turnDurationsMs}
          sidebarCollapsed={state.sidebarCollapsed}
          onOpenSidebar={state.openSidebar}
          onExpandSidebar={state.expandSidebar}
          onNewChat={state.handleCompose}
          localPath={state.navbarLocalPath}
          embeddedTerminalVisible={showTerminalPane}
          onToggleEmbeddedTerminal={projectId ? onToggleEmbeddedTerminal : undefined}
          rightSidebarVisible={showRightSidebar}
          onToggleRightSidebar={projectId ? onToggleRightSidebar : undefined}
          onOpenExternal={state.handleOpenExternal}
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
          silent={isSilent}
          onToggleSilent={handleToggleSilent}
        />
        <TranscriptActionsProvider value={transcriptActionsValue}>
          <ChatTranscriptViewport
            activeChatId={state.activeChatId}
            listRef={transcriptListRef}
            messages={state.messages}
            transcriptPaddingBottom={transcriptPaddingBottom}
            isHistoryLoading={state.isHistoryLoading}
            hasOlderHistory={state.hasOlderHistory}
            loadOlderHistory={state.loadOlderHistory}
            onOpenLocalLink={state.handleOpenLocalLink}
            showScrollButton={showScrollToBottom && state.messages.length > 0}
            onIsAtEndChange={onIsAtEndChange}
            scrollToBottom={() => scrollToTranscriptEnd(true)}
            typedEmptyStateText={typedEmptyStateText}
            isEmptyStateTypingComplete={isEmptyStateTypingComplete}
            isPageFileDragActive={isPageFileDragActive}
            showEmptyState={showEmptyState}
          />
        </TranscriptActionsProvider>
      </CardContent>

      <div className="absolute bottom-0 left-0 right-0 z-20 pointer-events-none">
        <div className="bg-gradient-to-t from-background via-background pointer-events-auto" ref={inputRef}>
          <ChatInput
            ref={chatInputRef}
            inputElementRef={chatInputElementRef}
            onLayoutChange={syncInputHeight}
            key={state.activeChatId ?? "new-chat"}
            onSubmit={handleChatSubmit}
            onCancel={state.handleCancel}
            disabled={!state.hasSelectedProject}
            canCancel={state.canCancel}
            chatId={state.activeChatId}
            projectId={projectId}
            activeProvider={state.runtime?.provider ?? null}
            availableProviders={state.availableProviders}
            contextWindowSnapshot={contextWindowSnapshot}
            sessionTotals={sessionTotals}
            previousPrompt={state.previousPrompt}
            hasUnpausedCronJob={(state.chatSnapshot?.cronJobs ?? EMPTY_CRON_JOBS).some((j) => !j.paused)}
          />
        </div>
      </div>
    </Card>
  )
}
