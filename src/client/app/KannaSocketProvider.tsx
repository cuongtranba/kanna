import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react"
import { KannaSocket, type KannaSocketPorts } from "./socket"
import { domAdapter } from "../adapters/dom.adapter"
import type { DomPort } from "../ports/domPort"


const KannaSocketContext = createContext<KannaSocket | null>(null)

export function wsUrl(dom: DomPort): string {
  const href = dom.getHref()
  const protocol = href.startsWith("https://") ? "wss:" : "ws:"
  const url = new URL(href)
  return `${protocol}//${url.host}/ws`
}

export interface KannaSocketProviderProps {
  children: ReactNode
  socket?: KannaSocket
  ports?: KannaSocketPorts
}

export function KannaSocketProvider({ children, socket, ports }: KannaSocketProviderProps) {
  const dom = ports?.dom ?? domAdapter

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const owned = useMemo(() => (socket ? null : new KannaSocket(wsUrl(dom), ports ?? {})), [])
  const instance = socket ?? owned

  useEffect(() => {
    if (!owned) return
    owned.start()
    return () => {
      owned.dispose()
    }
  }, [owned])

  return <KannaSocketContext.Provider value={instance}>{children}</KannaSocketContext.Provider>
}

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
