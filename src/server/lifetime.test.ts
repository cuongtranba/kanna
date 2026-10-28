import { describe, expect, test } from "vite-plus/test"
import { Lifetime } from "./lifetime"

describe("Lifetime", () => {
  test("runs quiesce, settle, then teardown, and teardown in reverse registration order", async () => {
    const lifetime = new Lifetime()
    const order: string[] = []
    lifetime.defer("teardown", () => { order.push("store") })
    lifetime.defer("settle", async () => { order.push("settle") })
    lifetime.defer("teardown", async () => { order.push("router") })
    lifetime.defer("quiesce", () => { order.push("timers") })
    lifetime.defer("teardown", () => { order.push("agent") })

    await lifetime.disposeAll()

    expect(order).toEqual(["timers", "settle", "agent", "router", "store"])
  })

  test("disposing twice stops each service once", async () => {
    const lifetime = new Lifetime()
    let stops = 0
    lifetime.defer("teardown", () => { stops += 1 })

    await lifetime.disposeAll()
    await lifetime.disposeAll()

    expect(stops).toBe(1)
  })

  test("a throwing or rejecting stop does not skip the stops after it, in any phase", async () => {
    const lifetime = new Lifetime()
    const order: string[] = []
    lifetime.defer("teardown", () => { order.push("store.flush") })
    lifetime.defer("teardown", () => { throw new Error("router exploded") })
    lifetime.defer("teardown", async () => { throw new Error("agent rejected") })
    lifetime.defer("settle", () => { order.push("settle") })
    lifetime.defer("quiesce", () => { throw new Error("timers exploded") })
    lifetime.defer("quiesce", () => { order.push("quiesce") })

    await expect(lifetime.disposeAll()).resolves.toBeUndefined()

    expect(order).toEqual(["quiesce", "settle", "store.flush"])
  })
})
