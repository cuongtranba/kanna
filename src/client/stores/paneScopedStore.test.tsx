import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { PaneScopedStore } from "./paneScopedStore"

/**
 * Render a consumer inside a PaneScopedStore.Provider and capture the
 * selected value synchronously (renderToStaticMarkup is synchronous).
 */
function readInitial<T>(selector: (state: Parameters<typeof PaneScopedStore.useScopedStore>[0] extends (state: infer S) => unknown ? S : never) => T): T {
  let captured!: T
  function Consumer() {
    // useContext is called inside renderToStaticMarkup, which is synchronous.
    // The scoped store's Provider sets up the context, so the hook works.
    captured = PaneScopedStore.useScopedStore(selector)
    return null
  }
  renderToStaticMarkup(
    <PaneScopedStore.Provider init={undefined}>
      <Consumer />
    </PaneScopedStore.Provider>,
  )
  return captured
}

describe("PaneScopedStore initial state", () => {
  test("layoutWidth starts at 0", () => {
    expect(readInitial((s) => s.layoutWidth)).toBe(0)
  })

  test("tabRecency starts empty", () => {
    expect(readInitial((s) => s.tabRecency)).toEqual([])
  })

  test("localLinkMenuTarget starts null", () => {
    expect(readInitial((s) => s.localLinkMenuTarget)).toBeNull()
  })

  test("diffRenderMode starts as unified", () => {
    expect(readInitial((s) => s.diffRenderMode)).toBe("unified")
  })

  test("wrapDiffLines starts false", () => {
    expect(readInitial((s) => s.wrapDiffLines)).toBe(false)
  })
})

describe("PaneScopedStore setters", () => {
  test("setDiffRenderMode updates diffRenderMode", () => {
    let api: ReturnType<typeof PaneScopedStore.useScopedStoreApi> | null = null
    function Capture() {
      api = PaneScopedStore.useScopedStoreApi()
      return null
    }
    renderToStaticMarkup(
      <PaneScopedStore.Provider init={undefined}>
        <Capture />
      </PaneScopedStore.Provider>,
    )
    api!.getState().setDiffRenderMode("split")
    expect(api!.getState().diffRenderMode).toBe("split")
  })

  test("setLocalLinkMenuOpen(false) clears a set target", () => {
    let api: ReturnType<typeof PaneScopedStore.useScopedStoreApi> | null = null
    function Capture() {
      api = PaneScopedStore.useScopedStoreApi()
      return null
    }
    renderToStaticMarkup(
      <PaneScopedStore.Provider init={undefined}>
        <Capture />
      </PaneScopedStore.Provider>,
    )
    const store = api!
    store.getState().setLocalLinkMenuTarget({ path: "/tmp/foo", line: 1, column: 1 })
    expect(store.getState().localLinkMenuTarget).not.toBeNull()
    store.getState().setLocalLinkMenuOpen(false)
    expect(store.getState().localLinkMenuTarget).toBeNull()
  })

  test("setLocalLinkMenuOpen(true) does not clear the target", () => {
    let api: ReturnType<typeof PaneScopedStore.useScopedStoreApi> | null = null
    function Capture() {
      api = PaneScopedStore.useScopedStoreApi()
      return null
    }
    renderToStaticMarkup(
      <PaneScopedStore.Provider init={undefined}>
        <Capture />
      </PaneScopedStore.Provider>,
    )
    const store = api!
    store.getState().setLocalLinkMenuTarget({ path: "/tmp/bar", line: 2, column: 3 })
    store.getState().setLocalLinkMenuOpen(true)
    expect(store.getState().localLinkMenuTarget).not.toBeNull()
  })

  // Each Provider instance gets its own store — state in one never leaks
  // to another, which is the whole point of the scoped pattern.
  test("two Provider instances are independent", () => {
    let apiA: ReturnType<typeof PaneScopedStore.useScopedStoreApi> | null = null
    let apiB: ReturnType<typeof PaneScopedStore.useScopedStoreApi> | null = null
    function CaptureA() { apiA = PaneScopedStore.useScopedStoreApi(); return null }
    function CaptureB() { apiB = PaneScopedStore.useScopedStoreApi(); return null }

    renderToStaticMarkup(
      <>
        <PaneScopedStore.Provider init={undefined}><CaptureA /></PaneScopedStore.Provider>
        <PaneScopedStore.Provider init={undefined}><CaptureB /></PaneScopedStore.Provider>
      </>,
    )

    apiA!.getState().setDiffRenderMode("split")
    expect(apiA!.getState().diffRenderMode).toBe("split")
    expect(apiB!.getState().diffRenderMode).toBe("unified")
  })
})
