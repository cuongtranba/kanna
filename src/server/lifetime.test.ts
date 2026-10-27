import { describe, expect, test } from "bun:test"
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
})
