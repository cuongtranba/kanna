/**
 * websocket.adapter.ts — Browser WebSocket implementation of WebSocketPort.
 *
 * The ONLY file in src/client/ that is permitted to reference the raw WebSocket
 * constructor. All other code uses WebSocketPort injected via KannaSocketPorts.
 *
 * Architecture: .c3/adr/adr-20260715-client-state-effect-architecture.md
 */

import type { WebSocketPort } from "../ports/webSocketPort"

export const webSocketAdapter: WebSocketPort = {
  CONNECTING: WebSocket.CONNECTING,
  OPEN: WebSocket.OPEN,
  CLOSING: WebSocket.CLOSING,
  CLOSED: WebSocket.CLOSED,

  create(url: string) {
    return new WebSocket(url)
  },
}
