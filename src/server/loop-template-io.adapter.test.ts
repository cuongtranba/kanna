import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  ensureTrackingFile,
  inspectTrackingFile,
  isWorktreeOfSameRepo,
  readOracleScript,
} from "./loop-template-io.adapter"

const noopReconcile = (existing: string) => ({ content: existing, changed: false, actions: [] })

describe("ensureTrackingFile", () => {
  let tempRoot = ""

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(tmpdir(), "kanna-loop-tracking-"))
  })

  afterEach(async () => {
    if (tempRoot) await rm(tempRoot, { recursive: true, force: true })
  })

  test("creates the tracking file with the supplied skeleton when absent", async () => {
    const abs = path.join(tempRoot, "PROGRESS.md")
    const result = await ensureTrackingFile({ absPath: abs, skeleton: "# hello\n", reconcile: noopReconcile })
    expect(result.created).toBe(true)
    expect(result.reconciled).toBe(false)
    expect(result.actions).toEqual([])
    expect(result.absPath).toBe(abs)
    const content = await readFile(abs, "utf8")
    expect(content).toBe("# hello\n")
  })

  test("creates missing parent directories as needed", async () => {
    const abs = path.join(tempRoot, "docs", "nested", "PROG.md")
    const result = await ensureTrackingFile({ absPath: abs, skeleton: "seed\n", reconcile: noopReconcile })
    expect(result.created).toBe(true)
    const content = await readFile(abs, "utf8")
    expect(content).toBe("seed\n")
  })

  test("leaves a conformant existing file untouched (reconcile reports no change)", async () => {
    const abs = path.join(tempRoot, "PROGRESS.md")
    await writeFile(abs, "user-authored content", "utf8")
    const result = await ensureTrackingFile({
      absPath: abs,
      skeleton: "SHOULD NOT BE WRITTEN",
      reconcile: noopReconcile,
    })
    expect(result.created).toBe(false)
    expect(result.reconciled).toBe(false)
    expect(result.actions).toEqual([])
    const content = await readFile(abs, "utf8")
    expect(content).toBe("user-authored content")
  })

  test("rewrites an existing file when reconcile reports a change, surfacing the actions", async () => {
    const abs = path.join(tempRoot, "PROGRESS.md")
    await writeFile(abs, "stale content", "utf8")
    const result = await ensureTrackingFile({
      absPath: abs,
      skeleton: "SKELETON (unused when file exists)",
      reconcile: (existing) => ({
        content: `reconciled from: ${existing}`,
        changed: true,
        actions: ['rewrote "## Goal"'],
      }),
    })
    expect(result.created).toBe(false)
    expect(result.reconciled).toBe(true)
    expect(result.actions).toEqual(['rewrote "## Goal"'])
    const content = await readFile(abs, "utf8")
    expect(content).toBe("reconciled from: stale content")
  })
})

describe("readOracleScript", () => {
  let workdir = ""

  beforeEach(async () => {
    workdir = await mkdtemp(path.join(tmpdir(), "kanna-loop-oracle-"))
  })

  afterEach(async () => {
    if (workdir) await rm(workdir, { recursive: true, force: true })
  })

  test("reads a script referenced relative to the workdir", async () => {
    await writeFile(path.join(workdir, ".loop-verify.sh"), "task check\n", "utf8")
    expect(await readOracleScript(workdir, ".loop-verify.sh")).toBe("task check\n")
  })

  test("reads a script in a subdirectory, ./-prefixed", async () => {
    const { mkdir } = await import("node:fs/promises")
    await mkdir(path.join(workdir, "ci"), { recursive: true })
    await writeFile(path.join(workdir, "ci", "gate.sh"), "bun test\n", "utf8")
    expect(await readOracleScript(workdir, "./ci/gate.sh")).toBe("bun test\n")
  })

  test("returns null for a missing script", async () => {
    expect(await readOracleScript(workdir, "nope.sh")).toBeNull()
  })

  test("returns null for a path escaping the workdir", async () => {
    expect(await readOracleScript(workdir, "../outside.sh")).toBeNull()
    expect(await readOracleScript(workdir, "/etc/passwd.sh")).toBeNull()
  })
})

