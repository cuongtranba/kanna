import { useEffect, useRef } from "react"
import type { SidebarData } from "../../shared/types"
import { usePaneLayoutStore } from "../stores/paneLayoutStore"
import { getChatsNewlyWaiting } from "./chatNotifications"

export function useWaitingChatTabs(sidebarData: SidebarData, sidebarReady: boolean) {
  const openTab = usePaneLayoutStore((state) => state.openTab)
  const previousSidebarDataRef = useRef<SidebarData | null>(null)

  useEffect(() => {
    if (!sidebarReady) return

    const newlyWaiting = getChatsNewlyWaiting(previousSidebarDataRef.current, sidebarData)
    previousSidebarDataRef.current = sidebarData

    for (const chatId of newlyWaiting) {
      openTab({ kind: "chat", chatId }, { focus: false })
    }
  }, [openTab, sidebarData, sidebarReady])
}
