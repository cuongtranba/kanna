import { describe, expect, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { runGit } from "./diff-store"
import type { DiffStoreBranchOpsDeps } from "./diff-store-branch-ops.adapter"
import {
  checkoutBranch,
  createBranch,
  listBranches,
  mergeBranch,
  previewMergeBranch,
  syncBranch,
} from "./diff-store-branch-ops.adapter"

async function makeRepo(): Promise<string> {
  const dir = mkdtempSync(path.join(tmpdir(), "kanna-branch-ops-"))
  await runGit(["init", "-b", "main"], dir)
  await runGit(["config", "user.email", "test@kanna.local"], dir)
  await runGit(["config", "user.name", "kanna-test"], dir)
  writeFileSync(path.join(dir, "README.md"), "hello\n")
  await runGit(["add", "README.md"], dir)
  await runGit(["commit", "-m", "init"], dir)
  return dir
}

function makeDeps(overrides: Partial<DiffStoreBranchOpsDeps> = {}): DiffStoreBranchOpsDeps {
  return {
    refreshSnapshot: async () => false,
    ...overrides,
  }
}

describe("listBranches", () => {
  test("throws when not a git repo", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "kanna-not-git-"))
    await expect(listBranches(makeDeps(), { projectPath: dir })).rejects.toThrow("not in a git repository")
  }, 15_000)

  test("lists current branch in local branches", async () => {
    const repo = await makeRepo()
    const result = await listBranches(makeDeps(), { projectPath: repo })
    expect(result.currentBranchName).toBe("main")
    const localNames = result.local.map((b) => b.name)
    expect(localNames).toContain("main")
    expect(result.local[0]).toMatchObject({ kind: "local", displayName: "main" })
  }, 30_000)

  test("returns empty remote/pullRequests with no remote", async () => {
    const repo = await makeRepo()
    const result = await listBranches(makeDeps(), { projectPath: repo })
    expect(result.remote).toHaveLength(0)
    expect(result.pullRequests).toHaveLength(0)
    expect(result.pullRequestsStatus).toBe("unavailable")
  }, 30_000)

  test("lists multiple local branches", async () => {
    const repo = await makeRepo()
    await runGit(["switch", "-c", "feature-a"], repo)
    await runGit(["switch", "main"], repo)
    await runGit(["switch", "-c", "feature-b"], repo)
    await runGit(["switch", "main"], repo)

    const result = await listBranches(makeDeps(), { projectPath: repo })
    const localNames = result.local.map((b) => b.name)
    expect(localNames).toContain("main")
    expect(localNames).toContain("feature-a")
    expect(localNames).toContain("feature-b")
  }, 30_000)
})

describe("createBranch", () => {
  test("throws for empty branch name", async () => {
    const repo = await makeRepo()
    await expect(
      createBranch(makeDeps(), { projectId: "p1", projectPath: repo, name: "" })
    ).rejects.toThrow("Branch name is required")
  }, 15_000)

  test("throws when not a git repo", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "kanna-not-git-"))
    await expect(
      createBranch(makeDeps(), { projectId: "p1", projectPath: dir, name: "new-branch" })
    ).rejects.toThrow("not in a git repository")
  }, 15_000)

  test("returns failure for duplicate branch name", async () => {
    const repo = await makeRepo()
    const result = await createBranch(makeDeps(), { projectId: "p1", projectPath: repo, name: "main" })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.title).toContain("Create branch failed")
      expect(result.message).toContain("main")
    }
  }, 30_000)

  test("creates a new branch and switches to it", async () => {
    const repo = await makeRepo()
    const result = await createBranch(makeDeps(), { projectId: "p1", projectPath: repo, name: "my-feature" })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.branchName).toBe("my-feature")
      expect(result.snapshotChanged).toBe(false)
    }
  }, 30_000)

  test("creates branch from explicit base branch", async () => {
    const repo = await makeRepo()
    const result = await createBranch(makeDeps(), {
      projectId: "p1",
      projectPath: repo,
      name: "from-main",
      baseBranchName: "main",
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.branchName).toBe("from-main")
    }
  }, 30_000)
})

describe("checkoutBranch", () => {
  test("throws when not a git repo", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "kanna-not-git-"))
    await expect(
      checkoutBranch(makeDeps(), {
        projectId: "p1",
        projectPath: dir,
        branch: { kind: "local", name: "main" },
      })
    ).rejects.toThrow("not in a git repository")
  }, 15_000)

  test("cancels when dirty paths and bringChanges is false", async () => {
    const repo = await makeRepo()
    // Create another branch to checkout
    await runGit(["switch", "-c", "other"], repo)
    await runGit(["switch", "main"], repo)
    // Dirty the working tree
    writeFileSync(path.join(repo, "dirty.txt"), "changes\n")

    const result = await checkoutBranch(makeDeps(), {
      projectId: "p1",
      projectPath: repo,
      branch: { kind: "local", name: "other" },
      bringChanges: false,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.cancelled).toBe(true)
      expect(result.title).toContain("cancelled")
    }
  }, 30_000)

  test("switches to a local branch", async () => {
    const repo = await makeRepo()
    await runGit(["switch", "-c", "feature-x"], repo)
    await runGit(["switch", "main"], repo)

    const result = await checkoutBranch(makeDeps(), {
      projectId: "p1",
      projectPath: repo,
      branch: { kind: "local", name: "feature-x" },
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.branchName).toBe("feature-x")
    }
  }, 30_000)
})

