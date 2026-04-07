import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import type {
  ChatBranchHistoryEntry,
  ChatBranchHistorySnapshot,
  ChatBranchListEntry,
  ChatBranchListResult,
  ChatCheckoutBranchResult,
  ChatCreateBranchResult,
  ChatDiffFile,
  ChatDiffSnapshot,
  ChatSyncResult,
  DiffCommitMode,
  DiffCommitResult,
} from "../shared/types"
import { generateCommitMessageDetailed } from "./generate-commit-message"
import { inferProjectFileContentType } from "./uploads"

interface StoredChatDiffState {
  status: ChatDiffSnapshot["status"]
  branchName?: string
  defaultBranchName?: string
  originRepoSlug?: string
  hasUpstream?: boolean
  aheadCount?: number
  behindCount?: number
  lastFetchedAt?: string
  files: ChatDiffFile[]
  branchHistory: ChatBranchHistorySnapshot
}

function createEmptyState(): StoredChatDiffState {
  return {
    status: "unknown",
    branchName: undefined,
    defaultBranchName: undefined,
    originRepoSlug: undefined,
    hasUpstream: undefined,
    aheadCount: undefined,
    behindCount: undefined,
    lastFetchedAt: undefined,
    files: [],
    branchHistory: { entries: [] },
  }
}

function snapshotsEqual(left: StoredChatDiffState | undefined, right: StoredChatDiffState) {
  if (!left) {
    return right.status === "unknown" && right.files.length === 0
  }
  if (left.status !== right.status) return false
  if (left.branchName !== right.branchName) return false
  if (left.defaultBranchName !== right.defaultBranchName) return false
  if (left.originRepoSlug !== right.originRepoSlug) return false
  if (left.hasUpstream !== right.hasUpstream) return false
  if (left.aheadCount !== right.aheadCount) return false
  if (left.behindCount !== right.behindCount) return false
  if (left.lastFetchedAt !== right.lastFetchedAt) return false
  if (left.files.length !== right.files.length) return false
  if (left.branchHistory.entries.length !== right.branchHistory.entries.length) return false
  const sameHistory = left.branchHistory.entries.every((entry, index) => {
    const other = right.branchHistory.entries[index]
    return Boolean(other)
      && entry.sha === other.sha
      && entry.summary === other.summary
      && entry.description === other.description
      && entry.authorName === other.authorName
      && entry.authoredAt === other.authoredAt
      && entry.githubUrl === other.githubUrl
      && entry.tags.length === other.tags.length
      && entry.tags.every((tag, tagIndex) => tag === other.tags[tagIndex])
  })
  if (!sameHistory) return false
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

async function runCommand(args: string[]) {
  const process = Bun.spawn(args, {
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

async function getLastFetchedAt(repoRoot: string) {
  const gitDirResult = await runGit(["rev-parse", "--git-dir"], repoRoot)
  if (gitDirResult.exitCode !== 0) {
    return undefined
  }

  const gitDir = gitDirResult.stdout.trim()
  const fetchHeadPath = path.resolve(repoRoot, gitDir, "FETCH_HEAD")
  try {
    const fetchHeadStat = await stat(fetchHeadPath)
    return fetchHeadStat.mtime.toISOString()
  } catch {
    return undefined
  }
}

async function getUpstreamStatusCounts(repoRoot: string) {
  const result = await runGit(["rev-list", "--left-right", "--count", "HEAD...@{upstream}"], repoRoot)
  if (result.exitCode !== 0) {
    return { aheadCount: undefined, behindCount: undefined }
  }

  const [aheadRaw, behindRaw] = result.stdout.trim().split(/\s+/u)
  const aheadCount = Number.parseInt(aheadRaw ?? "", 10)
  const behindCount = Number.parseInt(behindRaw ?? "", 10)
  return {
    aheadCount: Number.isFinite(aheadCount) ? aheadCount : undefined,
    behindCount: Number.isFinite(behindCount) ? behindCount : undefined,
  }
}

async function getOriginRemoteUrl(repoRoot: string) {
  const result = await runGit(["remote", "get-url", "origin"], repoRoot)
  if (result.exitCode !== 0) {
    return null
  }
  const remoteUrl = result.stdout.trim()
  return remoteUrl.length > 0 ? remoteUrl : null
}

async function getGitHubRemoteSlugs(repoRoot: string) {
  const remotesResult = await runGit(["remote"], repoRoot)
  if (remotesResult.exitCode !== 0) {
    return new Map<string, string>()
  }

  const remoteNames = remotesResult.stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)

  const remoteSlugEntries = await Promise.all(remoteNames.map(async (remoteName) => {
    const remoteUrlResult = await runGit(["remote", "get-url", remoteName], repoRoot)
    if (remoteUrlResult.exitCode !== 0) {
      return null
    }
    const repoSlug = extractGitHubRepoSlug(remoteUrlResult.stdout.trim())
    return repoSlug ? [remoteName, repoSlug.toLowerCase()] as const : null
  }))

  return new Map(remoteSlugEntries.filter((entry): entry is readonly [string, string] => Boolean(entry)))
}

async function getLocalBranchNames(repoRoot: string) {
  const result = await runGit(["for-each-ref", "--format=%(refname:short)", "refs/heads"], repoRoot)
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || "Failed to list local branches")
  }
  return result.stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right))
}

