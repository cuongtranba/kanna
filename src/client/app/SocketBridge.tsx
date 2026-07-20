/**
 * SocketBridge.tsx — react-use-websocket raw-transport mount point.
 *
 * This component:
 *   1. Calls useWebSocket with `filter: () => false` + `onMessage` so that incoming
 *      frames DO NOT trigger any React re-renders (no `lastJsonMessage` / `lastMessage`
 *      state updates). onMessage feeds Kanna's protocol layer instead.
 *   2. Writes sendMessage + readyState into socketStore (Zustand) so the rest of the
 *      client can send and observe connection state without touching the hook directly.
 *   3. Renders nothing — it is a pure effect component mounted once at the App root.
 *
 * IMPORTANT — protocol relocation is a LATER chunk (see plan .c3/adr/adr-20260715-...):
 *   The actual correlation/subscription/queue/heartbeat logic that today lives in
 *   socket.ts is NOT yet moved here. The onMessage handler below is a stub — when the
 *   burn-down chunk lands it will call into socket-protocol.ts.
 *
 * Architecture: see .c3/adr/adr-20260715-client-state-effect-architecture.md
 * Component: c3-101 (socket-client)
 */

import { useEffect } from "react"
import useWebSocket from "react-use-websocket"
import { domAdapter } from "../adapters/dom.adapter"
import type { DomPort } from "../ports/domPort"
import { useSocketStore } from "../stores/socketStore"

/** Derive the WebSocket URL from the current page URL (ws: / wss: mirrors http: / https:). */
function getWsUrl(dom: DomPort): string {
  const origin = dom.getOrigin()
  return `${origin.replace(/^https:/, "wss:").replace(/^http:/, "ws:")}/ws`
}

export interface SocketBridgePorts {
  dom?: DomPort
}

/**
 * SocketBridge mounts once at the App root (inside QueryClientProvider, before routes).
 * It is the ONLY component allowed to call useWebSocket — all other code reads from
 * socketStore or calls socketStore.getState().sendMessage(...).
 */
export function SocketBridge({ dom = domAdapter }: SocketBridgePorts = {}): null {
  const setReadyState = useSocketStore((s) => s.setReadyState)
  const setSendMessage = useSocketStore((s) => s.setSendMessage)

  const { sendMessage, readyState } = useWebSocket(() => getWsUrl(dom), {
    share: true,
    // filter: () => false prevents re-renders from lastMessage / lastJsonMessage state.
    // onMessage receives all frames without triggering React state updates.
    filter: () => false,
    // TODO (later burn-down chunk): route the message into socket-protocol.ts dispatcher.
    onMessage: (_event: MessageEvent) => {
      // Stub — full protocol relocation happens in a later chunk.
      // The existing KannaSocket in socket.ts continues to handle the live connection
      // until that chunk migrates correlation/subscription/queue/heartbeat logic here.
    },
    shouldReconnect: () => true,
  })

  // Write readyState into socketStore whenever it changes.
  useEffect(() => {
    setReadyState(readyState)
  }, [readyState, setReadyState])

  // Write the stable sendMessage function into socketStore once on mount.
  useEffect(() => {
    setSendMessage(sendMessage)
  }, [sendMessage, setSendMessage])

  return null
}
