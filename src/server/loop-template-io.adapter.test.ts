import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  isWorktreeOfSameRepo,
  readOracleScript,
} from "./loop-template-io.adapter"

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
