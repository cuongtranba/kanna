import { describe, expect, test } from "bun:test"
import { getAppleMobileWebAppStatusBarStyle, syncThemeMetadata } from "./useTheme"
import type { ComputedStyleLike, DomPort } from "../ports/domPort"

function createFakeDomPort(overrides: Partial<DomPort> = {}): DomPort {
  const headMeta: Map<string, string> = new Map()

  const base: DomPort = {
    getTitle: () => "",
    setTitle: () => { /* no-op */ },
    getVisibilityState: () => "visible",
    hasFocus: () => false,
    getHref: () => "",
    getPathname: () => "",
    getSearch: () => "",
    reload: () => { /* no-op */ },
    getUserAgent: () => "",
    isSecureContext: () => false,
    getInnerWidth: () => 0,
    getInnerHeight: () => 0,
    setBodyStyle: () => { /* no-op */ },
    getBodyStyle: () => "",
    addWindowListener: () => () => { /* no-op */ },
    addDocumentListener: () => () => { /* no-op */ },
    setHref: () => { /* no-op */ },
    addServiceWorkerMessageListener: () => () => { /* no-op */ },
    getActiveElement: () => null,
    getSelection: () => null,
    hasFocusOverlay: () => false,
    hasTypeaheadMenuOpen: () => false,
    addWindowCaptureListener: () => () => { /* no-op */ },
    addWindowCustomListener: () => () => { /* no-op */ },
    getHostname: () => "",
    isServiceWorkerSupported: () => false,
    isPushManagerSupported: () => false,
    registerServiceWorker: () => Promise.reject(new Error("not supported")),
    getReadyServiceWorkerRegistration: () => Promise.reject(new Error("not supported")),
    upsertHeadMeta(name: string, content: string) {
      headMeta.set(name, content)
    },
    getComputedBackgroundColor: () => "rgb(34, 34, 34)",
    setDocumentElementColorScheme: () => { /* no-op */ },
    toggleDocumentElementClass: () => { /* no-op */ },
    matchesMediaQuery: () => false,
    addMediaQueryListener: () => () => { /* no-op */ },
    addWindowListenerWithOptions: () => () => { /* no-op */ },
    isWebShareSupported: () => false,
    webShare: () => Promise.resolve(),
    getBaseURI: () => "",
    triggerDownload: () => { /* no-op */ },
    getCssVar: (_name: string, fallback: string) => fallback,
    getComputedStyle: (_element: Element): ComputedStyleLike => ({ paddingLeft: "", paddingRight: "", paddingTop: "", paddingBottom: "" }),
    getOrigin: () => "http://localhost",
    openWindow: () => { /* no-op */ },
    dispatchContextMenuEvent: () => { /* no-op */ },
    isTouchDevice: () => false,
    isIOSStandalone: () => false,
    getBodyElement: () => document.body,
    confirmDialog: () => true,
    dispatchCustomWindowEvent: () => { /* no-op */ },
    createElement: <K extends keyof HTMLElementTagNameMap>(tagName: K): HTMLElementTagNameMap[K] => document.createElement(tagName),
    ...overrides,
  }
  return base
}

describe("getAppleMobileWebAppStatusBarStyle", () => {
  test("maps dark themes to a translucent dark status bar", () => {
    expect(getAppleMobileWebAppStatusBarStyle("dark")).toBe("black-translucent")
  })

  test("maps light themes to the default status bar", () => {
    expect(getAppleMobileWebAppStatusBarStyle("light")).toBe("default")
  })
})

describe("syncThemeMetadata", () => {
  test("updates theme-color and color-scheme from the active theme", () => {
    const colorSchemeSpy: Array<string> = []
    const headMeta: Map<string, string> = new Map()

    const dom = createFakeDomPort({
      getComputedBackgroundColor: () => "rgb(34, 34, 34)",
      upsertHeadMeta(name: string, content: string) {
        headMeta.set(name, content)
      },
      setDocumentElementColorScheme(scheme) {
        colorSchemeSpy.push(scheme)
      },
    })

    syncThemeMetadata("dark", dom)

    expect(headMeta.get("theme-color")).toBe("rgb(34, 34, 34)")
    expect(headMeta.get("apple-mobile-web-app-status-bar-style")).toBe("black-translucent")
    expect(colorSchemeSpy).toEqual(["dark"])
  })

  test("skips theme-color when computed background is empty", () => {
    const headMeta: Map<string, string> = new Map()

    const dom = createFakeDomPort({
      getComputedBackgroundColor: () => "",
      upsertHeadMeta(name: string, content: string) {
        headMeta.set(name, content)
      },
    })

    syncThemeMetadata("light", dom)

    expect(headMeta.has("theme-color")).toBe(false)
    expect(headMeta.get("apple-mobile-web-app-status-bar-style")).toBe("default")
  })
})
