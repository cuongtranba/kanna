import { parseBeaconFrame, type BeaconFrame } from "../shared/beacon-protocol"
import { safeJsonParse } from "../shared/json"
import type { BeaconTransport } from "./ports"

export interface WebSocketTransportDeps {
  url: string
}

export function createWebSocketTransport(deps: WebSocketTransportDeps): BeaconTransport {
  const socket = new WebSocket(deps.url)
  const frameListeners: Array<(frame: BeaconFrame) => void> = []
  const closeListeners: Array<() => void> = []
  const pending: string[] = []
  let closed = false

  socket.addEventListener("open", () => {
    for (const message of pending.splice(0)) socket.send(message)
  })
  socket.addEventListener("message", (event) => {
    if (typeof event.data !== "string") return
    const parsed = safeJsonParse(event.data)
    if (parsed === null) return
    const frame = parseBeaconFrame(parsed)
    if (frame === null) return
    for (const listener of frameListeners) listener(frame)
  })
  socket.addEventListener("close", () => {
    if (closed) return
    closed = true
    for (const listener of closeListeners) listener()
  })
  socket.addEventListener("error", () => {
    socket.close()
  })

  return {
    send(frame) {
      const message = JSON.stringify(frame)
      if (socket.readyState === WebSocket.OPEN) socket.send(message)
      else if (socket.readyState === WebSocket.CONNECTING) pending.push(message)
    },
    onFrame(callback) {
      frameListeners.push(callback)
    },
    onClose(callback) {
      closeListeners.push(callback)
    },
    close() {
      socket.close()
    },
  }
}
