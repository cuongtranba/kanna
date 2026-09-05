
import type { JsonValue } from "../../../shared/json"
import type { HttpPort, HttpRequestOptions, HttpResponse } from "../../ports/httpPort"
import type { StoragePort } from "../../ports/storagePort"
import type { TimerPort } from "../../ports/timerPort"
import type { ComputedStyleLike, DomPort, ServiceWorkerRegistrationLike } from "../../ports/domPort"
import type { NotificationPort, NotificationPermission } from "../../ports/notificationPort"
import type { SoundPort } from "../../ports/soundPort"
import type { ClipboardPort } from "../../ports/clipboardPort"
import type { WebSocketPort, WebSocketLike, WsEventPayload } from "../../ports/webSocketPort"


export interface FakeHttpRoute {
  method: string
  url: string
  response: FakeHttpResponse
}

export interface FakeHttpResponse {
  ok: boolean
  status: number
  body: ReturnType<typeof JSON.parse>
  headers?: Record<string, string>
}

export interface FakeHttpPort extends HttpPort {
  routes: FakeHttpRoute[]
  calls: Array<{ method: string; url: string }>
}

function matchRoute(routes: FakeHttpRoute[], method: string, url: string): FakeHttpRoute | undefined {
  return routes.find((r) => r.method === method && url.startsWith(r.url))
}

function buildFakeResponse<T>(route: FakeHttpRoute): HttpResponse<T> {
  const data: T = route.response.body
  return {
    ok: route.response.ok,
    status: route.response.status,
    data,
    headers: route.response.headers ?? {},
  }
}

export function makeFakeHttpPort(): FakeHttpPort {
  const routes: FakeHttpRoute[] = []
  const calls: Array<{ method: string; url: string }> = []

  return {
    routes,
    calls,

    async getJson<T>(url: string, _options?: Omit<HttpRequestOptions, "method" | "body">): Promise<HttpResponse<T>> {
      calls.push({ method: "GET", url })
      const route = matchRoute(routes, "GET", url)
      if (!route) throw new Error(`[FakeHttpPort] No GET route registered for ${url}`)
      return buildFakeResponse<T>(route)
    },

    async postJson<T>(
      url: string,
      _body: Record<string, string | number | boolean | null | undefined>,
      _options?: Omit<HttpRequestOptions, "method" | "body">,
    ): Promise<HttpResponse<T>> {
      calls.push({ method: "POST", url })
      const route = matchRoute(routes, "POST", url)
      if (!route) throw new Error(`[FakeHttpPort] No POST route registered for ${url}`)
      return buildFakeResponse<T>(route)
    },

    async postJsonBody<T>(
      url: string,
      _body: JsonValue,
      _options?: Omit<HttpRequestOptions, "method" | "body">,
    ): Promise<HttpResponse<T>> {
      calls.push({ method: "POST", url })
      const route = matchRoute(routes, "POST", url)
      if (!route) throw new Error(`[FakeHttpPort] No POST route registered for ${url}`)
      return buildFakeResponse<T>(route)
    },

    async head(url: string, _options?: Omit<HttpRequestOptions, "method" | "body">) {
      calls.push({ method: "HEAD", url })
      const route = matchRoute(routes, "HEAD", url)
      if (!route) throw new Error(`[FakeHttpPort] No HEAD route registered for ${url}`)
      return {
        ok: route.response.ok,
        status: route.response.status,
        headers: route.response.headers ?? {},
      }
    },

    async del(url: string, _options?: Omit<HttpRequestOptions, "method" | "body">) {
      calls.push({ method: "DELETE", url })
      const route = matchRoute(routes, "DELETE", url)
      if (!route) throw new Error(`[FakeHttpPort] No DELETE route registered for ${url}`)
      return { ok: route.response.ok, status: route.response.status }
    },

    async streamBytes(url: string, _options?: Omit<HttpRequestOptions, "method" | "body">) {
      calls.push({ method: "GET_STREAM", url })
      const route = matchRoute(routes, "GET", url)
      if (!route) throw new Error(`[FakeHttpPort] No GET route registered for streaming ${url}`)
      const text = route.response.body !== null ? JSON.stringify(route.response.body) : ""
      const bytes = new TextEncoder().encode(text)
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes)
          controller.close()
        },
      })
      return { body, ok: route.response.ok, status: route.response.status }
    },
  }
}


