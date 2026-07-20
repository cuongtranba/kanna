import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { KannaSocket } from "./socket"
import type { ComputedStyleLike, DomPort, ServiceWorkerRegistrationLike } from "../ports/domPort"
import type { TimerPort } from "../ports/timerPort"
import type { StoragePort } from "../ports/storagePort"
import type { WebSocketPort, WebSocketLike, WsEventPayload } from "../ports/webSocketPort"

// ---------------------------------------------------------------------------
// Fake WebSocket
// ---------------------------------------------------------------------------

type WsHandler = (event?: WsEventPayload) => void

class FakeWebSocket implements WebSocketLike {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3
  static instances: FakeWebSocket[] = []

  readonly sent: Array<Record<string, unknown>> = []
  private readonly listeners = new Map<string, Set<WsHandler>>()
  readyState = FakeWebSocket.CONNECTING

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this)
  }

  addEventListener(type: string, listener: WsHandler) {
    let handlers = this.listeners.get(type)
    if (!handlers) {
      handlers = new Set()
      this.listeners.set(type, handlers)
    }
    handlers.add(listener)
  }

  send(message: string) {
    this.sent.push(JSON.parse(message))
  }

  open() {
    this.readyState = FakeWebSocket.OPEN
    this.emit("open")
  }

  receive(message: Record<string, unknown>) {
    this.emit("message", new MessageEvent("message", { data: JSON.stringify(message) }))
  }

  close() {
    if (this.readyState === FakeWebSocket.CLOSED) return
    this.readyState = FakeWebSocket.CLOSED
    this.emit("close")
  }

  private emit(type: string, event?: WsEventPayload) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event)
    }
  }
}

// ---------------------------------------------------------------------------
// Fake WebSocketPort
// ---------------------------------------------------------------------------

function makeFakeWebSocketPort(): WebSocketPort {
  return {
    CONNECTING: FakeWebSocket.CONNECTING,
    OPEN: FakeWebSocket.OPEN,
    CLOSING: FakeWebSocket.CLOSING,
    CLOSED: FakeWebSocket.CLOSED,
    create(url: string): WebSocketLike {
      return new FakeWebSocket(url)
    },
  }
}

// ---------------------------------------------------------------------------
// Fake TimerPort
// ---------------------------------------------------------------------------

class FakeTimers implements TimerPort {
  private nextId = 1
  readonly timeouts = new Map<number, () => void>()
  readonly intervals = new Map<number, () => void>()

  setTimeout(callback: () => void): number {
    const id = this.nextId++
    this.timeouts.set(id, callback)
    return id
  }

  clearTimeout(id: number): void {
    this.timeouts.delete(id)
  }

  setInterval(callback: () => void): number {
    const id = this.nextId++
    this.intervals.set(id, callback)
    return id
  }

  clearInterval(id: number): void {
    this.intervals.delete(id)
  }

  requestAnimationFrame(_callback: (timestamp: number) => void): number {
    return this.nextId++
  }

  cancelAnimationFrame(_id: number): void { /* no-op */ }

  runTimeout(id: number) {
    const callback = this.timeouts.get(id)
    if (!callback) return
    this.timeouts.delete(id)
    callback()
  }

  runInterval(id: number) {
    this.intervals.get(id)?.()
  }
}

// ---------------------------------------------------------------------------
// Fake DomPort
// ---------------------------------------------------------------------------

type DomHandler = (event?: Event) => void

class FakeDomPort implements DomPort {
  private readonly windowListeners = new Map<string, Set<DomHandler>>()
  private readonly documentListeners = new Map<string, Set<DomHandler>>()
  visibilityState: DocumentVisibilityState = "visible"
  href = "http://localhost/"
  lastSetHref: string | null = null

  getTitle(): string { return "" }
  setTitle(_title: string): void { /* no-op */ }
  getVisibilityState(): DocumentVisibilityState { return this.visibilityState }
  hasFocus(): boolean { return true }
  getHref(): string { return this.href }
  getPathname(): string { return "/" }
  getSearch(): string { return "" }
  reload(): void { /* no-op */ }
  getUserAgent(): string { return "FakeBrowser/1.0" }
  isSecureContext(): boolean { return true }
  getInnerWidth(): number { return 1024 }
  getInnerHeight(): number { return 768 }
  setBodyStyle(_property: string, _value: string): void { /* no-op */ }
  getBodyStyle(_property: string): string { return "" }

  setHref(href: string): void {
    this.lastSetHref = href
    this.href = href
  }

  addServiceWorkerMessageListener(_handler: (event: MessageEvent) => void): () => void {
    return () => { /* no-op */ }
  }

  getActiveElement(): Element | null { return null }
  getSelection(): Selection | null { return null }
  hasFocusOverlay(): boolean { return false }
  hasTypeaheadMenuOpen(): boolean { return false }

