/**
 * AppGlobalProvider — mounts `useAppGlobalState` exactly once at the
 * `KannaLayout` boundary and distributes the result via React context.
 *
 * Guarantee: N mounted `useKannaState` consumers → 1 global subscription
 * set, by construction. The provider is placed ABOVE `useKannaState` in the
 * component tree; consumers read the shared state via `useAppGlobalContext()`.
 *
 * Architecture: .c3/adr/adr-20260715-client-state-effect-architecture.md
 */

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

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const AppGlobalContext = createContext<AppGlobalState | null>(null)

// ---------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------

export interface AppGlobalProviderPorts {
  localStore?: StoragePort
  sessStore?: StoragePort
  dom?: DomPort
  timer?: TimerPort
  clipboard?: ClipboardPort
  /**
   * Overrides the socket from `KannaSocketProvider`. For tests only —
   * production shares the one connection the provider owns.
   */
  socket?: KannaSocket
  /**
   * Overrides the default chatNavigator (built from useNavigate). For tests
   * only — production uses makeChatNavigator(useNavigate()).
   */
  chatNavigator?: ChatNavigatorPort
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

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

  // ChatNavigator: one useNavigate() call at the provider boundary, shared by
  // all useKannaState consumers mounted beneath this provider.
  const navigate = useNavigate()
  const defaultChatNavigator = useMemo(() => makeChatNavigator(navigate), [navigate])
  const chatNavigator = ports.chatNavigator ?? defaultChatNavigator

  // Socket: prefer the injected test override; fall back to the provider.
  // Both calls must happen before any conditional throw (hooks rules).
  const fromContext = useOptionalKannaSocket()

  // Route params: chatId from the matched child route (e.g. /chat/:chatId).
  // React Router v6 merges all matched-route params, so the parent element
  // sees child params when a child route is active.
  const { chatId } = useParams<{ chatId: string }>()
  const activeChatId = chatId ?? null

  // Runtime from the per-chat store. Starts null on first render (before the
  // per-chat subscription fires in useKannaState); useAppGlobalState handles
  // null gracefully. Stale-snapshot masking mirrors getActiveChatSnapshot.
  const runtime = useChatStateStore((state) => {
    if (!activeChatId) return null
    const { chatSnapshot } = selectChatSlice(state, activeChatId)
    if (!chatSnapshot) return null
    // Mask stale snapshots: the store may briefly hold a previous chat's
    // snapshot while navigation is in flight.
    if (chatSnapshot.runtime.chatId !== activeChatId) return null
    return chatSnapshot.runtime
  })

  // After all hooks: resolve the socket and throw if absent (programming error).
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

// ---------------------------------------------------------------------------
// Consumer hook
// ---------------------------------------------------------------------------

export function useAppGlobalContext(): AppGlobalState {
  const ctx = useContext(AppGlobalContext)
  if (ctx === null) {
    throw new Error(
      "useAppGlobalContext must be called inside an AppGlobalProvider",
    )
  }
  return ctx
}