export interface FakeStoragePort extends StoragePort {
  store: Map<string, string>
}

export function makeFakeStoragePort(): FakeStoragePort {
  const store = new Map<string, string>()
  return {
    store,
    getItem(key: string): string | null {
      return store.get(key) ?? null
    },
    setItem(key: string, value: string): void {
      store.set(key, value)
    },
    removeItem(key: string): void {
      store.delete(key)
    },
    clear(): void {
      store.clear()
    },
  }
}


export interface FakeTimerCallback {
  id: number
  kind: "timeout" | "interval"
  callback: () => void
  ms: number
  cleared: boolean
}

export interface FakeTimerPort extends TimerPort {
  callbacks: FakeTimerCallback[]
  flushTimeouts(): void
  flushIntervals(): void
}

export function makeFakeTimerPort(): FakeTimerPort {
  let nextId = 1
  const callbacks: FakeTimerCallback[] = []

  const raf: Array<{ id: number; callback: (ts: number) => void; cancelled: boolean }> = []
  let rafId = 1000

  return {
    callbacks,

    setTimeout(callback: () => void, ms: number): number {
      const id = nextId++
      callbacks.push({ id, kind: "timeout", callback, ms, cleared: false })
      return id
    },

    clearTimeout(id: number): void {
      const entry = callbacks.find((c) => c.id === id && c.kind === "timeout")
      if (entry) entry.cleared = true
    },

    setInterval(callback: () => void, ms: number): number {
      const id = nextId++
      callbacks.push({ id, kind: "interval", callback, ms, cleared: false })
      return id
    },

    clearInterval(id: number): void {
      const entry = callbacks.find((c) => c.id === id && c.kind === "interval")
      if (entry) entry.cleared = true
    },

    requestAnimationFrame(callback: (timestamp: number) => void): number {
      const id = rafId++
      raf.push({ id, callback, cancelled: false })
      return id
    },

    cancelAnimationFrame(id: number): void {
      const entry = raf.find((r) => r.id === id)
      if (entry) entry.cancelled = true
    },

    flushTimeouts(): void {
      for (const entry of callbacks) {
        if (entry.kind === "timeout" && !entry.cleared) {
          entry.callback()
          entry.cleared = true
        }
      }
    },

    flushIntervals(): void {
      for (const entry of callbacks) {
        if (entry.kind === "interval" && !entry.cleared) {
          entry.callback()
        }
      }
    },
  }
}


export interface FakeDomPort extends DomPort {
  title: string
  visibilityState: DocumentVisibilityState
  focused: boolean
  href: string
  pathname: string
  search: string
  userAgent: string
  secure: boolean
  innerWidth: number
  innerHeight: number
  reloaded: boolean
  bodyStyles: Map<string, string>
  documentElementStyles: Map<string, string>
  eventListenerCounts: Map<string, number>
  activeElement: Element | null
  selection: Selection | null
  focusOverlay: boolean
  typeaheadMenuOpen: boolean
  hostname: string
  serviceWorkerSupported: boolean
  pushManagerSupported: boolean
  serviceWorkerRegistration: ServiceWorkerRegistrationLike
  touchDevice: boolean
  webShareSupported: boolean
  webShareError: Error | null
  webShareCalls: Array<{ title?: string; url?: string }>
  baseURI: string
  downloadCalls: Array<{ url: string; filename: string }>
  origin: string
  openWindowCalls: Array<{ url: string; target: string; features: string }>
  contextMenuEventCalls: Array<{ target: EventTarget; clientX: number; clientY: number }>
  iosStandalone: boolean
  confirmResult: boolean
  confirmCalls: string[]
}

