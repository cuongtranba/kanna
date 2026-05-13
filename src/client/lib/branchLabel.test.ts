import { describe, expect, test } from "bun:test"
import { branchLabel } from "./branchLabel"

describe("branchLabel", () => {
  test("returns 'Setup Git' when hasGitRepo is false", () => {
    expect(branchLabel({ hasGitRepo: false, localPath: "/foo/bar", branchName: "main" }))
      .toBe("Setup Git")
  })

  test("returns null when gitStatus is unknown", () => {
    expect(branchLabel({ gitStatus: "unknown", localPath: "/foo/bar", branchName: "main" }))
      .toBeNull()
  })

  test("returns '<dir> · <branch>' when localPath and branchName supplied", () => {
    expect(branchLabel({
      gitStatus: "ready",
      localPath: "/Users/x/repo/kanna-feature",
      branchName: "feat/x",
    })).toBe("kanna-feature · feat/x")
  })

  test("uses 'Detached HEAD' when branchName is missing", () => {
    expect(branchLabel({ gitStatus: "ready", localPath: "/a/b/wt" }))
      .toBe("wt · Detached HEAD")
  })

  test("returns branch only when localPath is missing", () => {
    expect(branchLabel({ gitStatus: "ready", branchName: "main" }))
      .toBe("main")
  })

  test("returns 'Detached HEAD' when both localPath and branchName missing", () => {
    expect(branchLabel({ gitStatus: "ready" })).toBe("Detached HEAD")
  })

  test("trims trailing slash from localPath", () => {
    expect(branchLabel({ gitStatus: "ready", localPath: "/a/b/wt/", branchName: "main" }))
      .toBe("wt · main")
  })

  test("handles Windows backslash separators", () => {
    expect(branchLabel({
      gitStatus: "ready",
      localPath: "C:\\Users\\x\\repo\\wt",
      branchName: "main",
    })).toBe("wt · main")
  })

  test("falls back to branch-only when localPath is empty string", () => {
    expect(branchLabel({ gitStatus: "ready", localPath: "", branchName: "main" }))
      .toBe("main")
  })
})
