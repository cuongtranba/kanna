import { describe, test, expect } from "bun:test"
import { parseSkillLock } from "./parse-skill-lock"

const EMPTY_MAP: ReadonlyMap<string, string[]> = new Map()

describe("parseSkillLock", () => {
  test("parses a valid v3 lock file", () => {
    const raw = {
      version: 3,
      skills: {
        "my-skill": {
          source: "owner/repo",
          sourceType: "github",
          sourceUrl: "https://github.com/owner/repo",
          skillPath: "/home/user/.agents/skills/my-skill",
          skillFolderHash: "abc123def456",
          installedAt: "2026-01-10T00:00:00.000Z",
          updatedAt: "2026-01-15T00:00:00.000Z",
          pluginName: "my-skill",
        },
      },
    }
    const { packages, error } = parseSkillLock(raw, EMPTY_MAP)
    expect(error).toBeNull()
    expect(packages).toHaveLength(1)
    const pkg = packages[0]!
    expect(pkg.id).toBe("skill:my-skill")
    expect(pkg.kind).toBe("skill")
    expect(pkg.name).toBe("my-skill")
    expect(pkg.source).toBe("owner/repo")
    expect(pkg.sourceUrl).toBe("https://github.com/owner/repo")
    expect(pkg.revision).toBe("abc123def456")
    expect(pkg.versionLabel).toBe("abc123de")
    expect(pkg.installedAt).toBe("2026-01-10T00:00:00.000Z")
    expect(pkg.updatedAt).toBe("2026-01-15T00:00:00.000Z")
    expect(pkg.installPath).toBe("/home/user/.agents/skills/my-skill")
    expect(pkg.version).toBeNull()
    expect(pkg.agents).toEqual([])
  })

  test("returns error for v1 lock file", () => {
    const raw = {
      version: 1,
      skills: {
        "old-skill": {
          source: "owner/repo",
          computedHash: "abc123",
        },
      },
    }
    const { packages, error } = parseSkillLock(raw, EMPTY_MAP)
    expect(packages).toHaveLength(0)
    expect(error).toMatch(/v1/)
  })

  test("returns error for unknown version", () => {
    const raw = { version: 99, skills: {} }
    const { packages, error } = parseSkillLock(raw, EMPTY_MAP)
    expect(packages).toHaveLength(0)
    expect(error).toMatch(/unknown version/)
  })

  test("returns empty packages for missing skills key without error", () => {
    const raw = { version: 3 }
    const { packages, error } = parseSkillLock(raw, EMPTY_MAP)
    expect(packages).toHaveLength(0)
    expect(error).toBeNull()
  })

  test("skips malformed entries without crashing", () => {
    const raw = {
      version: 3,
      skills: {
        "valid-skill": { source: "owner/repo" },
        "null-entry": null,
        "array-entry": ["not", "an", "object"],
      },
    }
    const { packages, error } = parseSkillLock(raw, EMPTY_MAP)
    expect(error).toBeNull()
    expect(packages).toHaveLength(1)
    expect(packages[0]!.name).toBe("valid-skill")
  })

  test("returns error when root is not an object", () => {
    const { packages, error } = parseSkillLock(null, EMPTY_MAP)
    expect(packages).toHaveLength(0)
    expect(error).not.toBeNull()
  })

  test("populates agents field from agentPresenceMap", () => {
    const raw = {
      version: 3,
      skills: {
        "shared-skill": { source: "owner/repo" },
        "claude-only": { source: "owner/repo" },
      },
    }
    const presenceMap = new Map<string, string[]>([
      ["shared-skill", ["claude-code", "codex"]],
      ["claude-only", ["claude-code"]],
    ])
    const { packages, error } = parseSkillLock(raw, presenceMap)
    expect(error).toBeNull()
    const shared = packages.find((p) => p.name === "shared-skill")!
    expect(shared.agents).toEqual(["claude-code", "codex"])
    const claudeOnly = packages.find((p) => p.name === "claude-only")!
    expect(claudeOnly.agents).toEqual(["claude-code"])
  })

  test("skill with no agentPresenceMap entry gets empty agents array", () => {
    const raw = {
      version: 3,
      skills: { "orphan-skill": { source: "owner/repo" } },
    }
    const presenceMap = new Map<string, string[]>()
    const { packages } = parseSkillLock(raw, presenceMap)
    expect(packages[0]!.agents).toEqual([])
  })

  test("sorts packages by name", () => {
    const raw = {
      version: 3,
      skills: {
        "z-skill": { source: "z/repo" },
        "a-skill": { source: "a/repo" },
        "m-skill": { source: "m/repo" },
      },
    }
    const { packages } = parseSkillLock(raw, EMPTY_MAP)
    expect(packages.map((p) => p.name)).toEqual(["a-skill", "m-skill", "z-skill"])
  })

  test("null skillFolderHash yields null revision and versionLabel", () => {
    const raw = {
      version: 3,
      skills: {
        "nohash-skill": {
          source: "owner/repo",
          skillFolderHash: null,
        },
      },
    }
    const { packages } = parseSkillLock(raw, EMPTY_MAP)
    expect(packages[0]!.revision).toBeNull()
    expect(packages[0]!.versionLabel).toBeNull()
  })
})