export function makeFakeDomPort(overrides: Partial<{
  title: string
  visibilityState: DocumentVisibilityState
  focused: boolean
  href: string
  pathname: string
  search: string
  userAgent: string
  secure: boolean
  innerWidth: number
  innerHeight: number
  hostname: string
  serviceWorkerSupported: boolean
  pushManagerSupported: boolean
  serviceWorkerRegistration: ServiceWorkerRegistrationLike
  touchDevice: boolean
  webShareSupported: boolean
  baseURI: string
  origin: string
  iosStandalone: boolean
}> = {}): FakeDomPort {
  let title = overrides.title ?? ""
  let reloaded = false
  const bodyStyles = new Map<string, string>()
  const documentElementStyles = new Map<string, string>()
  const webShareCalls: Array<{ title?: string; url?: string }> = []
  const downloadCalls: Array<{ url: string; filename: string }> = []
  const openWindowCalls: Array<{ url: string; target: string; features: string }> = []
  const contextMenuEventCalls: Array<{ target: EventTarget; clientX: number; clientY: number }> = []
  const confirmCalls: string[] = []
  const eventListenerCounts = new Map<string, number>()

  const defaultRegistration: ServiceWorkerRegistrationLike = {
    pushManager: {
      async subscribe() {
        return {
          endpoint: "https://push.example/fake",
          toJSON: () => ({ endpoint: "https://push.example/fake", keys: { p256dh: "p", auth: "a" } }),
          async unsubscribe() { return true },
        }
      },
      async getSubscription() { return null },
    },
  }

  const fake: FakeDomPort = {
    get title() { return title },
    visibilityState: overrides.visibilityState ?? "visible",
    focused: overrides.focused ?? true,
    href: overrides.href ?? "http://localhost/",
    pathname: overrides.pathname ?? "/",
    search: overrides.search ?? "",
    userAgent: overrides.userAgent ?? "FakeBrowser/1.0",
    secure: overrides.secure ?? true,
    innerWidth: overrides.innerWidth ?? 1024,
    innerHeight: overrides.innerHeight ?? 768,
    get reloaded() { return reloaded },
    bodyStyles,
    documentElementStyles,
    eventListenerCounts,
    activeElement: null,
    selection: null,
    focusOverlay: false,
    typeaheadMenuOpen: false,
    hostname: overrides.hostname ?? "localhost",
    serviceWorkerSupported: overrides.serviceWorkerSupported ?? true,
    pushManagerSupported: overrides.pushManagerSupported ?? true,
    serviceWorkerRegistration: overrides.serviceWorkerRegistration ?? defaultRegistration,
    touchDevice: overrides.touchDevice ?? false,
    iosStandalone: overrides.iosStandalone ?? false,
    webShareSupported: overrides.webShareSupported ?? false,
    webShareError: null,
    webShareCalls,
    baseURI: overrides.baseURI ?? "http://localhost/",
    downloadCalls,
    origin: overrides.origin ?? "http://localhost",
    openWindowCalls,
    contextMenuEventCalls,
    confirmResult: true,
    confirmCalls,

    getTitle(): string { return title },
    setTitle(next: string): void { title = next },

    getVisibilityState(): DocumentVisibilityState { return overrides.visibilityState ?? "visible" },
    hasFocus(): boolean { return overrides.focused ?? true },

    getHref(): string { return overrides.href ?? "http://localhost/" },
    getPathname(): string { return overrides.pathname ?? "/" },
    getSearch(): string { return overrides.search ?? "" },
    reload(): void { reloaded = true },

    getUserAgent(): string { return overrides.userAgent ?? "FakeBrowser/1.0" },
    isSecureContext(): boolean { return overrides.secure ?? true },

    getInnerWidth(): number { return overrides.innerWidth ?? 1024 },
    getInnerHeight(): number { return overrides.innerHeight ?? 768 },

    setBodyStyle(property: string, value: string): void { bodyStyles.set(property, value) },
    getBodyStyle(property: string): string { return bodyStyles.get(property) ?? "" },

    addWindowListener<K extends keyof WindowEventMap>(
      type: K,
      _handler: (event: WindowEventMap[K]) => void,
    ): () => void {
      eventListenerCounts.set(type, (eventListenerCounts.get(type) ?? 0) + 1)
      return () => {
        eventListenerCounts.set(type, Math.max(0, (eventListenerCounts.get(type) ?? 0) - 1))
      }
    },

    addDocumentListener<K extends keyof DocumentEventMap>(
      type: K,
      _handler: (event: DocumentEventMap[K]) => void,
    ): () => void {
      const key = `doc:${type}`
      eventListenerCounts.set(key, (eventListenerCounts.get(key) ?? 0) + 1)
      return () => {
        eventListenerCounts.set(key, Math.max(0, (eventListenerCounts.get(key) ?? 0) - 1))
      }
    },

    setHref(href: string): void {
      overrides.href = href
    },

    addServiceWorkerMessageListener(_handler: (event: MessageEvent) => void): () => void {
      eventListenerCounts.set("sw:message", (eventListenerCounts.get("sw:message") ?? 0) + 1)
      return () => {
        eventListenerCounts.set("sw:message", Math.max(0, (eventListenerCounts.get("sw:message") ?? 0) - 1))
      }
    },

    getActiveElement(): Element | null {
      return fake.activeElement
    },

    getSelection(): Selection | null {
      return fake.selection
    },

    hasFocusOverlay(): boolean {
      return fake.focusOverlay
    },

    hasTypeaheadMenuOpen(): boolean {
      return fake.typeaheadMenuOpen
    },

    addWindowCaptureListener<K extends keyof WindowEventMap>(
      type: K,
      _handler: (event: WindowEventMap[K]) => void,
    ): () => void {
      const key = `cap:${type}`
      eventListenerCounts.set(key, (eventListenerCounts.get(key) ?? 0) + 1)
      return () => {
        eventListenerCounts.set(key, Math.max(0, (eventListenerCounts.get(key) ?? 0) - 1))
      }
    },

    addWindowCustomListener(type: string, _handler: () => void): () => void {
      const key = `custom:${type}`
      eventListenerCounts.set(key, (eventListenerCounts.get(key) ?? 0) + 1)
      return () => {
        eventListenerCounts.set(key, Math.max(0, (eventListenerCounts.get(key) ?? 0) - 1))
      }
    },

    getHostname(): string {
      return fake.hostname
    },

    isServiceWorkerSupported(): boolean {
      return fake.serviceWorkerSupported
    },

    isPushManagerSupported(): boolean {
      return fake.pushManagerSupported
    },

    async registerServiceWorker(_url: string): Promise<ServiceWorkerRegistrationLike> {
      return fake.serviceWorkerRegistration
    },

    async getReadyServiceWorkerRegistration(): Promise<ServiceWorkerRegistrationLike> {
      return fake.serviceWorkerRegistration
    },

    upsertHeadMeta(_name: string, _content: string): void { },

    getComputedBackgroundColor(): string { return "" },

    setDocumentElementColorScheme(_scheme: "light" | "dark"): void { },

    setDocumentElementStyleProperty(property: string, value: string): void {
      documentElementStyles.set(property, value)
    },

    toggleDocumentElementClass(_className: string, _force: boolean): void { },

    matchesMediaQuery(_query: string): boolean { return false },

    addMediaQueryListener(_query: string, _handler: (matches: boolean) => void): () => void {
      return () => { }
    },

    addWindowListenerWithOptions<K extends keyof WindowEventMap>(
      type: K,
      _handler: (event: WindowEventMap[K]) => void,
      _options: AddEventListenerOptions,
    ): () => void {
      eventListenerCounts.set(type, (eventListenerCounts.get(type) ?? 0) + 1)
      return () => {
        eventListenerCounts.set(type, Math.max(0, (eventListenerCounts.get(type) ?? 0) - 1))
      }
    },

    isTouchDevice(): boolean {
      return fake.touchDevice
    },

    isIOSStandalone(): boolean {
      return fake.iosStandalone
    },

    getBodyElement(): Element {
      return document.body
    },

    isWebShareSupported(): boolean {
      return fake.webShareSupported
    },

    async webShare(data: { title?: string; url?: string }): Promise<void> {
      webShareCalls.push(data)
      if (fake.webShareError) throw fake.webShareError
    },

    getBaseURI(): string {
      return fake.baseURI
    },

    triggerDownload(url: string, filename: string): void {
      downloadCalls.push({ url, filename })
    },

    getCssVar(_name: string, fallback: string): string {
      return fallback
    },

    getComputedStyle(_element: Element): ComputedStyleLike {
      return { paddingLeft: "", paddingRight: "", paddingTop: "", paddingBottom: "" }
    },

    getOrigin(): string {
      return fake.origin
    },

    openWindow(url: string, target: string, features: string): void {
      openWindowCalls.push({ url, target, features })
    },

    dispatchContextMenuEvent(target: EventTarget, clientX: number, clientY: number): void {
      contextMenuEventCalls.push({ target, clientX, clientY })
    },

    confirmDialog(message: string): boolean {
      confirmCalls.push(message)
      return fake.confirmResult
    },

    dispatchCustomWindowEvent(_type: string): void { },

    createElement<K extends keyof HTMLElementTagNameMap>(tagName: K): HTMLElementTagNameMap[K] {
      return document.createElement(tagName)
    },
  }

  return fake
}