describe("inspectTrackingFile", () => {
  let repo = ""

  const git = async (args: string[], cwd = repo) => {
    const p = Bun.spawn(["git", ...args], {
      cwd,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    })
    await p.exited
  }

  beforeEach(async () => {
    repo = await mkdtemp(path.join(tmpdir(), "kanna-loop-inspect-"))
    await git(["init", "-q"])
    await git(["config", "user.email", "t@example.com"])
    await git(["config", "user.name", "t"])
  })

  afterEach(async () => {
    if (repo) await rm(repo, { recursive: true, force: true })
  })

  test("reports a missing file as absent, untracked, with null content", async () => {
    const result = await inspectTrackingFile(path.join(repo, "PROGRESS.md"))
    expect(result.exists).toBe(false)
    expect(result.content).toBeNull()
    expect(result.gitTracked).toBe(false)
  })

  test("reports an untracked file's content with gitTracked false", async () => {
    const abs = path.join(repo, "PROGRESS.md")
    await writeFile(abs, "# scratch\n")
    const result = await inspectTrackingFile(abs)
    expect(result.exists).toBe(true)
    expect(result.content).toBe("# scratch\n")
    expect(result.gitTracked).toBe(false)
  }, 30_000)

  test("reports a committed file as gitTracked", async () => {
    const abs = path.join(repo, "PROGRESS.md")
    await writeFile(abs, "# committed\n")
    await git(["add", "PROGRESS.md"])
    await git(["commit", "-qm", "add progress"])
    const result = await inspectTrackingFile(abs)
    expect(result.exists).toBe(true)
    expect(result.gitTracked).toBe(true)
  }, 30_000)

  test("a file outside any git repo is exists-but-untracked, not an error", async () => {
    const plain = await mkdtemp(path.join(tmpdir(), "kanna-loop-plain-"))
    try {
      const abs = path.join(plain, "PROGRESS.md")
      await writeFile(abs, "x\n")
      const result = await inspectTrackingFile(abs)
      expect(result.exists).toBe(true)
      expect(result.gitTracked).toBe(false)
    } finally {
      await rm(plain, { recursive: true, force: true })
    }
  }, 30_000)
})

describe("isWorktreeOfSameRepo", () => {
  let repo = ""
  let wt = ""

  const git = async (args: string[], cwd: string) => {
    const p = Bun.spawn(["git", ...args], {
      cwd,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    })
    await p.exited
  }

  beforeEach(async () => {
    repo = await mkdtemp(path.join(tmpdir(), "kanna-loop-repo-"))
    await git(["init", "-q", "-b", "main"], repo)
    await git(["config", "user.email", "t@example.com"], repo)
    await git(["config", "user.name", "t"], repo)
    await writeFile(path.join(repo, "f.txt"), "hi\n")
    await git(["add", "."], repo)
    await git(["commit", "-qm", "init"], repo)
    wt = path.join(await mkdtemp(path.join(tmpdir(), "kanna-loop-wt-")), "branch-a")
    await git(["worktree", "add", "-q", "-b", "branch-a", wt], repo)
  })

  afterEach(async () => {
    for (const dir of [repo, path.dirname(wt)]) {
      if (dir) await rm(dir, { recursive: true, force: true })
    }
  })

  test("accepts a linked worktree of the same repository", async () => {
    expect(await isWorktreeOfSameRepo(repo, wt)).toBe(true)
  }, 30_000)

  test("accepts the project checkout itself", async () => {
    expect(await isWorktreeOfSameRepo(repo, repo)).toBe(true)
  }, 30_000)

  test("rejects an unrelated repository", async () => {
    const other = await mkdtemp(path.join(tmpdir(), "kanna-loop-other-"))
    try {
      await git(["init", "-q"], other)
      expect(await isWorktreeOfSameRepo(repo, other)).toBe(false)
    } finally {
      await rm(other, { recursive: true, force: true })
    }
  }, 30_000)

  test("rejects a directory that is not a git repo at all", async () => {
    const plain = await mkdtemp(path.join(tmpdir(), "kanna-loop-plain2-"))
    try {
      expect(await isWorktreeOfSameRepo(repo, plain)).toBe(false)
    } finally {
      await rm(plain, { recursive: true, force: true })
    }
  }, 30_000)

  test("rejects a path that does not exist", async () => {
    expect(await isWorktreeOfSameRepo(repo, path.join(repo, "nope", "deeper"))).toBe(false)
  }, 30_000)
})
