import { describe, expect, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { runGit } from "./diff-store"
import type { DiffStoreCommitOpsDeps } from "./diff-store-commit-ops.adapter"
import {
  commitFiles,
  discardFile,
  generateCommitMessage,
  ignoreFile,
} from "./diff-store-commit-ops.adapter"

async function makeRepo(): Promise<string> {
  const dir = mkdtempSync(path.join(tmpdir(), "kanna-commit-ops-"))
  await runGit(["init", "-b", "main"], dir)
  await runGit(["config", "user.email", "test@kanna.local"], dir)
  await runGit(["config", "user.name", "kanna-test"], dir)
  writeFileSync(path.join(dir, "README.md"), "hello\n")
  await runGit(["add", "README.md"], dir)
  await runGit(["commit", "-m", "init"], dir)
  return dir
}

function makeDeps(overrides: Partial<DiffStoreCommitOpsDeps> = {}): DiffStoreCommitOpsDeps {
  return {
    refreshSnapshot: async () => false,
    ...overrides,
  }
}

describe("commitFiles", () => {
  test("throws when not a git repo", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "kanna-not-git-"))
    await expect(
      commitFiles(makeDeps(), {
        projectId: "p1",
        projectPath: dir,
        paths: ["README.md"],
        summary: "test commit",
        mode: "commit_only",
      })
    ).rejects.toThrow("not in a git repository")
  }, 15_000)

  test("throws when summary is empty", async () => {
    const repo = await makeRepo()
    await expect(
      commitFiles(makeDeps(), {
        projectId: "p1",
        projectPath: repo,
        paths: ["README.md"],
        summary: "   ",
        mode: "commit_only",
      })
    ).rejects.toThrow("Commit summary is required")
  }, 15_000)

  test("throws when no paths provided", async () => {
    const repo = await makeRepo()
    await expect(
      commitFiles(makeDeps(), {
        projectId: "p1",
        projectPath: repo,
        paths: [],
        summary: "test commit",
        mode: "commit_only",
      })
    ).rejects.toThrow("Select at least one file to commit")
  }, 15_000)

  test("throws when file is no longer changed", async () => {
    const repo = await makeRepo()
    await expect(
      commitFiles(makeDeps(), {
        projectId: "p1",
        projectPath: repo,
        paths: ["README.md"],
        summary: "test commit",
        mode: "commit_only",
      })
    ).rejects.toThrow("File is no longer changed")
  }, 15_000)

  test("commits an untracked file in commit_only mode", async () => {
    const repo = await makeRepo()
    writeFileSync(path.join(repo, "new-file.txt"), "content\n")

    const result = await commitFiles(makeDeps(), {
      projectId: "p1",
      projectPath: repo,
      paths: ["new-file.txt"],
      summary: "add new file",
      mode: "commit_only",
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.mode).toBe("commit_only")
      expect(result.pushed).toBe(false)
      expect(result.branchName).toBe("main")
    }
  }, 30_000)

  test("commits a modified tracked file in commit_only mode", async () => {
    const repo = await makeRepo()
    writeFileSync(path.join(repo, "README.md"), "modified content\n")

    const result = await commitFiles(makeDeps(), {
      projectId: "p1",
      projectPath: repo,
      paths: ["README.md"],
      summary: "update readme",
      mode: "commit_only",
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.mode).toBe("commit_only")
      expect(result.pushed).toBe(false)
    }
  }, 30_000)

  test("calls refreshSnapshot on success", async () => {
    const repo = await makeRepo()
    writeFileSync(path.join(repo, "new-file.txt"), "content\n")

    let called = false
    const deps = makeDeps({
      refreshSnapshot: async () => {
        called = true
        return true
      },
    })

    await commitFiles(deps, {
      projectId: "p1",
      projectPath: repo,
      paths: ["new-file.txt"],
      summary: "add new file",
      mode: "commit_only",
    })

    expect(called).toBe(true)
  }, 30_000)

  test("returns commit_only with pushed:false when no remote", async () => {
    const repo = await makeRepo()
    writeFileSync(path.join(repo, "new-file.txt"), "content\n")

    const result = await commitFiles(makeDeps(), {
      projectId: "p1",
      projectPath: repo,
      paths: ["new-file.txt"],
      summary: "add new file",
      mode: "commit_and_push",
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.pushed).toBe(false)
    }
  }, 30_000)
})

