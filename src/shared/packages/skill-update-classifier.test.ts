import { describe, test, expect } from "bun:test"
import type { InstalledPackage } from "./types"
import {
  classifySkillUpdate,
  buildTreeIndex,
  deriveSkillFolder,
  repinTarget,
  resolveGitHubRepo,
  type GitTreeEntry,
} from "./skill-update-classifier"

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
    pinnedRef: null,
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

describe("deriveSkillFolder", () => {
  test("strips a trailing /SKILL.md", () => {
    expect(deriveSkillFolder("skills/c3/SKILL.md")).toBe("skills/c3")
    expect(deriveSkillFolder(".agents/skills/impeccable/SKILL.md")).toBe(".agents/skills/impeccable")
  })

  test("accepts a folder path with no SKILL.md suffix", () => {
    expect(deriveSkillFolder("skills/c3")).toBe("skills/c3")
  })

  test("returns null for a root-level SKILL.md (no folder to match)", () => {
    expect(deriveSkillFolder("SKILL.md")).toBeNull()
  })

  test("returns null for blank input", () => {
    expect(deriveSkillFolder("")).toBeNull()
    expect(deriveSkillFolder("   ")).toBeNull()
  })

  test("normalizes leading ./ and trailing slashes", () => {
    expect(deriveSkillFolder("./skills/c3/")).toBe("skills/c3")
  })
})

describe("buildTreeIndex", () => {
  test("indexes by full path and by base name", () => {
    const entries: GitTreeEntry[] = [
      { path: "skills/my-skill", type: "tree", sha: "sha1" },
      { path: "other-skill", type: "tree", sha: "sha2" },
    ]
    const index = buildTreeIndex(entries)
    expect(index.byPath.get("skills/my-skill")?.sha).toBe("sha1")
    expect(index.byName.get("my-skill")?.sha).toBe("sha1")
    expect(index.byName.get("other-skill")?.sha).toBe("sha2")
  })

  test("byName keeps the shallowest entry when base name conflicts", () => {
    const entries: GitTreeEntry[] = [
      { path: "deep/nested/my-skill", type: "tree", sha: "sha-deep" },
      { path: "my-skill", type: "tree", sha: "sha-shallow" },
    ]
    const index = buildTreeIndex(entries)
    expect(index.byName.get("my-skill")?.sha).toBe("sha-shallow")
  })

  test("byPath keeps every same-named folder distinct", () => {
    const entries: GitTreeEntry[] = [
      { path: ".agent/skills/impeccable", type: "tree", sha: "sha-agent" },
      { path: ".agents/skills/impeccable", type: "tree", sha: "sha-agents" },
    ]
    const index = buildTreeIndex(entries)
    expect(index.byPath.get(".agent/skills/impeccable")?.sha).toBe("sha-agent")
    expect(index.byPath.get(".agents/skills/impeccable")?.sha).toBe("sha-agents")
  })

  test("ignores non-tree entries", () => {
    const entries: GitTreeEntry[] = [
      { path: "README.md", type: "blob", sha: "sha1" },
      { path: "my-skill", type: "tree", sha: "sha2" },
    ]
    const index = buildTreeIndex(entries)
    expect(index.byName.has("README.md")).toBe(false)
    expect(index.byPath.has("README.md")).toBe(false)
    expect(index.byName.get("my-skill")?.sha).toBe("sha2")
  })
})

