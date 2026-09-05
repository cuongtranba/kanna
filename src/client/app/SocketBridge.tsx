
import { useEffect, useMemo } from "react"
import { useWebSocket } from "../lib/useWebSocket"
import { domAdapter } from "../adapters/dom.adapter"
import type { DomPort } from "../ports/domPort"
import { useSocketStore } from "../stores/socketStore"

function getWsUrl(dom: DomPort): string {
  const origin = dom.getOrigin()
  return `${origin.replace(/^https:/, "wss:").replace(/^http:/, "ws:")}/ws`
}

export interface SocketBridgePorts {
  dom?: DomPort
}

export function SocketBridge({ dom = domAdapter }: SocketBridgePorts = {}): null {
  const setReadyState = useSocketStore((s) => s.setReadyState)
  const setSendMessage = useSocketStore((s) => s.setSendMessage)

  const wsUrl = useMemo(() => getWsUrl(dom), [dom])

  const { sendMessage, readyState } = useWebSocket(wsUrl, {
    share: true,
    filter: () => false,
    onMessage: (_event: MessageEvent) => {
    },
    shouldReconnect: () => true,
  })

  useEffect(() => {
    setReadyState(readyState)
  }, [readyState, setReadyState])

  useEffect(() => {
    setSendMessage(sendMessage)
  }, [sendMessage, setSendMessage])

  return null
}