export interface FakeNotificationPort extends NotificationPort {
  _permission: NotificationPermission
  _supported: boolean
}

export function makeFakeNotificationPort(
  permission: NotificationPermission = "default",
  supported = true,
): FakeNotificationPort {
  let perm = permission
  return {
    _permission: permission,
    _supported: supported,
    isSupported(): boolean { return supported },
    getPermission(): NotificationPermission { return perm },
    async requestPermission(): Promise<NotificationPermission> {
      perm = "granted"
      return perm
    },
  }
}


export interface FakeSoundPort extends SoundPort {
  played: string[]
}

export function makeFakeSoundPort(): FakeSoundPort {
  const played: string[] = []
  return {
    played,
    async play(src: string): Promise<void> {
      played.push(src)
    },
  }
}


export interface FakeClipboardPort extends ClipboardPort {
  clipboard: string
  readCalls: number
  writeCalls: number
}

export function makeFakeClipboardPort(): FakeClipboardPort {
  let clipboard = ""
  let readCalls = 0
  let writeCalls = 0
  return {
    get clipboard() { return clipboard },
    get readCalls() { return readCalls },
    get writeCalls() { return writeCalls },
    async writeText(text: string): Promise<void> {
      clipboard = text
      writeCalls++
    },
    async readText(): Promise<string> {
      readCalls++
      return clipboard
    },
  }
}


