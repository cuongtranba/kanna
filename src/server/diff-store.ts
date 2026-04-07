import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import type { ChatDiffFile, ChatDiffSnapshot, DiffCommitMode, DiffCommitResult } from "../shared/types"
import { generateCommitMessageDetailed } from "./generate-commit-message"
import { inferProjectFileContentType } from "./uploads"

interface StoredChatDiffState {
  status: ChatDiffSnapshot["status"]
  branchName?: string
  hasUpstream?: boolean
  files: ChatDiffFile[]
}

function createEmptyState(): StoredChatDiffState {
  return {
    status: "unknown",
    branchName: undefined,
    hasUpstream: undefined,
    files: [],
  }
}

function snapshotsEqual(left: StoredChatDiffState | undefined, right: StoredChatDiffState) {
  if (!left) {
    return right.status === "unknown" && right.files.length === 0
  }
  if (left.status !== right.status) return false
  if (left.branchName !== right.branchName) return false
  if (left.hasUpstream !== right.hasUpstream) return false
  if (left.files.length !== right.files.length) return false
  return left.files.every((file, index) => {
    const other = right.files[index]
    return Boolean(other)
      && file.path === other.path
      && file.changeType === other.changeType
      && file.patch === other.patch
  })
}

interface DirtyPathEntry {
  path: string
  previousPath?: string
  changeType: ChatDiffFile["changeType"]
  isUntracked: boolean
}

async function fileExists(filePath: string) {
  try {
    await stat(filePath)
    return true
  } catch {
    return false
  }
}

async function runGit(args: string[], cwd: string) {
  const process = Bun.spawn(["git", "-C", cwd, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ])

  return {
    stdout,
    stderr,
    exitCode,
  }
}

function formatGitFailure(result: Awaited<ReturnType<typeof runGit>>) {
  return [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join("\n")
}

function summarizeGitFailure(detail: string, fallback: string) {
  return detail
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.length > 0)
    ?? fallback
}

function createCommitFailure(mode: DiffCommitMode, detail: string): DiffCommitResult {
  const message = summarizeGitFailure(detail, "Git could not create the commit.")
  return {
    ok: false,
    mode,
    phase: "commit",
    title: "Commit failed",
    message,
    detail,
  }
}

function createPushFailure(mode: DiffCommitMode, detail: string, snapshotChanged: boolean): DiffCommitResult {
  const normalized = detail.toLowerCase()
  let title = "Push failed"
  let message = summarizeGitFailure(detail, "Git could not push the commit.")

  if (normalized.includes("non-fast-forward") || normalized.includes("fetch first")) {
    title = "Branch is not up to date"
    message = "Your branch is behind its remote. Pull or rebase, then try pushing again."
  } else if (normalized.includes("has no upstream branch") || normalized.includes("set-upstream")) {
    title = "No upstream branch configured"
    message = "This branch does not have an upstream remote branch configured yet."
  } else if (normalized.includes("merge conflict") || normalized.includes("resolve conflicts")) {
    title = "Merge conflicts need resolution"
    message = "Git reported conflicts while preparing the push. Resolve them, then try again."
  } else if (normalized.includes("permission denied") || normalized.includes("authentication failed") || normalized.includes("could not read from remote repository")) {
    title = "Remote authentication failed"
    message = "Git could not authenticate with the remote repository."
  }

  return {
    ok: false,
    mode,
    phase: "push",
    title,
    message,
    detail,
    localCommitCreated: true,
    snapshotChanged,
  }
}

async function resolveRepo(projectPath: string): Promise<{ repoRoot: string; baseCommit: string | null } | null> {
  const topLevel = await runGit(["rev-parse", "--show-toplevel"], projectPath)
  if (topLevel.exitCode !== 0) {
    return null
  }

  const repoRoot = topLevel.stdout.trim()
  const head = await runGit(["rev-parse", "--verify", "HEAD"], repoRoot)
  return {
    repoRoot,
    baseCommit: head.exitCode === 0 ? head.stdout.trim() : null,
  }
}

async function getBranchName(repoRoot: string) {
  const symbolicRef = await runGit(["symbolic-ref", "--quiet", "--short", "HEAD"], repoRoot)
  if (symbolicRef.exitCode === 0) {
    return symbolicRef.stdout.trim()
  }

  const revParse = await runGit(["rev-parse", "--abbrev-ref", "HEAD"], repoRoot)
  if (revParse.exitCode === 0) {
    return revParse.stdout.trim()
  }

  return undefined
}

async function hasUpstreamBranch(repoRoot: string) {
  const upstream = await runGit(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], repoRoot)
  return upstream.exitCode === 0 && upstream.stdout.trim().length > 0
}

