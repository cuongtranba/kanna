import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react"
import { KannaSocket, type KannaSocketPorts } from "./socket"
import { domAdapter } from "../adapters/dom.adapter"
import type { DomPort } from "../ports/domPort"

/**
 * The app's single WebSocket, owned above the router.
 *
 * It used to be created INSIDE `useKannaState` (`useMemo(() => new
 * KannaSocket(...), [])`), which was correct only while that hook was mounted
 * exactly once. One instance per open chat tab would mean one WebSocket, one
 * heartbeat and one reconnect ladder per tab — so the connection is hoisted to
 * a provider that mounts once, and the hook becomes a consumer.
 *
 * Ownership, not just storage: this provider calls `start()` on mount and
 * `dispose()` on unmount, so the socket's lifetime is the provider's.
 */

const KannaSocketContext = createContext<KannaSocket | null>(null)

/** Derive the ws:// endpoint from the current document location. */
export function wsUrl(dom: DomPort): string {
  const href = dom.getHref()
  const protocol = href.startsWith("https://") ? "wss:" : "ws:"
  const url = new URL(href)
  return `${protocol}//${url.host}/ws`
}

export interface KannaSocketProviderProps {
  children: ReactNode
  /**
   * Pre-built socket. Tests inject a fake here; production leaves it unset and
   * lets the provider build (and own) the real one.
   */
  socket?: KannaSocket
  ports?: KannaSocketPorts
}

export function KannaSocketProvider({ children, socket, ports }: KannaSocketProviderProps) {
  const dom = ports?.dom ?? domAdapter

  // The URL is read once: the DOM port cannot change for the life of the app,
  // and re-creating the socket would drop every live subscription.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const owned = useMemo(() => (socket ? null : new KannaSocket(wsUrl(dom), ports ?? {})), [])
  const instance = socket ?? owned

  useEffect(() => {
    // An injected socket belongs to the caller; only start/dispose our own.
    if (!owned) return
    owned.start()
    return () => {
      owned.dispose()
    }
  }, [owned])

  return <KannaSocketContext.Provider value={instance}>{children}</KannaSocketContext.Provider>
}

/**
 * The socket, or null when no provider is mounted.
 *
 * Nullable rather than throwing so `useKannaState` can accept an explicitly
 * injected socket via its ports without a provider in the tree — hooks cannot
 * be called conditionally, so the throw has to live at the consumer that knows
 * whether an override was supplied.
 */
export function useOptionalKannaSocket(): KannaSocket | null {
  return useContext(KannaSocketContext)
}

export function useKannaSocketInstance(): KannaSocket {
  const socket = useContext(KannaSocketContext)
  if (!socket) {
    throw new Error("useKannaSocketInstance must be used inside a KannaSocketProvider")
  }
  return socket
}
