import "../lib/testing/setupHappyDom"
import { afterEach, describe, expect, test } from "vite-plus/test"
import { domAdapter } from "./dom.adapter"

function setTouchDevice(on: boolean) {
  if (on) {
    Object.defineProperty(window, "ontouchstart", { configurable: true, value: null })
  } else if ("ontouchstart" in window) {
    Reflect.deleteProperty(window, "ontouchstart")
  }
  Object.defineProperty(navigator, "maxTouchPoints", {
    configurable: true,
    value: on ? 5 : 0,
  })
}

describe("domAdapter.isTouchDevice", () => {
  afterEach(() => setTouchDevice(false))

  test("false when neither ontouchstart nor maxTouchPoints", () => {
    setTouchDevice(false)
    expect(domAdapter.isTouchDevice()).toBe(false)
  })

  test("true when ontouchstart present (mobile Safari)", () => {
    Object.defineProperty(window, "ontouchstart", { configurable: true, value: null })
    expect(domAdapter.isTouchDevice()).toBe(true)
  })

  test("true when maxTouchPoints > 0 (touch laptop, iPad)", () => {
    Reflect.deleteProperty(window, "ontouchstart")
    Object.defineProperty(navigator, "maxTouchPoints", { configurable: true, value: 5 })
    expect(domAdapter.isTouchDevice()).toBe(true)
  })
})