function parseStatusPaths(output: string): DirtyPathEntry[] {
  const entries: DirtyPathEntry[] = []
  for (const rawLine of output.split(/\r?\n/u)) {
    const line = rawLine.trimEnd()
    if (line.length < 4) continue
    const statusCode = line.slice(0, 2)
    const value = line.slice(3)
    if (!value) continue
    const isUntracked = statusCode === "??"
    const isRename = statusCode.includes("R")
    const isDelete = statusCode.includes("D")
    const isAdd = statusCode.includes("A") || isUntracked
    const changeType: ChatDiffFile["changeType"] = isRename
      ? "renamed"
      : isDelete
        ? "deleted"
        : isAdd
          ? "added"
          : "modified"

    if (isRename && value.includes(" -> ")) {
      const [previousPath, nextPath] = value.split(" -> ")
      if (nextPath) {
        entries.push({
          path: nextPath,
          previousPath: previousPath || undefined,
          changeType,
          isUntracked,
        })
      }
      continue
    }

    entries.push({
      path: value,
      changeType,
      isUntracked,
    })
  }
  return entries.sort((left, right) => left.path.localeCompare(right.path))
}

async function listDirtyPaths(repoRoot: string) {
  const status = await runGit(["status", "--short", "--untracked-files=all"], repoRoot)
  if (status.exitCode !== 0) {
    throw new Error(status.stderr.trim() || "Failed to read git status")
  }

  const paths = parseStatusPaths(status.stdout)
  return paths
}

async function readWorktreeFile(repoRoot: string, relativePath: string): Promise<string | null> {
  const absolutePath = path.join(repoRoot, relativePath)
  if (!(await fileExists(absolutePath))) {
    return null
  }

  return await readFile(absolutePath, "utf8")
}

async function readBaseFile(repoRoot: string, baseCommit: string | null, relativePath: string): Promise<string | null> {
  if (!baseCommit) {
    return null
  }

  const result = await runGit(["show", `${baseCommit}:${relativePath}`], repoRoot)
  if (result.exitCode !== 0) {
    return null
  }
  return result.stdout
}

