import { describe, expect, test } from "bun:test"
import { isSandboxSupported, isSandboxEnabled } from "./platform"

describe("isSandboxSupported", () => {
  test("true on darwin", () => {
    expect(isSandboxSupported("darwin")).toBe(true)
  })
  test("false on linux (P4.1)", () => {
    expect(isSandboxSupported("linux")).toBe(false)
  })
  test("false on win32", () => {
    expect(isSandboxSupported("win32")).toBe(false)
  })
})

describe("isSandboxEnabled", () => {
  test("respects KANNA_PTY_SANDBOX=off explicit override", () => {
    expect(isSandboxEnabled({ platform: "darwin", env: "off" })).toBe(false)
  })
  test("defaults on for supported platform when env unset", () => {
    expect(isSandboxEnabled({ platform: "darwin", env: undefined })).toBe(true)
  })
  test("defaults on for supported platform with env=on", () => {
    expect(isSandboxEnabled({ platform: "darwin", env: "on" })).toBe(true)
  })
  test("false on unsupported platform regardless of env", () => {
    expect(isSandboxEnabled({ platform: "win32", env: "on" })).toBe(false)
  })
})