  addWindowCaptureListener<K extends keyof WindowEventMap>(
    type: K,
    handler: (event: WindowEventMap[K]) => void,
  ): () => void {
    return this.addWindowListener(type, handler)
  }

  addWindowCustomListener(_type: string, _handler: () => void): () => void {
    return () => { /* no-op */ }
  }

  getHostname(): string { return "localhost" }
  isServiceWorkerSupported(): boolean { return true }
  isPushManagerSupported(): boolean { return true }

  async registerServiceWorker(): Promise<ServiceWorkerRegistrationLike> {
    return { pushManager: { subscribe: async () => { throw new Error("not used in socket tests") }, getSubscription: async () => null } }
  }

  async getReadyServiceWorkerRegistration(): Promise<ServiceWorkerRegistrationLike> {
    return { pushManager: { subscribe: async () => { throw new Error("not used in socket tests") }, getSubscription: async () => null } }
  }

  upsertHeadMeta(_name: string, _content: string): void { /* no-op */ }
  getComputedBackgroundColor(): string { return "" }
  setDocumentElementColorScheme(_scheme: "light" | "dark"): void { /* no-op */ }
  toggleDocumentElementClass(_className: string, _force: boolean): void { /* no-op */ }
  matchesMediaQuery(_query: string): boolean { return false }
  addMediaQueryListener(_query: string, _handler: (matches: boolean) => void): () => void {
    return () => { /* no-op */ }
  }

  isWebShareSupported(): boolean { return false }
  webShare(_data: { title?: string; url?: string }): Promise<void> { return Promise.resolve() }
  getBaseURI(): string { return "http://localhost/" }
  triggerDownload(_url: string, _filename: string): void { /* no-op */ }
  getCssVar(_name: string, fallback: string): string { return fallback }
  getComputedStyle(_element: Element): ComputedStyleLike { return { paddingLeft: "", paddingRight: "", paddingTop: "", paddingBottom: "" } }
  getOrigin(): string { return "http://localhost" }
  openWindow(_url: string, _target: string, _features: string): void { /* no-op */ }
  dispatchContextMenuEvent(_target: EventTarget, _clientX: number, _clientY: number): void { /* no-op */ }
  isTouchDevice(): boolean { return false }
  isIOSStandalone(): boolean { return false }
  getBodyElement(): Element { return document.body }
  confirmDialog(_message: string): boolean { return true }
  dispatchCustomWindowEvent(_type: string): void { /* no-op */ }
  createElement<K extends keyof HTMLElementTagNameMap>(tagName: K): HTMLElementTagNameMap[K] {
    return document.createElement(tagName)
  }

  addWindowListenerWithOptions<K extends keyof WindowEventMap>(
    type: K,
    handler: (event: WindowEventMap[K]) => void,
    _options: AddEventListenerOptions,
  ): () => void {
    return this.addWindowListener(type, handler)
  }

  addWindowListener<K extends keyof WindowEventMap>(
    type: K,
    handler: (event: WindowEventMap[K]) => void,
  ): () => void {
    let handlers = this.windowListeners.get(type as string)
    if (!handlers) {
      handlers = new Set()
      this.windowListeners.set(type as string, handlers)
    }
    handlers.add(handler as DomHandler)
    return () => {
      this.windowListeners.get(type as string)?.delete(handler as DomHandler)
    }
  }

  addDocumentListener<K extends keyof DocumentEventMap>(
    type: K,
    handler: (event: DocumentEventMap[K]) => void,
  ): () => void {
    let handlers = this.documentListeners.get(type as string)
    if (!handlers) {
      handlers = new Set()
      this.documentListeners.set(type as string, handlers)
    }
    handlers.add(handler as DomHandler)
    return () => {
      this.documentListeners.get(type as string)?.delete(handler as DomHandler)
    }
  }

  dispatchWindowEvent(type: string, event?: Event) {
    for (const handler of this.windowListeners.get(type) ?? []) {
      handler(event)
    }
  }

  dispatchDocumentEvent(type: string, event?: Event) {
    for (const handler of this.documentListeners.get(type) ?? []) {
      handler(event)
    }
  }
}

// ---------------------------------------------------------------------------
// Fake StoragePort
// ---------------------------------------------------------------------------

