import { describe, expect, test } from "bun:test"
import type { ChatBranchListEntry, ChatBranchListResult, ChatDiffSnapshot } from "../../../shared/types"
import {
  canIgnoreDiffFile,
  canIgnoreDiffFolder,
  dedupeBranchEntries,
  deriveBranchListSnapshot,
  deriveRepositorySnapshot,
  filterBranchEntries,
  formatFetchTooltip,
  formatRelativeTime,
  getBranchCandidatePriority,
  getDiffPreviewAttachment,
  getMergeBranchGroups,
  shouldLoadDiffPatchNow,
} from "./repositoryWorkspace"

function makeEntry(
  overrides: Partial<ChatBranchListEntry> & { name: string },
): ChatBranchListEntry {
  return {
    id: overrides.name,
    kind: "local",
    displayName: overrides.name,
    ...overrides,
  }
}

function makeEmptyBranchList(
  overrides: Partial<ChatBranchListResult> = {},
): ChatBranchListResult {
  return {
    recent: [],
    local: [],
    remote: [],
    pullRequests: [],
    pullRequestsStatus: "unavailable",
    ...overrides,
  }
}

function makeDiffSnapshot(overrides: Partial<ChatDiffSnapshot> = {}): ChatDiffSnapshot {
  return {
    status: "ready",
    files: [],
    branchHistory: { entries: [] },
    ...overrides,
  }
}

describe("getBranchCandidatePriority", () => {
  test("local branches have highest priority", () => {
    expect(getBranchCandidatePriority(makeEntry({ name: "main", kind: "local" }))).toBe(0)
  })

  test("pull requests have medium priority", () => {
    expect(getBranchCandidatePriority(makeEntry({ name: "pr-1", kind: "pull_request" }))).toBe(1)
  })

  test("remote branches have lowest priority", () => {
    expect(getBranchCandidatePriority(makeEntry({ name: "origin/main", kind: "remote" }))).toBe(2)
  })
})

describe("dedupeBranchEntries", () => {
  test("keeps a single entry unchanged", () => {
    const entry = makeEntry({ name: "main", kind: "local" })
    const result = dedupeBranchEntries([entry])
    expect(result.get("main")).toBe(entry)
  })

  test("prefers local over remote for the same branch name", () => {
    const local = makeEntry({ name: "feat", kind: "local" })
    const remote = makeEntry({ name: "feat", kind: "remote" })
    const result = dedupeBranchEntries([remote, local])
    expect(result.get("feat")).toBe(local)
  })

  test("prefers pull_request over remote for the same branch name", () => {
    const pr = makeEntry({ name: "feat", kind: "pull_request" })
    const remote = makeEntry({ name: "feat", kind: "remote" })
    const result = dedupeBranchEntries([remote, pr])
    expect(result.get("feat")).toBe(pr)
  })

  test("keeps local over pull_request for the same branch name", () => {
    const local = makeEntry({ name: "feat", kind: "local" })
    const pr = makeEntry({ name: "feat", kind: "pull_request" })
    const result = dedupeBranchEntries([pr, local])
    expect(result.get("feat")).toBe(local)
  })

  test("keeps distinct entries by name", () => {
    const a = makeEntry({ name: "main", kind: "local" })
    const b = makeEntry({ name: "feat", kind: "local" })
    const result = dedupeBranchEntries([a, b])
    expect(result.size).toBe(2)
    expect(result.get("main")).toBe(a)
    expect(result.get("feat")).toBe(b)
  })

  test("returns empty map for empty input", () => {
    expect(dedupeBranchEntries([]).size).toBe(0)
  })
})

