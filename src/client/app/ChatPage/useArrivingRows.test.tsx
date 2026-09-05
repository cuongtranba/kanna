import { describe, expect, test } from "bun:test"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { STAGGER_LIMIT } from "../../lib/motion"
import { useArrivingRows, type ArrivingRows } from "./useArrivingRows"

/**
 * The whole point of this hook is what does NOT animate. A virtualized list
 * remounts rows constantly, so the interesting assertions are all about rows
 * the hook must stay silent about.
 */

interface Row {
  id: string
}

function rows(...ids: string[]): Row[] {
  return ids.map((id) => ({ id }))
}

/** Drives the hook through a real React root and reports the live result. */
function mountHook(initial: Row[], chatId: string | null) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  let latest: ArrivingRows | null = null

  function Probe({ data, resetKey }: { data: Row[]; resetKey: string | null }) {
    latest = useArrivingRows(data, resetKey)
    return null
  }

  act(() => {
    root.render(<Probe data={initial} resetKey={chatId} />)
  })

  return {
    update(data: Row[], resetKey: string | null) {
      act(() => {
        root.render(<Probe data={data} resetKey={resetKey} />)
      })
    },
    indexOf(id: string) {
      return latest?.indexOf(id)
    },
    result() {
      return latest
    },
    cleanup() {
      act(() => {
        root.unmount()
      })
      container.remove()
    },
  }
}

describe("useArrivingRows", () => {
  test("a chat's existing backlog never animates on open", () => {
    // Opening a chat makes every row "new" by any count-based measure.
    // Animating a whole backlog on arrival is handoff pitfall #1's shape.
    const hook = mountHook(rows("a", "b", "c"), "chat-1")
    expect(hook.indexOf("a")).toBeUndefined()
    expect(hook.indexOf("c")).toBeUndefined()
    hook.cleanup()
  })

  test("only appended rows arrive, and they carry their position", () => {
    const hook = mountHook(rows("a", "b"), "chat-1")
    hook.update(rows("a", "b", "c", "d"), "chat-1")

    expect(hook.indexOf("a")).toBeUndefined()
    expect(hook.indexOf("b")).toBeUndefined()
    expect(hook.indexOf("c")).toBe(0)
    expect(hook.indexOf("d")).toBe(1)
    hook.cleanup()
  })

  test("a burst past the cap shares the last delay", () => {
    const before = rows("a")
    const burst = rows("a", ...Array.from({ length: 40 }, (_, i) => `row-${i}`))
    const hook = mountHook(before, "chat-1")
    hook.update(burst, "chat-1")

    expect(hook.indexOf("row-0")).toBe(0)
    expect(hook.indexOf(`row-${STAGGER_LIMIT - 1}`)).toBe(STAGGER_LIMIT - 1)
    expect(hook.indexOf("row-39")).toBe(STAGGER_LIMIT - 1)
    hook.cleanup()
  })

  test("the previous burst stops arriving once a new render settles", () => {
    const hook = mountHook(rows("a"), "chat-1")
    hook.update(rows("a", "b"), "chat-1")
    expect(hook.indexOf("b")).toBe(0)

    // Same length, different render — the map is cleared, so `b` is no longer
    // arriving. This is what bounds the map to one burst instead of the
    // transcript's whole history.
    hook.update(rows("a", "b"), "chat-1")
    expect(hook.indexOf("b")).toBeUndefined()
    hook.cleanup()
  })

  test("switching chats does not animate the new chat's backlog", () => {
    // Without the reset the new chat's rows read as an append onto the old
    // chat's length, and animate (or not) depending on which was longer.
    const hook = mountHook(rows("a"), "chat-1")
    hook.update(rows("x", "y", "z"), "chat-2")

    expect(hook.indexOf("x")).toBeUndefined()
    expect(hook.indexOf("z")).toBeUndefined()
    hook.cleanup()
  })

  test("the returned handle is reference-stable across renders", () => {
    // renderItem lists this in its useCallback deps; a fresh object per render
    // would re-render every visible row on every streamed chunk.
    const hook = mountHook(rows("a"), "chat-1")
    const first = hook.result()
    hook.update(rows("a", "b"), "chat-1")
    expect(hook.result()).toBe(first)
    hook.cleanup()
  })
})
