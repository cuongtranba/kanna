import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { git, makeTempRepo } from "./test-helpers/worktree-repo"
import { parseWorktreeList, listWorktrees, addWorktree, isDirty } from "./worktree-store"
import { writeFileSync } from "node:fs"

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

test("listWorktrees returns the primary worktree for a fresh repo", async () => {
  const { dir, cleanup } = makeTempRepo()
  try {
    const result = await listWorktrees(dir)
    expect(result.length).toBe(1)
    expect(result[0].isPrimary).toBe(true)
    expect(result[0].branch).toBe("main")
  } finally {
    cleanup()
  }
}, 30_000)

test("listWorktrees sees a secondary worktree", async () => {
  const { dir, cleanup } = makeTempRepo()
  try {
    git(dir, "worktree", "add", join(dir, ".worktrees", "feat-x"), "-b", "feat/x")
    const result = await listWorktrees(dir)
    expect(result.length).toBe(2)
    const secondary = result.find((w) => !w.isPrimary)
    expect(secondary?.branch).toBe("feat/x")
  } finally {
    cleanup()
  }
}, 30_000)

test("addWorktree creates a new branch worktree", async () => {
  const { dir, cleanup } = makeTempRepo()
  try {
    const wt = await addWorktree(dir, {
      kind: "new-branch",
      branch: "feat/y",
      path: join(dir, ".worktrees", "feat-y"),
    })
    expect(wt.branch).toBe("feat/y")
    expect(wt.isPrimary).toBe(false)
    const list = await listWorktrees(dir)
    expect(list.some((w) => w.branch === "feat/y")).toBe(true)
  } finally {
    cleanup()
  }
}, 30_000)

test("addWorktree attaches an existing branch", async () => {
  const { dir, cleanup } = makeTempRepo()
  try {
    git(dir, "branch", "feat/exists")
    const wt = await addWorktree(dir, {
      kind: "existing-branch",
      branch: "feat/exists",
      path: join(dir, ".worktrees", "feat-exists"),
    })
    expect(wt.branch).toBe("feat/exists")
  } finally {
    cleanup()
  }
}, 30_000)

test("addWorktree throws with git stderr on conflict", async () => {
  const { dir, cleanup } = makeTempRepo()
  try {
    await addWorktree(dir, { kind: "new-branch", branch: "feat/dup", path: join(dir, ".worktrees", "a") })
    await expect(
      addWorktree(dir, { kind: "new-branch", branch: "feat/dup", path: join(dir, ".worktrees", "b") })
    ).rejects.toThrow(/already (used|exists)/)
  } finally {
    cleanup()
  }
}, 30_000)

test("isDirty is false on a clean tree", async () => {
  const { dir, cleanup } = makeTempRepo()
  try {
    expect(await isDirty(dir)).toEqual({ dirty: false, fileCount: 0 })
  } finally { cleanup() }
}, 30_000)

test("isDirty counts modified + untracked", async () => {
  const { dir, cleanup } = makeTempRepo()
  try {
    writeFileSync(join(dir, "a.txt"), "hello")
    writeFileSync(join(dir, "b.txt"), "world")
    const r = await isDirty(dir)
    expect(r.dirty).toBe(true)
    expect(r.fileCount).toBe(2)
  } finally { cleanup() }
}, 30_000)
