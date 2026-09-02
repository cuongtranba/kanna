import { describe, test, expect } from "bun:test"
import type { InstalledPackage } from "./types"
import { classifySkillUpdate, buildEntryMap, resolveGitHubRepo, type GitTreeEntry } from "./skill-update-classifier"

function makePkg(overrides: Partial<InstalledPackage> = {}): InstalledPackage {
  return {
    id: "skill:my-skill",
    kind: "skill",
    name: "my-skill",
    source: "owner/repo",
    sourceUrl: "https://github.com/owner/repo",
    version: null,
    revision: "abc123",
    installedAt: null,
    updatedAt: null,
    installPath: null,
    versionLabel: null,
    agents: [],
    ...overrides,
  }
}

function makeEntry(overrides: Partial<GitTreeEntry> = {}): GitTreeEntry {
  return {
    path: "my-skill",
    type: "tree",
    sha: "abc123",
    ...overrides,
  }
}

describe("resolveGitHubRepo", () => {
  test("resolves from sourceUrl", () => {
    expect(resolveGitHubRepo(makePkg({ sourceUrl: "https://github.com/owner/repo" }))).toBe("owner/repo")
  })

  test("resolves from sourceUrl with .git suffix", () => {
    expect(resolveGitHubRepo(makePkg({ sourceUrl: "https://github.com/owner/repo.git" }))).toBe("owner/repo")
  })

  test("resolves from sourceUrl with subpath", () => {
    expect(resolveGitHubRepo(makePkg({ sourceUrl: "https://github.com/owner/repo/tree/main/skills" }))).toBe("owner/repo")
  })

  test("resolves from source field when no sourceUrl", () => {
    expect(resolveGitHubRepo(makePkg({ sourceUrl: null, source: "owner/repo" }))).toBe("owner/repo")
  })

  test("returns null when both sourceUrl is non-GitHub and source has no owner/repo pattern", () => {
    expect(
      resolveGitHubRepo(makePkg({ sourceUrl: "https://gitlab.com/owner/repo", source: "just-a-name" })),
    ).toBeNull()
  })

  test("returns null for source with multiple slashes", () => {
    expect(resolveGitHubRepo(makePkg({ sourceUrl: null, source: "owner/repo/subdir" }))).toBeNull()
  })

  test("returns null for source with no slash", () => {
    expect(resolveGitHubRepo(makePkg({ sourceUrl: null, source: "just-a-name" }))).toBeNull()
  })

  test("sourceUrl takes precedence over non-GitHub source", () => {
    expect(resolveGitHubRepo(makePkg({ sourceUrl: "https://github.com/owner/repo", source: "not/github" }))).toBe("owner/repo")
  })
})

describe("buildEntryMap", () => {
  test("keys by folder base name", () => {
    const entries: GitTreeEntry[] = [
      { path: "my-skill", type: "tree", sha: "sha1" },
      { path: "other-skill", type: "tree", sha: "sha2" },
    ]
    const map = buildEntryMap(entries)
    expect(map.get("my-skill")?.sha).toBe("sha1")
    expect(map.get("other-skill")?.sha).toBe("sha2")
  })

  test("keeps shallowest entry when base name conflicts", () => {
    const entries: GitTreeEntry[] = [
      { path: "deep/nested/my-skill", type: "tree", sha: "sha-deep" },
      { path: "my-skill", type: "tree", sha: "sha-shallow" },
    ]
    const map = buildEntryMap(entries)
    expect(map.get("my-skill")?.sha).toBe("sha-shallow")
  })

  test("ignores non-tree entries", () => {
    const entries: GitTreeEntry[] = [
      { path: "README.md", type: "blob", sha: "sha1" },
      { path: "my-skill", type: "tree", sha: "sha2" },
    ]
    const map = buildEntryMap(entries)
    expect(map.has("README.md")).toBe(false)
    expect(map.get("my-skill")?.sha).toBe("sha2")
  })
})

