
export interface PushSubscriptionLike {
  endpoint: string
  toJSON(): { endpoint?: string; keys?: { p256dh?: string; auth?: string } }
  unsubscribe(): Promise<boolean>
}

export interface ServiceWorkerRegistrationLike {
  pushManager: {
    subscribe(options: {
      userVisibleOnly: boolean
      applicationServerKey: Uint8Array<ArrayBuffer>
    }): Promise<PushSubscriptionLike>
    getSubscription(): Promise<PushSubscriptionLike | null>
  }
}

export interface DomPort {
  getTitle(): string
  setTitle(title: string): void

  getVisibilityState(): DocumentVisibilityState
  hasFocus(): boolean

  getHref(): string
  getPathname(): string
  getSearch(): string
  reload(): void

  getUserAgent(): string

  isSecureContext(): boolean

  getInnerWidth(): number

  getInnerHeight(): number

  setBodyStyle(property: string, value: string): void
  getBodyStyle(property: string): string

  addWindowListener<K extends keyof WindowEventMap>(
    type: K,
    handler: (event: WindowEventMap[K]) => void,
  ): () => void

  addDocumentListener<K extends keyof DocumentEventMap>(
    type: K,
    handler: (event: DocumentEventMap[K]) => void,
  ): () => void

  setHref(href: string): void

  addServiceWorkerMessageListener(handler: (event: MessageEvent) => void): () => void

  getActiveElement(): Element | null

  getSelection(): Selection | null

  hasFocusOverlay(): boolean

  addWindowCaptureListener<K extends keyof WindowEventMap>(
    type: K,
    handler: (event: WindowEventMap[K]) => void,
  ): () => void

  addWindowCustomListener(type: string, handler: () => void): () => void

  getHostname(): string

  getOrigin(): string

  isServiceWorkerSupported(): boolean

  isPushManagerSupported(): boolean

  registerServiceWorker(url: string): Promise<ServiceWorkerRegistrationLike>

  getReadyServiceWorkerRegistration(): Promise<ServiceWorkerRegistrationLike>

  upsertHeadMeta(name: string, content: string): void

  getComputedBackgroundColor(): string

  setDocumentElementColorScheme(scheme: "light" | "dark"): void

  setDocumentElementStyleProperty(property: string, value: string): void

  toggleDocumentElementClass(className: string, force: boolean): void

  matchesMediaQuery(query: string): boolean

  addMediaQueryListener(query: string, handler: (matches: boolean) => void): () => void

  addWindowListenerWithOptions<K extends keyof WindowEventMap>(
    type: K,
    handler: (event: WindowEventMap[K]) => void,
    options: AddEventListenerOptions,
  ): () => void

  isWebShareSupported(): boolean

  webShare(data: { title?: string; url?: string }): Promise<void>

  getBaseURI(): string

  triggerDownload(url: string, filename: string): void

  getCssVar(name: string, fallback: string): string

  getComputedStyle(element: Element): ComputedStyleLike

  openWindow(url: string, target: string, features: string): void

  dispatchContextMenuEvent(target: EventTarget, clientX: number, clientY: number): void

  isTouchDevice(): boolean

  hasTypeaheadMenuOpen(): boolean

  isIOSStandalone(): boolean

  getBodyElement(): Element

  confirmDialog(message: string): boolean

  dispatchCustomWindowEvent(type: string): void

  createElement<K extends keyof HTMLElementTagNameMap>(tagName: K): HTMLElementTagNameMap[K]
}

export interface ComputedStyleLike {
  readonly paddingLeft: string
  readonly paddingRight: string
  readonly paddingTop: string
  readonly paddingBottom: string
}