async function getRemoteBranchNames(repoRoot: string) {
  const result = await runGit(["for-each-ref", "--format=%(refname:short)", "refs/remotes"], repoRoot)
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || "Failed to list remote branches")
  }
  return result.stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.endsWith("/HEAD"))
    .sort((left, right) => left.localeCompare(right))
}

async function getBranchUpdatedAtMap(repoRoot: string, refPrefix: "refs/heads" | "refs/remotes") {
  const result = await runGit(
    ["for-each-ref", "--format=%(refname:short)\t%(committerdate:iso-strict)", refPrefix],
    repoRoot
  )
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || "Failed to read branch update times")
  }

  const entries = new Map<string, string>()
  for (const line of result.stdout.split(/\r?\n/u)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const [name, updatedAt] = trimmed.split("\t")
    if (!name || !updatedAt || (refPrefix === "refs/remotes" && name.endsWith("/HEAD"))) {
      continue
    }
    entries.set(name, updatedAt)
  }
  return entries
}

async function resolveDefaultBranchName(repoRoot: string) {
  const originHead = await runGit(["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"], repoRoot)
  if (originHead.exitCode === 0) {
    const ref = originHead.stdout.trim()
    if (ref.startsWith("origin/")) {
      return ref.slice("origin/".length)
    }
  }

  const localBranches = await getLocalBranchNames(repoRoot)
  if (localBranches.includes("main")) return "main"
  if (localBranches.includes("master")) return "master"
  return (await getBranchName(repoRoot)) ?? localBranches[0] ?? undefined
}

async function getRecentBranchNames(repoRoot: string) {
  const result = await runGit(["reflog", "--format=%gs", "--max-count=100", "HEAD"], repoRoot)
  if (result.exitCode !== 0) {
    return []
  }

  const recent: string[] = []
  const seen = new Set<string>()
  for (const line of result.stdout.split(/\r?\n/u)) {
    const match = /checkout: moving from .* to (?<branch>.+)$/u.exec(line.trim())
    const branch = match?.groups?.branch?.trim()
    if (!branch || branch === "HEAD" || branch.startsWith("refs/")) {
      continue
    }
    if (seen.has(branch)) continue
    seen.add(branch)
    recent.push(branch)
  }
  return recent
}

export function extractGitHubRepoSlug(remoteUrl: string | null | undefined) {
  if (!remoteUrl) return null

  const sshMatch = /^git@github\.com:(?<owner>[^/]+)\/(?<repo>[^/]+?)(?:\.git)?$/u.exec(remoteUrl)
  if (sshMatch?.groups?.owner && sshMatch.groups.repo) {
    return `${sshMatch.groups.owner}/${sshMatch.groups.repo}`
  }

  const sshProtocolMatch = /^ssh:\/\/git@github\.com\/(?<owner>[^/]+)\/(?<repo>[^/]+?)(?:\.git)?$/u.exec(remoteUrl)
  if (sshProtocolMatch?.groups?.owner && sshProtocolMatch.groups.repo) {
    return `${sshProtocolMatch.groups.owner}/${sshProtocolMatch.groups.repo}`
  }

  const httpsMatch = /^https?:\/\/github\.com\/(?<owner>[^/]+)\/(?<repo>[^/]+?)(?:\.git)?$/u.exec(remoteUrl)
  if (httpsMatch?.groups?.owner && httpsMatch.groups.repo) {
    return `${httpsMatch.groups.owner}/${httpsMatch.groups.repo}`
  }

  return null
}

