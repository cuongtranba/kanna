import path from "node:path"
import {
  runCommand,
  runGit,
  statOrNull,
  summarizeGitFailure,
} from "./diff-store-io.adapter"
import type {
  ChatBranchHistoryEntry,
  ChatBranchHistorySnapshot,
  GithubRelease,
} from "../shared/types"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SelectedBranch =
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

// ---------------------------------------------------------------------------
// Repo / branch queries
// ---------------------------------------------------------------------------

export async function resolveRepo(
  projectPath: string
): Promise<{ repoRoot: string; baseCommit: string | null } | null> {
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

export async function getBranchName(repoRoot: string) {
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

export async function hasUpstreamBranch(repoRoot: string) {
  const upstream = await runGit(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], repoRoot)
  return upstream.exitCode === 0 && upstream.stdout.trim().length > 0
}

export async function getLastFetchedAt(repoRoot: string) {
  const gitDirResult = await runGit(["rev-parse", "--git-dir"], repoRoot)
  if (gitDirResult.exitCode !== 0) {
    return undefined
  }

  const gitDir = gitDirResult.stdout.trim()
  const fetchHeadPath = path.resolve(repoRoot, gitDir, "FETCH_HEAD")
  try {
    const fetchHeadStat = (await statOrNull(fetchHeadPath))!
    return fetchHeadStat.mtime.toISOString()
  } catch {
    return undefined
  }
}

export async function getUpstreamStatusCounts(repoRoot: string) {
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

export async function getOriginRemoteUrl(repoRoot: string) {
  const result = await runGit(["remote", "get-url", "origin"], repoRoot)
  if (result.exitCode !== 0) {
    return null
  }
  const remoteUrl = result.stdout.trim()
  return remoteUrl.length > 0 ? remoteUrl : null
}

export async function getGitHubRemoteSlugs(repoRoot: string) {
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

export async function getLocalBranchNames(repoRoot: string) {
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

export async function getRemoteBranchNames(repoRoot: string) {
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

export async function getBranchUpdatedAtMap(repoRoot: string, refPrefix: "refs/heads" | "refs/remotes") {
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

export async function resolveDefaultBranchName(repoRoot: string) {
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

export async function getRecentBranchNames(repoRoot: string) {
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

export async function resolveSelectedBranchRef(repoRoot: string, branch: SelectedBranch) {
  if (branch.kind === "local") {
    const localBranchNames = await getLocalBranchNames(repoRoot)
    if (!localBranchNames.includes(branch.name)) {
      throw new Error(`Local branch not found: ${branch.name}`)
    }
    return {
      ref: branch.name,
      displayName: branch.name,
      branchName: branch.name,
    }
  }

  if (branch.kind === "remote") {
    const remoteRef = branch.remoteRef.trim()
    const remoteBranchNames = await getRemoteBranchNames(repoRoot)
    if (!remoteBranchNames.includes(remoteRef)) {
      throw new Error(`Remote branch not found: ${remoteRef}`)
    }
    return {
      ref: remoteRef,
      displayName: remoteRef,
      branchName: branch.name,
    }
  }

  const localBranchNames = await getLocalBranchNames(repoRoot)
  if (localBranchNames.includes(branch.name)) {
    return {
      ref: branch.name,
      displayName: `PR #${branch.prNumber}`,
      branchName: branch.name,
    }
  }

  const remoteRef = branch.remoteRef?.trim()
  if (remoteRef) {
    const remoteBranchNames = await getRemoteBranchNames(repoRoot)
    if (remoteBranchNames.includes(remoteRef)) {
      return {
        ref: remoteRef,
        displayName: `PR #${branch.prNumber}`,
        branchName: branch.headRefName || branch.name,
      }
    }
  }

  if (branch.isCrossRepository) {
    throw new Error("This pull request branch is not available locally yet. Check it out first before merging.")
  }

  throw new Error(`Pull request branch not found: ${branch.headRefName || branch.name}`)
}

export async function getMergeCommitCount(repoRoot: string, sourceRef: string) {
  const result = await runGit(["rev-list", "--count", `HEAD..${sourceRef}`], repoRoot)
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || "Failed to calculate merge commit count")
  }

  const commitCount = Number.parseInt(result.stdout.trim(), 10)
  return Number.isFinite(commitCount) ? commitCount : 0
}

export async function predictMergeConflicts(repoRoot: string, sourceRef: string) {
  // Try the newer `git merge-tree --write-tree` form (requires Git 2.38+).
  const newResult = await runGit(["merge-tree", "--write-tree", "--messages", "HEAD", sourceRef], repoRoot)

  // Exit code 129 means the --write-tree flag is not supported (Git < 2.38).
  // Fall back to the legacy three-argument form.
  if (newResult.exitCode !== 129) {
    const output = `${newResult.stdout}\n${newResult.stderr}`.trim()

    if (newResult.exitCode === 0) {
      return { hasConflicts: false }
    }

    const normalizedOutput = output.toLowerCase()
    if (newResult.exitCode === 1 || normalizedOutput.includes("conflict")) {
      return {
        hasConflicts: true,
        detail: output || "Git reported merge conflicts for this branch pair.",
      }
    }

    throw new Error(output || "Failed to analyze merge conflicts")
  }

  // Legacy fallback: `git merge-tree <base> HEAD <source>` (Git < 2.38).
  const baseResult = await runGit(["merge-base", "HEAD", sourceRef], repoRoot)
  if (baseResult.exitCode !== 0) {
    throw new Error(baseResult.stderr.trim() || "Failed to find merge base")
  }
  const baseTree = baseResult.stdout.trim()

  const legacyResult = await runGit(["merge-tree", baseTree, "HEAD", sourceRef], repoRoot)
  const legacyOutput = `${legacyResult.stdout}\n${legacyResult.stderr}`.trim()

  if (legacyResult.exitCode !== 0) {
    throw new Error(legacyOutput || "Failed to analyze merge conflicts")
  }

  // In the legacy form, conflict markers (<<<<<<) appear in the output when there are conflicts.
  if (legacyOutput.includes("<<<<<<<") || legacyOutput.toLowerCase().includes("conflict")) {
    return {
      hasConflicts: true,
      detail: legacyOutput || "Git reported merge conflicts for this branch pair.",
    }
  }

  return { hasConflicts: false }
}

// ---------------------------------------------------------------------------
// GitHub URL parsing (pure)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// GitHub API — pull requests
// ---------------------------------------------------------------------------

export interface GitHubPullRequestResponseItem {
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

  const json: GitHubPullRequestResponseItem[] = JSON.parse(result.stdout)
  return Array.isArray(json) ? json : []
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

  const json: GitHubPullRequestResponseItem[] = await response.json()
  return Array.isArray(json) ? json : []
}

// ---------------------------------------------------------------------------
// GitHub API — releases
// ---------------------------------------------------------------------------

type GitHubReleasesCliApiLike = (path: string) => Promise<GithubRelease[] | null>

interface FetchGitHubReleasesDeps {
  fetchImpl?: FetchLike
  ghApiImpl?: GitHubReleasesCliApiLike
}

async function fetchGitHubReleasesViaGh(path: string): Promise<GithubRelease[] | null> {
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

  const json: GithubRelease[] = JSON.parse(result.stdout)
  return Array.isArray(json) ? json : []
}

// Fetches published releases for the changelog panel. Prefers the authenticated
// `gh` CLI (5000 req/hr) and falls back to an unauthenticated HTTP request
// (60 req/hr per IP) so the browser never hits GitHub's low anonymous limit.
export async function fetchGitHubReleases(
  repoSlug: string,
  deps: FetchLike | FetchGitHubReleasesDeps = fetch
): Promise<GithubRelease[]> {
  const fetchImpl = typeof deps === "function" ? deps : (deps.fetchImpl ?? fetch)
  const ghApiImpl = typeof deps === "function" ? fetchGitHubReleasesViaGh : (deps.ghApiImpl ?? fetchGitHubReleasesViaGh)
  const ghPath = `repos/${repoSlug}/releases`

  let releases: GithubRelease[] | null = null
  try {
    releases = await ghApiImpl(ghPath)
  } catch {
    // Fall back to an unauthenticated HTTP request when `gh` is unavailable.
  }

  if (!releases) {
    const response = await fetchImpl(`https://api.github.com/${ghPath}`, {
      headers: {
        Accept: "application/vnd.github+json",
      },
    })

    if (!response.ok) {
      throw new Error(`GitHub releases request failed with status ${response.status}`)
    }

    releases = await response.json()
  }

  return Array.isArray(releases) ? releases.filter((release) => !release.draft) : []
}

// ---------------------------------------------------------------------------
// Commit history
// ---------------------------------------------------------------------------

function buildGitHubCommitUrl(remoteUrl: string | null, sha: string) {
  const slug = extractGitHubRepoSlug(remoteUrl)
  return slug ? `https://github.com/${slug}/commit/${sha}` : undefined
}

async function getTagsByCommit(repoRoot: string, shas: string[]): Promise<Map<string, string[]>> {
  const tagMap = new Map<string, string[]>()
  if (shas.length === 0) return tagMap

  for (const sha of shas) {
    tagMap.set(sha, [])
  }

  const result = await runGit(
    ["log", "--max-count", String(shas.length), "--decorate-refs=refs/tags", "--format=%H %D", shas[0]!],
    repoRoot
  )

  if (result.exitCode !== 0) return tagMap

  for (const line of result.stdout.split(/\r?\n/u)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const spaceIndex = trimmed.indexOf(" ")
    if (spaceIndex < 0) continue
    const sha = trimmed.slice(0, spaceIndex)
    const decorations = trimmed.slice(spaceIndex + 1)
    if (!tagMap.has(sha) || !decorations) continue
    const tags = decorations
      .split(",")
      .map((decoration) => decoration.trim())
      .filter((decoration) => decoration.startsWith("tag: "))
      .map((decoration) => decoration.slice(5))
      .filter(Boolean)
      .sort((left, right) => left.localeCompare(right))
    tagMap.set(sha, tags)
  }

  return tagMap
}

export async function getBranchHistory(args: {
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
  const parsedRecords: Array<{ sha: string; summary: string; description: string; authorName?: string; authoredAt: string }> = []

  for (const record of logResult.stdout.split("")) {
    const trimmed = record.trim()
    if (!trimmed) continue
    const [sha, summary, description, authorName, authoredAt] = trimmed.split("")
    if (!sha || !summary || !authoredAt) continue
    parsedRecords.push({
      sha,
      summary,
      description: (description ?? "").trim(),
      authorName: authorName?.trim() || undefined,
      authoredAt,
    })
  }

  const tagMap = await getTagsByCommit(args.repoRoot, parsedRecords.map((record) => record.sha))

  const entries: ChatBranchHistoryEntry[] = parsedRecords.map((record) => ({
    ...record,
    tags: tagMap.get(record.sha) ?? [],
    githubUrl: buildGitHubCommitUrl(remoteUrl, record.sha),
  }))

  return { entries }
}

// ---------------------------------------------------------------------------
// Branch action failure factories
// ---------------------------------------------------------------------------

export function createBranchActionFailure(title: string, detail: string, fallback: string) {
  return {
    ok: false,
    title,
    message: summarizeGitFailure(detail, fallback),
    detail,
  } as const
}

export function createMergeActionFailure(args: {
  title: string
  detail: string
  fallback: string
  snapshotChanged: boolean
}) {
  return {
    ok: false,
    title: args.title,
    message: summarizeGitFailure(args.detail, args.fallback),
    detail: args.detail,
    snapshotChanged: args.snapshotChanged,
  } as const
}

// ---------------------------------------------------------------------------
// GitHub auth / publish helpers
// ---------------------------------------------------------------------------

export function sanitizeRepoName(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/gu, "-")
    .replace(/[^a-z0-9.-]+/gu, "-")
    .replace(/-+/gu, "-")
    .replace(/^-|-$/gu, "")
}

export async function getGhAuthInfo() {
  const versionResult = await runCommand(["gh", "--version"])
  if (versionResult.exitCode !== 0) {
    return {
      ghInstalled: false,
      authenticated: false,
      activeAccountLogin: undefined,
    }
  }

  const authStatusResult = await runCommand(["gh", "auth", "status", "--json", "hosts"])
  if (authStatusResult.exitCode !== 0) {
    return {
      ghInstalled: true,
      authenticated: false,
      activeAccountLogin: undefined,
    }
  }

  try {
    const parsed: { hosts?: Record<string, Array<{ active?: boolean; login?: string; state?: string }>> } = JSON.parse(authStatusResult.stdout)
    const accounts = parsed.hosts?.["github.com"] ?? []
    const activeAccount = accounts.find((account) => account.active) ?? accounts[0]
    return {
      ghInstalled: true,
      authenticated: activeAccount?.state === "success",
      activeAccountLogin: activeAccount?.login,
    }
  } catch {
    return {
      ghInstalled: true,
      authenticated: false,
      activeAccountLogin: undefined,
    }
  }
}

export async function getGitHubOwners(): Promise<string[]> {
  const userResult = await runCommand(["gh", "api", "user", "--jq", ".login"])
  if (userResult.exitCode !== 0) {
    return []
  }

  const owners = new Set<string>()
  const userLogin = userResult.stdout.trim()
  if (userLogin) {
    owners.add(userLogin)
  }

  const orgsResult = await runCommand(["gh", "api", "user/orgs", "--paginate", "--jq", ".[].login"])
  if (orgsResult.exitCode === 0) {
    for (const line of orgsResult.stdout.split(/\r?\n/u)) {
      const login = line.trim()
      if (login) {
        owners.add(login)
      }
    }
  }

  return [...owners]
}
