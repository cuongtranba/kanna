import { describe, expect, test } from "bun:test"
import { parseWorktreeList } from "./worktree-store"

describe("parseWorktreeList", () => {
  test("parses primary + secondary worktree", () => {
    const input = [
      "worktree /repo/main",
      "HEAD abc123",
      "branch refs/heads/main",
      "",
      "worktree /repo/.worktrees/feat-x",
      "HEAD def456",
      "branch refs/heads/feat/x",
      "",
    ].join("\n")

    const result = parseWorktreeList(input)

    expect(result).toEqual([
      { path: "/repo/main", sha: "abc123", branch: "main", isPrimary: true,  isLocked: false },
      { path: "/repo/.worktrees/feat-x", sha: "def456", branch: "feat/x", isPrimary: false, isLocked: false },
    ])
  })

  test("marks detached HEAD", () => {
    const input = [
      "worktree /repo/main",
      "HEAD abc123",
      "branch refs/heads/main",
      "",
      "worktree /repo/.worktrees/wip",
      "HEAD def456",
      "detached",
      "",
    ].join("\n")
    expect(parseWorktreeList(input)[1].branch).toBe("(detached)")
  })

  test("flags locked", () => {
    const input = [
      "worktree /repo/main",
      "HEAD abc123",
      "branch refs/heads/main",
      "locked",
      "",
    ].join("\n")
    expect(parseWorktreeList(input)[0].isLocked).toBe(true)
  })

  test("returns [] for empty input", () => {
    expect(parseWorktreeList("")).toEqual([])
  })

  test("filters out bare-repo blocks", () => {
    const input = [
      "worktree /repo/bare",
      "bare",
      "",
    ].join("\n")
    expect(parseWorktreeList(input)).toEqual([])
  })

  test("filters out blocks missing the worktree line", () => {
    const input = [
      "HEAD abc123",
      "branch refs/heads/main",
      "",
    ].join("\n")
    expect(parseWorktreeList(input)).toEqual([])
  })
})
