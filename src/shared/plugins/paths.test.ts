import { describe, expect, test } from "bun:test"
import {
  PLUGIN_SOCKET_PATH_MAX_BYTES,
  getPluginBuildDir,
  getPluginsRootDir,
  pluginSocketPathFits,
} from "./paths"

const PROD = { KANNA_RUNTIME_PROFILE: "prod" }
const DEV = { KANNA_RUNTIME_PROFILE: "dev" }

describe("plugin directories", () => {
  test("live under the data ROOT, beside keybindings.json", () => {
    expect(getPluginsRootDir("/home/u", PROD)).toBe("/home/u/.kanna/plugins")
  })

  test("follow the dev runtime profile", () => {
    expect(getPluginsRootDir("/home/u", DEV)).toBe("/home/u/.kanna-dev/plugins")
  })

  test("give each plugin its own build directory", () => {
    expect(getPluginBuildDir("/home/u", "hello", PROD)).toBe("/home/u/.kanna/plugins/hello/build")
  })
})

describe("socket path length (macOS sun_path)", () => {
  test("the cap matches the platform limit", () => {
    expect(PLUGIN_SOCKET_PATH_MAX_BYTES).toBe(104)
  })

  test("a home-rooted path with a max-length id does NOT fit", () => {
    const longId = "a".repeat(64)
    const homeRooted = `${getPluginsRootDir("/Users/cuongtran", PROD)}/${longId}/run/host.sock`
    expect(new TextEncoder().encode(homeRooted).length).toBeGreaterThan(PLUGIN_SOCKET_PATH_MAX_BYTES)
    expect(pluginSocketPathFits(homeRooted)).toBe(false)
  })

  test("a short path fits", () => {
    expect(pluginSocketPathFits("/tmp/kanna-plugin-abc123.sock")).toBe(true)
  })

  test("counts BYTES, not characters", () => {
    const multiByte = `/tmp/${"é".repeat(60)}.sock`
    expect(multiByte.length).toBeLessThan(PLUGIN_SOCKET_PATH_MAX_BYTES)
    expect(pluginSocketPathFits(multiByte)).toBe(false)
  })
})