async function createPatch(beforePathLabel: string, afterPathLabel: string, beforeText: string | null, afterText: string | null) {
  const tempDir = await mkdtemp(path.join(tmpdir(), "kanna-diff-"))
  const beforePath = path.join(tempDir, "before")
  const afterPath = path.join(tempDir, "after")

  try {
    await writeFile(beforePath, beforeText ?? "", "utf8")
    await writeFile(afterPath, afterText ?? "", "utf8")

    const result = await runGit(
      [
        "diff",
        "--no-index",
        "--no-ext-diff",
        "--text",
        "--unified=3",
        "--src-prefix=a/",
        "--dst-prefix=b/",
        "before",
        "after",
      ],
      tempDir
    )

    if (result.exitCode !== 0 && result.exitCode !== 1) {
      throw new Error(result.stderr.trim() || `Failed to build patch for ${afterPathLabel}`)
    }

    return result.stdout
      .replace("diff --git a/before b/after", `diff --git a/${beforePathLabel} b/${afterPathLabel}`)
      .replace("--- a/before", `--- a/${beforePathLabel}`)
      .replace("+++ b/after", `+++ b/${afterPathLabel}`)
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

async function computeCurrentFiles(repoRoot: string, baseCommit: string | null): Promise<ChatDiffFile[]> {
  const currentDirtyPaths = await listDirtyPaths(repoRoot)
  const files: ChatDiffFile[] = []

  for (const entry of currentDirtyPaths) {
    const relativePath = entry.path
    const beforePath = entry.previousPath ?? relativePath
    const beforeText = await readBaseFile(repoRoot, baseCommit, beforePath)
    const afterText = await readWorktreeFile(repoRoot, relativePath)
    const absolutePath = path.join(repoRoot, relativePath)
    const fileInfo = await stat(absolutePath).catch(() => null)
    const file = fileInfo?.isFile() ? Bun.file(absolutePath) : null
    const mimeType = file ? inferProjectFileContentType(relativePath, file.type) : undefined
    const size = fileInfo?.isFile() ? fileInfo.size : undefined

    if (beforeText === afterText && entry.changeType !== "renamed") {
      continue
    }

    const patch = await createPatch(beforePath, relativePath, beforeText, afterText)
    files.push({
      path: relativePath,
      changeType: entry.changeType,
      isUntracked: entry.isUntracked,
      patch,
      mimeType,
      size,
    })
  }

  return files
}

function normalizeRepoRelativePath(inputPath: string) {
  const normalized = path.posix.normalize(inputPath.replaceAll("\\", "/")).replace(/^\.\/+/u, "")
  if (!normalized || normalized === "." || normalized.startsWith("../") || normalized.includes("/../") || path.posix.isAbsolute(normalized)) {
    throw new Error(`Invalid diff path: ${inputPath}`)
  }
  return normalized
}

async function findDirtyPath(repoRoot: string, relativePath: string) {
  const dirtyPaths = await listDirtyPaths(repoRoot)
  return dirtyPaths.find((entry) => entry.path === relativePath)
}

async function discardAddedPath(repoRoot: string, repoHasHead: boolean, relativePath: string) {
  if (repoHasHead) {
    const resetResult = await runGit(["reset", "--quiet", "HEAD", "--", relativePath], repoRoot)
    if (resetResult.exitCode !== 0) {
      throw new Error(formatGitFailure(resetResult) || "Failed to unstage added file")
    }
  } else {
    const rmCachedResult = await runGit(["rm", "--cached", "--force", "--", relativePath], repoRoot)
    if (rmCachedResult.exitCode !== 0) {
      throw new Error(formatGitFailure(rmCachedResult) || "Failed to unstage added file")
    }
  }
}

async function discardRenamedPath(repoRoot: string, entry: DirtyPathEntry) {
  if (!entry.previousPath) {
    throw new Error(`Missing previous path for renamed file: ${entry.path}`)
  }

  const resetResult = await runGit(["reset", "--quiet", "HEAD", "--", entry.path], repoRoot)
  if (resetResult.exitCode !== 0) {
    throw new Error(formatGitFailure(resetResult) || "Failed to unstage renamed file")
  }

  const restoreResult = await runGit(["restore", "--staged", "--worktree", "--source=HEAD", "--", entry.previousPath], repoRoot)
  if (restoreResult.exitCode !== 0) {
    throw new Error(formatGitFailure(restoreResult) || "Failed to restore renamed file")
  }

  await rm(path.join(repoRoot, entry.path), { recursive: true, force: true })
}

export function appendGitIgnoreEntry(currentContents: string | null, entry: string) {
  const normalizedContents = currentContents ?? ""
  const existingEntries = normalizedContents
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)

  if (existingEntries.includes(entry)) {
    return normalizedContents.length > 0 && !normalizedContents.endsWith("\n")
      ? `${normalizedContents}\n`
      : normalizedContents
  }

  const prefix = normalizedContents.length === 0
    ? ""
    : normalizedContents.endsWith("\n")
      ? normalizedContents
      : `${normalizedContents}\n`
  return `${prefix}${entry}\n`
}

export class DiffStore {
  private readonly states = new Map<string, StoredChatDiffState>()

  constructor(_: string) {}

  async initialize() {}

  getSnapshot(chatId: string): ChatDiffSnapshot {
    const state = this.states.get(chatId) ?? createEmptyState()
    return {
      status: state.status,
      branchName: state.branchName,
      hasUpstream: state.hasUpstream,
      files: [...state.files],
    }
  }

  async refreshSnapshot(chatId: string, projectPath: string) {
    const repo = await resolveRepo(projectPath)
    if (!repo) {
      const nextState = {
        status: "no_repo",
        branchName: undefined,
        hasUpstream: undefined,
        files: [],
      } satisfies StoredChatDiffState
      const changed = !snapshotsEqual(this.states.get(chatId), nextState)
      this.states.set(chatId, nextState)
      return changed
    }

    const files = await computeCurrentFiles(repo.repoRoot, repo.baseCommit)
    const branchName = await getBranchName(repo.repoRoot)
    const hasUpstream = await hasUpstreamBranch(repo.repoRoot)
    const nextState = {
      status: "ready",
      branchName,
      hasUpstream,
      files,
    } satisfies StoredChatDiffState
    const changed = !snapshotsEqual(this.states.get(chatId), nextState)
    this.states.set(chatId, nextState)
    return changed
  }

  async generateCommitMessage(args: {
    projectPath: string
    paths: string[]
  }) {
    const normalizedPaths = [...new Set(args.paths.map(normalizeRepoRelativePath))]
    if (normalizedPaths.length === 0) {
      throw new Error("Select at least one file")
    }

    const repo = await resolveRepo(args.projectPath)
    if (!repo) {
      throw new Error("Project is not in a git repository")
    }

    const files = await computeCurrentFiles(repo.repoRoot, repo.baseCommit)
    const selectedFiles = normalizedPaths.map((selectedPath) => {
      const file = files.find((candidate) => candidate.path === selectedPath)
      if (!file) {
        throw new Error(`File is no longer changed: ${selectedPath}`)
      }
      return file
    })

    const branchName = await getBranchName(repo.repoRoot)
    return await generateCommitMessageDetailed({
      cwd: repo.repoRoot,
      branchName,
      files: selectedFiles,
    })
  }

  async commitFiles(args: {
    chatId: string
    projectPath: string
    paths: string[]
    summary: string
    description?: string
    mode: DiffCommitMode
  }) {
    const summary = args.summary.trim()
    const description = args.description?.trim()
    if (!summary) {
      throw new Error("Commit summary is required")
    }

    const normalizedPaths = [...new Set(args.paths.map(normalizeRepoRelativePath))]
    if (normalizedPaths.length === 0) {
      throw new Error("Select at least one file to commit")
    }

    const repo = await resolveRepo(args.projectPath)
    if (!repo) {
      throw new Error("Project is not in a git repository")
    }

    const currentDirtyPaths = new Set((await listDirtyPaths(repo.repoRoot)).map((entry) => entry.path))
    const missingPaths = normalizedPaths.filter((relativePath) => !currentDirtyPaths.has(relativePath))
    if (missingPaths.length > 0) {
      throw new Error(`File is no longer changed: ${missingPaths[0]}`)
    }

    const addResult = await runGit(["add", "--", ...normalizedPaths], repo.repoRoot)
    if (addResult.exitCode !== 0) {
      throw new Error(addResult.stderr.trim() || "Failed to stage selected files")
    }

    const commitArgs = ["commit", "--only", "-m", summary]
    if (description) {
      commitArgs.push("-m", description)
    }
    commitArgs.push("--", ...normalizedPaths)

    const commitResult = await runGit(commitArgs, repo.repoRoot)
    if (commitResult.exitCode !== 0) {
      return createCommitFailure(args.mode, formatGitFailure(commitResult))
    }

    const snapshotChanged = await this.refreshSnapshot(args.chatId, args.projectPath)
    const branchName = await getBranchName(repo.repoRoot)

    if (args.mode === "commit_only") {
      return {
        ok: true,
        mode: args.mode,
        branchName,
        pushed: false,
        snapshotChanged,
      } satisfies DiffCommitResult
    }

    const pushResult = await runGit(["push"], repo.repoRoot)
    if (pushResult.exitCode !== 0) {
      return createPushFailure(args.mode, formatGitFailure(pushResult), snapshotChanged)
    }

    return {
      ok: true,
      mode: args.mode,
      branchName,
      pushed: true,
      snapshotChanged,
    } satisfies DiffCommitResult
  }

  async discardFile(args: {
    chatId: string
    projectPath: string
    path: string
  }) {
    const relativePath = normalizeRepoRelativePath(args.path)
    const repo = await resolveRepo(args.projectPath)
    if (!repo) {
      throw new Error("Project is not in a git repository")
    }

    const entry = await findDirtyPath(repo.repoRoot, relativePath)
    if (!entry) {
      throw new Error(`File is no longer changed: ${relativePath}`)
    }

    if (entry.isUntracked) {
      await rm(path.join(repo.repoRoot, entry.path), { recursive: true, force: true })
    } else if (entry.changeType === "added") {
      await discardAddedPath(repo.repoRoot, repo.baseCommit !== null, entry.path)
      await rm(path.join(repo.repoRoot, entry.path), { recursive: true, force: true })
    } else if (entry.changeType === "renamed") {
      if (!repo.baseCommit) {
        throw new Error("Cannot discard a rename before the repository has an initial commit")
      }
      await discardRenamedPath(repo.repoRoot, entry)
    } else {
      if (!repo.baseCommit) {
        throw new Error("Cannot discard tracked changes before the repository has an initial commit")
      }
      const restoreResult = await runGit(["restore", "--staged", "--worktree", "--source=HEAD", "--", entry.path], repo.repoRoot)
      if (restoreResult.exitCode !== 0) {
        throw new Error(formatGitFailure(restoreResult) || "Failed to discard file changes")
      }
    }

    return {
      snapshotChanged: await this.refreshSnapshot(args.chatId, args.projectPath),
    }
  }

  async ignoreFile(args: {
    chatId: string
    projectPath: string
    path: string
  }) {
    const relativePath = normalizeRepoRelativePath(args.path)
    const repo = await resolveRepo(args.projectPath)
    if (!repo) {
      throw new Error("Project is not in a git repository")
    }

    const entry = await findDirtyPath(repo.repoRoot, relativePath)
    if (!entry) {
      throw new Error(`File is no longer changed: ${relativePath}`)
    }
    if (!entry.isUntracked) {
      throw new Error("Only untracked files can be ignored from the diff viewer")
    }

    const gitignorePath = path.join(repo.repoRoot, ".gitignore")
    const currentContents = await readFile(gitignorePath, "utf8").catch(() => null)
    const nextContents = appendGitIgnoreEntry(currentContents, relativePath)
    if (nextContents !== currentContents) {
      await writeFile(gitignorePath, nextContents, "utf8")
    }

    return {
      snapshotChanged: await this.refreshSnapshot(args.chatId, args.projectPath),
    }
  }
}
