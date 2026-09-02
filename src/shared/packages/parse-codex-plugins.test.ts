import { describe, test, expect } from "bun:test"
import { parseCodexPluginList } from "./parse-codex-plugins"
import fixture from "../../server/__fixtures__/codex-plugin-list.json"

describe("parseCodexPluginList", () => {
  test("parses valid codex plugin list", () => {
    const { packages, error } = parseCodexPluginList([
      {
        id: "my-plugin",
        name: "My Plugin",
        version: "1.0.0",
        installPath: "/home/user/.codex/plugins/my-plugin",
        installedAt: "2026-01-10T00:00:00.000Z",
      },
    ])
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
    const { packages } = parseCodexPluginList([
      { id: ".system-core", version: "1.0.0" },
      { id: ".system-extra", version: "1.0.0" },
      { id: "user-plugin", version: "1.0.0" },
    ])
    expect(packages).toHaveLength(1)
    expect(packages[0]!.name).toBe("user-plugin")
  })

  test("returns error when input is not an array", () => {
    const { packages, error } = parseCodexPluginList({ id: "plugin" })
    expect(packages).toHaveLength(0)
    expect(error).not.toBeNull()
  })

  test("returns error when input is null", () => {
    const { packages, error } = parseCodexPluginList(null)
    expect(packages).toHaveLength(0)
    expect(error).not.toBeNull()
  })

  test("skips malformed entries without crashing", () => {
    const { packages, error } = parseCodexPluginList([
      null,
      42,
      { id: "good", version: "1.0.0" },
    ])
    expect(error).toBeNull()
    expect(packages).toHaveLength(1)
  })

  test("fixture excludes .system entries and parses the rest", () => {
    const { packages, error } = parseCodexPluginList(fixture)
    expect(error).toBeNull()
    expect(packages).toHaveLength(2)
    expect(packages.find((p) => p.name === ".system-builtin")).toBeUndefined()
    expect(packages.find((p) => p.name === "mycodexplugin")).toBeDefined()
    expect(packages.find((p) => p.name === "another-plugin")).toBeDefined()
  })

  test("handles entries with missing optional fields gracefully", () => {
    const { packages, error } = parseCodexPluginList([
      { id: "minimal-plugin" },
    ])
    expect(error).toBeNull()
    expect(packages).toHaveLength(1)
    const pkg = packages[0]!
    expect(pkg.version).toBeNull()
    expect(pkg.versionLabel).toBeNull()
    expect(pkg.installPath).toBeNull()
    expect(pkg.installedAt).toBeNull()
  })
})