describe("getMergeBranchGroups", () => {
  test("separates default branch, recent, and other", () => {
    const main = makeEntry({ name: "main", kind: "local" })
    const feat = makeEntry({ name: "feat", kind: "local" })
    const fix = makeEntry({ name: "fix", kind: "local" })
    const branchList = makeEmptyBranchList({
      defaultBranchName: "main",
      local: [main, feat, fix],
      recent: [feat],
    })

    const groups = getMergeBranchGroups(branchList)
    expect(groups.defaultBranch?.name).toBe("main")
    expect(groups.recent.map((e) => e.name)).toEqual(["feat"])
    expect(groups.other.map((e) => e.name)).toEqual(["fix"])
  })

  test("excludes the current branch from all groups", () => {
    const main = makeEntry({ name: "main", kind: "local" })
    const feat = makeEntry({ name: "feat", kind: "local" })
    const branchList = makeEmptyBranchList({
      defaultBranchName: "main",
      local: [main, feat],
      recent: [main],
    })

    const groups = getMergeBranchGroups(branchList, "main")
    expect(groups.defaultBranch).toBeUndefined()
    expect(groups.recent).toHaveLength(0)
    expect(groups.other.map((e) => e.name)).toEqual(["feat"])
  })

  test("sorts other branches alphabetically", () => {
    const branches = ["zebra", "apple", "mango"].map((name) =>
      makeEntry({ name, kind: "local" }),
    )
    const branchList = makeEmptyBranchList({ local: branches })

    const groups = getMergeBranchGroups(branchList)
    expect(groups.other.map((e) => e.name)).toEqual(["apple", "mango", "zebra"])
  })

  test("returns undefined defaultBranch when no defaultBranchName", () => {
    const feat = makeEntry({ name: "feat", kind: "local" })
    const branchList = makeEmptyBranchList({ local: [feat] })

    const groups = getMergeBranchGroups(branchList)
    expect(groups.defaultBranch).toBeUndefined()
  })

  test("prefers local over remote in dedup when same name appears in both", () => {
    const local = makeEntry({ name: "feat", kind: "local" })
    const remote = makeEntry({ name: "feat", kind: "remote", displayName: "origin/feat" })
    const branchList = makeEmptyBranchList({ local: [local], remote: [remote] })

    const groups = getMergeBranchGroups(branchList)
    const featEntry = groups.other.find((e) => e.name === "feat")
    expect(featEntry?.kind).toBe("local")
  })
})

describe("filterBranchEntries", () => {
  test("returns all entries when query is empty", () => {
    const entries = [makeEntry({ name: "main" }), makeEntry({ name: "feat" })]
    expect(filterBranchEntries(entries, "")).toEqual(entries)
  })

  test("matches by name", () => {
    const entries = [makeEntry({ name: "main" }), makeEntry({ name: "feat/login" })]
    expect(filterBranchEntries(entries, "feat")).toHaveLength(1)
  })

  test("matches by displayName", () => {
    const entries = [makeEntry({ name: "pr-1", displayName: "Login Flow" })]
    expect(filterBranchEntries(entries, "login")).toHaveLength(1)
    expect(filterBranchEntries(entries, "logout")).toHaveLength(0)
  })

  test("matches by prTitle", () => {
    const entries = [makeEntry({ name: "pr-1", prTitle: "Add authentication" })]
    expect(filterBranchEntries(entries, "authentication")).toHaveLength(1)
  })

  test("matches by description", () => {
    const entries = [makeEntry({ name: "feat", description: "OAuth support" })]
    expect(filterBranchEntries(entries, "oauth")).toHaveLength(1)
  })

  test("is case-insensitive", () => {
    const entries = [makeEntry({ name: "FEATURE-1" })]
    expect(filterBranchEntries(entries, "feature")).toHaveLength(1)
  })
})

