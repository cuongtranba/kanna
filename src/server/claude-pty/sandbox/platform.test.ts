import { describe, expect, test } from "bun:test"
import { isSandboxSupported, isSandboxEnabled, isSandboxEnabledAsync } from "./platform"
import { resetBwrapCacheForTest } from "./detect"

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

describe("isSandboxEnabledAsync", () => {
  test("respects env=off on linux", async () => {
    expect(await isSandboxEnabledAsync({ platform: "linux", env: "off" })).toBe(false)
  })

  test("linux: depends on bwrap detection (sync no, async maybe yes)", async () => {
    resetBwrapCacheForTest()
    // The actual return depends on whether bwrap is installed on the test machine.
    // We just assert the function is async and returns boolean.
    const r = await isSandboxEnabledAsync({ platform: "linux", env: undefined })
    expect(typeof r).toBe("boolean")
  })

  test("darwin: always enabled when env not 'off'", async () => {
    expect(await isSandboxEnabledAsync({ platform: "darwin", env: undefined })).toBe(true)
  })

  test("win32: always false", async () => {
    expect(await isSandboxEnabledAsync({ platform: "win32", env: "on" })).toBe(false)
  })
})
