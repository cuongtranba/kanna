import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { PaneScopedStore } from "./paneScopedStore"

function readInitial<T>(selector: (state: Parameters<typeof PaneScopedStore.useScopedStore>[0] extends (state: infer S) => unknown ? S : never) => T): T {
  let captured!: T
  function Consumer() {
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
})

describe("PaneScopedStore setters", () => {
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

    apiA!.getState().setLayoutWidth(640)
    expect(apiA!.getState().layoutWidth).toBe(640)
    expect(apiB!.getState().layoutWidth).toBe(0)
  })
})