interface GitHubPullRequestResponseItem {
  number: number
  title: string
  head?: {
    ref?: string
    label?: string
    repo?: {
      clone_url?: string
      full_name?: string
    } | null
  }
  base?: {
    ref?: string
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

type GitHubCliApiLike = (path: string) => Promise<GitHubPullRequestResponseItem[] | null>

interface FetchGitHubPullRequestsDeps {
  fetchImpl?: FetchLike
  ghApiImpl?: GitHubCliApiLike
}

async function fetchGitHubPullRequestsViaGh(path: string): Promise<GitHubPullRequestResponseItem[] | null> {
  const result = await runCommand([
    "gh",
    "api",
    "-H",
    "Accept: application/vnd.github+json",
    path,
  ])
  if (result.exitCode !== 0) {
    return null
  }

  const json = JSON.parse(result.stdout)
  return Array.isArray(json) ? json as GitHubPullRequestResponseItem[] : []
}

export async function fetchGitHubPullRequests(
  repoSlug: string,
  deps: FetchLike | FetchGitHubPullRequestsDeps = fetch
): Promise<GitHubPullRequestResponseItem[]> {
  const fetchImpl = typeof deps === "function" ? deps : (deps.fetchImpl ?? fetch)
  const ghApiImpl = typeof deps === "function" ? fetchGitHubPullRequestsViaGh : (deps.ghApiImpl ?? fetchGitHubPullRequestsViaGh)
  const ghPath = `repos/${repoSlug}/pulls?state=open&per_page=50`

  try {
    const ghPulls = await ghApiImpl(ghPath)
    if (ghPulls) {
      return ghPulls
    }
  } catch {
    // Fall back to an unauthenticated HTTP request when `gh` is unavailable.
  }

  const response = await fetchImpl(`https://api.github.com/repos/${repoSlug}/pulls?state=open&per_page=50`, {
    headers: {
      Accept: "application/vnd.github+json",
    },
  })

  if (!response.ok) {
    throw new Error(`GitHub pull requests request failed with status ${response.status}`)
  }

  const json = await response.json()
  return Array.isArray(json) ? json as GitHubPullRequestResponseItem[] : []
}

function buildGitHubCommitUrl(remoteUrl: string | null, sha: string) {
  const slug = extractGitHubRepoSlug(remoteUrl)
  return slug ? `https://github.com/${slug}/commit/${sha}` : undefined
}

async function listCommitTags(repoRoot: string, sha: string) {
  const result = await runGit(["tag", "--points-at", sha], repoRoot)
  if (result.exitCode !== 0) {
    return []
  }
  return result.stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right))
}

async function getBranchHistory(args: {
  repoRoot: string
  ref: string
  limit: number
}): Promise<ChatBranchHistorySnapshot> {
  const logResult = await runGit(
    [
      "log",
      "--max-count",
      String(args.limit),
      "--pretty=format:%H%x1f%s%x1f%b%x1f%an%x1f%aI%x1e",
      args.ref,
    ],
    args.repoRoot
  )

  if (logResult.exitCode !== 0) {
    throw new Error(logResult.stderr.trim() || "Failed to read git log")
  }

  const remoteUrl = await getOriginRemoteUrl(args.repoRoot)
  const entries: ChatBranchHistoryEntry[] = []

  for (const record of logResult.stdout.split("\u001e")) {
    const trimmed = record.trim()
    if (!trimmed) continue
    const [sha, summary, description, authorName, authoredAt] = trimmed.split("\u001f")
    if (!sha || !summary || !authoredAt) continue
    entries.push({
      sha,
      summary,
      description: (description ?? "").trim(),
      authorName: authorName?.trim() || undefined,
      authoredAt,
      tags: await listCommitTags(args.repoRoot, sha),
      githubUrl: buildGitHubCommitUrl(remoteUrl, sha),
    })
  }

  return { entries }
}

