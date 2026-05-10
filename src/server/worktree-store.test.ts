import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { parseWorktreeList, listWorktrees } from "./worktree-store"

function git(cwd: string, ...args: string[]) {
  // spawnSync (not Bun.spawn) is chosen here so makeTempRepo can stay synchronous;
  // the env block mirrors NON_INTERACTIVE_GIT_ENV in diff-store.ts to ensure no
  // credential helper or askpass prompt can hang the test on CI runners.
  const r = spawnSync("git", args, {
    cwd,
    stdio: "pipe",
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      GIT_ASKPASS: "echo",
      SSH_ASKPASS: "echo",
      GCM_INTERACTIVE: "Never",
    },
  })
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr.toString()}`)
  return r.stdout.toString().trim()
}

function makeTempRepo(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "kanna-wt-"))
  git(dir, "init", "-q", "-b", "main")
  git(dir, "config", "user.email", "test@example.com")
  git(dir, "config", "user.name", "Test")
  git(dir, "commit", "--allow-empty", "-m", "init")
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

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
