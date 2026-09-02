import { describe, test, expect } from "bun:test"
import {
  parseKnownMarketplaces,
  parseMarketplaceManifest,
  classifyClaudePluginUpdate,
} from "./parse-claude-plugin-marketplace"

describe("parseKnownMarketplaces", () => {
  const VALID_FIXTURE = {
    "acme-marketplace": {
      installLocation: "/home/user/.claude/plugins/marketplaces/acme",
      source: "https://github.com/acme/plugins.git",
      lastUpdated: "2026-01-15T00:00:00.000Z",
      autoUpdate: true,
    },
    "beta-marketplace": {
      installLocation: "/home/user/.claude/plugins/marketplaces/beta",
      source: "https://github.com/beta/plugins.git",
    },
  }

  test("parses a valid known_marketplaces.json", () => {
    const result = parseKnownMarketplaces(VALID_FIXTURE)
    expect(result.size).toBe(2)

    const acme = result.get("acme-marketplace")!
    expect(acme.name).toBe("acme-marketplace")
    expect(acme.installLocation).toBe("/home/user/.claude/plugins/marketplaces/acme")
    expect(acme.lastUpdated).toBe("2026-01-15T00:00:00.000Z")

    const beta = result.get("beta-marketplace")!
    expect(beta.installLocation).toBe("/home/user/.claude/plugins/marketplaces/beta")
    expect(beta.lastUpdated).toBeNull()
  })

  test("skips entries without installLocation", () => {
    const result = parseKnownMarketplaces({ "bad-entry": { source: "https://example.com" } })
    expect(result.size).toBe(0)
  })

  test("returns empty map for non-object input", () => {
    expect(parseKnownMarketplaces(null).size).toBe(0)
    expect(parseKnownMarketplaces([]).size).toBe(0)
    expect(parseKnownMarketplaces("string").size).toBe(0)
  })

  test("skips non-object entry values", () => {
    const result = parseKnownMarketplaces({ "ok": { installLocation: "/path" }, "bad": "not-an-object" })
    expect(result.size).toBe(1)
    expect(result.has("ok")).toBe(true)
  })
})

describe("parseMarketplaceManifest", () => {
  const VALID_FIXTURE = {
    "my-plugin": { version: "1.2.3", sha: "abc123def456abc123" },
    "another-plugin": { version: "0.9.0", sha: "def456abc123def456" },
  }

  test("parses a valid plugins.json manifest", () => {
    const result = parseMarketplaceManifest(VALID_FIXTURE)
    expect(result.size).toBe(2)

    const p1 = result.get("my-plugin")!
    expect(p1.version).toBe("1.2.3")
    expect(p1.sha).toBe("abc123def456abc123")

    const p2 = result.get("another-plugin")!
    expect(p2.version).toBe("0.9.0")
  })

  test("stores null for missing version or sha", () => {
    const result = parseMarketplaceManifest({ "plugin": {} })
    const entry = result.get("plugin")!
    expect(entry.version).toBeNull()
    expect(entry.sha).toBeNull()
  })

  test("returns empty map for non-object input", () => {
    expect(parseMarketplaceManifest(null).size).toBe(0)
    expect(parseMarketplaceManifest([]).size).toBe(0)
  })

  test("skips non-object entries", () => {
    const result = parseMarketplaceManifest({ "ok": { version: "1.0.0", sha: "abc" }, "bad": "not-obj" })
    expect(result.size).toBe(1)
    expect(result.has("ok")).toBe(true)
  })
})

describe("classifyClaudePluginUpdate", () => {
  test("up_to_date when shas match", () => {
    const sha = "abc123def456"
    const result = classifyClaudePluginUpdate(sha, sha)
    expect(result.availability).toBe("up_to_date")
    expect(result.latestRevision).toBe(sha)
    expect(result.error).toBeNull()
  })

  test("outdated when shas differ", () => {
    const result = classifyClaudePluginUpdate("old-sha", "new-sha")
    expect(result.availability).toBe("outdated")
    expect(result.latestRevision).toBe("new-sha")
    expect(result.error).toBeNull()
  })

  test("unknown when latestSha is null", () => {
    const result = classifyClaudePluginUpdate("installed-sha", null)
    expect(result.availability).toBe("unknown")
    expect(result.latestRevision).toBeNull()
    expect(result.error).not.toBeNull()
  })

  test("unknown when installedSha is null", () => {
    const result = classifyClaudePluginUpdate(null, "latest-sha")
    expect(result.availability).toBe("unknown")
    expect(result.latestRevision).toBe("latest-sha")
    expect(result.error).not.toBeNull()
  })

  test("unknown when both shas are null", () => {
    const result = classifyClaudePluginUpdate(null, null)
    expect(result.availability).toBe("unknown")
    expect(result.error).not.toBeNull()
  })

  test("latestVersion is always null (git-sha-based, no version source)", () => {
    const result = classifyClaudePluginUpdate("sha-a", "sha-b")
    expect(result.latestVersion).toBeNull()
  })
})