describe("classifySkillUpdate", () => {
  test("up_to_date when hashes match", () => {
    const pkg = makePkg({ revision: "abc123" })
    const index = buildTreeIndex([makeEntry({ sha: "abc123" })])
    const result = classifySkillUpdate(index, false, pkg, 1000)
    expect(result.availability).toBe("up_to_date")
    expect(result.latestRevision).toBe("abc123")
    expect(result.currentRevision).toBe("abc123")
    expect(result.error).toBeNull()
  })

  test("outdated when hashes differ", () => {
    const pkg = makePkg({ revision: "abc123" })
    const index = buildTreeIndex([makeEntry({ sha: "def456" })])
    const result = classifySkillUpdate(index, false, pkg, 1000)
    expect(result.availability).toBe("outdated")
    expect(result.latestRevision).toBe("def456")
    expect(result.currentRevision).toBe("abc123")
    expect(result.error).toBeNull()
  })

  test("outdated when entry absent and tree not truncated (folder deleted)", () => {
    const pkg = makePkg({ revision: "abc123" })
    const index = buildTreeIndex([])
    const result = classifySkillUpdate(index, false, pkg, 1000)
    expect(result.availability).toBe("outdated")
    expect(result.latestRevision).toBeNull()
    expect(result.error).toBeNull()
  })

  test("unknown when entry absent and tree truncated", () => {
    const pkg = makePkg({ revision: "abc123" })
    const index = buildTreeIndex([])
    const result = classifySkillUpdate(index, true, pkg, 1000)
    expect(result.availability).toBe("unknown")
    expect(result.error).toBe("tree truncated")
  })

  test("unknown when entry type is blob", () => {
    const pkg = makePkg({ revision: "abc123", installPath: "my-skill/SKILL.md" })
    const index = {
      byPath: new Map<string, GitTreeEntry>([["my-skill", { path: "my-skill", type: "blob", sha: "abc123" }]]),
      byName: new Map<string, GitTreeEntry>(),
    }
    const result = classifySkillUpdate(index, false, pkg, 1000)
    expect(result.availability).toBe("unknown")
    expect(result.error).toContain("unexpected entry type")
  })

  test("unknown when revision is null (lock v1)", () => {
    const pkg = makePkg({ revision: null })
    const index = buildTreeIndex([makeEntry({ sha: "abc123" })])
    const result = classifySkillUpdate(index, false, pkg, 1000)
    expect(result.availability).toBe("unknown")
    expect(result.error).toContain("no folder hash in lock")
    expect(result.currentRevision).toBeNull()
  })

  test("unknown when source is not GitHub", () => {
    const pkg = makePkg({ sourceUrl: null, source: "not-a-valid-source" })
    const index = buildTreeIndex([makeEntry({ sha: "abc123" })])
    const result = classifySkillUpdate(index, false, pkg, 1000)
    expect(result.availability).toBe("unknown")
    expect(result.error).toBe("unsupported source")
  })

  test("checkedAt is preserved", () => {
    const result = classifySkillUpdate(buildTreeIndex([makeEntry()]), false, makePkg(), 99999)
    expect(result.checkedAt).toBe(99999)
  })

  test("id is preserved from pkg", () => {
    const pkg = makePkg({ id: "skill:special-name" })
    const index = buildTreeIndex([makeEntry({ path: "my-skill", sha: "abc123" })])
    expect(classifySkillUpdate(index, false, pkg, 0).id).toBe("skill:special-name")
  })

  test("latestVersion is null — the checker resolves it, not the classifier", () => {
    const result = classifySkillUpdate(buildTreeIndex([makeEntry()]), false, makePkg(), 0)
    expect(result.latestVersion).toBeNull()
  })

  test("currentVersion echoes the pin so the card can name it", () => {
    const pkg = makePkg({ pinnedRef: "v11.12.0" })
    const result = classifySkillUpdate(buildTreeIndex([makeEntry()]), false, pkg, 0)
    expect(result.currentVersion).toBe("v11.12.0")
  })

  test("currentVersion is null when unpinned", () => {
    const result = classifySkillUpdate(buildTreeIndex([makeEntry()]), false, makePkg(), 0)
    expect(result.currentVersion).toBeNull()
  })

  // Regression: pbakaus/impeccable vendors the same skill into 18 agent
  // directories, all at depth 3. Matching by folder base name kept whichever
  // tied first (`.agent/skills/impeccable`) and compared the installed hash
  // against a sibling copy — a permanent, unfixable "Outdated".
  test("matches the folder named by installPath, not a same-named sibling", () => {
    const pkg = makePkg({
      name: "impeccable",
      revision: "sha-agents",
      installPath: ".agents/skills/impeccable/SKILL.md",
    })
    const index = buildTreeIndex([
      { path: ".agent/skills/impeccable", type: "tree", sha: "sha-agent" },
      { path: ".agents/skills/impeccable", type: "tree", sha: "sha-agents" },
      { path: ".claude/skills/impeccable", type: "tree", sha: "sha-claude" },
    ])
    const result = classifySkillUpdate(index, false, pkg, 0)
    expect(result.availability).toBe("up_to_date")
    expect(result.latestRevision).toBe("sha-agents")
  })

  test("installPath is authoritative — a missing path never falls back to a sibling", () => {
    const pkg = makePkg({
      name: "impeccable",
      revision: "sha-gone",
      installPath: ".agents/skills/impeccable/SKILL.md",
    })
    const index = buildTreeIndex([{ path: ".agent/skills/impeccable", type: "tree", sha: "sha-agent" }])
    const result = classifySkillUpdate(index, false, pkg, 0)
    expect(result.availability).toBe("outdated")
    expect(result.latestRevision).toBeNull()
  })

  test("falls back to base-name matching when the lock records no skillPath", () => {
    const pkg = makePkg({ name: "my-skill", revision: "sha1", installPath: null })
    const index = buildTreeIndex([{ path: "skills/my-skill", type: "tree", sha: "sha1" }])
    expect(classifySkillUpdate(index, false, pkg, 0).availability).toBe("up_to_date")
  })
})

describe("repinTarget", () => {
  const status = (latestVersion: string | null) => ({
    id: "skill:c3",
    availability: "outdated" as const,
    currentRevision: "old",
    latestRevision: "new",
    currentVersion: "v11.12.0",
    latestVersion,
    checkedAt: 0,
    error: null,
  })

  test("names the newer tag for a pinned package", () => {
    expect(repinTarget(makePkg({ pinnedRef: "v11.12.0" }), status("v11.13.4"))).toBe("v11.13.4")
  })

  test("returns null when the package is not pinned", () => {
    expect(repinTarget(makePkg({ pinnedRef: null }), status("v11.13.4"))).toBeNull()
  })

  test("returns null when no upstream tag could be resolved", () => {
    expect(repinTarget(makePkg({ pinnedRef: "v11.12.0" }), status(null))).toBeNull()
  })

  test("returns null when the resolved tag is the pin itself", () => {
    expect(repinTarget(makePkg({ pinnedRef: "v11.12.0" }), status("v11.12.0"))).toBeNull()
  })
})
