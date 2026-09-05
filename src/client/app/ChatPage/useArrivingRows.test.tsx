import { describe, expect, test } from "bun:test"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { STAGGER_LIMIT } from "../../lib/motion"
import { useArrivingRows, type ArrivingRows } from "./useArrivingRows"


interface Row {
  id: string
}

function rows(...ids: string[]): Row[] {
  return ids.map((id) => ({ id }))
}

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

    hook.update(rows("a", "b"), "chat-1")
    expect(hook.indexOf("b")).toBeUndefined()
    hook.cleanup()
  })

  test("switching chats does not animate the new chat's backlog", () => {
    const hook = mountHook(rows("a"), "chat-1")
    hook.update(rows("x", "y", "z"), "chat-2")

    expect(hook.indexOf("x")).toBeUndefined()
    expect(hook.indexOf("z")).toBeUndefined()
    hook.cleanup()
  })

  test("the returned handle is reference-stable across renders", () => {
    const hook = mountHook(rows("a"), "chat-1")
    const first = hook.result()
    hook.update(rows("a", "b"), "chat-1")
    expect(hook.result()).toBe(first)
    hook.cleanup()
  })
})