describe("deriveBranchListSnapshot", () => {
  test("excludes the current branch from all lists", () => {
    const main = makeEntry({ name: "main" })
    const feat = makeEntry({ name: "feat" })
    const branchList = makeEmptyBranchList({ local: [main, feat], recent: [main] })

    const snapshot = deriveBranchListSnapshot(branchList, undefined, "")
    expect(snapshot.currentName).toBe(branchList.currentBranchName)
    expect(snapshot.local.map((e) => e.name)).toEqual(["main", "feat"])
    expect(snapshot.recent.map((e) => e.name)).toEqual(["main"])
  })

  test("excludes current branch from recent and local", () => {
    const main = makeEntry({ name: "main" })
    const feat = makeEntry({ name: "feat" })
    const branchList = makeEmptyBranchList({
      currentBranchName: "main",
      local: [main, feat],
      recent: [main],
    })

    const snapshot = deriveBranchListSnapshot(branchList, "main", "")
    expect(snapshot.currentName).toBe("main")
    expect(snapshot.local.map((e) => e.name)).toEqual(["feat"])
    expect(snapshot.recent).toHaveLength(0)
  })

  test("filters remote branches that are PR head refs", () => {
    const pr = makeEntry({ name: "pr/42", kind: "pull_request", headRefName: "feat/login" })
    const remote = makeEntry({ name: "feat/login", kind: "remote" })
    const branchList = makeEmptyBranchList({
      remote: [remote],
      pullRequests: [pr],
    })

    const snapshot = deriveBranchListSnapshot(branchList, undefined, "")
    expect(snapshot.remote).toHaveLength(0)
    expect(snapshot.pullRequests).toHaveLength(1)
  })

  test("applies query filter across all lists", () => {
    const main = makeEntry({ name: "main" })
    const feat = makeEntry({ name: "feat/auth" })
    const branchList = makeEmptyBranchList({ local: [main, feat], recent: [feat] })

    const snapshot = deriveBranchListSnapshot(branchList, undefined, "auth")
    expect(snapshot.local.map((e) => e.name)).toEqual(["feat/auth"])
    expect(snapshot.recent.map((e) => e.name)).toEqual(["feat/auth"])
  })

  test("handles null branchList", () => {
    const snapshot = deriveBranchListSnapshot(null, "main", "")
    expect(snapshot.currentName).toBe("main")
    expect(snapshot.recent).toEqual([])
    expect(snapshot.local).toEqual([])
    expect(snapshot.remote).toEqual([])
    expect(snapshot.pullRequests).toEqual([])
    expect(snapshot.totalPullRequestCount).toBe(0)
  })
})

describe("formatRelativeTime", () => {
  const ONE_MINUTE = 60_000
  const ONE_HOUR = 60 * ONE_MINUTE
  const ONE_DAY = 24 * ONE_HOUR
  const ONE_WEEK = 7 * ONE_DAY
  const ONE_MONTH = 30 * ONE_DAY
  const ONE_YEAR = 365 * ONE_DAY

  function ago(ms: number) {
    return new Date(Date.now() - ms).toISOString()
  }

  test("returns 'just now' for under one minute", () => {
    expect(formatRelativeTime(ago(30_000))).toBe("just now")
  })

  test("returns minutes for under one hour", () => {
    expect(formatRelativeTime(ago(5 * ONE_MINUTE))).toBe("5m ago")
  })

  test("returns hours for under one day", () => {
    expect(formatRelativeTime(ago(3 * ONE_HOUR))).toBe("3hr ago")
  })

  test("returns days for under one week", () => {
    expect(formatRelativeTime(ago(4 * ONE_DAY))).toBe("4d ago")
  })

  test("returns weeks for under one month", () => {
    expect(formatRelativeTime(ago(2 * ONE_WEEK))).toBe("2wk ago")
  })

  test("returns months for under one year", () => {
    expect(formatRelativeTime(ago(3 * ONE_MONTH))).toBe("3mo ago")
  })

  test("returns years for over one year", () => {
    expect(formatRelativeTime(ago(2 * ONE_YEAR))).toBe("2yr ago")
  })

  test("returns empty string for invalid timestamp", () => {
    expect(formatRelativeTime("not-a-date")).toBe("")
  })
})

describe("formatFetchTooltip", () => {
  test("returns placeholder for missing timestamp", () => {
    expect(formatFetchTooltip(undefined)).toBe("No local fetch recorded")
  })

  test("includes relative time for a valid timestamp", () => {
    const timestamp = new Date(Date.now() - 30_000).toISOString()
    expect(formatFetchTooltip(timestamp)).toBe("Last fetched just now")
  })
})

function makeDiffFile(
  overrides: Partial<import("../../../shared/types").ChatDiffFile> & { path: string },
): import("../../../shared/types").ChatDiffFile {
  return {
    changeType: "modified",
    isUntracked: false,
    additions: 0,
    deletions: 0,
    patchDigest: "digest-0",
    ...overrides,
  }
}

describe("canIgnoreDiffFile", () => {
  test("returns true for untracked files", () => {
    expect(canIgnoreDiffFile(makeDiffFile({ path: "tmp.log", isUntracked: true }))).toBe(true)
  })

  test("returns false for tracked files", () => {
    expect(canIgnoreDiffFile(makeDiffFile({ path: "src/app.ts", isUntracked: false }))).toBe(false)
  })
})

