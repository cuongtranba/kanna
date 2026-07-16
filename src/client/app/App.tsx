import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react"
import { QueryClientProvider } from "@tanstack/react-query"
import { Navigate, Outlet, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom"
import { queryClient } from "../query/queryClient"
import { SocketBridge } from "./SocketBridge"
import { Flower } from "lucide-react"
import { ChatPolicyDialog } from "../components/chat-ui/ChatPolicyDialog"
import { POLICY_DEFAULT } from "../../shared/permission-policy"
import { AppDialogProvider, useAppDialog } from "../components/ui/app-dialog"
import { Button } from "../components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card"
import { Input } from "../components/ui/input"
import { NoticeBanner } from "../components/ui/notice-banner"
import { TooltipProvider } from "../components/ui/tooltip"
import { Toaster } from "../components/ui/toaster"
import { APP_NAME, SDK_CLIENT_APP } from "../../shared/branding"
import { useChatSoundPreferencesStore } from "../stores/chatSoundPreferencesStore"
import type { ChatSoundPreference } from "../stores/chatSoundPreferencesStore"
import { playChatNotificationSound, shouldPlayChatSound } from "../lib/chatSounds"
import { getChatSoundBurstCount, getNotificationTitleCount } from "./chatNotifications"
import { KannaSidebar } from "./KannaSidebar"
import { ChatPage } from "./ChatPage"
import { LocalProjectsPage } from "./LocalProjectsPage"
import { SettingsPage } from "./SettingsPage"
import { WorkflowsPage } from "./WorkflowsPage"
import { AppBootstrap } from "./AppBootstrap"
import { SharePage } from "./share-view/SharePage"
import { useKannaState } from "./useKannaState"
import { useSidebarSwipeGesture } from "./sidebarSwipeGesture"
import type { AppSettingsSnapshot } from "../../shared/types"
import { log } from "../../shared/log"
import { useAppShellStore } from "../stores/appShellStore"
import { PasswordScreenStore } from "./PasswordScreen.store"
import type { DomPort } from "../ports/domPort"
import type { TimerPort } from "../ports/timerPort"
import type { StoragePort } from "../ports/storagePort"
import { domAdapter } from "../adapters/dom.adapter"
import { timerAdapter } from "../adapters/timer.adapter"
import { localStorageAdapter } from "../adapters/storage.adapter"
import { fetchAuthStatus, postAuthLogin } from "../api/auth"

const VERSION_SEEN_STORAGE_KEY = "kanna:last-seen-version"
const AUTH_STATUS_RETRY_DELAY_MS = 500

export interface AppPorts {
  dom?: DomPort
  timer?: TimerPort
  storage?: StoragePort
}

interface AuthStatusResponse {
  enabled: boolean
  authenticated: boolean
}

type AppAuthState =
  | { status: "checking" }
  | { status: "ready" }
  | { status: "locked"; error: string | null }

export function getAppAuthStateFromStatus(payload: Partial<AuthStatusResponse>): AppAuthState {
  if (!payload.enabled || payload.authenticated) {
    return { status: "ready" }
  }

  return { status: "locked", error: null }
}

export function shouldRetryAuthStatusRequest(responseOk: boolean | null) {
  return responseOk !== true
}

function PasswordScreenInner({
  error,
  onSubmit,
}: {
  error: string | null
  onSubmit: (password: string) => Promise<void>
}) {
  const password = PasswordScreenStore.useScopedStore((s) => s.password)
  const submitting = PasswordScreenStore.useScopedStore((s) => s.submitting)
  const setPassword = PasswordScreenStore.useScopedStore((s) => s.setPassword)
  const setSubmitting = PasswordScreenStore.useScopedStore((s) => s.setSubmitting)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!password || submitting) return
    setSubmitting(true)
    try {
      await onSubmit(password)
      setPassword("")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-6 py-10">
      <Card className="w-full max-w-md rounded-3xl border border-border bg-card shadow-sm">
        <CardHeader className="flex flex-col p-2 space-y-3 px-6 pt-6 pb-5 pl-[28px]">
          <div className="flex items-center gap-3">
            <Flower className="h-5 w-5 text-logo" />
            <div>
              <CardTitle className="font-logo text-xl uppercase text-foreground">{APP_NAME}</CardTitle>
            </div>
          </div>
          <CardDescription className="leading-6">
            Enter your password to continue.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-6 pb-6">
          <form className="space-y-4" onSubmit={(event) => void handleSubmit(event)}>
            {error ? (
              <div className="rounded-2xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-foreground">
                {error}
              </div>
            ) : null}
            <Input
              id="kanna-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Password"
              disabled={submitting}
              className="h-11 rounded-2xl bg-background"
            />
            <Button
              type="submit"
              disabled={submitting || password.length === 0}
              className="h-11 w-full"
            >
              {submitting ? "Unlocking..." : "Unlock"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

function PasswordScreen({
  error,
  onSubmit,
}: {
  error: string | null
  onSubmit: (password: string) => Promise<void>
}) {
  return (
    <PasswordScreenStore.Provider init={{}}>
      <PasswordScreenInner error={error} onSubmit={onSubmit} />
    </PasswordScreenStore.Provider>
  )
}

function useAppAuthState(ports: AppPorts = {}) {
  const timer = ports.timer ?? timerAdapter
  const dom = ports.dom ?? domAdapter
  const authStatus = useAppShellStore((s) => s.authStatus)
  const retryTimeoutRef = useRef<number | null>(null)
  const refreshRef = useRef<() => Promise<void>>(async () => { /* stable ref kept current by useLayoutEffect */ })

  const refresh = useCallback(async () => {
    if (retryTimeoutRef.current !== null) {
      timer.clearTimeout(retryTimeoutRef.current)
      retryTimeoutRef.current = null
    }

    const { authStatus: current, setAuthStatus } = useAppShellStore.getState()
    setAuthStatus(current.status === "ready" ? current : { status: "checking" })

    let payload: Partial<AuthStatusResponse>
    try {
      payload = await fetchAuthStatus()
    } catch {
      retryTimeoutRef.current = timer.setTimeout(() => {
        void refreshRef.current()
      }, AUTH_STATUS_RETRY_DELAY_MS)
      return
    }

    // fetchAuthStatus returns {} on non-ok HTTP; treat as a retry condition
    const responseOk = Object.keys(payload).length > 0 ? true : null
    if (shouldRetryAuthStatusRequest(responseOk)) {
      retryTimeoutRef.current = timer.setTimeout(() => {
        void refreshRef.current()
      }, AUTH_STATUS_RETRY_DELAY_MS)
      return
    }

    useAppShellStore.getState().setAuthStatus(getAppAuthStateFromStatus(payload))
  }, [timer])

  useLayoutEffect(() => {
    refreshRef.current = refresh
  })

  useEffect(() => {
    void refresh()
    return () => {
      if (retryTimeoutRef.current !== null) {
        timer.clearTimeout(retryTimeoutRef.current)
      }
    }
  }, [refresh, timer])

  const submitPassword = useCallback(async (password: string) => {
    const next = dom.getPathname() + dom.getSearch()
    const ok = await postAuthLogin({ password, next })

    if (!ok) {
      useAppShellStore.getState().setAuthStatus({ status: "locked", error: "Incorrect password. Try again." })
      return
    }

    await refresh()
  }, [dom, refresh])

  return {
    state: authStatus,
    submitPassword,
  }
}

export function shouldRedirectToChangelog(pathname: string, currentVersion: string, seenVersion: string | null) {
  return pathname === "/" && Boolean(currentVersion) && seenVersion !== currentVersion
}

export function shouldPlayChatNotificationSound(
  appSettings: AppSettingsSnapshot | null,
  preference: ChatSoundPreference,
  dom: DomPort = domAdapter,
) {
  return Boolean(appSettings) && shouldPlayChatSound(preference, dom)
}

function KannaLayout({ ports = {} }: { ports?: AppPorts } = {}) {
  const dom = ports.dom ?? domAdapter
  const storage = ports.storage ?? localStorageAdapter
  const location = useLocation()
  const navigate = useNavigate()
  const params = useParams()
  const state = useKannaState(params.chatId ?? null)
  const dialog = useAppDialog()
  const chatSoundPreference = useChatSoundPreferencesStore((store) => store.chatSoundPreference)
  const chatSoundId = useChatSoundPreferencesStore((store) => store.chatSoundId)
  const showMobileOpenButton = location.pathname === "/"
  const currentVersion = SDK_CLIENT_APP.split("/")[1] ?? "unknown"
  useSidebarSwipeGesture({
    sidebarOpen: state.sidebarOpen,
    onOpen: state.openSidebar,
    onClose: state.closeSidebar,
  })
  const previousSidebarDataRef = useRef<ReturnType<typeof useKannaState>["sidebarData"] | null>(null)
  const {
    handleCreateChat,
    handleForkChat,
    handleRenameChat,
    handleArchiveChat,
    handleOpenArchivedChat: stateHandleOpenArchivedChat,
    openAddProjectModal,
    handleDeleteChat,
    handleCopyPath,
    handleOpenExternalPath,
    handleHideProject,
    handleToggleProjectStar,
    handleReorderProjectGroups,
    importClaudeSessions,
  } = state
  const handleSidebarCreateChat = useCallback((projectId: string) => {
    void handleCreateChat(projectId)
  }, [handleCreateChat])
  const handleSidebarForkChat = useCallback((chat: Parameters<typeof handleForkChat>[0]) => {
    void handleForkChat(chat)
  }, [handleForkChat])
  const handleSidebarRenameChat = useCallback((chat: Parameters<typeof handleRenameChat>[0]) => {
    void handleRenameChat(chat)
  }, [handleRenameChat])
  const handleSidebarArchiveChat = useCallback((chat: Parameters<typeof handleArchiveChat>[0]) => {
    void handleArchiveChat(chat)
  }, [handleArchiveChat])
  const handleOpenArchivedChat = useCallback((chatId: string) => {
    void stateHandleOpenArchivedChat(chatId)
  }, [stateHandleOpenArchivedChat])
  const handleOpenAddProjectModal = useCallback(() => {
    openAddProjectModal()
  }, [openAddProjectModal])
  const handleSidebarDeleteChat = useCallback((chat: Parameters<typeof handleDeleteChat>[0]) => {
    void handleDeleteChat(chat)
  }, [handleDeleteChat])
  const handleSidebarCopyPath = useCallback((localPath: string) => {
    void handleCopyPath(localPath)
  }, [handleCopyPath])
  const handleSidebarOpenExternalPath = useCallback((action: "open_finder" | "open_editor", localPath: string) => {
    void handleOpenExternalPath(action, localPath)
  }, [handleOpenExternalPath])
  const handleSidebarHideProject = useCallback((projectId: string) => {
    void handleHideProject(projectId)
  }, [handleHideProject])
  const handleSidebarToggleProjectStar = useCallback((projectId: string, starred: boolean) => {
    void handleToggleProjectStar(projectId, starred)
  }, [handleToggleProjectStar])
  const handleSidebarReorderProjectGroups = useCallback((projectIds: string[]) => {
    void handleReorderProjectGroups(projectIds)
  }, [handleReorderProjectGroups])
  const handleImportClaudeSessions = useCallback(async () => {
    try {
      const result = await importClaudeSessions()
      const parts = [
        `Imported ${result.imported}`,
        `updated ${result.updated}`,
        `skipped ${result.skipped}`,
        `failed ${result.failed}`,
      ]
      const suffix = result.newProjects > 0 ? ` (${result.newProjects} new projects)` : ""
      await dialog.alert({
        title: "Import complete",
        description: `${parts.join(", ")}.${suffix}`,
      })
    } catch (error) {
      log.error("[kanna/import] failed", String(error))
      await dialog.alert({
        title: "Import failed",
        description: "See console for details.",
      })
    }
  }, [dialog, importClaudeSessions])

  const permissionsChatId = useAppShellStore((s) => s.permissionsChatId)
  const setPermissionsChatId = useAppShellStore((s) => s.setPermissionsChatId)
  const handleSidebarEditPermissions = useCallback((chatId: string) => {
    setPermissionsChatId(chatId)
    if (state.activeChatId !== chatId) {
      navigate(`/chat/${chatId}`)
    }
  }, [navigate, setPermissionsChatId, state.activeChatId])
  const permissionsChatTitle = state.chatSnapshot?.runtime.title ?? "Chat"
  const permissionsCurrentOverride = state.chatSnapshot?.runtime.policyOverride ?? null

  const sidebarElement = useMemo(() => (
    <KannaSidebar
      data={state.sidebarData}
      activeChatId={state.activeChatId}
      connectionStatus={state.connectionStatus}
      open={state.sidebarOpen}
      collapsed={state.sidebarCollapsed}
      showMobileOpenButton={showMobileOpenButton}
      onOpen={state.openSidebar}
      onClose={state.closeSidebar}
      onCollapse={state.collapseSidebar}
      onExpand={state.expandSidebar}
      onCreateChat={handleSidebarCreateChat}
      onForkChat={handleSidebarForkChat}
      currentProjectId={state.activeProjectId}
      keybindings={state.keybindings}
      onRenameChat={handleSidebarRenameChat}
      onArchiveChat={handleSidebarArchiveChat}
      onOpenArchivedChat={handleOpenArchivedChat}
      onDeleteChat={handleSidebarDeleteChat}
      onEditChatPermissions={handleSidebarEditPermissions}
      onOpenAddProjectModal={handleOpenAddProjectModal}
      onImportClaudeSessions={handleImportClaudeSessions}
      onCopyPath={handleSidebarCopyPath}
      onOpenExternalPath={handleSidebarOpenExternalPath}
      onHideProject={handleSidebarHideProject}
      onToggleStar={handleSidebarToggleProjectStar}
      onReorderProjectGroups={handleSidebarReorderProjectGroups}
      onCreateStack={state.handleCreateStack}
      onRenameStack={state.handleRenameStack}
      onRemoveStack={state.handleRemoveStack}
      onCreateStackChat={state.handleCreateStackChat}
      onListStackWorktrees={state.handleListStackWorktrees}
      editorLabel={state.editorLabel}
      updateSnapshot={state.updateSnapshot}
    />
  ), [
    handleOpenAddProjectModal,
    handleImportClaudeSessions,
    handleSidebarCopyPath,
    handleSidebarCreateChat,
    handleSidebarArchiveChat,
    handleSidebarDeleteChat,
    handleOpenArchivedChat,
    handleSidebarForkChat,
    handleSidebarOpenExternalPath,
    handleSidebarRenameChat,
    handleSidebarEditPermissions,
    handleSidebarReorderProjectGroups,
    handleSidebarHideProject,
    handleSidebarToggleProjectStar,
    showMobileOpenButton,
    state.activeChatId,
    state.activeProjectId,
    state.keybindings,
    state.closeSidebar,
    state.collapseSidebar,
    state.connectionStatus,
    state.editorLabel,
    state.expandSidebar,
    state.openSidebar,
    state.sidebarCollapsed,
    state.sidebarData,
    state.sidebarOpen,
    state.updateSnapshot,
    state.handleCreateStack,
    state.handleRenameStack,
    state.handleRemoveStack,
    state.handleCreateStackChat,
    state.handleListStackWorktrees,
  ])

  useEffect(() => {
    const seenVersion = storage.getItem(VERSION_SEEN_STORAGE_KEY)
    const shouldRedirect = shouldRedirectToChangelog(location.pathname, currentVersion, seenVersion)
    storage.setItem(VERSION_SEEN_STORAGE_KEY, currentVersion)
    if (!shouldRedirect) return
    navigate("/settings/changelog", { replace: true })
  }, [currentVersion, location.pathname, navigate, storage])

  useLayoutEffect(() => {
    dom.setTitle(APP_NAME)
  }, [dom, location.key])

  useEffect(() => {
    function handlePageShow() {
      dom.setTitle(APP_NAME)
    }

    function handlePageHide() {
      dom.setTitle(APP_NAME)
    }

    const removePageShow = dom.addWindowListener("pageshow", handlePageShow)
    const removePageHide = dom.addWindowListener("pagehide", handlePageHide)
    return () => {
      removePageShow()
      removePageHide()
    }
  }, [dom])

  useEffect(() => {
    const notificationCount = getNotificationTitleCount(state.sidebarData)
    dom.setTitle(notificationCount > 0 ? `[${notificationCount}] ${APP_NAME}` : APP_NAME)
  }, [dom, state.sidebarData])

  useEffect(() => {
    const burstCount = getChatSoundBurstCount(previousSidebarDataRef.current, state.sidebarData)
    previousSidebarDataRef.current = state.sidebarData

    if (burstCount <= 0) return
    if (!shouldPlayChatNotificationSound(state.appSettings, chatSoundPreference)) return

    void playChatNotificationSound(chatSoundId, burstCount).catch(() => undefined)
  }, [chatSoundId, chatSoundPreference, state.appSettings, state.sidebarData])

  const ptyDriverActive = state.appSettings?.claudeDriver.preference === "pty"

  if (state.uiRestartActive) {
    return <AppBootstrap label={state.uiRestartLabel} />
  }

  if (!state.sidebarReady) {
    return <AppBootstrap label="Connecting to workspace" />
  }

  return (
    <div className="flex flex-col h-[100dvh] min-h-[100dvh] overflow-hidden">
      {ptyDriverActive ? (
        <NoticeBanner variant="warning">
          <span className="font-medium text-foreground">PTY driver active.</span>
          <span className="text-muted-foreground">
            Tools run under the <code className="font-mono">claude</code> CLI with subscription billing. Use a worktree for risky tasks.
          </span>
        </NoticeBanner>
      ) : null}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {sidebarElement}
        <div className="flex flex-1 flex-col overflow-hidden">
          <Outlet context={state} />
        </div>
      </div>
      <ChatPolicyDialog
        open={permissionsChatId != null && permissionsChatId === state.activeChatId}
        chatTitle={permissionsChatTitle}
        baseline={POLICY_DEFAULT}
        current={permissionsCurrentOverride}
        onCancel={() => setPermissionsChatId(null)}
        onApply={(next) => {
          if (!permissionsChatId) return
          void state.handleSetChatPolicyOverride(permissionsChatId, next).catch(() => undefined)
          setPermissionsChatId(null)
        }}
      />
    </div>
  )
}

function AuthedApp() {
  const auth = useAppAuthState()

  if (auth.state.status === "checking") {
    return <AppBootstrap label="Checking session" />
  }

  if (auth.state.status === "locked") {
    return <PasswordScreen error={auth.state.error} onSubmit={auth.submitPassword} />
  }

  return (
    <Routes>
      <Route element={<KannaLayout />}>
        <Route path="/" element={<LocalProjectsPage />} />
        <Route path="/settings" element={<Navigate to="/settings/general" replace />} />
        <Route path="/settings/:sectionId" element={<SettingsPage />} />
        <Route path="/chat/:chatId" element={<ChatPage />} />
        <Route path="/workflows/:chatId" element={<WorkflowsPage />} />
      </Route>
    </Routes>
  )
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SocketBridge />
      <TooltipProvider>
        <AppDialogProvider>
          <Routes>
            <Route path="/share/:token" element={<SharePage />} />
            <Route path="*" element={<AuthedApp />} />
          </Routes>
          <Toaster />
        </AppDialogProvider>
      </TooltipProvider>
    </QueryClientProvider>
  )
}