function createBranchActionFailure(title: string, detail: string, fallback: string) {
  return {
    ok: false,
    title,
    message: summarizeGitFailure(detail, fallback),
    detail,
  } as const
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
      defaultBranchName: state.defaultBranchName,
      originRepoSlug: state.originRepoSlug,
      hasUpstream: state.hasUpstream,
      aheadCount: state.aheadCount,
      behindCount: state.behindCount,
      lastFetchedAt: state.lastFetchedAt,
      files: [...state.files],
      branchHistory: {
        entries: state.branchHistory.entries.map((entry) => ({
          ...entry,
          tags: [...entry.tags],
        })),
      },
    }
  }

  async refreshSnapshot(chatId: string, projectPath: string) {
    const repo = await resolveRepo(projectPath)
    if (!repo) {
      const nextState = {
        status: "no_repo",
        branchName: undefined,
        defaultBranchName: undefined,
        originRepoSlug: undefined,
        hasUpstream: undefined,
        aheadCount: undefined,
        behindCount: undefined,
        lastFetchedAt: undefined,
        files: [],
        branchHistory: { entries: [] },
      } satisfies StoredChatDiffState
      const changed = !snapshotsEqual(this.states.get(chatId), nextState)
      this.states.set(chatId, nextState)
      return changed
    }

    const files = await computeCurrentFiles(repo.repoRoot, repo.baseCommit)
    const branchName = await getBranchName(repo.repoRoot)
    const defaultBranchName = await resolveDefaultBranchName(repo.repoRoot)
    const originRemoteUrl = await getOriginRemoteUrl(repo.repoRoot)
    const originRepoSlug = extractGitHubRepoSlug(originRemoteUrl) ?? undefined
    const hasUpstream = await hasUpstreamBranch(repo.repoRoot)
    const { aheadCount, behindCount } = hasUpstream
      ? await getUpstreamStatusCounts(repo.repoRoot)
      : { aheadCount: undefined, behindCount: undefined }
    const lastFetchedAt = await getLastFetchedAt(repo.repoRoot)
    const branchHistory = repo.baseCommit
      ? await getBranchHistory({
          repoRoot: repo.repoRoot,
          ref: branchName ?? "HEAD",
          limit: 20,
        })
      : { entries: [] }
    const nextState = {
      status: "ready",
      branchName,
      defaultBranchName,
      originRepoSlug,
      hasUpstream,
      aheadCount,
      behindCount,
      lastFetchedAt,
      files,
      branchHistory,
    } satisfies StoredChatDiffState
    const changed = !snapshotsEqual(this.states.get(chatId), nextState)
    this.states.set(chatId, nextState)
    return changed
  }

  async listBranches(args: {
    projectPath: string
  }): Promise<ChatBranchListResult> {
    const repo = await resolveRepo(args.projectPath)
    if (!repo) {
      throw new Error("Project is not in a git repository")
    }

    const [currentBranchName, defaultBranchName, localBranchNames, remoteBranchNames, recentBranchNames, localUpdatedAtMap, remoteUpdatedAtMap] = await Promise.all([
      getBranchName(repo.repoRoot),
      resolveDefaultBranchName(repo.repoRoot),
      getLocalBranchNames(repo.repoRoot),
      getRemoteBranchNames(repo.repoRoot),
      getRecentBranchNames(repo.repoRoot),
      getBranchUpdatedAtMap(repo.repoRoot, "refs/heads"),
      getBranchUpdatedAtMap(repo.repoRoot, "refs/remotes"),
    ])

    const local = localBranchNames.map((name) => ({
      id: `local:${name}`,
      kind: "local",
      name,
      displayName: name,
      updatedAt: localUpdatedAtMap.get(name),
    } satisfies ChatBranchListEntry))

    const remote = remoteBranchNames.map((remoteRef) => ({
      id: `remote:${remoteRef}`,
      kind: "remote",
      name: remoteRef.replace(/^[^/]+\//u, ""),
      displayName: remoteRef,
      updatedAt: remoteUpdatedAtMap.get(remoteRef),
      remoteRef,
    } satisfies ChatBranchListEntry))

    const localBranchSet = new Set(localBranchNames)
    const remoteByName = new Map(remote.map((entry) => [entry.name, entry]))
    const remoteEntriesByName = new Map<string, ChatBranchListEntry[]>()
    for (const entry of remote) {
      const entries = remoteEntriesByName.get(entry.name) ?? []
      entries.push(entry)
      remoteEntriesByName.set(entry.name, entries)
    }
    const recent: ChatBranchListEntry[] = recentBranchNames.flatMap<ChatBranchListEntry>((branchName) => {
      if (localBranchSet.has(branchName)) {
        return {
          id: `recent:local:${branchName}`,
          kind: "local",
          name: branchName,
          displayName: branchName,
          updatedAt: localUpdatedAtMap.get(branchName),
        } satisfies ChatBranchListEntry
      }
      const remoteEntry = remoteByName.get(branchName)
      return remoteEntry
        ? {
            ...remoteEntry,
            id: `recent:${remoteEntry.id}`,
          } satisfies ChatBranchListEntry
        : []
    })

    const [remoteUrl, githubRemoteSlugs] = await Promise.all([
      getOriginRemoteUrl(repo.repoRoot),
      getGitHubRemoteSlugs(repo.repoRoot),
    ])
    const repoSlug = extractGitHubRepoSlug(remoteUrl)
    let pullRequests: ChatBranchListEntry[] = []
    const pullRequestRemoteRefs = new Set<string>()
    const pullRequestHeadNames = new Set<string>()
    let pullRequestsStatus: ChatBranchListResult["pullRequestsStatus"] = "unavailable"
    let pullRequestsError: string | undefined

    if (repoSlug) {
      try {
        const prs = await fetchGitHubPullRequests(repoSlug)
        pullRequests = prs.flatMap<ChatBranchListEntry>((pr) => {
          const headRefName = pr.head?.ref?.trim()
          if (!headRefName) return []
          pullRequestHeadNames.add(headRefName)
          const cloneUrl = pr.head?.repo?.clone_url?.trim() || undefined
          const fullName = pr.head?.repo?.full_name?.trim() || undefined
          const headRepoSlug = fullName?.toLowerCase()
          const matchingRemoteEntries = (remoteEntriesByName.get(headRefName) ?? []).filter((entry) => {
            const remoteName = entry.remoteRef?.split("/")[0]
            if (!remoteName) return false
            const remoteSlug = githubRemoteSlugs.get(remoteName)
            if (!remoteSlug) return false
            if (headRepoSlug) {
              return remoteSlug === headRepoSlug
            }
            return remoteName === "origin"
          })
          for (const entry of matchingRemoteEntries) {
            if (entry.remoteRef) {
              pullRequestRemoteRefs.add(entry.remoteRef)
            }
          }
          const preferredRemoteEntry = matchingRemoteEntries[0] ?? remoteByName.get(headRefName)
          const remoteRef = preferredRemoteEntry?.remoteRef ?? `origin/${headRefName}`
          return {
            id: `pr:${pr.number}`,
            kind: "pull_request",
            name: headRefName,
            displayName: `PR #${pr.number}`,
            updatedAt: (remoteRef ? remoteUpdatedAtMap.get(remoteRef) : undefined) ?? localUpdatedAtMap.get(headRefName),
            description: pr.title,
            remoteRef,
            prNumber: pr.number,
            prTitle: pr.title,
            headRefName,
            headLabel: pr.head?.label?.trim() || fullName,
            headRepoCloneUrl: cloneUrl,
            isCrossRepository: Boolean(fullName && fullName.toLowerCase() !== repoSlug.toLowerCase()),
          } satisfies ChatBranchListEntry
        })
        pullRequestsStatus = "available"
      } catch (error) {
        pullRequestsStatus = "error"
        pullRequestsError = error instanceof Error ? error.message : String(error)
      }
    }

    const visibleRemote = remote.filter((entry) => {
      if (pullRequestHeadNames.has(entry.name)) {
        return false
      }
      return !entry.remoteRef || !pullRequestRemoteRefs.has(entry.remoteRef)
    })
    const visibleRemoteByName = new Map(visibleRemote.map((entry) => [entry.name, entry]))
    const visibleRecent = recent.filter((entry) => entry.kind !== "remote" || !entry.remoteRef || visibleRemoteByName.has(entry.name))

    return {
      currentBranchName,
      defaultBranchName,
      recent: visibleRecent,
      local,
      remote: visibleRemote,
      pullRequests,
      pullRequestsStatus,
      pullRequestsError,
    }
  }

  async checkoutBranch(args: {
    chatId: string
    projectPath: string
    branch:
    | { kind: "local"; name: string }
    | { kind: "remote"; name: string; remoteRef: string }
    | {
        kind: "pull_request"
        name: string
        prNumber: number
        headRefName: string
        headRepoCloneUrl?: string
        isCrossRepository?: boolean
        remoteRef?: string
      }
    bringChanges?: boolean
  }): Promise<ChatCheckoutBranchResult> {
    const repo = await resolveRepo(args.projectPath)
    if (!repo) {
      throw new Error("Project is not in a git repository")
    }

    const currentDirtyPaths = await listDirtyPaths(repo.repoRoot)
    if (currentDirtyPaths.length > 0 && !args.bringChanges) {
      return {
        ok: false,
        cancelled: true,
        title: "Branch switch cancelled",
        message: "Your current changes were kept on the current branch.",
        snapshotChanged: false,
      }
    }

    let switchResult: Awaited<ReturnType<typeof runGit>>
    if (args.branch.kind === "local") {
      switchResult = await runGit(["switch", args.branch.name], repo.repoRoot)
    } else if (args.branch.kind === "remote") {
      const localBranchNames = await getLocalBranchNames(repo.repoRoot)
      if (localBranchNames.includes(args.branch.name)) {
        switchResult = await runGit(["switch", args.branch.name], repo.repoRoot)
      } else {
        switchResult = await runGit(["switch", "--track", "--no-guess", args.branch.remoteRef], repo.repoRoot)
      }
    } else {
      const localBranchNames = await getLocalBranchNames(repo.repoRoot)
      let localBranchName = args.branch.name

      if (localBranchNames.includes(localBranchName) && args.branch.isCrossRepository) {
        localBranchName = `${args.branch.name}-pr-${args.branch.prNumber}`
      }

      if (localBranchNames.includes(localBranchName)) {
        switchResult = await runGit(["switch", localBranchName], repo.repoRoot)
      } else if (args.branch.isCrossRepository && args.branch.headRepoCloneUrl) {
        const fetchResult = await runGit(
          [
            "fetch",
            "--no-tags",
            args.branch.headRepoCloneUrl,
            `refs/heads/${args.branch.headRefName}:refs/heads/${localBranchName}`,
          ],
          repo.repoRoot
        )
        if (fetchResult.exitCode !== 0) {
          return createBranchActionFailure("Checkout failed", formatGitFailure(fetchResult), "Git could not fetch the pull request branch.")
        }
        switchResult = await runGit(["switch", localBranchName], repo.repoRoot)
      } else {
        const remoteRef = args.branch.remoteRef ?? `origin/${args.branch.headRefName}`
        const remoteBranchNames = await getRemoteBranchNames(repo.repoRoot)
        if (!remoteBranchNames.includes(remoteRef)) {
          const fetchResult = await runGit(
            ["fetch", "--no-tags", "origin", `refs/heads/${args.branch.headRefName}:refs/remotes/${remoteRef}`],
            repo.repoRoot
          )
          if (fetchResult.exitCode !== 0) {
            return createBranchActionFailure("Checkout failed", formatGitFailure(fetchResult), "Git could not fetch the pull request branch.")
          }
        }
        switchResult = await runGit(["switch", "--track", "--no-guess", remoteRef], repo.repoRoot)
      }
    }

    if (switchResult.exitCode !== 0) {
      return createBranchActionFailure("Checkout failed", formatGitFailure(switchResult), "Git could not switch branches.")
    }

    const snapshotChanged = await this.refreshSnapshot(args.chatId, args.projectPath)
    return {
      ok: true,
      branchName: await getBranchName(repo.repoRoot),
      snapshotChanged,
    }
  }

  async createBranch(args: {
    chatId: string
    projectPath: string
    name: string
    baseBranchName?: string
  }): Promise<ChatCreateBranchResult> {
    const repo = await resolveRepo(args.projectPath)
    if (!repo) {
      throw new Error("Project is not in a git repository")
    }

    const branchName = args.name.trim()
    if (!branchName) {
      throw new Error("Branch name is required")
    }

    const refValidation = await runGit(["check-ref-format", "--branch", branchName], repo.repoRoot)
    if (refValidation.exitCode !== 0) {
      return createBranchActionFailure("Create branch failed", formatGitFailure(refValidation), "Branch name is not valid.")
    }

    const localBranchNames = await getLocalBranchNames(repo.repoRoot)
    if (localBranchNames.includes(branchName)) {
      return {
        ok: false,
        title: "Create branch failed",
        message: `A local branch named "${branchName}" already exists.`,
        snapshotChanged: false,
      }
    }

    const baseBranchName = args.baseBranchName?.trim() || await resolveDefaultBranchName(repo.repoRoot) || await getBranchName(repo.repoRoot)
    if (!baseBranchName) {
      throw new Error("Could not determine a base branch")
    }

    const switchResult = await runGit(["switch", "-c", branchName, baseBranchName], repo.repoRoot)
    if (switchResult.exitCode !== 0) {
      return createBranchActionFailure("Create branch failed", formatGitFailure(switchResult), "Git could not create the branch.")
    }

    const snapshotChanged = await this.refreshSnapshot(args.chatId, args.projectPath)
    return {
      ok: true,
      branchName,
      snapshotChanged,
    }
  }

  async syncBranch(args: {
    chatId: string
    projectPath: string
    action: "fetch" | "pull" | "publish"
  }): Promise<ChatSyncResult> {
    const repo = await resolveRepo(args.projectPath)
    if (!repo) {
      throw new Error("Project is not in a git repository")
    }

    const hasUpstream = await hasUpstreamBranch(repo.repoRoot)
    if (args.action === "publish") {
      const publishResult = await runGit(["push", "-u", "origin", "HEAD"], repo.repoRoot)
      if (publishResult.exitCode !== 0) {
        const detail = formatGitFailure(publishResult)
        const normalized = detail.toLowerCase()
        let title = "Publish branch failed"
        let message = summarizeGitFailure(detail, "Git could not publish this branch.")

        if (normalized.includes("could not read from remote repository") || normalized.includes("authentication failed") || normalized.includes("permission denied")) {
          title = "Remote authentication failed"
          message = "Git could not authenticate with the remote repository."
        }

        return {
          ok: false,
          action: args.action,
          title,
          message,
          detail,
          snapshotChanged: false,
        }
      }

      const snapshotChanged = await this.refreshSnapshot(args.chatId, args.projectPath)
      const branchName = await getBranchName(repo.repoRoot)
      const nextHasUpstream = await hasUpstreamBranch(repo.repoRoot)
      const { aheadCount, behindCount } = nextHasUpstream
        ? await getUpstreamStatusCounts(repo.repoRoot)
        : { aheadCount: undefined, behindCount: undefined }

      return {
        ok: true,
        action: args.action,
        branchName,
        aheadCount,
        behindCount,
        snapshotChanged,
      }
    }

    if (args.action === "pull" && !hasUpstream) {
      return {
        ok: false,
        action: args.action,
        title: "Pull failed",
        message: "This branch does not have an upstream remote branch configured yet.",
        snapshotChanged: false,
      }
    }

    const syncResult = args.action === "pull"
      ? await runGit(["pull", "--ff-only"], repo.repoRoot)
      : await runGit(["fetch", "--all", "--prune"], repo.repoRoot)

    if (syncResult.exitCode !== 0) {
      const detail = formatGitFailure(syncResult)
      const normalized = detail.toLowerCase()
      let title = args.action === "pull" ? "Pull failed" : "Fetch failed"
      let message = summarizeGitFailure(detail, args.action === "pull" ? "Git could not pull the latest changes." : "Git could not fetch the latest changes.")

      if (args.action === "pull" && normalized.includes("not possible to fast-forward")) {
        title = "Pull requires merge or rebase"
        message = "Your branch cannot be fast-forwarded. Rebase or merge manually, then try again."
      } else if (normalized.includes("could not read from remote repository") || normalized.includes("authentication failed") || normalized.includes("permission denied")) {
        title = "Remote authentication failed"
        message = "Git could not authenticate with the remote repository."
      }

      return {
        ok: false,
        action: args.action,
        title,
        message,
        detail,
        snapshotChanged: false,
      }
    }

    const snapshotChanged = await this.refreshSnapshot(args.chatId, args.projectPath)
    const branchName = await getBranchName(repo.repoRoot)
    const nextHasUpstream = await hasUpstreamBranch(repo.repoRoot)
    const { aheadCount, behindCount } = nextHasUpstream
      ? await getUpstreamStatusCounts(repo.repoRoot)
      : { aheadCount: undefined, behindCount: undefined }

    return {
      ok: true,
      action: args.action,
      branchName,
      aheadCount,
      behindCount,
      snapshotChanged,
    }
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

    const postPushSnapshotChanged = await this.refreshSnapshot(args.chatId, args.projectPath)

    return {
      ok: true,
      mode: args.mode,
      branchName,
      pushed: true,
      snapshotChanged: snapshotChanged || postPushSnapshotChanged,
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
