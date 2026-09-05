
import { createContext, useContext, useMemo, type ReactNode } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { type AppGlobalState, useAppGlobalState } from "./useAppGlobalState"
import { type ChatNavigatorPort, makeChatNavigator } from "./chatNavigator"
import { selectChatSlice, useChatStateStore } from "../stores/chatStateStore"
import { useOptionalKannaSocket } from "./KannaSocketProvider"
import type { KannaSocket } from "./socket"
import type { StoragePort } from "../ports/storagePort"
import type { DomPort } from "../ports/domPort"
import type { TimerPort } from "../ports/timerPort"
import type { ClipboardPort } from "../ports/clipboardPort"
import { localStorageAdapter, sessionStorageAdapter } from "../adapters/storage.adapter"
import { domAdapter } from "../adapters/dom.adapter"
import { timerAdapter } from "../adapters/timer.adapter"
import { clipboardAdapter } from "../adapters/clipboard.adapter"


const AppGlobalContext = createContext<AppGlobalState | null>(null)


export interface AppGlobalProviderPorts {
  localStore?: StoragePort
  sessStore?: StoragePort
  dom?: DomPort
  timer?: TimerPort
  clipboard?: ClipboardPort
  socket?: KannaSocket
  chatNavigator?: ChatNavigatorPort
}


export function AppGlobalProvider({
  children,
  ports = {},
}: {
  children: ReactNode
  ports?: AppGlobalProviderPorts
}) {
  const localStore = ports.localStore ?? localStorageAdapter
  const sessStore = ports.sessStore ?? sessionStorageAdapter
  const dom = ports.dom ?? domAdapter
  const timer = ports.timer ?? timerAdapter
  const clipboard = ports.clipboard ?? clipboardAdapter

  const navigate = useNavigate()
  const defaultChatNavigator = useMemo(() => makeChatNavigator(navigate), [navigate])
  const chatNavigator = ports.chatNavigator ?? defaultChatNavigator

  const fromContext = useOptionalKannaSocket()

  const { chatId } = useParams<{ chatId: string }>()
  const activeChatId = chatId ?? null

  const runtime = useChatStateStore((state) => {
    if (!activeChatId) return null
    const { chatSnapshot } = selectChatSlice(state, activeChatId)
    if (!chatSnapshot) return null
    if (chatSnapshot.runtime.chatId !== activeChatId) return null
    return chatSnapshot.runtime
  })

  const socket = ports.socket ?? fromContext
  if (!socket) {
    throw new Error(
      "AppGlobalProvider requires a KannaSocket: mount inside KannaSocketProvider or pass ports.socket",
    )
  }

  const appGlobal = useAppGlobalState(
    socket,
    localStore,
    sessStore,
    dom,
    timer,
    clipboard,
    activeChatId,
    runtime,
    chatNavigator,
  )

  return (
    <AppGlobalContext.Provider value={appGlobal}>
      {children}
    </AppGlobalContext.Provider>
  )
}


export function useAppGlobalContext(): AppGlobalState {
  const ctx = useContext(AppGlobalContext)
  if (ctx === null) {
    throw new Error(
      "useAppGlobalContext must be called inside an AppGlobalProvider",
    )
  }
  return ctx
}