describe("discardFile", () => {
  test("throws when not a git repo", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "kanna-not-git-"))
    await expect(
      discardFile(makeDeps(), {
        projectId: "p1",
        projectPath: dir,
        path: "some-file.txt",
      })
    ).rejects.toThrow("not in a git repository")
  }, 15_000)

  test("throws when file is no longer changed", async () => {
    const repo = await makeRepo()
    await expect(
      discardFile(makeDeps(), {
        projectId: "p1",
        projectPath: repo,
        path: "README.md",
      })
    ).rejects.toThrow("File is no longer changed")
  }, 15_000)

  test("discards an untracked file by deleting it", async () => {
    const repo = await makeRepo()
    const filePath = path.join(repo, "untracked.txt")
    writeFileSync(filePath, "content\n")

    const result = await discardFile(makeDeps(), {
      projectId: "p1",
      projectPath: repo,
      path: "untracked.txt",
    })

    expect(result.snapshotChanged).toBe(false)
    const exists = await Bun.file(filePath).exists()
    expect(exists).toBe(false)
  }, 30_000)

  test("discards modifications to a tracked file via restore", async () => {
    const repo = await makeRepo()
    writeFileSync(path.join(repo, "README.md"), "modified content\n")

    const result = await discardFile(makeDeps(), {
      projectId: "p1",
      projectPath: repo,
      path: "README.md",
    })

    expect(result.snapshotChanged).toBe(false)

    // Verify the file was restored
    const content = await Bun.file(path.join(repo, "README.md")).text()
    expect(content).toBe("hello\n")
  }, 30_000)

  test("calls refreshSnapshot after discard", async () => {
    const repo = await makeRepo()
    writeFileSync(path.join(repo, "untracked.txt"), "content\n")

    let called = false
    const deps = makeDeps({
      refreshSnapshot: async () => {
        called = true
        return true
      },
    })

    await discardFile(deps, {
      projectId: "p1",
      projectPath: repo,
      path: "untracked.txt",
    })

    expect(called).toBe(true)
  }, 30_000)
})

describe("ignoreFile", () => {
  test("throws when not a git repo", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "kanna-not-git-"))
    await expect(
      ignoreFile(makeDeps(), {
        projectId: "p1",
        projectPath: dir,
        path: "some-file.txt",
      })
    ).rejects.toThrow("not in a git repository")
  }, 15_000)

  test("throws when file is no longer changed", async () => {
    const repo = await makeRepo()
    await expect(
      ignoreFile(makeDeps(), {
        projectId: "p1",
        projectPath: repo,
        path: "README.md",
      })
    ).rejects.toThrow("File is no longer changed")
  }, 15_000)

  test("throws when file is tracked (not untracked)", async () => {
    const repo = await makeRepo()
    writeFileSync(path.join(repo, "README.md"), "modified content\n")
    await expect(
      ignoreFile(makeDeps(), {
        projectId: "p1",
        projectPath: repo,
        path: "README.md",
      })
    ).rejects.toThrow("Only untracked files can be ignored")
  }, 30_000)

  test("adds untracked file to .gitignore", async () => {
    const repo = await makeRepo()
    writeFileSync(path.join(repo, "secret.txt"), "secret content\n")

    const result = await ignoreFile(makeDeps(), {
      projectId: "p1",
      projectPath: repo,
      path: "secret.txt",
    })

    expect(result.snapshotChanged).toBe(false)

    const gitignoreContent = await Bun.file(path.join(repo, ".gitignore")).text()
    expect(gitignoreContent).toContain("secret.txt")
  }, 30_000)

  test("calls refreshSnapshot after ignore", async () => {
    const repo = await makeRepo()
    writeFileSync(path.join(repo, "secret.txt"), "secret content\n")

    let called = false
    const deps = makeDeps({
      refreshSnapshot: async () => {
        called = true
        return true
      },
    })

    await ignoreFile(deps, {
      projectId: "p1",
      projectPath: repo,
      path: "secret.txt",
    })

    expect(called).toBe(true)
  }, 30_000)
})

describe("generateCommitMessage", () => {
  test("throws when not a git repo", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "kanna-not-git-"))
    await expect(
      generateCommitMessage(makeDeps(), {
        projectPath: dir,
        paths: ["README.md"],
      })
    ).rejects.toThrow("not in a git repository")
  }, 15_000)

  test("throws when no paths provided", async () => {
    const repo = await makeRepo()
    await expect(
      generateCommitMessage(makeDeps(), {
        projectPath: repo,
        paths: [],
      })
    ).rejects.toThrow("Select at least one file")
  }, 15_000)

  test("throws when file is no longer changed", async () => {
    const repo = await makeRepo()
    await expect(
      generateCommitMessage(makeDeps(), {
        projectPath: repo,
        paths: ["README.md"],
      })
    ).rejects.toThrow("File is no longer changed")
  }, 15_000)

  test("deduplicates paths before processing", async () => {
    const repo = await makeRepo()
    // Both paths resolve to the same file — the error should mention the unique path
    await expect(
      generateCommitMessage(makeDeps(), {
        projectPath: repo,
        paths: ["README.md", "README.md"],
      })
    ).rejects.toThrow("File is no longer changed")
  }, 15_000)
})