function makeFakeStoragePort(): StoragePort {
  const store = new Map<string, string>()
  return {
    getItem(key: string): string | null { return store.get(key) ?? null },
    setItem(key: string, value: string): void { store.set(key, value) },
    removeItem(key: string): void { store.delete(key) },
    clear(): void { store.clear() },
  }
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makePorts() {
  const dom = new FakeDomPort()
  const timer = new FakeTimers()
  const webSocket = makeFakeWebSocketPort()
  const localStorage = makeFakeStoragePort()
  const sessionStorage = makeFakeStoragePort()
  return { dom, timer, webSocket, localStorage, sessionStorage }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("KannaSocket", () => {
  beforeEach(() => {
    FakeWebSocket.instances = []
  })

  afterEach(() => {
    FakeWebSocket.instances = []
  })

  test("does not ping when the connection is already fresh", async () => {
    const ports = makePorts()
    const socket = new KannaSocket("ws://localhost/ws", ports)
    socket.start()
    const ws = FakeWebSocket.instances[0]!
    ws.open()

    await socket.ensureHealthyConnection()

    expect(ws.sent).toHaveLength(0)
    socket.dispose()
  })

  test("pings a stale open connection and resolves when acked", async () => {
    const ports = makePorts()
    const socket = new KannaSocket("ws://localhost/ws", ports)
    socket.start()
    const ws = FakeWebSocket.instances[0]!
    ws.open()
    ;(socket as any).lastOpenAt = Date.now() - 30_000
    ;(socket as any).lastMessageAt = Date.now() - 30_000

    const healthCheck = socket.ensureHealthyConnection()
    const ping = ws.sent[0]

    expect(ping?.type).toBe("command")
    expect(ping?.command).toEqual({ type: "system.ping" })

    ws.receive({ v: 1, type: "ack", id: ping?.id })
    await healthCheck

    expect(FakeWebSocket.instances).toHaveLength(1)
    socket.dispose()
  })

  test("reconnects immediately when a stale ping times out", async () => {
    const ports = makePorts()
    const socket = new KannaSocket("ws://localhost/ws", ports)
    socket.start()
    const firstWs = FakeWebSocket.instances[0]!
    firstWs.open()
    ;(socket as any).lastOpenAt = Date.now() - 30_000
    ;(socket as any).lastMessageAt = Date.now() - 30_000

    const healthCheck = socket.ensureHealthyConnection()
    ports.timer.runTimeout((socket as any).pingTimeoutTimer)

    await expect(healthCheck).rejects.toThrow("Disconnected")
    expect(FakeWebSocket.instances).toHaveLength(2)
    expect(FakeWebSocket.instances[1]?.readyState).toBe(FakeWebSocket.CONNECTING)
    socket.dispose()
  })

  test("runs health checks on focus, visibility restore, and online", async () => {
    const ports = makePorts()
    const socket = new KannaSocket("ws://localhost/ws", ports)
    socket.start()
    const ws = FakeWebSocket.instances[0]!
    ws.open()

    ;(socket as any).lastOpenAt = Date.now() - 30_000
    ;(socket as any).lastMessageAt = Date.now() - 30_000
    ports.dom.dispatchWindowEvent("focus")
    let ping = ws.sent.pop()
    ws.receive({ v: 1, type: "ack", id: ping?.id })
    await Promise.resolve()

    ports.dom.visibilityState = "hidden"
    ports.dom.dispatchDocumentEvent("visibilitychange")
    ;(socket as any).lastOpenAt = Date.now() - 30_000
    ;(socket as any).lastMessageAt = Date.now() - 30_000
    ports.dom.visibilityState = "visible"
    ports.dom.dispatchDocumentEvent("visibilitychange")
    ping = ws.sent.pop()
    ws.receive({ v: 1, type: "ack", id: ping?.id })
    await Promise.resolve()

    ;(socket as any).lastOpenAt = Date.now() - 30_000
    ;(socket as any).lastMessageAt = Date.now() - 30_000
    ports.dom.dispatchWindowEvent("online")
    ping = ws.sent.pop()

    expect(ping?.command).toEqual({ type: "system.ping" })
    ws.receive({ v: 1, type: "ack", id: ping?.id })
    await Promise.resolve()
    socket.dispose()
  })

  test("keeps queued commands and flushes them once the socket opens", async () => {
    const ports = makePorts()
    const socket = new KannaSocket("ws://localhost/ws", ports)
    socket.start()
    const ws = FakeWebSocket.instances[0]!
    const pingPromise = socket.command({ type: "system.ping" })

    expect(ws.sent).toHaveLength(0)

    ws.open()
    const ping = ws.sent[0]
    ws.receive({ v: 1, type: "ack", id: ping?.id })

    await expect(pingPromise).resolves.toBeUndefined()
    expect(ws.sent).toHaveLength(1)
    socket.dispose()
  })

  test("sends heartbeat checks while visible", async () => {
    const ports = makePorts()
    const socket = new KannaSocket("ws://localhost/ws", ports)
    socket.start()
    const ws = FakeWebSocket.instances[0]!
    ws.open()
    ;(socket as any).lastOpenAt = Date.now() - 30_000
    ;(socket as any).lastMessageAt = Date.now() - 30_000

    ports.timer.runInterval((socket as any).heartbeatTimer)

    expect(ws.sent[0]?.command).toEqual({ type: "system.ping" })
    ws.receive({ v: 1, type: "ack", id: ws.sent[0]?.id })
    await Promise.resolve()
    socket.dispose()
  })
})
