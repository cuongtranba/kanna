// src/server/orchestration-worktree.adapter.test.ts
import { describe, expect, test } from "bun:test"
import { mkdtempSync, writeFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { runGit } from "./diff-store"
import { createOrchWorktreeOps } from "./orchestration-worktree.adapter"

async function makeRepo(): Promise<string> {
  const dir = mkdtempSync(path.join(tmpdir(), "kanna-orch-wt-"))
  await runGit(["init", "-b", "main"], dir)
  await runGit(["config", "user.email", "test@kanna.local"], dir)
  await runGit(["config", "user.name", "kanna-test"], dir)
  writeFileSync(path.join(dir, "README.md"), "hello\n")
  await runGit(["add", "README.md"], dir)
  await runGit(["commit", "-m", "init"], dir)
  return dir
}

describe("orchestration-worktree.adapter", () => {
  test("ensureWorktree creates a new branch worktree and returns HEAD sha", async () => {
    const repo = await makeRepo()
    const ops = createOrchWorktreeOps()
    const wtPath = path.join(repo, ".kanna-worktrees", "r1", "t1")
    const wt = await ops.ensureWorktree(repo, "orch/r1/t1", wtPath, "main")
    expect(existsSync(path.join(wt.path, "README.md"))).toBe(true)
    expect(wt.branch).toBe("orch/r1/t1")
    expect(wt.headSha).toMatch(/^[0-9a-f]{7,40}$/)
  }, 30_000)

  test("resetHard scrubs tracked + untracked junk, keeps committed work (F13)", async () => {
    const repo = await makeRepo()
    const ops = createOrchWorktreeOps()
    const wtPath = path.join(repo, ".kanna-worktrees", "r1", "t1")
    await ops.ensureWorktree(repo, "orch/r1/t1", wtPath, "main")
    writeFileSync(path.join(wtPath, "committed.txt"), "keep\n")
    await ops.commitAll(wtPath, "orch: keep")
    writeFileSync(path.join(wtPath, "junk.txt"), "junk\n")           // untracked
    writeFileSync(path.join(wtPath, "committed.txt"), "modified\n")  // tracked change
    await ops.resetHard(wtPath)
    expect(existsSync(path.join(wtPath, "junk.txt"))).toBe(false)
    const status = await runGit(["status", "--porcelain"], wtPath)
    expect(status.stdout.trim()).toBe("")
    expect(existsSync(path.join(wtPath, "committed.txt"))).toBe(true)
  }, 30_000)

  test("ensureWorktree is idempotent — reuses an existing worktree (restart recovery)", async () => {
    const repo = await makeRepo()
    const ops = createOrchWorktreeOps()
    const wtPath = path.join(repo, ".kanna-worktrees", "r1", "t1")
    await ops.ensureWorktree(repo, "orch/r1/t1", wtPath, "main")
    writeFileSync(path.join(wtPath, "progress.txt"), "half done\n")
    const again = await ops.ensureWorktree(repo, "orch/r1/t1", wtPath, "main")
    expect(again.path).toBe(wtPath)
    expect(existsSync(path.join(wtPath, "progress.txt"))).toBe(true) // progress kept (F2)
  }, 30_000)

  test("commitAll + diffAgainstBase round-trip through the real repo", async () => {
    const repo = await makeRepo()
    const ops = createOrchWorktreeOps()
    const wtPath = path.join(repo, ".kanna-worktrees", "r1", "t1")
    await ops.ensureWorktree(repo, "orch/r1/t1", wtPath, "main")
    writeFileSync(path.join(wtPath, "feature.ts"), "export const x = 1\n")
    const diff = await ops.diffAgainstBase(wtPath, "main")
    expect(diff).toContain("feature.ts")
    const commit = await ops.commitAll(wtPath, "orch: t1")
    expect(commit.kind).toBe("committed")
  }, 30_000)

  test("removeWorktree removes it", async () => {
    const repo = await makeRepo()
    const ops = createOrchWorktreeOps()
    const wtPath = path.join(repo, ".kanna-worktrees", "r1", "t1")
    await ops.ensureWorktree(repo, "orch/r1/t1", wtPath, "main")
    await ops.removeWorktree(repo, wtPath)
    const list = await runGit(["worktree", "list", "--porcelain"], repo)
    expect(list.stdout).not.toContain(wtPath)
  }, 30_000)
})
