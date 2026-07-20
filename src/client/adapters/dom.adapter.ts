/**
 * dom.adapter.ts — Browser DOM/window/navigator implementation of DomPort.
 *
 * Wraps document.title, window.location, document.visibilityState,
 * document.hasFocus, navigator.userAgent, and window event listeners.
 *
 * Architecture: .c3/adr/adr-20260715-client-state-effect-architecture.md
 */

import type { DomPort, ServiceWorkerRegistrationLike, ComputedStyleLike } from "../ports/domPort"

declare global {
  interface Navigator {
    /** iOS Safari "Add to Home Screen" standalone-mode flag. */
    readonly standalone?: boolean
  }
}

export const domAdapter: DomPort = {
  getTitle(): string {
    return document.title
  },
  setTitle(title: string): void {
    document.title = title
  },

  getVisibilityState(): DocumentVisibilityState {
    return document.visibilityState
  },
  hasFocus(): boolean {
    return document.hasFocus()
  },

  getHref(): string {
    return window.location.href
  },
  getPathname(): string {
    return window.location.pathname
  },
  getSearch(): string {
    return window.location.search
  },
  reload(): void {
    window.location.reload()
  },

  getUserAgent(): string {
    return navigator.userAgent
  },

  isSecureContext(): boolean {
    return window.isSecureContext
  },

  getInnerWidth(): number {
    return window.innerWidth
  },

  getInnerHeight(): number {
    return window.innerHeight
  },

  setBodyStyle(property: string, value: string): void {
    document.body.style.setProperty(property, value)
  },

  getBodyStyle(property: string): string {
    return document.body.style.getPropertyValue(property)
  },

  addWindowListener<K extends keyof WindowEventMap>(
    type: K,
    handler: (event: WindowEventMap[K]) => void,
  ): () => void {
    window.addEventListener(type, handler)
    return () => {
      window.removeEventListener(type, handler)
    }
  },

  addDocumentListener<K extends keyof DocumentEventMap>(
    type: K,
    handler: (event: DocumentEventMap[K]) => void,
  ): () => void {
    document.addEventListener(type, handler)
    return () => {
      document.removeEventListener(type, handler)
    }
  },

  setHref(href: string): void {
    window.location.href = href
  },

  addServiceWorkerMessageListener(handler: (event: MessageEvent) => void): () => void {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return () => { /* no-op: service workers not supported */ }
    }
    navigator.serviceWorker.addEventListener("message", handler)
    return () => {
      navigator.serviceWorker.removeEventListener("message", handler)
    }
  },

  getActiveElement(): Element | null {
    return document.activeElement
  },

  getSelection(): Selection | null {
    return window.getSelection()
  },

  hasFocusOverlay(): boolean {
    return Boolean(document.querySelector("[data-focus-fallback-ignore][data-state='open']"))
  },

  addWindowCaptureListener<K extends keyof WindowEventMap>(
    type: K,
    handler: (event: WindowEventMap[K]) => void,
  ): () => void {
    window.addEventListener(type, handler, true)
    return () => {
      window.removeEventListener(type, handler, true)
    }
  },

  addWindowCustomListener(type: string, handler: () => void): () => void {
    window.addEventListener(type, handler)
    return () => {
      window.removeEventListener(type, handler)
    }
  },

  getHostname(): string {
    return window.location?.hostname ?? ""
  },

  getOrigin(): string {
    return window.location.origin
  },

  isServiceWorkerSupported(): boolean {
    return typeof navigator !== "undefined" && "serviceWorker" in navigator
  },

  isPushManagerSupported(): boolean {
    return typeof Reflect.get(globalThis, "PushManager") !== "undefined"
  },

  async registerServiceWorker(url: string): Promise<ServiceWorkerRegistrationLike> {
    return navigator.serviceWorker.register(url)
  },

  async getReadyServiceWorkerRegistration(): Promise<ServiceWorkerRegistrationLike> {
    return navigator.serviceWorker.ready
  },

  upsertHeadMeta(name: string, content: string): void {
    let tag = document.head.querySelector(`meta[name="${name}"]`)
    if (!tag) {
      tag = document.createElement("meta")
      tag.setAttribute("name", name)
      document.head.appendChild(tag)
    }
    tag.setAttribute("content", content)
  },

  getComputedBackgroundColor(): string {
    return (
      getComputedStyle(document.body).backgroundColor ||
      getComputedStyle(document.documentElement).backgroundColor
    )
  },

  setDocumentElementColorScheme(scheme: "light" | "dark"): void {
    document.documentElement.style.colorScheme = scheme
  },

  toggleDocumentElementClass(className: string, force: boolean): void {
    document.documentElement.classList.toggle(className, force)
  },

  matchesMediaQuery(query: string): boolean {
    return window.matchMedia(query).matches
  },

  addMediaQueryListener(query: string, handler: (matches: boolean) => void): () => void {
    const mq = window.matchMedia(query)
    const wrappedHandler = (event: MediaQueryListEvent) => {
      handler(event.matches)
    }
    if (mq.addEventListener) {
      mq.addEventListener("change", wrappedHandler)
      return () => mq.removeEventListener("change", wrappedHandler)
    }
    // Legacy fallback (Safari < 14, older browsers)
    const legacyHandler = () => {
      handler(mq.matches)
    }
    mq.addListener(legacyHandler)
    return () => mq.removeListener(legacyHandler)
  },

  addWindowListenerWithOptions<K extends keyof WindowEventMap>(
    type: K,
    handler: (event: WindowEventMap[K]) => void,
    options: AddEventListenerOptions,
  ): () => void {
    window.addEventListener(type, handler, options)
    return () => {
      window.removeEventListener(type, handler, options)
    }
  },

  isWebShareSupported(): boolean {
    return "share" in navigator && typeof navigator.share === "function"
  },

  async webShare(data: { title?: string; url?: string }): Promise<void> {
    await navigator.share(data)
  },

  getBaseURI(): string {
    return document.baseURI
  },

  triggerDownload(url: string, filename: string): void {
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = filename
    anchor.rel = "noopener"
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
  },

  getCssVar(name: string, fallback: string): string {
    if (typeof document === "undefined") return fallback
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
    return value || fallback
  },

  getComputedStyle(element: Element): ComputedStyleLike {
    return window.getComputedStyle(element)
  },

  openWindow(url: string, target: string, features: string): void {
    window.open(url, target, features)
  },

  dispatchContextMenuEvent(target: EventTarget, clientX: number, clientY: number): void {
    target.dispatchEvent(new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX,
      clientY,
      view: window,
    }))
  },

  isTouchDevice(): boolean {
    if (typeof window === "undefined") return false
    if ("ontouchstart" in window) return true
    return (navigator?.maxTouchPoints ?? 0) > 0
  },

  isIOSStandalone(): boolean {
    if (typeof navigator === "undefined") return false
    return navigator.standalone === true
  },

  hasTypeaheadMenuOpen(): boolean {
    return document.querySelector("[data-kanna-typeahead-menu]") != null
  },

  getBodyElement(): Element {
    return document.body
  },

  confirmDialog(message: string): boolean {
    return window.confirm(message)
  },

  dispatchCustomWindowEvent(type: string): void {
    window.dispatchEvent(new Event(type))
  },

  createElement<K extends keyof HTMLElementTagNameMap>(tagName: K): HTMLElementTagNameMap[K] {
    return document.createElement(tagName)
  },
}