describe("canIgnoreDiffFolder", () => {
  test("returns true for untracked file inside a subdirectory", () => {
    expect(canIgnoreDiffFolder(makeDiffFile({ path: "tmp/cache/output.log", isUntracked: true }))).toBe(true)
  })

  test("returns false for untracked file at the root", () => {
    expect(canIgnoreDiffFolder(makeDiffFile({ path: "scratch.log", isUntracked: true }))).toBe(false)
  })

  test("returns false for tracked file in a subdirectory", () => {
    expect(canIgnoreDiffFolder(makeDiffFile({ path: "src/app.ts", isUntracked: false }))).toBe(false)
  })
})

describe("shouldLoadDiffPatchNow", () => {
  test("returns true when row is expanded with no patch data", () => {
    expect(
      shouldLoadDiffPatchNow({
        isCollapsed: false,
        hasPreviewAttachment: false,
        patch: undefined,
        patchError: undefined,
        isPatchLoading: false,
      }),
    ).toBe(true)
  })

  test("returns false when row is collapsed", () => {
    expect(
      shouldLoadDiffPatchNow({
        isCollapsed: true,
        hasPreviewAttachment: false,
        patch: undefined,
        patchError: undefined,
        isPatchLoading: false,
      }),
    ).toBe(false)
  })

  test("returns false when a preview attachment is present", () => {
    expect(
      shouldLoadDiffPatchNow({
        isCollapsed: false,
        hasPreviewAttachment: true,
        patch: undefined,
        patchError: undefined,
        isPatchLoading: false,
      }),
    ).toBe(false)
  })

  test("returns false when patch content already exists", () => {
    expect(
      shouldLoadDiffPatchNow({
        isCollapsed: false,
        hasPreviewAttachment: false,
        patch: "diff --git a/app.ts b/app.ts",
        patchError: undefined,
        isPatchLoading: false,
      }),
    ).toBe(false)
  })

  test("returns false when a patch error already exists", () => {
    expect(
      shouldLoadDiffPatchNow({
        isCollapsed: false,
        hasPreviewAttachment: false,
        patch: undefined,
        patchError: "Not found",
        isPatchLoading: false,
      }),
    ).toBe(false)
  })

  test("returns false when patch is already loading", () => {
    expect(
      shouldLoadDiffPatchNow({
        isCollapsed: false,
        hasPreviewAttachment: false,
        patch: undefined,
        patchError: undefined,
        isPatchLoading: true,
      }),
    ).toBe(false)
  })
})

describe("getDiffPreviewAttachment", () => {
  const baseFile = {
    path: "assets/logo.png",
    changeType: "modified" as const,
    isUntracked: false,
    additions: 0,
    deletions: 0,
    patchDigest: "digest-1",
    mimeType: "image/png",
    size: 1024,
  }

  test("returns an attachment for an image file", () => {
    const attachment = getDiffPreviewAttachment("project-1", baseFile)
    expect(attachment).not.toBeNull()
    expect(attachment?.kind).toBe("image")
    expect(attachment?.mimeType).toBe("image/png")
    expect(attachment?.id).toBe("diff:assets/logo.png")
  })

  test("returns an attachment for a PDF file", () => {
    const file = { ...baseFile, path: "docs/spec.pdf", mimeType: "application/pdf" }
    const attachment = getDiffPreviewAttachment("project-1", file)
    expect(attachment).not.toBeNull()
    expect(attachment?.kind).toBe("file")
  })

  test("returns null for non-preview mime types", () => {
    const file = { ...baseFile, mimeType: "text/typescript" }
    expect(getDiffPreviewAttachment("project-1", file)).toBeNull()
  })

  test("returns null when projectId is null", () => {
    expect(getDiffPreviewAttachment(null, baseFile)).toBeNull()
  })

  test("returns null for deleted files", () => {
    const file = { ...baseFile, changeType: "deleted" as const }
    expect(getDiffPreviewAttachment("project-1", file)).toBeNull()
  })

  test("returns null when mimeType is absent", () => {
    const file = { ...baseFile, mimeType: undefined }
    expect(getDiffPreviewAttachment("project-1", file)).toBeNull()
  })

  test("returns null when size is absent", () => {
    const file = { ...baseFile, size: undefined }
    expect(getDiffPreviewAttachment("project-1", file)).toBeNull()
  })

  test("encodes the file path in contentUrl", () => {
    const file = { ...baseFile, path: "assets/my file.png" }
    const attachment = getDiffPreviewAttachment("project-1", file)
    expect(attachment?.contentUrl).toContain(encodeURIComponent("assets/my file.png"))
  })
})

