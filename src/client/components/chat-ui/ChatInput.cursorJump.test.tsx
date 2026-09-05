
import "../../lib/testing/setupHappyDom"
import { afterEach, describe, expect, test } from "bun:test"
import {
  isTouchDeviceEnvironment,
  shouldRefreshPickerOnSelection,
} from "./ChatInput"


function setTouchDevice(on: boolean) {
  if (on) {
    Object.defineProperty(window, "ontouchstart", { configurable: true, value: null })
  } else if ("ontouchstart" in window) {
    delete (window as unknown as { ontouchstart?: unknown }).ontouchstart
  }
  Object.defineProperty(navigator, "maxTouchPoints", {
    configurable: true,
    value: on ? 5 : 0,
  })
}


describe("shouldRefreshPickerOnSelection", () => {
  test("desktop -> picker refreshes on caret moves (Arrow keys, mouse clicks)", () => {
    expect(shouldRefreshPickerOnSelection(false)).toBe(true)
  })

  test("touch device -> picker does NOT refresh (iOS hold-space cursor-drag safety)", () => {
    expect(shouldRefreshPickerOnSelection(true)).toBe(false)
  })
})


describe("isTouchDeviceEnvironment", () => {
  afterEach(() => setTouchDevice(false))

  test("false when neither ontouchstart nor maxTouchPoints", () => {
    setTouchDevice(false)
    expect(isTouchDeviceEnvironment()).toBe(false)
  })

  test("true when ontouchstart present (mobile Safari)", () => {
    Object.defineProperty(window, "ontouchstart", { configurable: true, value: null })
    expect(isTouchDeviceEnvironment()).toBe(true)
  })

  test("true when maxTouchPoints > 0 (touch laptop, iPad)", () => {
    if ("ontouchstart" in window) {
      delete (window as unknown as { ontouchstart?: unknown }).ontouchstart
    }
    Object.defineProperty(navigator, "maxTouchPoints", { configurable: true, value: 5 })
    expect(isTouchDeviceEnvironment()).toBe(true)
  })
})

