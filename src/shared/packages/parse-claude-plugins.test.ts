import { describe, test, expect } from "bun:test"
import { parseClaudePluginList, parseClaudePluginsFile } from "./parse-claude-plugins"

const USER_ENTRY = {
  id: "my-plugin",
  version: "1.0.0",
  scope: "user",
  enabled: true,
  installPath: "/home/user/.claude/plugins/my-plugin",
  installedAt: "2026-01-10T00:00:00.000Z",
  lastUpdated: "2026-01-15T00:00:00.000Z",
}

describe("parseClaudePluginList", () => {
  test("parses a valid user-scoped plugin", () => {
    const { packages, error } = parseClaudePluginList([USER_ENTRY])
    expect(error).toBeNull()
    expect(packages).toHaveLength(1)
    const pkg = packages[0]!
    expect(pkg.id).toBe("claude-plugin:my-plugin")
    expect(pkg.kind).toBe("claude-plugin")
    expect(pkg.name).toBe("my-plugin")
    expect(pkg.version).toBe("1.0.0")
    expect(pkg.installedAt).toBe("2026-01-10T00:00:00.000Z")
    expect(pkg.updatedAt).toBe("2026-01-15T00:00:00.000Z")
    expect(pkg.installPath).toBe("/home/user/.claude/plugins/my-plugin")
    expect(pkg.revision).toBeNull()
    expect(pkg.agents).toEqual([])
  })

  test("filters out non-user scoped entries", () => {
    const entries = [
      { ...USER_ENTRY, id: "user-plugin", scope: "user" },
      { ...USER_ENTRY, id: "project-plugin", scope: "project" },
      { ...USER_ENTRY, id: "local-plugin", scope: "local" },
      { ...USER_ENTRY, id: "managed-plugin", scope: "managed" },
    ]
    const { packages } = parseClaudePluginList(entries)
    expect(packages).toHaveLength(1)
    expect(packages[0]!.name).toBe("user-plugin")
  })

  test("deduplicates user entries with same id, taking first", () => {
    const entries = [
      { ...USER_ENTRY, id: "dup-plugin", version: "1.0.0" },
      { ...USER_ENTRY, id: "dup-plugin", version: "2.0.0" },
    ]
    const { packages } = parseClaudePluginList(entries)
    expect(packages).toHaveLength(1)
    expect(packages[0]!.version).toBe("1.0.0")
  })

  test("keeps version: 'unknown' as-is", () => {
    const entry = { ...USER_ENTRY, version: "unknown" }
    const { packages } = parseClaudePluginList([entry])
    expect(packages[0]!.version).toBe("unknown")
    expect(packages[0]!.versionLabel).toBeNull()
  })

  test("returns error when input is not an array", () => {
    const { packages, error } = parseClaudePluginList({})
    expect(packages).toHaveLength(0)
    expect(error).not.toBeNull()
  })

  test("returns error when input is null", () => {
    const { packages, error } = parseClaudePluginList(null)
    expect(packages).toHaveLength(0)
    expect(error).not.toBeNull()
  })

  test("skips malformed entries", () => {
    const { packages, error } = parseClaudePluginList([null, 42, "string", USER_ENTRY])
    expect(error).toBeNull()
    expect(packages).toHaveLength(1)
  })

  test("returns empty list for empty array input", () => {
    const { packages, error } = parseClaudePluginList([])
    expect(error).toBeNull()
    expect(packages).toHaveLength(0)
  })

  test("versionLabel is null when version is 'unknown'", () => {
    const { packages } = parseClaudePluginList([{ ...USER_ENTRY, version: "unknown" }])
    expect(packages[0]!.versionLabel).toBeNull()
  })

  test("versionLabel is truncated version for known version", () => {
    const { packages } = parseClaudePluginList([{ ...USER_ENTRY, version: "abc123def456abcdef" }])
    expect(packages[0]!.versionLabel).toBe("abc123def456")
  })
})

describe("parseClaudePluginsFile", () => {
  test("parses installed_plugins.json (all entries treated as user-scoped)", () => {
    const entries = [
      {
        id: "file-plugin",
        version: "2.0.0",
        installPath: "/home/user/.claude/plugins/file-plugin",
        installedAt: "2026-01-10T00:00:00.000Z",
      },
    ]
    const { packages, error } = parseClaudePluginsFile(entries)
    expect(error).toBeNull()
    expect(packages).toHaveLength(1)
    expect(packages[0]!.id).toBe("claude-plugin:file-plugin")
    expect(packages[0]!.version).toBe("2.0.0")
  })

  test("returns error when input is not an array", () => {
    const { packages, error } = parseClaudePluginsFile("not-an-array")
    expect(packages).toHaveLength(0)
    expect(error).not.toBeNull()
  })

  test("deduplicates entries by id", () => {
    const entries = [
      { id: "dup", version: "1.0.0" },
      { id: "dup", version: "2.0.0" },
    ]
    const { packages } = parseClaudePluginsFile(entries)
    expect(packages).toHaveLength(1)
    expect(packages[0]!.version).toBe("1.0.0")
  })
})
