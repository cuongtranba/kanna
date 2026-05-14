import { describe, expect, test } from "bun:test"
import { create, type UseBoundStore, type StoreApi } from "zustand"
import { renderForLoopCheck } from "./renderForLoopCheck"

interface ItemsStore {
  items?: string[]
}

type ItemsStoreHook = UseBoundStore<StoreApi<ItemsStore>>

function ListConsumer({ store, fallback }: { store: ItemsStoreHook; fallback: string[] }) {
  const items = store((state) => state.items ?? fallback)
  return (
    <ul>
      {items.map((item: string) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  )
}

describe("renderForLoopCheck", () => {
  test("detects zustand selector returning fresh literal each call", async () => {
    const store = create<ItemsStore>(() => ({}))
    const Component = () => {
      const items = store((state) => state.items ?? [])
      return <span data-count={items.length} />
    }

    const result = await renderForLoopCheck(<Component />)
    try {
      expect(result.loopWarnings.length).toBeGreaterThan(0)
      expect(result.loopWarnings.join(" ")).toMatch(/getSnapshot should be cached|Maximum update depth/i)
    } finally {
      await result.cleanup()
    }
  })

  test("passes when selector returns stable reference", async () => {
    const EMPTY: string[] = []
    const store = create<ItemsStore>(() => ({}))

    const result = await renderForLoopCheck(<ListConsumer store={store} fallback={EMPTY} />)
    try {
      expect(result.loopWarnings).toEqual([])
      expect(result.thrown).toBeNull()
    } finally {
      await result.cleanup()
    }
  })
})
