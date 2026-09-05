
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