export interface FakeWebSocketLike extends WebSocketLike {
  readonly sent: string[]
  open(): void
  receiveRaw(data: string): void
  serverClose(): void
}

export interface FakeWebSocketPort extends WebSocketPort {
  readonly instances: FakeWebSocketLike[]
}

export function makeFakeWebSocketPort(): FakeWebSocketPort {
  const instances: FakeWebSocketLike[] = []

  function makeFakeWs(): FakeWebSocketLike {
    const sent: string[] = []
    const listeners = new Map<string, Set<(event?: WsEventPayload) => void>>()

    function on(type: string, handler: (event?: WsEventPayload) => void) {
      let s = listeners.get(type)
      if (!s) { s = new Set(); listeners.set(type, s) }
      s.add(handler)
    }

    function emit(type: string, event?: WsEventPayload) {
      for (const h of listeners.get(type) ?? []) h(event)
    }

    let readyState = 0

    const ws: FakeWebSocketLike = {
      get readyState() { return readyState },
      sent,
      send(data: string) { sent.push(data) },
      close() {
        if (readyState === 3) return
        readyState = 3
        emit("close")
      },
      addEventListener(type: string, handler: (event?: WsEventPayload) => void) { on(type, handler) },
      open() { readyState = 1; emit("open") },
      receiveRaw(data: string) { emit("message", new MessageEvent("message", { data })) },
      serverClose() {
        readyState = 3
        emit("close")
      },
    }
    return ws
  }

  return {
    CONNECTING: 0,
    OPEN: 1,
    CLOSING: 2,
    CLOSED: 3,
    instances,
    create(_url: string): WebSocketLike {
      const ws = makeFakeWs()
      instances.push(ws)
      return ws
    },
  }
}


export interface AllFakePorts {
  http: FakeHttpPort
  localStorage: FakeStoragePort
  sessionStorage: FakeStoragePort
  timer: FakeTimerPort
  dom: FakeDomPort
  notification: FakeNotificationPort
  sound: FakeSoundPort
  clipboard: FakeClipboardPort
  webSocket: FakeWebSocketPort
}

export function makeAllFakePorts(): AllFakePorts {
  return {
    http: makeFakeHttpPort(),
    localStorage: makeFakeStoragePort(),
    sessionStorage: makeFakeStoragePort(),
    timer: makeFakeTimerPort(),
    dom: makeFakeDomPort(),
    notification: makeFakeNotificationPort(),
    sound: makeFakeSoundPort(),
    clipboard: makeFakeClipboardPort(),
    webSocket: makeFakeWebSocketPort(),
  }
}
