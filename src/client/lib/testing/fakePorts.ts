import type { DomPort, ServiceWorkerRegistrationLike } from "../../ports/domPort"
import type { StoragePort } from "../../ports/storagePort"
import type { TimerPort } from "../../ports/timerPort"


export interface FakeDomPortOptions {
  href?: string
  innerWidth?: number
  innerHeight?: number
  visibilityState?: DocumentVisibilityState
}

const noopUnsubscribe = (): void => { }

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
    reload: () => { },
    getUserAgent: () => "FakeBrowser/1.0",
    isSecureContext: () => true,
    getInnerWidth: () => innerWidth,
    getInnerHeight: () => innerHeight,
    setBodyStyle: () => { },
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
    upsertHeadMeta: () => { },
    getComputedBackgroundColor: () => "",
    setDocumentElementColorScheme: () => { },
    setDocumentElementStyleProperty: () => { },
    toggleDocumentElementClass: () => { },
    matchesMediaQuery: () => false,
    addMediaQueryListener: () => noopUnsubscribe,
    addWindowListenerWithOptions: () => noopUnsubscribe,
    isWebShareSupported: () => false,
    webShare: () => Promise.resolve(),
    getBaseURI: () => currentHref,
    triggerDownload: () => { },
    getCssVar: (_name, fallback) => fallback,
    getComputedStyle: () => ({
      getPropertyValue: () => "",
      paddingLeft: "0px",
      paddingRight: "0px",
      paddingTop: "0px",
      paddingBottom: "0px",
    }),
    openWindow: () => { },
    dispatchContextMenuEvent: () => { },
    isTouchDevice: () => false,
    hasTypeaheadMenuOpen: () => false,
    isIOSStandalone: () => false,
    getBodyElement: () => document.body,
    confirmDialog: () => false,
    dispatchCustomWindowEvent: () => { },
    createElement: (tagName) => document.createElement(tagName),
  }

  return dom
}

export function makeFakeTimerPort(): TimerPort {
  let nextId = 1
  const timer: TimerPort = {
    setTimeout: () => nextId++,
    clearTimeout: () => { },
    setInterval: () => nextId++,
    clearInterval: () => { },
    requestAnimationFrame: () => nextId++,
    cancelAnimationFrame: () => { },
  }
  return timer
}

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
