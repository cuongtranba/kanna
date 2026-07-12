import { describe, expect, test } from "bun:test"
import { useEffect } from "react"
import type { StoreApi } from "zustand"
import { renderForLoopCheck } from "./testing/renderForLoopCheck"
import { createScopedStore } from "./createScopedStore"

interface CounterState {
  count: number
  increment: () => void
}

const Counter = createScopedStore<{ start: number }, CounterState>(
  "CounterStore",
  (init) => (set) => ({
    count: init.start,
    increment: () => set((state) => ({ count: state.count + 1 })),
  })
)

function CaptureApi({ onApi }: { onApi: (api: StoreApi<CounterState>) => void }) {
  const api = Counter.useScopedStoreApi()
  useEffect(() => {
    onApi(api)
  }, [api, onApi])
  return null
}

function ShowCount() {
  const count = Counter.useScopedStore((state) => state.count)
  return <span data-testid="count">{count}</span>
}

describe("createScopedStore", () => {
  test("each Provider instance gets an isolated store", async () => {
    const apis: StoreApi<CounterState>[] = []
    const result = await renderForLoopCheck(
      <>
        <Counter.Provider init={{ start: 1 }}>
          <CaptureApi onApi={(api) => apis.push(api)} />
        </Counter.Provider>
        <Counter.Provider init={{ start: 100 }}>
          <CaptureApi onApi={(api) => apis.push(api)} />
        </Counter.Provider>
      </>
    )
    expect(result.thrown).toBeNull()
    expect(apis).toHaveLength(2)
    apis[0]!.getState().increment()
    expect(apis[0]!.getState().count).toBe(2)
    expect(apis[1]!.getState().count).toBe(100)
    await result.cleanup()
  })

  test("useScopedStore outside Provider throws a named error", async () => {
    const result = await renderForLoopCheck(<ShowCount />)
    expect(String(result.thrown)).toContain("CounterStore")
    expect(String(result.thrown)).toContain("Provider")
    await result.cleanup()
  })

  test("selector subscription does not trigger render loops", async () => {
    const result = await renderForLoopCheck(
      <Counter.Provider init={{ start: 0 }}>
        <ShowCount />
      </Counter.Provider>
    )
    expect(result.loopWarnings).toEqual([])
    expect(result.thrown).toBeNull()
    await result.cleanup()
  })
})
