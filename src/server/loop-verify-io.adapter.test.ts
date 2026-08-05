import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { computeWorkspaceDigest, runVerifyCommand } from "./loop-verify-io.adapter"

/** Non-interactive git env so a stray credential/pager prompt cannot hang CI. */
const GIT_TEST_ENV: Record<string, string | undefined> = {
  ...process.env,
  GIT_TERMINAL_PROMPT: "0",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
}

async function git(args: string[], cwd: string): Promise<void> {
  const proc = Bun.spawn(["git", ...args], {
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: GIT_TEST_ENV,
  })
  const [stderr, exitCode] = await Promise.all([new Response(proc.stderr).text(), proc.exited])
  if (exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${stderr}`)
}

/** Temp git repo with one commit, so `rev-parse HEAD` resolves. */
async function makeRepo(root: string): Promise<string> {
  await git(["init", "-q", "-b", "main"], root)
  await git(["config", "user.email", "test@kanna.local"], root)
  await git(["config", "user.name", "kanna-test"], root)
  await git(["config", "commit.gpgsign", "false"], root)
  await writeFile(path.join(root, "README.md"), "hello\n", "utf8")
  await git(["add", "-A"], root)
  await git(["commit", "-q", "-m", "init"], root)
  return root
}

describe("runVerifyCommand", () => {
  let tempRoot = ""

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(tmpdir(), "kanna-loop-verify-"))
  })

  afterEach(async () => {
    if (tempRoot) await rm(tempRoot, { recursive: true, force: true })
  })

  test("reports exit code 0 and the command output for a passing command", async () => {
    const result = await runVerifyCommand({
      command: "echo verify-ok",
      cwd: tempRoot,
      timeoutMs: 10_000,
    })
    expect(result.exitCode).toBe(0)
    expect(result.output).toContain("verify-ok")
    expect(result.timedOut).toBe(false)
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  }, 30_000)

  test("returns a non-zero exit code instead of throwing", async () => {
    const result = await runVerifyCommand({
      command: "exit 3",
      cwd: tempRoot,
      timeoutMs: 10_000,
    })
    expect(result.exitCode).toBe(3)
    expect(result.timedOut).toBe(false)
  }, 30_000)

  test("captures stderr alongside stdout in the combined output", async () => {
    const result = await runVerifyCommand({
      command: "echo to-out; echo to-err 1>&2; exit 1",
      cwd: tempRoot,
      timeoutMs: 10_000,
    })
    expect(result.exitCode).toBe(1)
    expect(result.output).toContain("to-out")
    expect(result.output).toContain("to-err")
  }, 30_000)

  test("runs through a shell so pipes and && behave as typed", async () => {
    const result = await runVerifyCommand({
      command: "echo alpha && echo beta | tr 'a-z' 'A-Z'",
      cwd: tempRoot,
      timeoutMs: 10_000,
    })
    expect(result.exitCode).toBe(0)
    expect(result.output).toContain("alpha")
    expect(result.output).toContain("BETA")
  }, 30_000)

  test("runs the command in the supplied cwd", async () => {
    const result = await runVerifyCommand({
      command: "pwd",
      cwd: tempRoot,
      timeoutMs: 10_000,
    })
    expect(result.exitCode).toBe(0)
    // macOS tmpdir is a /var -> /private/var symlink; compare basenames.
    expect(result.output).toContain(path.basename(tempRoot))
  }, 30_000)

  test("keeps the TAIL of long output and marks the elision", async () => {
    const result = await runVerifyCommand({
      command: "for i in $(seq 1 2000); do echo line-$i; done",
      cwd: tempRoot,
      timeoutMs: 20_000,
      maxOutputChars: 200,
    })
    expect(result.exitCode).toBe(0)
    expect(result.output.length).toBeLessThanOrEqual(200)
    expect(result.output.split("\n")[0] ?? "").toContain("truncated")
    // Tail kept: the last line survives, the first does not.
    expect(result.output.trimEnd().endsWith("line-2000")).toBe(true)
    expect(result.output).not.toContain("line-1\n")
  }, 30_000)

  test("kills the command on timeout, reporting timedOut and a non-zero exit code", async () => {
    const marker = path.join(tempRoot, "stray-child-marker")
    const startedAt = Date.now()
    const result = await runVerifyCommand({
      command: `sleep 5 && touch ${JSON.stringify(marker)}`,
      cwd: tempRoot,
      timeoutMs: 500,
    })
    const elapsed = Date.now() - startedAt

    expect(result.timedOut).toBe(true)
    expect(result.exitCode).not.toBe(0)
    expect(elapsed).toBeLessThan(4_500)

    // The killed command must not finish later: no stray child left behind.
    await Bun.sleep(1_500)
    const markerStat = await stat(marker).catch(() => null)
    expect(markerStat).toBeNull()
  }, 30_000)

  test("kills the whole process group so a backgrounded grandchild dies too", async () => {
    const marker = path.join(tempRoot, "grandchild-marker")
    const result = await runVerifyCommand({
      // The subshell is a grandchild of the spawned shell: killing the shell
      // pid alone would orphan it (a real verify command spawns a test runner).
      command: `( sleep 2; touch ${JSON.stringify(marker)} ) & wait`,
      cwd: tempRoot,
      timeoutMs: 300,
    })
    expect(result.timedOut).toBe(true)

    await Bun.sleep(3_000)
    const markerStat = await stat(marker).catch(() => null)
    expect(markerStat).toBeNull()
  }, 30_000)
})

describe("computeWorkspaceDigest", () => {
  let tempRoot = ""

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(tmpdir(), "kanna-loop-digest-"))
  })

  afterEach(async () => {
    if (tempRoot) await rm(tempRoot, { recursive: true, force: true })
  })

  test("returns null for a directory that is not a git repo", async () => {
    const digest = await computeWorkspaceDigest(tempRoot)
    expect(digest).toBeNull()
  }, 30_000)

  test("returns a stable digest across two calls when nothing changed", async () => {
    const repo = await makeRepo(tempRoot)
    const first = await computeWorkspaceDigest(repo)
    const second = await computeWorkspaceDigest(repo)
    expect(first).not.toBeNull()
    expect(first).toMatch(/^[0-9a-f]{64}$/u)
    expect(second).toBe(first as string)
  }, 30_000)

  test("changes after an uncommitted edit to a tracked file", async () => {
    const repo = await makeRepo(tempRoot)
    const before = await computeWorkspaceDigest(repo)
    await writeFile(path.join(repo, "README.md"), "hello, edited\n", "utf8")
    const after = await computeWorkspaceDigest(repo)
    expect(after).not.toBeNull()
    expect(after).not.toBe(before)
  }, 30_000)

  test("changes after a new untracked file appears", async () => {
    const repo = await makeRepo(tempRoot)
    const before = await computeWorkspaceDigest(repo)
    await writeFile(path.join(repo, "scratch.txt"), "untracked\n", "utf8")
    const after = await computeWorkspaceDigest(repo)
    expect(after).not.toBeNull()
    expect(after).not.toBe(before)
  }, 30_000)

  test("changes when an already-modified file is edited again", async () => {
    const repo = await makeRepo(tempRoot)
    await writeFile(path.join(repo, "README.md"), "edit one\n", "utf8")
    const before = await computeWorkspaceDigest(repo)
    await writeFile(path.join(repo, "README.md"), "edit two — longer than the first\n", "utf8")
    const after = await computeWorkspaceDigest(repo)
    expect(after).not.toBe(before)
  }, 30_000)

  test("changes after a commit moves HEAD", async () => {
    const repo = await makeRepo(tempRoot)
    await writeFile(path.join(repo, "README.md"), "committed change\n", "utf8")
    await git(["add", "-A"], repo)
    await git(["commit", "-q", "-m", "second"], repo)
    const afterCommit = await computeWorkspaceDigest(repo)

    await writeFile(path.join(repo, "README.md"), "hello\n", "utf8")
    await git(["add", "-A"], repo)
    await git(["commit", "-q", "-m", "third"], repo)
    const afterThird = await computeWorkspaceDigest(repo)

    expect(afterCommit).not.toBeNull()
    expect(afterThird).not.toBe(afterCommit)
  }, 30_000)
})
