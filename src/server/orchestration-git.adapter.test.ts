import { describe, expect, test } from "bun:test"
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { runGit } from "./diff-store"
import { commitAll, diffAgainstBase } from "./orchestration-git.adapter"
import { addWorktree } from "./worktree-store.adapter"

async function makeRepo(): Promise<string> {
  const dir = mkdtempSync(path.join(tmpdir(), "kanna-orch-git-"))
  await runGit(["init", "-b", "main"], dir)
  await runGit(["config", "user.email", "test@kanna.local"], dir)
  await runGit(["config", "user.name", "kanna-test"], dir)
  writeFileSync(path.join(dir, "README.md"), "hello\n")
  await runGit(["add", "README.md"], dir)
  await runGit(["commit", "-m", "init"], dir)
  return dir
}

describe("orchestration-git.adapter", () => {
  test("commitAll commits working-tree changes and returns sha", async () => {
    const repo = await makeRepo()
    writeFileSync(path.join(repo, "a.txt"), "content\n")
    const result = await commitAll(repo, "orch: task t1")
    expect(result.kind).toBe("committed")
    if (result.kind === "committed") {
      expect(result.sha).toMatch(/^[0-9a-f]{7,40}$/)
    }
  }, 30_000)

  test("commitAll on clean tree returns noChanges", async () => {
    const repo = await makeRepo()
    const result = await commitAll(repo, "orch: nothing")
    expect(result.kind).toBe("noChanges")
  }, 30_000)

  test("diffAgainstBase returns unified diff of worktree branch vs base", async () => {
    const repo = await makeRepo()
    const wtPath = path.join(repo, ".worktrees", "t1")
    mkdirSync(path.dirname(wtPath), { recursive: true })
    await addWorktree(repo, { kind: "new-branch", branch: "orch/r1/t1", path: wtPath, base: "main" })
    writeFileSync(path.join(wtPath, "feature.txt"), "new feature\n")
    await runGit(["add", "feature.txt"], wtPath)
    const diff = await diffAgainstBase(wtPath, "main")
    expect(diff).toContain("feature.txt")
    expect(diff).toContain("+new feature")
  }, 30_000)
})
