import { describe, expect, test } from "bun:test"
import { createWatchedRegistry } from "./watched-registry"

function harness() {
  const loads: string[] = []
  const armed: string[] = []
  const disposed: string[] = []
  const onChangeByKey = new Map<string, () => void>()
  const registry = createWatchedRegistry<string>({
    load: (key) => {
      loads.push(key)
      return `state:${key}:${loads.length}`
    },
    watch: (key, onChange) => {
      armed.push(key)
      onChangeByKey.set(key, onChange)
      return () => disposed.push(key)
    },
  })
  return { registry, loads, armed, disposed, onChangeByKey }
}

describe("createWatchedRegistry", () => {
  test("register arms a watch, loads state, and notifies subscribers", () => {
    const h = harness()
    const seen: string[] = []
    h.registry.subscribe((chatId) => seen.push(chatId))

    h.registry.register("chat1", "/a")

    expect(h.armed).toEqual(["/a"])
    expect(h.registry.entry("chat1")?.key).toBe("/a")
    expect(h.registry.entry("chat1")?.state).toBe("state:/a:1")
    expect(seen).toEqual(["chat1"])
  })

  test("re-registering the same key leaves the live watch alone", () => {
    const h = harness()
    h.registry.register("chat1", "/a")
    h.registry.register("chat1", "/a")

    expect(h.armed).toEqual(["/a"])
    expect(h.disposed).toEqual([])
    expect(h.loads.length).toBe(1)
  })

  test("re-registering a different key disposes the old watch before arming the new", () => {
    const h = harness()
    h.registry.register("chat1", "/a")
    h.registry.register("chat1", "/b")

    expect(h.disposed).toEqual(["/a"])
    expect(h.armed).toEqual(["/a", "/b"])
    expect(h.registry.entry("chat1")?.key).toBe("/b")
  })

  test("a watch change reloads state and notifies subscribers", () => {
    const h = harness()
    h.registry.register("chat1", "/a")
    const seen: string[] = []
    h.registry.subscribe((chatId) => seen.push(chatId))

    h.onChangeByKey.get("/a")?.()

    expect(h.registry.entry("chat1")?.state).toBe("state:/a:2")
    expect(seen).toEqual(["chat1"])
  })

  test("a change arriving after unregister neither reloads nor notifies", () => {
    const h = harness()
    h.registry.register("chat1", "/a")
    const seen: string[] = []
    h.registry.subscribe((chatId) => seen.push(chatId))
    h.registry.unregister("chat1")

    h.onChangeByKey.get("/a")?.()

    expect(h.disposed).toEqual(["/a"])
    expect(h.registry.entry("chat1")).toBeUndefined()
    expect(h.loads.length).toBe(1)
    expect(seen).toEqual([])
  })

  test("unregistering an unknown chat is a no-op", () => {
    const h = harness()
    expect(() => h.registry.unregister("nope")).not.toThrow()
    expect(h.disposed).toEqual([])
  })

  test("entries are per chat", () => {
    const h = harness()
    h.registry.register("chat1", "/a")
    h.registry.register("chat2", "/b")

    expect(h.registry.entry("chat1")?.key).toBe("/a")
    expect(h.registry.entry("chat2")?.key).toBe("/b")
  })

  test("unsubscribe stops delivery", () => {
    const h = harness()
    const seen: string[] = []
    const off = h.registry.subscribe((chatId) => seen.push(chatId))
    off()

    h.registry.register("chat1", "/a")

    expect(seen).toEqual([])
  })
})
