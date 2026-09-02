import { describe, test, expect } from "bun:test"
import { parseCodexPluginList, parseCodexPluginAvailable } from "./parse-codex-plugins"
import fixture from "../../server/__fixtures__/codex-plugin-list.json"

describe("parseCodexPluginList", () => {
  test("parses installed plugins from real {installed, available} format", () => {
    const { packages, error } = parseCodexPluginList({
      installed: [
        {
          id: "my-plugin",
          name: "My Plugin",
          version: "1.0.0",
          installPath: "/home/user/.codex/plugins/my-plugin",
          installedAt: "2026-01-10T00:00:00.000Z",
        },
      ],
      available: [],
    })
    expect(error).toBeNull()
    expect(packages).toHaveLength(1)
    const pkg = packages[0]!
    expect(pkg.id).toBe("codex-plugin:my-plugin")
    expect(pkg.kind).toBe("codex-plugin")
    expect(pkg.name).toBe("my-plugin")
    expect(pkg.version).toBe("1.0.0")
    expect(pkg.versionLabel).toBe("1.0.0")
    expect(pkg.installPath).toBe("/home/user/.codex/plugins/my-plugin")
    expect(pkg.installedAt).toBe("2026-01-10T00:00:00.000Z")
    expect(pkg.revision).toBeNull()
    expect(pkg.agents).toEqual([])
  })

  test("excludes entries whose id starts with .system", () => {
    const { packages } = parseCodexPluginList({
      installed: [
        { id: ".system-core", version: "1.0.0" },
        { id: ".system-extra", version: "1.0.0" },
        { id: "user-plugin", version: "1.0.0" },
      ],
      available: [],
    })
    expect(packages).toHaveLength(1)
    expect(packages[0]!.name).toBe("user-plugin")
  })

  test("returns error when input is not a record", () => {
    const { packages, error } = parseCodexPluginList([{ id: "plugin" }])
    expect(packages).toHaveLength(0)
    expect(error).not.toBeNull()
  })

  test("returns error when installed is missing", () => {
    const { packages, error } = parseCodexPluginList({ available: [] })
    expect(packages).toHaveLength(0)
    expect(error).not.toBeNull()
  })

  test("returns error when input is null", () => {
    const { packages, error } = parseCodexPluginList(null)
    expect(packages).toHaveLength(0)
    expect(error).not.toBeNull()
  })

  test("skips malformed installed entries without crashing", () => {
    const { packages, error } = parseCodexPluginList({
      installed: [null, 42, { id: "good", version: "1.0.0" }],
      available: [],
    })
    expect(error).toBeNull()
    expect(packages).toHaveLength(1)
  })

  test("fixture parses 2 installed packages (excluding .system-builtin)", () => {
    const { packages, error } = parseCodexPluginList(fixture)
    expect(error).toBeNull()
    expect(packages).toHaveLength(2)
    expect(packages.find((p) => p.name === ".system-builtin")).toBeUndefined()
    expect(packages.find((p) => p.name === "mycodexplugin")).toBeDefined()
    expect(packages.find((p) => p.name === "another-plugin")).toBeDefined()
  })

  test("handles installed entries with missing optional fields gracefully", () => {
    const { packages, error } = parseCodexPluginList({
      installed: [{ id: "minimal-plugin" }],
      available: [],
    })
    expect(error).toBeNull()
    expect(packages).toHaveLength(1)
    const pkg = packages[0]!
    expect(pkg.version).toBeNull()
    expect(pkg.versionLabel).toBeNull()
    expect(pkg.installPath).toBeNull()
    expect(pkg.installedAt).toBeNull()
  })
})

describe("parseCodexPluginAvailable", () => {
  test("returns map of id → entry for available updates", () => {
    const result = parseCodexPluginAvailable({
      installed: [{ id: "my-plugin", version: "1.0.0" }],
      available: [{ id: "my-plugin", version: "1.1.0" }],
    })
    expect(result.size).toBe(1)
    const entry = result.get("my-plugin")!
    expect(entry.id).toBe("my-plugin")
    expect(entry.version).toBe("1.1.0")
  })

  test("excludes .system entries from available", () => {
    const result = parseCodexPluginAvailable({
      installed: [],
      available: [
        { id: ".system-core", version: "2.0.0" },
        { id: "user-plugin", version: "1.5.0" },
      ],
    })
    expect(result.has(".system-core")).toBe(false)
    expect(result.has("user-plugin")).toBe(true)
  })

  test("returns empty map when available is empty", () => {
    const result = parseCodexPluginAvailable({ installed: [], available: [] })
    expect(result.size).toBe(0)
  })

  test("returns empty map on non-record input", () => {
    expect(parseCodexPluginAvailable(null).size).toBe(0)
    expect(parseCodexPluginAvailable([]).size).toBe(0)
  })

  test("fixture has one available update (another-plugin 0.6.0)", () => {
    const result = parseCodexPluginAvailable(fixture)
    expect(result.size).toBe(1)
    const entry = result.get("another-plugin")!
    expect(entry.version).toBe("0.6.0")
  })
})