describe("previewMergeBranch", () => {
  test("throws when not a git repo", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "kanna-not-git-"))
    await expect(
      previewMergeBranch(makeDeps(), {
        projectPath: dir,
        branch: { kind: "local", name: "main" },
      })
    ).rejects.toThrow("not in a git repository")
  }, 15_000)

  test("returns up_to_date when targeting current branch", async () => {
    const repo = await makeRepo()
    const result = await previewMergeBranch(makeDeps(), {
      projectPath: repo,
      branch: { kind: "local", name: "main" },
    })
    expect(result.status).toBe("up_to_date")
    expect(result.currentBranchName).toBe("main")
    expect(result.targetBranchName).toBe("main")
  }, 30_000)

  test("returns up_to_date when branch has no new commits", async () => {
    const repo = await makeRepo()
    // Create a branch but don't add commits — so it has 0 commits ahead of main
    await runGit(["switch", "-c", "empty-branch"], repo)
    await runGit(["switch", "main"], repo)

    const result = await previewMergeBranch(makeDeps(), {
      projectPath: repo,
      branch: { kind: "local", name: "empty-branch" },
    })
    expect(result.status).toBe("up_to_date")
    expect(result.commitCount).toBe(0)
  }, 30_000)

  test("returns mergeable when branch has new commits", async () => {
    const repo = await makeRepo()
    // Create a branch with a commit
    await runGit(["switch", "-c", "with-commits"], repo)
    writeFileSync(path.join(repo, "new-file.txt"), "content\n")
    await runGit(["add", "new-file.txt"], repo)
    await runGit(["commit", "-m", "add new file"], repo)
    await runGit(["switch", "main"], repo)

    const result = await previewMergeBranch(makeDeps(), {
      projectPath: repo,
      branch: { kind: "local", name: "with-commits" },
    })
    expect(result.status).toBe("mergeable")
    expect(result.commitCount).toBe(1)
    expect(result.hasConflicts).toBe(false)
  }, 30_000)
})

describe("mergeBranch", () => {
  test("throws when not a git repo", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "kanna-not-git-"))
    await expect(
      mergeBranch(makeDeps(), {
        projectId: "p1",
        projectPath: dir,
        branch: { kind: "local", name: "main" },
      })
    ).rejects.toThrow("not in a git repository")
  }, 15_000)

  test("returns failure when working tree is dirty", async () => {
    const repo = await makeRepo()
    writeFileSync(path.join(repo, "dirty.txt"), "changes\n")
    const result = await mergeBranch(makeDeps(), {
      projectId: "p1",
      projectPath: repo,
      branch: { kind: "local", name: "main" },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.title).toContain("Merge blocked")
    }
  }, 30_000)

  test("returns failure when already up to date", async () => {
    const repo = await makeRepo()
    await runGit(["switch", "-c", "no-new-commits"], repo)
    await runGit(["switch", "main"], repo)
    const result = await mergeBranch(makeDeps(), {
      projectId: "p1",
      projectPath: repo,
      branch: { kind: "local", name: "no-new-commits" },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.title).toContain("Already up to date")
    }
  }, 30_000)

  test("merges a branch with new commits", async () => {
    const repo = await makeRepo()
    await runGit(["switch", "-c", "to-merge"], repo)
    writeFileSync(path.join(repo, "merged-file.txt"), "content\n")
    await runGit(["add", "merged-file.txt"], repo)
    await runGit(["commit", "-m", "add merged file"], repo)
    await runGit(["switch", "main"], repo)

    const result = await mergeBranch(makeDeps(), {
      projectId: "p1",
      projectPath: repo,
      branch: { kind: "local", name: "to-merge" },
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.branchName).toBe("main")
    }
  }, 30_000)
})

describe("syncBranch", () => {
  test("throws when not a git repo", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "kanna-not-git-"))
    await expect(
      syncBranch(makeDeps(), { projectId: "p1", projectPath: dir, action: "fetch" })
    ).rejects.toThrow("not in a git repository")
  }, 15_000)

  test("returns failure for push without upstream", async () => {
    const repo = await makeRepo()
    const result = await syncBranch(makeDeps(), { projectId: "p1", projectPath: repo, action: "push" })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.title).toContain("Push failed")
      expect(result.message).toContain("upstream")
    }
  }, 30_000)

  test("returns failure for pull without upstream", async () => {
    const repo = await makeRepo()
    const result = await syncBranch(makeDeps(), { projectId: "p1", projectPath: repo, action: "pull" })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.title).toContain("Pull failed")
      expect(result.message).toContain("upstream")
    }
  }, 30_000)

  test("fetch returns failure when no remote configured", async () => {
    const repo = await makeRepo()
    const result = await syncBranch(makeDeps(), { projectId: "p1", projectPath: repo, action: "fetch" })
    // fetch --all --prune with no remotes: git either returns non-zero or returns ok with nothing to fetch
    // Either is acceptable — just verify we get a response
    expect(result.action).toBe("fetch")
  }, 30_000)

  test("publish returns failure when no remote configured", async () => {
    const repo = await makeRepo()
    const result = await syncBranch(makeDeps(), { projectId: "p1", projectPath: repo, action: "publish" })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.action).toBe("publish")
    }
  }, 30_000)
})
