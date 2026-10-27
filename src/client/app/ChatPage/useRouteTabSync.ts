import { useCallback, useEffect, useMemo } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { collectPanes, fallbackPathAfterClose, pageTargetForPath, type PageTabTarget, type PaneTabTarget, chatPath } from "../../lib/paneTree"
import { usePaneLayoutStore } from "../../stores/paneLayoutStore"
import { useAppGlobalContext } from "../AppGlobalProvider"

interface RouteTabSyncArgs {
  activeChatId: string | null
  routeBoardId: string | undefined
}

export interface RouteTabSync {
  routePage: PageTabTarget | null
  syncUrlToFocusedTab: () => void
  closeRoutedTab: (tabId: string, target: PaneTabTarget) => void
}

export function useRouteTabSync({ activeChatId, routeBoardId }: RouteTabSyncArgs): RouteTabSync {
  const location = useLocation()
  const navigate = useNavigate()
  const chatNavigator = useAppGlobalContext().chatNavigator
  const openTab = usePaneLayoutStore((s) => s.openTab)
  const closeTab = usePaneLayoutStore((s) => s.closeTab)
  const getPaneLayout = usePaneLayoutStore((s) => s.getLayout)
  const pathname = location.pathname
  const locationKey = location.key

  const routePage = useMemo(() => pageTargetForPath(pathname), [pathname])

  useEffect(() => {
    if (routePage) {
      openTab(routePage)
      return
    }
    if (activeChatId) openTab({ kind: "chat", chatId: activeChatId })
    if (routeBoardId) openTab({ kind: "board", boardId: routeBoardId })
  }, [locationKey, routePage, activeChatId, routeBoardId, openTab])

  const syncUrlToFocusedTab = useCallback(() => {
    const layout = getPaneLayout()
    const pane = collectPanes(layout.root).find((candidate) => candidate.id === layout.focusedPaneId)
    const target = pane?.tabs.find((tab) => tab.tabId === pane.focusedTabId)?.target
    if (target?.kind === "chat" && pathname !== chatPath(target.chatId)) {
      chatNavigator.openChat(target.chatId)
    }
    if (target?.kind === "page" && pathname !== target.path) {
      navigate(target.path)
    }
  }, [getPaneLayout, pathname, chatNavigator, navigate])

  const closeRoutedTab = useCallback(
    (tabId: string, target: PaneTabTarget) => {
      closeTab(tabId)
      const ownsUrl =
        target.kind === "page"
          ? routePage?.page === target.page
          : target.kind === "chat" && !routePage && target.chatId === activeChatId
      if (!ownsUrl) return
      const fallback = fallbackPathAfterClose(getPaneLayout())
      if (fallback !== pathname) navigate(fallback)
    },
    [closeTab, getPaneLayout, routePage, activeChatId, pathname, navigate],
  )

  return { routePage, syncUrlToFocusedTab, closeRoutedTab }
}
