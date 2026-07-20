/**
 * DomPort — typed interface for document / window / navigator side effects.
 *
 * Covers the subset of browser globals actually used in the client:
 *   - document.title mutations
 *   - window.location (reload, href read)
 *   - window event listeners (pageshow / pagehide / resize)
 *   - document.visibilityState / hasFocus (chat-sound gating)
 *   - navigator.userAgent (push subscription label)
 *   - window.isSecureContext (push support check)
 *   - window.location.hostname, navigator.serviceWorker, PushManager
 *     (push support detection + subscribe/unsubscribe, pushClient.ts)
 *
 * The concrete implementation is src/client/adapters/dom.adapter.ts.
 *
 * Architecture: .c3/adr/adr-20260715-client-state-effect-architecture.md
 */

/** Minimal push-subscription shape consumed by pushClient.ts (subset of native PushSubscription). */
export interface PushSubscriptionLike {
  endpoint: string
  toJSON(): { endpoint?: string; keys?: { p256dh?: string; auth?: string } }
  unsubscribe(): Promise<boolean>
}

/** Minimal registration shape consumed by pushClient.ts (subset of native ServiceWorkerRegistration). */
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
  /** Read document.title. */
  getTitle(): string
  /** Set document.title. */
  setTitle(title: string): void

  /** Returns document.visibilityState. */
  getVisibilityState(): DocumentVisibilityState
  /** Returns document.hasFocus(). */
  hasFocus(): boolean

  /** Returns window.location.href. */
  getHref(): string
  /** Returns window.location.pathname. */
  getPathname(): string
  /** Returns window.location.search. */
  getSearch(): string
  /** Calls window.location.reload(). */
  reload(): void

  /** Returns navigator.userAgent. */
  getUserAgent(): string

  /** Returns window.isSecureContext. */
  isSecureContext(): boolean

  /** Returns window.innerWidth. */
  getInnerWidth(): number

  /** Returns window.innerHeight. */
  getInnerHeight(): number

  /** Sets a CSS property on document.body.style. */
  setBodyStyle(property: string, value: string): void
  /** Gets a CSS property from document.body.style. */
  getBodyStyle(property: string): string

  /** Adds an event listener to window; returns a cleanup function. */
  addWindowListener<K extends keyof WindowEventMap>(
    type: K,
    handler: (event: WindowEventMap[K]) => void,
  ): () => void

  /** Adds an event listener to document; returns a cleanup function. */
  addDocumentListener<K extends keyof DocumentEventMap>(
    type: K,
    handler: (event: DocumentEventMap[K]) => void,
  ): () => void

  /** Sets window.location.href (navigation). */
  setHref(href: string): void

  /**
   * Registers a message listener on navigator.serviceWorker (if available).
   * Returns a cleanup function. If service workers are not supported, does nothing
   * and returns a no-op cleanup.
   */
  addServiceWorkerMessageListener(handler: (event: MessageEvent) => void): () => void

  /** Returns document.activeElement. */
  getActiveElement(): Element | null

  /** Returns window.getSelection(). */
  getSelection(): Selection | null

  /**
   * Returns true when a modal/popover overlay with data-focus-fallback-ignore
   * and data-state="open" is present in the document — i.e. hasActiveFocusOverlay
   * from chatFocusPolicy, evaluated against the live document.
   */
  hasFocusOverlay(): boolean

  /**
   * Adds an event listener to window in the CAPTURE phase; returns a cleanup
   * function. Used for pointer / keyboard listeners that must intercept events
   * before bubbling reaches other handlers.
   */
  addWindowCaptureListener<K extends keyof WindowEventMap>(
    type: K,
    handler: (event: WindowEventMap[K]) => void,
  ): () => void

  /**
   * Adds a listener for a custom (non-standard) window event identified by a
   * plain string type (e.g. "kanna:restore-chat-input-focus"). Returns a
   * cleanup function.
   */
  addWindowCustomListener(type: string, handler: () => void): () => void

  /** Returns window.location.hostname. */
  getHostname(): string

  /** Returns window.location.origin. */
  getOrigin(): string

  /** Returns true if navigator.serviceWorker is available. */
  isServiceWorkerSupported(): boolean

  /** Returns true if the PushManager API is available (globalThis.PushManager). */
  isPushManagerSupported(): boolean

  /** Registers a service worker at the given URL (navigator.serviceWorker.register). */
  registerServiceWorker(url: string): Promise<ServiceWorkerRegistrationLike>

  /** Resolves once navigator.serviceWorker.ready resolves. */
  getReadyServiceWorkerRegistration(): Promise<ServiceWorkerRegistrationLike>

  /**
   * Upserts a `<meta name="…">` element in document.head.
   * If a matching element exists its `content` attribute is updated in place;
   * otherwise a new element is created and appended.
   */
  upsertHeadMeta(name: string, content: string): void

  /**
   * Returns the computed `backgroundColor` of the document body (falls back to
   * documentElement's computed backgroundColor when the body value is empty).
   */
  getComputedBackgroundColor(): string

  /** Sets `document.documentElement.style.colorScheme`. */
  setDocumentElementColorScheme(scheme: "light" | "dark"): void

  /** Calls `document.documentElement.classList.toggle(className, force)`. */
  toggleDocumentElementClass(className: string, force: boolean): void

  /**
   * Returns whether the given CSS media query currently matches.
   * Equivalent to `window.matchMedia(query).matches`.
   */
  matchesMediaQuery(query: string): boolean

  /**
   * Adds a listener for a CSS media query's `change` event.
   * Handles both the modern `addEventListener` and legacy `addListener` APIs.
   * Returns a cleanup function.
   */
  addMediaQueryListener(query: string, handler: (matches: boolean) => void): () => void

  /**
   * Adds an event listener to window with explicit `AddEventListenerOptions`
   * (e.g. `{ passive: false }` to allow `preventDefault()`). Returns a cleanup
   * function. Use this instead of `addWindowListener` when passivity matters.
   */
  addWindowListenerWithOptions<K extends keyof WindowEventMap>(
    type: K,
    handler: (event: WindowEventMap[K]) => void,
    options: AddEventListenerOptions,
  ): () => void

  /** Returns true if the Web Share API (navigator.share) is available. */
  isWebShareSupported(): boolean

  /** Calls navigator.share(data). Rejects (e.g. AbortError) if the user cancels. */
  webShare(data: { title?: string; url?: string }): Promise<void>

  /** Returns document.baseURI. */
  getBaseURI(): string

  /**
   * Triggers a browser file download: creates a temporary `<a download>`
   * anchor for `url`/`filename`, appends it to document.body, clicks it, and
   * removes it.
   */
  triggerDownload(url: string, filename: string): void

  /**
   * Returns the computed value of a CSS custom property on the document
   * root element (`document.documentElement`). Falls back to `fallback`
   * when the document is unavailable or the property is empty.
   */
  getCssVar(name: string, fallback: string): string

  /**
   * Returns the computed style for the given element.
   * Equivalent to `window.getComputedStyle(element)`.
   * Only the box-model padding properties are required; tests may return a
   * minimal stub without filling the full CSSStyleDeclaration surface.
   */
  getComputedStyle(element: Element): ComputedStyleLike

  /**
   * Opens a new browser tab/window. Equivalent to `window.open(url, target,
   * features)`.
   */
  openWindow(url: string, target: string, features: string): void

  /**
   * Dispatches a synthetic `contextmenu` `MouseEvent` (bubbles, cancelable,
   * `view: window`) at the given client coordinates on `target`. Used to
   * open a context menu from a non-right-click trigger (e.g. an ellipsis
   * button).
   */
  dispatchContextMenuEvent(target: EventTarget, clientX: number, clientY: number): void

  /** Returns true if the current environment appears to be a touch device
   * (`"ontouchstart" in window` or `navigator.maxTouchPoints > 0`). */
  isTouchDevice(): boolean

  /**
   * Returns true when a composer typeahead picker (mention `@` / slash `/`)
   * menu element (tagged `[data-kanna-typeahead-menu]`) is present in the
   * document. Used by SubmitPlugin / SnippetExpandPlugin to bail on Enter/Tab
   * while a picker is open.
   */
  hasTypeaheadMenuOpen(): boolean

  /**
   * Returns true if the app is running as an iOS "Add to Home Screen"
   * standalone PWA (`navigator.standalone === true`). iOS Safari only —
   * other browsers never set this property.
   */
  isIOSStandalone(): boolean

  /**
   * Returns `document.body`. Used as a portal mount target
   * (`createPortal(node, ports.dom.getBodyElement())`).
   */
  getBodyElement(): Element

  /**
   * Shows a native blocking confirm dialog (`window.confirm(message)`).
   * Returns true if the user accepted, false if cancelled.
   */
  confirmDialog(message: string): boolean

  /**
   * Dispatches a custom `Event` on `window` with the given string `type`.
   * Equivalent to `window.dispatchEvent(new Event(type))`.
   */
  dispatchCustomWindowEvent(type: string): void

  /**
   * Creates a DOM element of the given tag name.
   * Equivalent to `document.createElement(tagName)`.
   */
  createElement<K extends keyof HTMLElementTagNameMap>(tagName: K): HTMLElementTagNameMap[K]
}

/**
 * Minimal computed-style shape used by TerminalPane to measure padding.
 * A subset of CSSStyleDeclaration so test fakes can satisfy it without
 * constructing a real style object.
 */
export interface ComputedStyleLike {
  readonly paddingLeft: string
  readonly paddingRight: string
  readonly paddingTop: string
  readonly paddingBottom: string
}
