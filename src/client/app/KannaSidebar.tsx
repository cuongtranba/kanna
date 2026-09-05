import { memo, useCallback, useEffect, useMemo, useRef, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react"
import { useShallow } from "zustand/react/shallow"
import { useSidebarSelectionStore } from "../stores/sidebarSelectionStore"
import { FocusScope } from "@radix-ui/react-focus-scope"

/** Returns CSS custom properties as a React-compatible style object via Object.assign. */
function cssVars(vars: Record<`--${string}`, string>): CSSProperties {
  return Object.assign({} satisfies CSSProperties, vars)
}
import { Download, Flower, FoldVertical, PanelLeft, UnfoldVertical, X, Menu, Plus, CheckSquare } from "lucide-react"
import { useLocation, useNavigate } from "react-router-dom"
import { APP_NAME } from "../../shared/branding"
import { Button } from "../components/ui/button"
import { HoverHint } from "../components/ui/truncated-text"
import { SidebarUtilityNav } from "./SidebarUtilityNav"
import { usePluginContributionsStore, selectPluginSidebarItems } from "../stores/pluginContributionsStore"
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../components/ui/dialog"
import { ImportSessionsDialog } from "../components/ImportSessionsDialog"
import { formatSidebarAgeLabel, getPathBasename } from "../lib/formatters"
import { getSidebarChatTimestamp } from "../lib/sidebarChats"
import { cn } from "../lib/utils"
import { SHELL_TOP_BAND_CLASS } from "../lib/shellChrome"
import { ChatRow } from "../components/chat-ui/sidebar/ChatRow"
import { SidebarBulkActionBar } from "../components/chat-ui/sidebar/SidebarBulkActionBar"
import { LocalProjectsSection } from "../components/chat-ui/sidebar/LocalProjectsSection"
import { StacksSection } from "../components/chat-ui/sidebar/StacksSection"
import { StackEditPanels } from "../components/chat-ui/sidebar/StackEditPanels"
import { StackChatCreateRow } from "../components/chat-ui/sidebar/StackChatCreateRow"
import { getResolvedKeybindings } from "../lib/keybindings"
import type { GitWorktree, KeybindingsSnapshot, SidebarData, SidebarChatRow, SidebarProjectGroup, StackBinding, UpdateSnapshot } from "../../shared/types"
import type { SocketStatus } from "./socket"
import {
  getSidebarJumpTargetIndex,
  getSidebarNumberJumpHint,
  getVisibleSidebarChats,
  isSidebarModifierShortcut,
  shouldShowSidebarNumberJumpHints,
} from "./sidebarNumberJump"
import { log } from "../../shared/log"
import {
  useKannaSidebarStore,
  clampSidebarWidth,
  DEFAULT_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  SIDEBAR_CONTENT_MIN_WIDTH,
  SIDEBAR_CONTENT_MIN_WIDTH_SETTINGS,
  resolveSidebarWidth,
} from "../stores/kannaSidebarStore"
import { useViewportStore } from "../stores/viewportStore"
import { useKannaStateStore } from "../stores/kannaStateStore"
import type { DomPort } from "../ports/domPort"
import type { TimerPort } from "../ports/timerPort"
import { domAdapter } from "../adapters/dom.adapter"
import { timerAdapter } from "../adapters/timer.adapter"
import { isMobileViewport } from "../lib/viewport"

export { DEFAULT_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH, clampSidebarWidth }

const EMPTY_MUTED_CHAT_IDS: string[] = []

export interface KannaSidebarPorts {
  dom?: DomPort
  timer?: TimerPort
}

interface KannaSidebarProps {
  data: SidebarData
  activeChatId: string | null
  connectionStatus: SocketStatus
  open: boolean
  collapsed: boolean
  showMobileOpenButton: boolean
  onOpen: () => void
  onClose: () => void
  onCollapse: () => void
  onExpand: () => void
  onCreateChat: (projectId: string) => void | Promise<void>
  onForkChat: (chat: SidebarChatRow) => void | Promise<void>
  currentProjectId: string | null
  keybindings: KeybindingsSnapshot | null
  onRenameChat: (chat: SidebarChatRow) => void | Promise<void>
  onArchiveChat: (chat: SidebarChatRow) => void | Promise<void>
  onOpenArchivedChat: (chatId: string) => void | Promise<void>
  onDeleteChat: (chat: SidebarChatRow) => void | Promise<void>
  onDeleteBulkChats: (chatIds: string[]) => void | Promise<void>
  onEditChatPermissions?: (chatId: string) => void
  onOpenAddProjectModal: () => void | Promise<void>
  onImportClaudeSessions?: () => Promise<void>
  onImportClaudeSessionIds?: (sessionIds: string[]) => Promise<void>
  onCopyPath: (localPath: string) => void | Promise<void>
  onOpenExternalPath: (action: "open_finder" | "open_editor", localPath: string) => void | Promise<void>
  onHideProject: (projectId: string) => void | Promise<void>
  onToggleStar: (projectId: string, starred: boolean) => void | Promise<void>
  onSetProjectInstructions: (projectId: string, instructions: string) => void | Promise<void>
  onReorderProjectGroups: (projectIds: string[]) => void | Promise<void>
  onCreateStack: (title: string, projectIds: string[], instructions?: string) => void
  onRenameStack: (stackId: string, title: string) => void
  onSetStackInstructions: (stackId: string, instructions: string) => void
  onRemoveStack: (stackId: string) => void
  onCreateStackChat: (primaryProjectId: string, stackId: string, stackBindings: StackBinding[]) => void
  onListStackWorktrees: (projectId: string) => Promise<GitWorktree[]>
  editorLabel: string
  updateSnapshot: UpdateSnapshot | null
  ports?: KannaSidebarPorts
}

function KannaSidebarImpl({
  data,
  activeChatId,
  connectionStatus,
  open,
  collapsed,
  showMobileOpenButton,
  onOpen,
  onClose,
  onCollapse,
  onExpand,
  onCreateChat,
  onForkChat,
  currentProjectId,
  keybindings,
  onRenameChat,
  onArchiveChat,
  onOpenArchivedChat,
  onDeleteChat,
  onDeleteBulkChats,
  onEditChatPermissions,
  onOpenAddProjectModal,
  onImportClaudeSessions,
  onImportClaudeSessionIds,
  onCopyPath,
  onOpenExternalPath,
  onHideProject,
  onToggleStar,
  onSetProjectInstructions,
  onReorderProjectGroups,
  onCreateStack,
  onRenameStack,
  onSetStackInstructions,
  onRemoveStack,
  onCreateStackChat,
  onListStackWorktrees,
  editorLabel,
  updateSnapshot,
  ports = {},
}: KannaSidebarProps) {
  const dom = ports.dom ?? domAdapter
  const timer = ports.timer ?? timerAdapter

  const { isSelecting, selectedChatIds, startSelecting, stopSelecting, toggle: toggleSelect, selectAll, clearAll } = useSidebarSelectionStore(useShallow((s) => s))

  const location = useLocation()
  const navigate = useNavigate()
  // The project context menu's only navigating item.
  const handleOpenBoards = useCallback(
    (projectId: string) => {
      navigate(`/boards/${projectId}`)
    },
    [navigate],
  )
  // Mirrors handleOpenBoards, one owner kind over: a Stack row's Boards
  // affordance opens the Stack's own board list, not any one member project's.
  const handleOpenStackBoards = useCallback(
    (stackId: string) => {
      navigate(`/boards/stack/${stackId}`)
    },
    [navigate],
  )
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const resizeStartRef = useRef<{ pointerX: number; width: number } | null>(null)
  const sidebarRestoreFocusRef = useRef<HTMLElement | null>(null)
  const wasMobileModalOpenRef = useRef(false)

  const collapsedSections = useKannaSidebarStore((s) => s.collapsedSections)
  const expandedGroups = useKannaSidebarStore((s) => s.expandedGroups)
  const nowMs = useKannaSidebarStore((s) => s.nowMs)
  const showNumberJumpHints = useKannaSidebarStore((s) => s.showNumberJumpHints)
  // Module-level selector, not an inline `?? []` — see pluginContributionsStore.
  const pluginSidebarItems = usePluginContributionsStore(selectPluginSidebarItems)
  const requestedSidebarWidth = useKannaSidebarStore((s) => s.sidebarWidth)
  const viewportWidth = useViewportStore((s) => s.width)
  const mobileModalOpen = open && isMobileViewport(viewportWidth)
  // Settings is a two-column split, so it needs a wider content minimum than a
  // chat transcript before the sidebar is allowed to take the space.
  const sidebarWidth = resolveSidebarWidth({
    requestedWidth: requestedSidebarWidth,
    viewportWidth,
    contentMinWidth: location.pathname.startsWith("/settings")
      ? SIDEBAR_CONTENT_MIN_WIDTH_SETTINGS
      : SIDEBAR_CONTENT_MIN_WIDTH,
  })
  const isResizingSidebar = useKannaSidebarStore((s) => s.isResizingSidebar)
  const archivedProjectId = useKannaSidebarStore((s) => s.archivedProjectId)
  const expandedStackIds = useKannaSidebarStore((s) => s.expandedStackIds)

  useEffect(() => dom.addDocumentListener("focusin", (event) => {
    if (!mobileModalOpen && event.target instanceof HTMLElement) {
      sidebarRestoreFocusRef.current = event.target
    }
  }), [dom, mobileModalOpen])

  useEffect(() => {
    if (wasMobileModalOpenRef.current && !mobileModalOpen) {
      sidebarRestoreFocusRef.current?.focus()
    }
    wasMobileModalOpenRef.current = mobileModalOpen
  }, [mobileModalOpen])
  const stackCreatePanelOpen = useKannaSidebarStore((s) => s.stackCreatePanelOpen)
  const stackEditId = useKannaSidebarStore((s) => s.stackEditId)
  const stackDeleteConfirmId = useKannaSidebarStore((s) => s.stackDeleteConfirmId)
  const stackChatCreateId = useKannaSidebarStore((s) => s.stackChatCreateId)
  const stackChatWorktrees = useKannaSidebarStore((s) => s.stackChatWorktrees)
  const stackChatLoading = useKannaSidebarStore((s) => s.stackChatLoading)
  const isImporting = useKannaSidebarStore((s) => s.isImporting)
  const mutedChatIds = useKannaStateStore((s) => s.pushConfig?.preferences.mutedChatIds ?? EMPTY_MUTED_CHAT_IDS)
  const importDialogOpen = useKannaSidebarStore((s) => s.importDialogOpen)

  const reconcileSidebarGroups = useKannaSidebarStore((s) => s.reconcileSidebarGroups)
  const toggleSectionCollapsed = useKannaSidebarStore((s) => s.toggleSectionCollapsed)
  const toggleGroupExpanded = useKannaSidebarStore((s) => s.toggleGroupExpanded)
  const toggleAllSectionsCollapsed = useKannaSidebarStore((s) => s.toggleAllSectionsCollapsed)
  const setNowMs = useKannaSidebarStore((s) => s.setNowMs)
  const setShowNumberJumpHints = useKannaSidebarStore((s) => s.setShowNumberJumpHints)
  const setSidebarWidth = useKannaSidebarStore((s) => s.setSidebarWidth)
  const nudgeSidebarWidth = useKannaSidebarStore((s) => s.nudgeSidebarWidth)
  const commitSidebarWidth = useKannaSidebarStore((s) => s.commitSidebarWidth)
  const setSidebarWidthAndPersist = useKannaSidebarStore((s) => s.setSidebarWidthAndPersist)
  const setIsResizingSidebar = useKannaSidebarStore((s) => s.setIsResizingSidebar)
  const setArchivedProjectId = useKannaSidebarStore((s) => s.setArchivedProjectId)
  const toggleStackExpanded = useKannaSidebarStore((s) => s.toggleStackExpanded)
  const openStackCreatePanel = useKannaSidebarStore((s) => s.openStackCreatePanel)
  const openStackEditPanel = useKannaSidebarStore((s) => s.openStackEditPanel)
  const closeStackPanel = useKannaSidebarStore((s) => s.closeStackPanel)
  const setStackDeleteConfirmId = useKannaSidebarStore((s) => s.setStackDeleteConfirmId)
  const beginStackChatCreate = useKannaSidebarStore((s) => s.beginStackChatCreate)
  const finishStackChatCreate = useKannaSidebarStore((s) => s.finishStackChatCreate)
  const endStackChatCreateLoading = useKannaSidebarStore((s) => s.endStackChatCreateLoading)
  const closeStackChatCreate = useKannaSidebarStore((s) => s.closeStackChatCreate)
  const setIsImporting = useKannaSidebarStore((s) => s.setIsImporting)
  const setImportDialogOpen = useKannaSidebarStore((s) => s.setImportDialogOpen)

  const resolvedKeybindings = useMemo(() => getResolvedKeybindings(keybindings), [keybindings])

  const stackChats = useMemo(() => {
    const out: SidebarChatRow[] = []
    for (const group of data.projectGroups) {
      for (const chat of group.chats) {
        if (chat.stackId) out.push(chat)
      }
    }
    return out
  }, [data.projectGroups])

  const stripStackChats = useCallback((groups: SidebarProjectGroup[]) => {
    return groups.map((group) => {
      const chats = group.chats.filter((c) => !c.stackId)
      if (chats.length === group.chats.length) return group
      const previewChats = group.previewChats.filter((c) => !c.stackId)
      const olderChats = group.olderChats.filter((c) => !c.stackId)
      return { ...group, chats, previewChats, olderChats }
    })
  }, [])

  const starredProjectGroupsWithoutStackChats = useMemo(
    () => stripStackChats(data.starredProjectGroups),
    [data.starredProjectGroups, stripStackChats]
  )

  const projectGroupsWithoutStackChats = useMemo(
    () => stripStackChats(data.projectGroups),
    [data.projectGroups, stripStackChats]
  )

  const visibleChats = useMemo(
    () => getVisibleSidebarChats(
      [...starredProjectGroupsWithoutStackChats, ...projectGroupsWithoutStackChats],
      collapsedSections,
      expandedGroups
    ),
    [collapsedSections, starredProjectGroupsWithoutStackChats, projectGroupsWithoutStackChats, expandedGroups]
  )
  const visibleChatsRef = useRef(visibleChats)
  const visibleIndexByChatId = useMemo(
    () => new Map(visibleChats.map((entry) => [entry.chat.chatId, entry.visibleIndex])),
    [visibleChats]
  )

  const stackProjects = useMemo(
    () => data.projectGroups.map((group) => ({ id: group.groupKey, title: getPathBasename(group.localPath) })),
    [data.projectGroups]
  )

  const handleStartStackChat = useCallback(async (stackId: string) => {
    const stack = data.stacks.find((s) => s.id === stackId)
    if (!stack) return
    beginStackChatCreate(stackId)
    try {
      const entries = await Promise.all(
        stack.projectIds.map(async (projectId) => [projectId, await onListStackWorktrees(projectId)] as const)
      )
      finishStackChatCreate(new Map(entries))
    } finally {
      endStackChatCreateLoading()
    }
  }, [data.stacks, onListStackWorktrees, beginStackChatCreate, finishStackChatCreate, endStackChatCreateLoading])

  // Each of these closes over a PROP (or a ref), so it stays in the component;
  // only the state transitions live in kannaSidebarStore.
  const handleCreateStackChat = useCallback(async (
    stackId: string,
    { primaryProjectId, stackBindings }: { primaryProjectId: string; stackBindings: StackBinding[] },
  ) => {
    onCreateStackChat(primaryProjectId, stackId, stackBindings)
    closeStackChatCreate()
  }, [onCreateStackChat, closeStackChatCreate])

  const handleStackPanelSubmit = useCallback(async (title: string, projectIds: string[], instructions: string) => {
    if (stackEditId) {
      onRenameStack(stackEditId, title)
      onSetStackInstructions(stackEditId, instructions)
    } else {
      onCreateStack(title, projectIds, instructions)
    }
    closeStackPanel()
  }, [stackEditId, onRenameStack, onSetStackInstructions, onCreateStack, closeStackPanel])

  const clearStackDeleteConfirm = useCallback(() => setStackDeleteConfirmId(null), [setStackDeleteConfirmId])

  const handleConfirmDeleteStack = useCallback((stackId: string) => {
    onRemoveStack(stackId)
    setStackDeleteConfirmId(null)
  }, [onRemoveStack, setStackDeleteConfirmId])

  const handleOpenArchivedChat = useCallback((chatId: string) => {
    onOpenArchivedChat(chatId)
    setArchivedProjectId(null)
    onClose()
  }, [onOpenArchivedChat, setArchivedProjectId, onClose])

  const handleArchivedDialogOpenChange = useCallback((dialogOpen: boolean) => {
    if (!dialogOpen) setArchivedProjectId(null)
  }, [setArchivedProjectId])

  // Writes resizeStartRef: a ref, deliberately not store state — the drag
  // origin must not trigger a render on every pointer move.
  const handleResizeStart = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    resizeStartRef.current = { pointerX: event.clientX, width: sidebarWidth }
    setIsResizingSidebar(true)
  }, [sidebarWidth, setIsResizingSidebar])

  // Maps a key to a width intent; the clamping lives in the store.
  const handleResizeKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft") nudgeSidebarWidth(-16)
    else if (event.key === "ArrowRight") nudgeSidebarWidth(16)
    else if (event.key === "Home") setSidebarWidthAndPersist(MIN_SIDEBAR_WIDTH)
    else if (event.key === "End") setSidebarWidthAndPersist(MAX_SIDEBAR_WIDTH)
    else if (event.key === "Enter") setSidebarWidthAndPersist(DEFAULT_SIDEBAR_WIDTH)
    else return
    event.preventDefault()
  }, [nudgeSidebarWidth, setSidebarWidthAndPersist])

  const projectIdByPath = useMemo(
    () => new Map([...data.starredProjectGroups, ...data.projectGroups].map((group) => [group.localPath, group.groupKey])),
    [data.starredProjectGroups, data.projectGroups]
  )

  const activeVisibleCount = visibleChats.length
  const archivedProject = useMemo(
    () => [...data.starredProjectGroups, ...data.projectGroups].find((group) => group.groupKey === archivedProjectId) ?? null,
    [archivedProjectId, data.starredProjectGroups, data.projectGroups]
  )

  useEffect(() => {
    visibleChatsRef.current = visibleChats
  }, [visibleChats])

  useEffect(() => {
    reconcileSidebarGroups([...data.starredProjectGroups, ...data.projectGroups])
  }, [data.starredProjectGroups, data.projectGroups, reconcileSidebarGroups])

  const toggleSection = toggleSectionCollapsed

  const toggleExpandedGroup = toggleGroupExpanded

  const allSidebarGroupKeys = useMemo(
    () => [...data.starredProjectGroups, ...data.projectGroups].map((g) => g.groupKey),
    [data.starredProjectGroups, data.projectGroups]
  )
  const allSectionsCollapsed = allSidebarGroupKeys.length > 0
    && allSidebarGroupKeys.every((key) => collapsedSections.has(key))

  const toggleAllSections = useCallback(() => {
    toggleAllSectionsCollapsed(allSidebarGroupKeys)
  }, [allSidebarGroupKeys, toggleAllSectionsCollapsed])

  const handleBulkDelete = useCallback(() => {
    if (!selectedChatIds.size) return
    void onDeleteBulkChats([...selectedChatIds])
    stopSelecting()
  }, [selectedChatIds, onDeleteBulkChats, stopSelecting])

  const handleSelectAll = useCallback(() => {
    const allIds = visibleChats.map((e) => e.chat.chatId)
    if (selectedChatIds.size === allIds.length) clearAll()
    else selectAll(allIds)
  }, [clearAll, selectAll, selectedChatIds, visibleChats])

  const renderChatRow = useCallback((chat: SidebarChatRow) => {
    const visibleIndex = visibleIndexByChatId.get(chat.chatId)

    return (
      <ChatRow
        key={chat._id}
        chat={chat}
        activeChatId={activeChatId}
        nowMs={nowMs}
        shortcutHint={visibleIndex ? getSidebarNumberJumpHint(resolvedKeybindings, visibleIndex) : null}
        showShortcutHint={showNumberJumpHints}
        onSelectChat={(chatId) => {
          navigate(`/chat/${chatId}`)
          onClose()
        }}
        onRenameChat={() => onRenameChat(chat)}
        onOpenInFinder={() => onOpenExternalPath("open_finder", chat.localPath)}
        onForkChat={() => onForkChat(chat)}
        onArchiveChat={() => onArchiveChat(chat)}
        onDeleteChat={() => onDeleteChat(chat)}
        onEditPermissions={onEditChatPermissions}
        silent={mutedChatIds.includes(chat.chatId)}
        isSelected={isSelecting ? selectedChatIds.has(chat.chatId) : undefined}
        onToggleSelect={isSelecting ? () => toggleSelect(chat.chatId) : undefined}
      />
    )
  }, [activeChatId, isSelecting, mutedChatIds, navigate, nowMs, onArchiveChat, onClose, onDeleteChat, onEditChatPermissions, onForkChat, onOpenExternalPath, onRenameChat, resolvedKeybindings, selectedChatIds, showNumberJumpHints, toggleSelect, visibleIndexByChatId])

  useEffect(() => {
    const intervalId = timer.setInterval(() => {
      setNowMs(Date.now())
    }, 30_000)

    return () => timer.clearInterval(intervalId)
  }, [setNowMs, timer])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      setShowNumberJumpHints(shouldShowSidebarNumberJumpHints(resolvedKeybindings, event))

      if (event.key === "Escape" && mobileModalOpen) {
        event.preventDefault()
        onClose()
        return
      }

      if (isSidebarModifierShortcut(resolvedKeybindings, "createChatInCurrentProject", event)) {
        if (!currentProjectId) {
          return
        }

        event.preventDefault()
        onCreateChat(currentProjectId)
        return
      }

      if (isSidebarModifierShortcut(resolvedKeybindings, "openAddProject", event)) {
        event.preventDefault()
        navigate("/")
        onClose()
        onOpenAddProjectModal()
        return
      }

      if (isSidebarModifierShortcut(resolvedKeybindings, "newStack", event)) {
        event.preventDefault()
        openStackCreatePanel()
        return
      }

      if (isSidebarModifierShortcut(resolvedKeybindings, "newStackChat", event)) {
        event.preventDefault()
        // TODO: open stack chat creation for the first stack if any
        // For now just ensure the binding is registered
        return
      }

      const targetIndex = getSidebarJumpTargetIndex(resolvedKeybindings, event)
      if (targetIndex === null) {
        return
      }

      const targetChat = visibleChatsRef.current[targetIndex - 1]?.chat
      if (!targetChat) {
        return
      }

      event.preventDefault()
      navigate(`/chat/${targetChat.chatId}`)
      onClose()
    }

    function handleKeyUp(event: KeyboardEvent) {
      setShowNumberJumpHints(shouldShowSidebarNumberJumpHints(resolvedKeybindings, event))
    }

    function clearHints() {
      setShowNumberJumpHints(false)
    }

    const removeKeyDown = dom.addWindowListener("keydown", handleKeyDown)
    const removeKeyUp = dom.addWindowListener("keyup", handleKeyUp)
    const removeBlur = dom.addWindowListener("blur", clearHints)

    return () => {
      removeKeyDown()
      removeKeyUp()
      removeBlur()
    }
  }, [currentProjectId, dom, mobileModalOpen, navigate, onClose, onCreateChat, onOpenAddProjectModal, resolvedKeybindings, setShowNumberJumpHints, openStackCreatePanel])

  useEffect(() => {
    if (!activeChatId || !scrollContainerRef.current) return

    timer.requestAnimationFrame(() => {
      const container = scrollContainerRef.current
      const found = container?.querySelector(`[data-chat-id="${activeChatId}"]`)
      const activeElement = found instanceof HTMLElement ? found : null
      if (!activeElement || !container) return

      const elementRect = activeElement.getBoundingClientRect()
      const containerRect = container.getBoundingClientRect()

      if (elementRect.top < containerRect.top + 38) {
        const relativeTop = elementRect.top - containerRect.top + container.scrollTop
        container.scrollTo({ top: relativeTop - 38, behavior: "smooth" })
      } else if (elementRect.bottom > containerRect.bottom) {
        const elementCenter = elementRect.top + elementRect.height / 2 - containerRect.top + container.scrollTop
        const containerCenter = container.clientHeight / 2
        container.scrollTo({ top: elementCenter - containerCenter, behavior: "smooth" })
      }
    })
  }, [activeChatId, timer])

  useEffect(() => {
    if (!isResizingSidebar) return

    const previousCursor = dom.getBodyStyle("cursor")
    const previousUserSelect = dom.getBodyStyle("user-select")
    dom.setBodyStyle("cursor", "col-resize")
    dom.setBodyStyle("user-select", "none")

    function handlePointerMove(event: PointerEvent) {
      const resizeStart = resizeStartRef.current
      if (!resizeStart) return
      setSidebarWidth(clampSidebarWidth(resizeStart.width + event.clientX - resizeStart.pointerX))
    }

    function handlePointerUp() {
      setIsResizingSidebar(false)
      resizeStartRef.current = null
      commitSidebarWidth()
    }

    const removePointerMove = dom.addWindowListener("pointermove", handlePointerMove)
    const removePointerUp = dom.addWindowListener("pointerup", handlePointerUp)

    return () => {
      removePointerMove()
      removePointerUp()
      dom.setBodyStyle("cursor", previousCursor)
      dom.setBodyStyle("user-select", previousUserSelect)
    }
  }, [dom, isResizingSidebar, setSidebarWidth, setIsResizingSidebar, commitSidebarWidth])

  const handleImportAll = useCallback(async () => {
    if (isImporting || !onImportClaudeSessions) return
    setIsImporting(true)
    try {
      await onImportClaudeSessions()
    } catch (error) {
      log.error("[kanna/import] failed", String(error))
    } finally {
      setIsImporting(false)
      setImportDialogOpen(false)
    }
  }, [isImporting, onImportClaudeSessions, setIsImporting, setImportDialogOpen])

  const handleImportSessionIds = useCallback(async (sessionIds: string[]) => {
    if (isImporting || !onImportClaudeSessionIds) return
    setIsImporting(true)
    try {
      await onImportClaudeSessionIds(sessionIds)
    } catch (error) {
      log.error("[kanna/import] failed", String(error))
    } finally {
      setIsImporting(false)
      setImportDialogOpen(false)
    }
  }, [isImporting, onImportClaudeSessionIds, setIsImporting, setImportDialogOpen])

  const hasVisibleChats = activeVisibleCount > 0
  const isLocalProjectsActive = location.pathname === "/"
  const isSettingsActive = location.pathname.startsWith("/settings")
  const isWorkflowsActive = location.pathname.startsWith("/workflows")
  const isCronJobsActive = location.pathname.startsWith("/cron")
  const isUtilityPageActive = isLocalProjectsActive || isSettingsActive || isWorkflowsActive || isCronJobsActive
  const isConnecting = connectionStatus === "connecting"
  let statusLabel: string
  if (isConnecting) {
    statusLabel = "Connecting"
  } else if (connectionStatus === "connected") {
    statusLabel = "Connected"
  } else {
    statusLabel = "Disconnected"
  }
  const statusDotClass = connectionStatus === "connected" ? "bg-success" : "bg-warning"
  const showDevBadge = updateSnapshot
    ? updateSnapshot.latestVersion === `${updateSnapshot.currentVersion}-dev`
    : false
  let workflowsButtonClass: string
  if (!activeChatId) {
    workflowsButtonClass = "opacity-60"
  } else if (isWorkflowsActive) {
    workflowsButtonClass = "bg-muted"
  } else {
    workflowsButtonClass = "hover:bg-muted/50"
  }

  return (
    <>
      {!open && showMobileOpenButton && (
        <Button
          variant="ghost"
          size="icon-mobile"
          aria-label="Open sidebar"
          className="fixed top-3 left-3 z-50 md:hidden"
          onClick={onOpen}
        >
          <Menu className="h-5 w-5" />
        </Button>
      )}

      {collapsed && isUtilityPageActive && (
        <div className="hidden md:flex fixed left-0 top-0 h-full z-40 items-start pt-4 pl-5 border-l border-border/0">
          <div className="flex items-center gap-1">
            <Flower className="size-6 text-logo" />
            <Button
              variant="ghost"
              size="icon"
              onClick={onExpand}
              title="Expand sidebar"
              aria-label="Expand sidebar"
            >
              <PanelLeft className="h-5 w-5" />
            </Button>
          </div>
        </div>
      )}

      <FocusScope key={mobileModalOpen ? "mobile-modal" : "sidebar"} asChild loop trapped={mobileModalOpen}>
      <div
        data-sidebar="open"
        role={mobileModalOpen ? "dialog" : undefined}
        aria-modal={mobileModalOpen ? "true" : undefined}
        aria-label={mobileModalOpen ? "Workspace navigation" : undefined}
        className={cn(
          "fixed inset-0 z-50 bg-background dark:bg-card flex flex-col h-[100dvh] select-none",
          "kanna-sidebar-shell md:relative md:inset-auto md:w-[var(--sidebar-width)] md:mr-0 md:h-[calc(100%-16px)] md:my-2 md:ml-2 md:border md:border-border md:rounded-2xl",
          open ? "flex" : "hidden md:flex",
          collapsed && "md:hidden"
        )}
        style={cssVars({ "--sidebar-width": `${sidebarWidth}px` })}
      >
        <div className={cn(
          "px-[5px] border-b grid grid-cols-[40px_minmax(0,1fr)_40px] items-center md:px-[7px] md:pl-3 md:flex md:justify-between",
          SHELL_TOP_BAND_CLASS,
        )}>
          <div className="md:hidden">
            <Button
              variant="ghost"
              size="icon"
              className="size-10 rounded-lg hover:!border-border/0"
              onClick={onClose}
              title="Close sidebar"
              aria-label="Close sidebar"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
          <div className="flex items-center justify-self-center gap-2 md:justify-self-auto">
            <HoverHint label="Collapse sidebar">
              <button
                type="button"
                onClick={onCollapse}
                aria-label="Collapse sidebar"
                className="hidden md:flex group/sidebar-collapse relative items-center justify-center h-5 w-5 sm:h-6 sm:w-6"
              >
                <Flower className="absolute inset-0.5 h-4 w-4 sm:h-5 sm:w-5 text-logo transition-[transform,opacity] motion-reduce:transition-none duration-200 ease-out opacity-100 scale-100 group-hover/sidebar-collapse:opacity-0 group-hover/sidebar-collapse:scale-0" />
                <PanelLeft className="absolute inset-0 h-4 w-4 sm:h-6 sm:w-6 text-muted-foreground transition-[transform,opacity] motion-reduce:transition-none duration-200 ease-out opacity-0 scale-0 group-hover/sidebar-collapse:opacity-100 group-hover/sidebar-collapse:scale-80 hover:opacity-50" />
              </button>
            </HoverHint>
            <Flower className="h-5 w-5 sm:h-6 sm:w-6 text-logo md:hidden" />
            <span className="font-logo text-base sm:text-md text-foreground">{APP_NAME}</span>
          </div>
          <div className="flex items-center justify-self-end md:justify-self-auto">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                navigate("/")
                onClose()
              }}
              className="size-10 rounded-lg hover:!border-border/0 md:hidden"
              title="New project"
              aria-label="New project"
            >
              <Plus className="h-5 w-5" />
            </Button>
            {showDevBadge ? (
              <HoverHint label="Development build">
                <span className="mr-1 hidden md:inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-bold tracking-wider text-muted-foreground">
                  DEV
                </span>
              </HoverHint>
            ) : null}
            {onImportClaudeSessions ? (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setImportDialogOpen(true)}
                disabled={isImporting}
                className="inline-flex size-10 rounded-lg hover:!border-border/0"
                title="Import Claude Code sessions"
                aria-label="Import Claude Code sessions"
              >
                <Download className="size-4" />
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                navigate("/")
                onClose()
              }}
              className="hidden md:inline-flex size-10 rounded-lg hover:!border-border/0"
              title="New project"
              aria-label="New project"
            >
              <Plus className="size-4" />
            </Button>
          </div>
        </div>

        {allSidebarGroupKeys.length > 0 && (
          <div className="flex items-center justify-between pl-2 pr-2 pt-1.5 pb-1 shrink-0">
            <button
              type="button"
              onClick={isSelecting ? stopSelecting : startSelecting}
              aria-pressed={isSelecting}
              className="inline-flex items-center gap-1.5 rounded-full border border-border/50 bg-transparent px-2.5 py-1 text-xs font-medium tracking-[0.005em] text-muted-foreground hover:border-border hover:bg-muted/50 hover:text-foreground aria-pressed:border-border aria-pressed:bg-muted/40 aria-pressed:text-foreground transition-colors duration-150 motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <CheckSquare className="size-3.5" aria-hidden />
              {isSelecting ? "Cancel" : "Select"}
            </button>
            <button
              type="button"
              onClick={toggleAllSections}
              aria-pressed={allSectionsCollapsed}
              className="group/collapse-all inline-flex items-center gap-1.5 rounded-full border border-border/50 bg-transparent px-2.5 py-1 text-xs font-medium tracking-[0.005em] text-muted-foreground hover:border-border hover:bg-muted/50 hover:text-foreground aria-pressed:border-border aria-pressed:bg-muted/40 aria-pressed:text-foreground transition-colors duration-150 motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {allSectionsCollapsed ? (
                <>
                  <UnfoldVertical className="size-3.5 text-muted-foreground/80 group-hover/collapse-all:text-foreground group-aria-pressed/collapse-all:text-foreground transition-colors duration-150 motion-reduce:transition-none" aria-hidden />
                  Expand all
                </>
              ) : (
                <>
                  <FoldVertical className="size-3.5 text-muted-foreground/80 group-hover/collapse-all:text-foreground transition-colors duration-150 motion-reduce:transition-none" aria-hidden />
                  Collapse all
                </>
              )}
            </button>
          </div>
        )}

        <div
          ref={scrollContainerRef}
          className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden"
          style={{
            WebkitOverflowScrolling: "touch",
            touchAction: "pan-y",
          }}
        >
          <div className="p-[7px]">
            {!hasVisibleChats && data.projectGroups.length === 0 ? (
              <p className="text-sm text-muted-foreground p-2 mt-6 text-center">No conversations yet</p>
            ) : null}

            <StacksSection
              stacks={data.stacks}
              projects={stackProjects}
              expandedStackIds={expandedStackIds}
              onToggleExpanded={toggleStackExpanded}
              onOpenCreatePanel={openStackCreatePanel}
              onOpenStackMenu={openStackEditPanel}
              onOpenBoards={handleOpenStackBoards}
              onDeleteStack={(stackId) => setStackDeleteConfirmId(stackId)}
              onStartChat={(stackId) => { void handleStartStackChat(stackId) }}
              renderChatCreate={(stack) => {
                if (stack.id !== stackChatCreateId) return null
                if (stackChatLoading) return <p className="text-xs text-muted-foreground">Loading worktrees…</p>
                const rowProjects = stack.projectIds.map((pid) => ({
                  id: pid,
                  title: stackProjects.find((p) => p.id === pid)?.title ?? pid,
                  worktrees: stackChatWorktrees.get(pid) ?? [],
                }))
                return (
                  <StackChatCreateRow
                    stack={stack}
                    projects={rowProjects}
                    onCreate={(args) => handleCreateStackChat(stack.id, args)}
                    onCancel={closeStackChatCreate}
                  />
                )
              }}
              renderChatRow={renderChatRow}
              chats={stackChats}
            />

            <StackEditPanels
              stacks={data.stacks}
              projects={stackProjects}
              createPanelOpen={stackCreatePanelOpen}
              editId={stackEditId}
              deleteConfirmId={stackDeleteConfirmId}
              onSubmit={handleStackPanelSubmit}
              onCancel={closeStackPanel}
              onConfirmDelete={handleConfirmDeleteStack}
              onCancelDelete={clearStackDeleteConfirm}
            />

            {starredProjectGroupsWithoutStackChats.length > 0 && (
              <>
                <LocalProjectsSection
                  projectGroups={starredProjectGroupsWithoutStackChats}
                  heading="Starred"
                  editorLabel={editorLabel}
                  collapsedSections={collapsedSections}
                  expandedGroups={expandedGroups}
                  onToggleSection={toggleSection}
                  onToggleExpandedGroup={toggleExpandedGroup}
                  renderChatRow={renderChatRow}
                  onShowArchivedProject={setArchivedProjectId}
                  onNewLocalChat={(localPath) => {
                    const projectId = projectIdByPath.get(localPath)
                    if (projectId) {
                      onCreateChat(projectId)
                    }
                  }}
                  onCopyPath={onCopyPath}
                  onOpenExternalPath={onOpenExternalPath}
                  onHideProject={onHideProject}
                  onOpenBoards={handleOpenBoards}
                  onToggleStar={onToggleStar}
                  onSetInstructions={onSetProjectInstructions}
                  isConnected={connectionStatus === "connected"}
                />
              </>
            )}

            <LocalProjectsSection
              projectGroups={projectGroupsWithoutStackChats}
              heading="Projects"
              editorLabel={editorLabel}
              onReorderGroups={onReorderProjectGroups}
              collapsedSections={collapsedSections}
              expandedGroups={expandedGroups}
              onToggleSection={toggleSection}
              onToggleExpandedGroup={toggleExpandedGroup}
              renderChatRow={renderChatRow}
              onShowArchivedProject={setArchivedProjectId}
              onNewLocalChat={(localPath) => {
                const projectId = projectIdByPath.get(localPath)
                if (projectId) {
                  onCreateChat(projectId)
                }
              }}
              onCopyPath={onCopyPath}
              onOpenExternalPath={onOpenExternalPath}
              onHideProject={onHideProject}
              onOpenBoards={handleOpenBoards}
              onToggleStar={onToggleStar}
              onSetInstructions={onSetProjectInstructions}
              isConnected={connectionStatus === "connected"}
            />
          </div>
        </div>

        {isSelecting && (
          <SidebarBulkActionBar
            selectedCount={selectedChatIds.size}
            visibleChatCount={visibleChats.length}
            onSelectAll={handleSelectAll}
            onDelete={handleBulkDelete}
          />
        )}

        <SidebarUtilityNav
          activeChatId={activeChatId}
          navigate={navigate}
          onClose={onClose}
          workflowsButtonClass={workflowsButtonClass}
          isCronJobsActive={isCronJobsActive}
          isSettingsActive={isSettingsActive}
          statusDotClass={statusDotClass}
          statusLabel={statusLabel}
          pluginItems={pluginSidebarItems}
        />

        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          tabIndex={0}
          className={cn(
            "hidden md:block absolute -right-1 top-3 bottom-3 z-20 w-2 cursor-col-resize rounded-full",
            "focus-visible:outline-none"
          )}
          onPointerDown={handleResizeStart}
          onDoubleClick={() => {
            setSidebarWidthAndPersist(DEFAULT_SIDEBAR_WIDTH)
          }}
          onKeyDown={handleResizeKeyDown}
        />
      </div>
      </FocusScope>

      <Dialog
        open={Boolean(archivedProject)}
        onOpenChange={handleArchivedDialogOpenChange}
      >
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>Archived Chats</DialogTitle>
            <DialogDescription>
              {archivedProject?.localPath ?? ""}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-1">
            {archivedProject?.archivedChats?.length ? (
              archivedProject.archivedChats.map((chat) => (
                <button
                  key={chat.chatId}
                  type="button"
                  className="flex w-full items-center justify-between gap-3 rounded-lg border border-border/0 px-3 py-2 text-left transition-colors hover:border-border hover:bg-muted"
                  onClick={() => handleOpenArchivedChat(chat.chatId)}
                >
                  <span className="min-w-0 truncate text-sm">{chat.title}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatSidebarAgeLabel(getSidebarChatTimestamp(chat), nowMs)}
                  </span>
                </button>
              ))
            ) : (
              <p className="px-1 py-3 text-sm text-muted-foreground">No archived chats</p>
            )}
          </DialogBody>
        </DialogContent>
      </Dialog>

      {onImportClaudeSessions ? (
        <ImportSessionsDialog
          open={importDialogOpen}
          busy={isImporting}
          onClose={() => setImportDialogOpen(false)}
          onImportAll={() => void handleImportAll()}
          onImportSessions={(sessionIds) => void handleImportSessionIds(sessionIds)}
        />
      ) : null}

      {open ? <div className="fixed inset-0 bg-overlay/40 z-40 md:hidden" onClick={onClose} /> : null}
    </>
  )
}

export const KannaSidebar = memo(KannaSidebarImpl)