describe("deriveRepositorySnapshot", () => {
  test("sync action is fetch on a published branch with no behind commits", () => {
    const snapshot = deriveRepositorySnapshot(
      makeDiffSnapshot({ hasUpstream: true, behindCount: 0, branchName: "main" }),
    )
    expect(snapshot.syncAction).toBe("fetch")
  })

  test("sync action is pull when behind remote", () => {
    const snapshot = deriveRepositorySnapshot(
      makeDiffSnapshot({ hasUpstream: true, behindCount: 3, branchName: "main" }),
    )
    expect(snapshot.syncAction).toBe("pull")
  })

  test("sync action is publish for an unpublished local branch", () => {
    const snapshot = deriveRepositorySnapshot(
      makeDiffSnapshot({ hasUpstream: false, branchName: "feat/my-feature" }),
    )
    expect(snapshot.syncAction).toBe("publish")
  })

  test("canOpenPullRequest is true for a published non-default branch with a remote", () => {
    const snapshot = deriveRepositorySnapshot(
      makeDiffSnapshot({
        hasUpstream: true,
        branchName: "feat/branch-switcher",
        defaultBranchName: "main",
        hasOriginRemote: true,
        originRepoSlug: "acme/repo",
      }),
    )
    expect(snapshot.canOpenPullRequest).toBe(true)
    expect(snapshot.compareUrl).toContain("acme/repo")
    expect(snapshot.compareUrl).toContain("feat/branch-switcher")
  })

  test("canOpenPullRequest is false on the default branch", () => {
    const snapshot = deriveRepositorySnapshot(
      makeDiffSnapshot({
        hasUpstream: true,
        branchName: "main",
        defaultBranchName: "main",
        hasOriginRemote: true,
        originRepoSlug: "acme/repo",
      }),
    )
    expect(snapshot.canOpenPullRequest).toBe(false)
  })

  test("canOpenPullRequest is false when no origin remote", () => {
    const snapshot = deriveRepositorySnapshot(
      makeDiffSnapshot({
        hasUpstream: true,
        branchName: "feat",
        defaultBranchName: "main",
        hasOriginRemote: false,
      }),
    )
    expect(snapshot.canOpenPullRequest).toBe(false)
  })

  test("primaryCommitMode is commit_and_push when origin remote exists", () => {
    const snapshot = deriveRepositorySnapshot(
      makeDiffSnapshot({ hasOriginRemote: true }),
    )
    expect(snapshot.primaryCommitMode).toBe("commit_and_push")
  })

  test("primaryCommitMode is commit_only without origin remote", () => {
    const snapshot = deriveRepositorySnapshot(
      makeDiffSnapshot({ hasOriginRemote: false }),
    )
    expect(snapshot.primaryCommitMode).toBe("commit_only")
  })

  test("encodedBranchName encodes slash-separated segments", () => {
    const snapshot = deriveRepositorySnapshot(
      makeDiffSnapshot({ branchName: "feat/my feature" }),
    )
    expect(snapshot.encodedBranchName).toBe("feat/my%20feature")
  })

  test("resolvedBranchName falls back to 'current branch'", () => {
    const snapshot = deriveRepositorySnapshot(makeDiffSnapshot({ branchName: undefined }))
    expect(snapshot.resolvedBranchName).toBe("current branch")
  })

  test("counts ahead and behind from snapshot", () => {
    const snapshot = deriveRepositorySnapshot(
      makeDiffSnapshot({ aheadCount: 2, behindCount: 5 }),
    )
    expect(snapshot.aheadCount).toBe(2)
    expect(snapshot.behindCount).toBe(5)
  })
})