describe("classifySkillUpdate", () => {
  test("up_to_date when hashes match", () => {
    const pkg = makePkg({ revision: "abc123" })
    const entry = makeEntry({ sha: "abc123" })
    const map = buildEntryMap([entry])
    const result = classifySkillUpdate(map, false, pkg, 1000)
    expect(result.availability).toBe("up_to_date")
    expect(result.latestRevision).toBe("abc123")
    expect(result.currentRevision).toBe("abc123")
    expect(result.error).toBeNull()
  })

  test("outdated when hashes differ", () => {
    const pkg = makePkg({ revision: "abc123" })
    const entry = makeEntry({ sha: "def456" })
    const map = buildEntryMap([entry])
    const result = classifySkillUpdate(map, false, pkg, 1000)
    expect(result.availability).toBe("outdated")
    expect(result.latestRevision).toBe("def456")
    expect(result.currentRevision).toBe("abc123")
    expect(result.error).toBeNull()
  })

  test("outdated when entry absent and tree not truncated (folder deleted)", () => {
    const pkg = makePkg({ revision: "abc123" })
    const map = buildEntryMap([]) // empty tree
    const result = classifySkillUpdate(map, false, pkg, 1000)
    expect(result.availability).toBe("outdated")
    expect(result.latestRevision).toBeNull()
    expect(result.error).toBeNull()
  })

  test("unknown when entry absent and tree truncated", () => {
    const pkg = makePkg({ revision: "abc123" })
    const map = buildEntryMap([])
    const result = classifySkillUpdate(map, true, pkg, 1000)
    expect(result.availability).toBe("unknown")
    expect(result.error).toBe("tree truncated")
  })

  test("unknown when entry type is blob", () => {
    const pkg = makePkg({ revision: "abc123" })
    const entries: GitTreeEntry[] = [{ path: "my-skill", type: "blob", sha: "abc123" }]
    const map = new Map<string, GitTreeEntry>([["my-skill", entries[0]]])
    const result = classifySkillUpdate(map, false, pkg, 1000)
    expect(result.availability).toBe("unknown")
    expect(result.error).toContain("unexpected entry type")
  })

  test("unknown when revision is null (lock v1)", () => {
    const pkg = makePkg({ revision: null })
    const entry = makeEntry({ sha: "abc123" })
    const map = buildEntryMap([entry])
    const result = classifySkillUpdate(map, false, pkg, 1000)
    expect(result.availability).toBe("unknown")
    expect(result.error).toContain("no folder hash in lock")
    expect(result.currentRevision).toBeNull()
  })

  test("unknown when source is not GitHub", () => {
    const pkg = makePkg({ sourceUrl: null, source: "not-a-valid-source" })
    const entry = makeEntry({ sha: "abc123" })
    const map = buildEntryMap([entry])
    const result = classifySkillUpdate(map, false, pkg, 1000)
    expect(result.availability).toBe("unknown")
    expect(result.error).toBe("unsupported source")
  })

  test("checkedAt is preserved", () => {
    const pkg = makePkg()
    const map = buildEntryMap([makeEntry()])
    const result = classifySkillUpdate(map, false, pkg, 99999)
    expect(result.checkedAt).toBe(99999)
  })

  test("id is preserved from pkg", () => {
    const pkg = makePkg({ id: "skill:special-name" })
    const entry = makeEntry({ path: "my-skill", sha: "abc123" })
    const map = buildEntryMap([entry])
    const result = classifySkillUpdate(map, false, pkg, 0)
    expect(result.id).toBe("skill:special-name")
  })

  test("currentVersion and latestVersion are null for skills", () => {
    const pkg = makePkg()
    const map = buildEntryMap([makeEntry()])
    const result = classifySkillUpdate(map, false, pkg, 0)
    expect(result.currentVersion).toBeNull()
    expect(result.latestVersion).toBeNull()
  })
})
