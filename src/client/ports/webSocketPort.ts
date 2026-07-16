/**
 * WebSocketPort — typed interface for WebSocket construction.
 *
 * Abstracts `new WebSocket(url)` so that the protocol layer (KannaSocket) never
 * references the global WebSocket constructor directly. The concrete implementation
 * is src/client/adapters/websocket.adapter.ts.
 *
 * Architecture: .c3/adr/adr-20260715-client-state-effect-architecture.md
 */

/** Event handler payload used by KannaSocket's WebSocket listeners. */
export type WsEventPayload = MessageEvent | Event

/** Subset of the WebSocket API used by KannaSocket. */
export interface WebSocketLike {
  readonly readyState: number
  send(data: string): void
  close(): void
  /**
   * Register an event handler for the given event type.
   * Only "open", "close", "message", and "error" are used by KannaSocket.
   * The handler receives the event payload (undefined for "open"/"close").
   */
  addEventListener(type: string, handler: (event?: WsEventPayload) => void): void
}

/** Factory port that creates a new WebSocket connection to the given URL. */
export interface WebSocketPort {
  /** ReadyState constants mirroring the WebSocket static fields. */
  readonly CONNECTING: number
  readonly OPEN: number
  readonly CLOSING: number
  readonly CLOSED: number
  /** Creates a new WebSocket connection. */
  create(url: string): WebSocketLike
}
