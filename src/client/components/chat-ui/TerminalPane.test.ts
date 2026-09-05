import { describe, expect, test } from "bun:test"
import { getMacOptionInputSequence, getTerminalFontSize, getTerminalOptions } from "./TerminalPane"

describe("getTerminalOptions", () => {
  test("treats Option as Meta on macOS", () => {
    const options = getTerminalOptions(1_000, { foreground: "#fff" }, 13, "MacIntel")

    expect(options.macOptionIsMeta).toBe(true)
    expect(options.scrollback).toBe(1_000)
    expect(options.lineHeight).toBe(1)
  })

  test("does not enable macOS Option behavior on non-mac platforms", () => {
    const options = getTerminalOptions(500, { foreground: "#fff" }, 13, "Linux x86_64")

    expect(options.macOptionIsMeta).toBe(false)
    expect(options.scrollback).toBe(500)
  })

  test("takes the font size as a parameter instead of hardcoding it", () => {
    const options = getTerminalOptions(500, { foreground: "#fff" }, 20, "MacIntel")

    expect(options.fontSize).toBe(20)
  })
})

describe("getTerminalFontSize", () => {
  test("md (default) resolves to the base 13px size", () => {
    expect(getTerminalFontSize("md")).toBe(13)
  })

  test("scales up with lg/xl/xxl, rounded to the nearest pixel", () => {
    expect(getTerminalFontSize("lg")).toBe(15)
    expect(getTerminalFontSize("xl")).toBe(16)
    expect(getTerminalFontSize("xxl")).toBe(20)
  })

  test("scales down with sm, rounded to the nearest pixel", () => {
    expect(getTerminalFontSize("sm")).toBe(11)
  })

  test("falls back to the base size for garbage input, same as resolveFontScale", () => {
    expect(getTerminalFontSize("huge")).toBe(13)
    expect(getTerminalFontSize(undefined)).toBe(13)
  })
})

describe("getMacOptionInputSequence", () => {
  test("maps plain arrow keys to standard escape sequences", () => {
    expect(getMacOptionInputSequence({
      key: "ArrowUp",
      altKey: false,
      ctrlKey: false,
      metaKey: false,
    }, "MacIntel")).toBe("\x1b[A")

    expect(getMacOptionInputSequence({
      key: "ArrowDown",
      altKey: false,
      ctrlKey: false,
      metaKey: false,
    }, "MacIntel")).toBe("\x1b[B")
  })

  test("maps Option+Left and Option+Right to shell word motion on macOS", () => {
    expect(getMacOptionInputSequence({
      key: "ArrowLeft",
      altKey: true,
      ctrlKey: false,
      metaKey: false,
    }, "MacIntel")).toBe("\x1bb")

    expect(getMacOptionInputSequence({
      key: "ArrowRight",
      altKey: true,
      ctrlKey: false,
      metaKey: false,
    }, "MacIntel")).toBe("\x1bf")
  })

  test("maps Option+Backspace to backward delete word on macOS", () => {
    expect(getMacOptionInputSequence({
      key: "Backspace",
      altKey: true,
      ctrlKey: false,
      metaKey: false,
    }, "MacIntel")).toBe("\x1b\x7f")
  })

  test("maps Command+Delete to kill backward and forward by line on macOS", () => {
    expect(getMacOptionInputSequence({
      key: "Backspace",
      altKey: false,
      ctrlKey: false,
      metaKey: true,
    }, "MacIntel")).toBe("\x15")

    expect(getMacOptionInputSequence({
      key: "Delete",
      altKey: false,
      ctrlKey: false,
      metaKey: true,
    }, "MacIntel")).toBe("\x0b")
  })

  test("ignores non-mac or modified key combinations", () => {
    expect(getMacOptionInputSequence({
      key: "ArrowLeft",
      altKey: true,
      ctrlKey: false,
      metaKey: false,
    }, "Linux x86_64")).toBeNull()

    expect(getMacOptionInputSequence({
      key: "ArrowLeft",
      altKey: true,
      ctrlKey: true,
      metaKey: false,
    }, "MacIntel")).toBeNull()
  })
})
