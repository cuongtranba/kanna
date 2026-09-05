
export type WsEventPayload = MessageEvent | Event

export interface WebSocketLike {
  readonly readyState: number
  send(data: string): void
  close(): void
  addEventListener(type: string, handler: (event?: WsEventPayload) => void): void
}

export interface WebSocketPort {
  readonly CONNECTING: number
  readonly OPEN: number
  readonly CLOSING: number
  readonly CLOSED: number
  create(url: string): WebSocketLike
}
