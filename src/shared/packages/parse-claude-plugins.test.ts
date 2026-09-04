import type { JsonValue } from "../json"
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
  // ─── v1 array format ─────────────────────────────────────────────────────

  test("v1: parses installed_plugins.json array (all entries treated as user-scoped)", () => {
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

  test("v1: returns error when input is not an array or object", () => {
    const { packages, error } = parseClaudePluginsFile("not-an-array")
    expect(packages).toHaveLength(0)
    expect(error).not.toBeNull()
  })

  test("v1: deduplicates entries by id", () => {
    const entries = [
      { id: "dup", version: "1.0.0" },
      { id: "dup", version: "2.0.0" },
    ]
    const { packages } = parseClaudePluginsFile(entries)
    expect(packages).toHaveLength(1)
    expect(packages[0]!.version).toBe("1.0.0")
  })

  // ─── v2 dict format ───────────────────────────────────────────────────────

  const V2_FIXTURE = {
    "my-plugin@acme-marketplace": [
      {
        scope: "user",
        version: "1.2.3",
        gitCommitSha: "abc123def456abc123def456abc123def456abc1",
        installPath: "/home/user/.claude/plugins/my-plugin",
        installedAt: "2026-01-10T00:00:00.000Z",
        lastUpdated: "2026-01-15T00:00:00.000Z",
      },
    ],
  }

  test("v2: parses dict-format installed_plugins.json", () => {
    const { packages, error } = parseClaudePluginsFile(V2_FIXTURE)
    expect(error).toBeNull()
    expect(packages).toHaveLength(1)
    const pkg = packages[0]!
    expect(pkg.id).toBe("claude-plugin:my-plugin@acme-marketplace")
    expect(pkg.kind).toBe("claude-plugin")
    expect(pkg.name).toBe("my-plugin@acme-marketplace")
    expect(pkg.version).toBe("1.2.3")
    expect(pkg.source).toBe("acme-marketplace")
    expect(pkg.revision).toBe("abc123def456abc123def456abc123def456abc1")
    expect(pkg.installPath).toBe("/home/user/.claude/plugins/my-plugin")
    expect(pkg.installedAt).toBe("2026-01-10T00:00:00.000Z")
    expect(pkg.updatedAt).toBe("2026-01-15T00:00:00.000Z")
    expect(pkg.versionLabel).toBe("1.2.3")
    expect(pkg.agents).toEqual([])
  })

  test("v2: extracts marketplace name from source field", () => {
    const { packages } = parseClaudePluginsFile(V2_FIXTURE)
    expect(packages[0]!.source).toBe("acme-marketplace")
  })

  test("v2: stores gitCommitSha in revision field", () => {
    const { packages } = parseClaudePluginsFile(V2_FIXTURE)
    expect(packages[0]!.revision).toBe("abc123def456abc123def456abc123def456abc1")
  })

  test("v2: takes user-scoped entry, skips non-user scopes", () => {
    const fixture: JsonValue = {
      "plugin@mkt": [
        { scope: "project", version: "0.0.1", gitCommitSha: "proj-sha" },
        { scope: "user", version: "1.0.0", gitCommitSha: "user-sha", installedAt: "2026-01-01T00:00:00.000Z" },
        { scope: "local", version: "0.9.0", gitCommitSha: "local-sha" },
      ],
    }
    const { packages } = parseClaudePluginsFile(fixture)
    expect(packages).toHaveLength(1)
    expect(packages[0]!.revision).toBe("user-sha")
    expect(packages[0]!.version).toBe("1.0.0")
  })

  test("v2: skips keys with no user-scoped entry", () => {
    const fixture: JsonValue = {
      "plugin-a@mkt": [{ scope: "project", version: "1.0.0" }],
      "plugin-b@mkt": [{ scope: "user", version: "2.0.0", installedAt: "2026-01-01T00:00:00.000Z" }],
    }
    const { packages } = parseClaudePluginsFile(fixture)
    expect(packages).toHaveLength(1)
    expect(packages[0]!.name).toBe("plugin-b@mkt")
  })

  test("v2: multiple plugins produce one package each", () => {
    const fixture: JsonValue = {
      "plugin-a@mkt": [{ scope: "user", version: "1.0.0", gitCommitSha: "sha-a", installedAt: "2026-01-01T00:00:00.000Z" }],
      "plugin-b@mkt": [{ scope: "user", version: "2.0.0", gitCommitSha: "sha-b", installedAt: "2026-01-01T00:00:00.000Z" }],
    }
    const { packages } = parseClaudePluginsFile(fixture)
    expect(packages).toHaveLength(2)
    const names = packages.map((p) => p.name).sort()
    expect(names).toEqual(["plugin-a@mkt", "plugin-b@mkt"])
  })

  test("v2: plugin key without @ uses key as both name and source", () => {
    const fixture: JsonValue = {
      "standalone-plugin": [
        { scope: "user", version: "1.0.0", installedAt: "2026-01-01T00:00:00.000Z" },
      ],
    }
    const { packages } = parseClaudePluginsFile(fixture)
    expect(packages).toHaveLength(1)
    const pkg = packages[0]!
    expect(pkg.name).toBe("standalone-plugin")
    expect(pkg.source).toBe("standalone-plugin")
  })

  test("v2: null revision when gitCommitSha is absent", () => {
    const fixture: JsonValue = {
      "plugin@mkt": [{ scope: "user", version: "1.0.0", installedAt: "2026-01-01T00:00:00.000Z" }],
    }
    const { packages } = parseClaudePluginsFile(fixture)
    expect(packages[0]!.revision).toBeNull()
  })
})
