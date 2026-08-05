import type { DomPort, ServiceWorkerRegistrationLike } from "../../ports/domPort"
import type { StoragePort } from "../../ports/storagePort"
import type { TimerPort } from "../../ports/timerPort"

/**
 * Cast-free fakes for the browser ports.
 *
 * Declared as `DomPort` / `TimerPort` / `StoragePort` rather than built with an
 * `as unknown as` cast on purpose: a cast silently hides a method the real port
 * gained, and the test then fails at runtime deep inside the code under test
 * (that is exactly how the first draft of the socket-provider test broke, on a
 * missing `addServiceWorkerMessageListener`). Typed this way, a new port member
 * is a compile error here instead.
 *
 * Behaviour is inert by design — every listener returns a no-op unsubscribe and
 * nothing dispatches. Tests that need to DRIVE events should build a recording
 * fake locally; these exist so a test can mount a tree without caring about the
 * DOM at all.
 */

export interface FakeDomPortOptions {
  href?: string
  innerWidth?: number
  innerHeight?: number
  visibilityState?: DocumentVisibilityState
}

const noopUnsubscribe = (): void => { /* no-op */ }

export function makeFakeDomPort(options: FakeDomPortOptions = {}): DomPort {
  const {
    href = "http://localhost:5174/",
    innerWidth = 1024,
    innerHeight = 768,
    visibilityState = "visible",
  } = options

  let currentHref = href
  let title = ""

  const dom: DomPort = {
    getTitle: () => title,
    setTitle: (next) => { title = next },
    getVisibilityState: () => visibilityState,
    hasFocus: () => true,
    getHref: () => currentHref,
    getPathname: () => new URL(currentHref).pathname,
    getSearch: () => new URL(currentHref).search,
    reload: () => { /* no-op */ },
    getUserAgent: () => "FakeBrowser/1.0",
    isSecureContext: () => true,
    getInnerWidth: () => innerWidth,
    getInnerHeight: () => innerHeight,
    setBodyStyle: () => { /* no-op */ },
    getBodyStyle: () => "",
    addWindowListener: () => noopUnsubscribe,
    addDocumentListener: () => noopUnsubscribe,
    setHref: (next) => { currentHref = next },
    addServiceWorkerMessageListener: () => noopUnsubscribe,
    getActiveElement: () => null,
    getSelection: () => null,
    hasFocusOverlay: () => false,
    addWindowCaptureListener: () => noopUnsubscribe,
    addWindowCustomListener: () => noopUnsubscribe,
    getHostname: () => new URL(currentHref).hostname,
    getOrigin: () => new URL(currentHref).origin,
    isServiceWorkerSupported: () => false,
    isPushManagerSupported: () => false,
    registerServiceWorker: () =>
      Promise.reject(new Error("fake DomPort: service workers are not supported")),
    getReadyServiceWorkerRegistration: (): Promise<ServiceWorkerRegistrationLike> =>
      Promise.reject(new Error("fake DomPort: service workers are not supported")),
    upsertHeadMeta: () => { /* no-op */ },
    getComputedBackgroundColor: () => "",
    setDocumentElementColorScheme: () => { /* no-op */ },
    toggleDocumentElementClass: () => { /* no-op */ },
    matchesMediaQuery: () => false,
    addMediaQueryListener: () => noopUnsubscribe,
    addWindowListenerWithOptions: () => noopUnsubscribe,
    isWebShareSupported: () => false,
    webShare: () => Promise.resolve(),
    getBaseURI: () => currentHref,
    triggerDownload: () => { /* no-op */ },
    getCssVar: (_name, fallback) => fallback,
    getComputedStyle: () => ({
      getPropertyValue: () => "",
      paddingLeft: "0px",
      paddingRight: "0px",
      paddingTop: "0px",
      paddingBottom: "0px",
    }),
    openWindow: () => { /* no-op */ },
    dispatchContextMenuEvent: () => { /* no-op */ },
    isTouchDevice: () => false,
    hasTypeaheadMenuOpen: () => false,
    isIOSStandalone: () => false,
    // happy-dom is set up by the renderer helpers, so a real element exists.
    getBodyElement: () => document.body,
    // Never silently "confirm" a destructive prompt in a test.
    confirmDialog: () => false,
    dispatchCustomWindowEvent: () => { /* no-op */ },
    createElement: (tagName) => document.createElement(tagName),
  }

  return dom
}

/** Timers that never fire — callers assert on scheduling, not on elapsed time. */
export function makeFakeTimerPort(): TimerPort {
  let nextId = 1
  const timer: TimerPort = {
    setTimeout: () => nextId++,
    clearTimeout: () => { /* no-op */ },
    setInterval: () => nextId++,
    clearInterval: () => { /* no-op */ },
    requestAnimationFrame: () => nextId++,
    cancelAnimationFrame: () => { /* no-op */ },
  }
  return timer
}

/** In-memory storage; each call gets its own map, so tests cannot leak state. */
export function makeFakeStoragePort(): StoragePort {
  const store = new Map<string, string>()
  const storage: StoragePort = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => { store.set(key, value) },
    removeItem: (key) => { store.delete(key) },
    clear: () => { store.clear() },
  }
  return storage
}
