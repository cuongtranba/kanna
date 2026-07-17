import path from "node:path"
import {
  formatGitFailure,
  readTextFileOrNull,
  rmPathRecursive,
  runCommand,
  runGit,
  summarizeGitFailure,
  writeTextFile,
} from "./diff-store-io.adapter"
import {
  createBranchActionFailure,
  createMergeActionFailure,
  extractGitHubRepoSlug,
  fetchGitHubPullRequests,
  fetchGitHubReleases,
  getBranchHistory,
  getBranchName,
  getBranchUpdatedAtMap,
  getGhAuthInfo,
  getGitHubOwners,
  getGitHubRemoteSlugs,
  getLastFetchedAt,
  getLocalBranchNames,
  getMergeCommitCount,
  getOriginRemoteUrl,
  getRecentBranchNames,
  getRemoteBranchNames,
  getUpstreamStatusCounts,
  hasUpstreamBranch,
  predictMergeConflicts,
  resolveDefaultBranchName,
  resolveRepo,
  resolveSelectedBranchRef,
  sanitizeRepoName,
} from "./diff-store-git-branch.adapter"
import type { SelectedBranch } from "./diff-store-git-branch.adapter"
import {
  appendGitIgnoreEntry,
  normalizeRepoRelativePath,
} from "./diff-store-parse"
import {
  createEmptyState,
  snapshotsEqual,
} from "./diff-store-state"
import type { StoredChatDiffState } from "./diff-store-state"
import {
  createCommitFailure,
  createPushFailure,
  createSyncPushFailure,
} from "./diff-store-errors"
import {
  computeCurrentFiles,
  createPatch,
  discardAddedPath,
  discardRenamedPath,
  findDirtyPath,
  listDirtyPaths,
  readBaseFile,
  readWorktreeFile,
} from "./diff-store-file-ops.adapter"
import type {
  ChatBranchListEntry,
  ChatBranchListResult,
  ChatCheckoutBranchResult,
  ChatCreateBranchResult,
  ChatDiffSnapshot,
  BranchActionSuccess,
  BranchActionFailure,
  GitHubPublishInfo,
  GitHubRepoAvailabilityResult,
  ChatMergeBranchResult,
  ChatMergePreviewResult,
  ChatSyncResult,
  DiffCommitMode,
  DiffCommitResult,
} from "../shared/types"
import { generateCommitMessageDetailed } from "./generate-commit-message"

// Re-exports for backwards compatibility with other modules
export { runGit, formatGitFailure, extractGitHubRepoSlug, fetchGitHubPullRequests, fetchGitHubReleases }
export { appendGitIgnoreEntry } from "./diff-store-parse"

export class DiffStore {
  private readonly states = new Map<string, StoredChatDiffState>()

  constructor(_: string) {}

  async initialize() {}

  async initializeGit(args: {
    projectId: string
    projectPath: string
  }): Promise<BranchActionSuccess | BranchActionFailure> {
    const existingRepo = await resolveRepo(args.projectPath)
    if (existingRepo) {
      const snapshotChanged = await this.refreshSnapshot(args.projectId, args.projectPath)
      return {
        ok: true,
        branchName: await getBranchName(existingRepo.repoRoot),
        snapshotChanged,
      }
    }

    const initResult = await runGit(["init"], args.projectPath)
    if (initResult.exitCode !== 0) {
      return createBranchActionFailure("Initialize git failed", formatGitFailure(initResult), "Git could not initialize this folder.")
    }

    const repo = await resolveRepo(args.projectPath)
    const snapshotChanged = await this.refreshSnapshot(args.projectId, args.projectPath)
    return {
      ok: true,
      branchName: repo ? await getBranchName(repo.repoRoot) : undefined,
      snapshotChanged,
    }
  }

  async getGitHubPublishInfo(args: {
    projectPath: string
  }): Promise<GitHubPublishInfo> {
    const authInfo = await getGhAuthInfo()
    const suggestedRepoName = sanitizeRepoName(path.basename(args.projectPath)) || "my-repo"

    if (!authInfo.ghInstalled || !authInfo.authenticated) {
      return {
        ghInstalled: authInfo.ghInstalled,
        authenticated: authInfo.authenticated,
        activeAccountLogin: authInfo.activeAccountLogin,
        owners: authInfo.activeAccountLogin ? [authInfo.activeAccountLogin] : [],
        suggestedRepoName,
      }
    }

    const owners = await getGitHubOwners()
    return {
      ghInstalled: true,
      authenticated: true,
      activeAccountLogin: authInfo.activeAccountLogin,
      owners,
      suggestedRepoName,
    }
  }

  async checkGitHubRepoAvailability(args: {
    owner: string
    name: string
  }): Promise<GitHubRepoAvailabilityResult> {
    const authInfo = await getGhAuthInfo()
    if (!authInfo.ghInstalled) {
      return {
        available: false,
        message: "GitHub CLI is not installed.",
      }
    }
    if (!authInfo.authenticated) {
      return {
        available: false,
        message: "GitHub CLI is not authenticated.",
      }
    }

    const owner = args.owner.trim()
    const name = sanitizeRepoName(args.name)
    if (!owner || !name) {
      return {
        available: false,
        message: "Enter an owner and repository name.",
      }
    }

    const result = await runCommand(["gh", "api", `repos/${owner}/${name}`])
    if (result.exitCode === 0) {
      return {
        available: false,
        message: `${owner}/${name} already exists.`,
      }
    }

    const detail = `${result.stderr}\n${result.stdout}`.toLowerCase()
    if (detail.includes("404")) {
      return {
        available: true,
        message: `${owner}/${name} is available.`,
      }
    }

    return {
      available: false,
      message: "Could not verify repository availability.",
    }
  }

  async publishToGitHub(args: {
    projectId: string
    projectPath: string
    owner: string
    name: string
    visibility: "public" | "private"
    description?: string
  }): Promise<BranchActionSuccess | BranchActionFailure> {
    const repo = await resolveRepo(args.projectPath)
    if (!repo) {
      return {
        ok: false,
        title: "Publish failed",
        message: "Initialize git before publishing to GitHub.",
        snapshotChanged: false,
      }
    }

    const authInfo = await getGhAuthInfo()
    if (!authInfo.ghInstalled) {
      return {
        ok: false,
        title: "GitHub CLI not installed",
        message: "Install GitHub CLI (`gh`) to publish from Kanna.",
        snapshotChanged: false,
      }
    }
    if (!authInfo.authenticated) {
      return {
        ok: false,
        title: "GitHub CLI not signed in",
        message: "Run `gh auth login` and try again.",
        snapshotChanged: false,
      }
    }

    const owner = args.owner.trim()
    const repoName = sanitizeRepoName(args.name)
    if (!owner || !repoName) {
      return {
        ok: false,
        title: "Publish failed",
        message: "Owner and repository name are required.",
        snapshotChanged: false,
      }
    }

    const availability = await this.checkGitHubRepoAvailability({ owner, name: repoName })
    if (!availability.available) {
      return {
        ok: false,
        title: "Publish failed",
        message: availability.message,
        snapshotChanged: false,
      }
    }

    const createArgs = [
      "gh",
      "repo",
      "create",
      `${owner}/${repoName}`,
      args.visibility === "private" ? "--private" : "--public",
      "--source",
      args.projectPath,
      "--remote",
      "origin",
    ]
    if (repo.baseCommit) {
      createArgs.push("--push")
    }
    if (args.description?.trim()) {
      createArgs.push("--description", args.description.trim())
    }

    const createResult = await runCommand(createArgs)
    if (createResult.exitCode !== 0) {
      const detail = [createResult.stderr.trim(), createResult.stdout.trim()].filter(Boolean).join("\n")
      return {
        ok: false,
        title: "Publish failed",
        message: summarizeGitFailure(detail, "GitHub CLI could not publish this repository."),
        detail,
        snapshotChanged: false,
      }
    }

    const snapshotChanged = await this.refreshSnapshot(args.projectId, args.projectPath)
    return {
      ok: true,
      branchName: await getBranchName(repo.repoRoot),
      snapshotChanged,
    }
  }

  async readPatch(args: {
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

    const beforePath = entry.previousPath ?? relativePath
    const beforeText = await readBaseFile(repo.repoRoot, repo.baseCommit, beforePath)
    const afterText = await readWorktreeFile(repo.repoRoot, relativePath)
    const patch = await createPatch(beforePath, relativePath, beforeText, afterText)

    return { patch }
  }

  getProjectSnapshot(projectId: string): ChatDiffSnapshot {
    const state = this.states.get(projectId) ?? createEmptyState()
    return {
      status: state.status,
      branchName: state.branchName,
      defaultBranchName: state.defaultBranchName,
      hasOriginRemote: state.hasOriginRemote,
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

  async refreshSnapshot(projectId: string, projectPath: string) {
    const repo = await resolveRepo(projectPath)
    if (!repo) {
      const nextState = {
        status: "no_repo",
        branchName: undefined,
        defaultBranchName: undefined,
        hasOriginRemote: undefined,
        originRepoSlug: undefined,
        hasUpstream: undefined,
        aheadCount: undefined,
        behindCount: undefined,
        lastFetchedAt: undefined,
        files: [],
        branchHistory: { entries: [] },
      } satisfies StoredChatDiffState
      const changed = !snapshotsEqual(this.states.get(projectId), nextState)
      this.states.set(projectId, nextState)
      return changed
    }

    const files = await computeCurrentFiles(repo.repoRoot, repo.baseCommit)
    const branchName = await getBranchName(repo.repoRoot)
    const defaultBranchName = await resolveDefaultBranchName(repo.repoRoot)
    const originRemoteUrl = await getOriginRemoteUrl(repo.repoRoot)
    const hasOriginRemote = originRemoteUrl !== null
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
      hasOriginRemote,
      originRepoSlug,
      hasUpstream,
      aheadCount,
      behindCount,
      lastFetchedAt,
      files,
      branchHistory,
    } satisfies StoredChatDiffState
    const changed = !snapshotsEqual(this.states.get(projectId), nextState)
    this.states.set(projectId, nextState)
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

  async previewMergeBranch(args: {
    projectPath: string
    branch: SelectedBranch
  }): Promise<ChatMergePreviewResult> {
    const repo = await resolveRepo(args.projectPath)
    if (!repo) {
      throw new Error("Project is not in a git repository")
    }

    const currentBranchName = await getBranchName(repo.repoRoot)
    const resolvedBranch = await resolveSelectedBranchRef(repo.repoRoot, args.branch)

    if (currentBranchName && resolvedBranch.branchName === currentBranchName) {
      return {
        currentBranchName,
        targetBranchName: resolvedBranch.branchName,
        targetDisplayName: resolvedBranch.displayName,
        status: "up_to_date",
        commitCount: 0,
        hasConflicts: false,
        message: `${currentBranchName} is already up to date with ${resolvedBranch.displayName}.`,
      }
    }

    try {
      const commitCount = await getMergeCommitCount(repo.repoRoot, resolvedBranch.ref)
      if (commitCount === 0) {
        return {
          currentBranchName,
          targetBranchName: resolvedBranch.branchName,
          targetDisplayName: resolvedBranch.displayName,
          status: "up_to_date",
          commitCount,
          hasConflicts: false,
          message: `${currentBranchName ?? "Current branch"} is already up to date with ${resolvedBranch.displayName}.`,
        }
      }

      const conflictPrediction = await predictMergeConflicts(repo.repoRoot, resolvedBranch.ref)
      if (conflictPrediction.hasConflicts) {
        return {
          currentBranchName,
          targetBranchName: resolvedBranch.branchName,
          targetDisplayName: resolvedBranch.displayName,
          status: "conflicts",
          commitCount,
          hasConflicts: true,
          message: `${commitCount} ${commitCount === 1 ? "commit" : "commits"} from ${resolvedBranch.displayName} would merge into ${currentBranchName ?? "the current branch"}, but conflicts are expected.`,
          detail: conflictPrediction.detail,
        }
      }

      return {
        currentBranchName,
        targetBranchName: resolvedBranch.branchName,
        targetDisplayName: resolvedBranch.displayName,
        status: "mergeable",
        commitCount,
        hasConflicts: false,
        message: `${commitCount} ${commitCount === 1 ? "commit" : "commits"} from ${resolvedBranch.displayName} will merge into ${currentBranchName ?? "the current branch"}.`,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        currentBranchName,
        targetBranchName: resolvedBranch.branchName,
        targetDisplayName: resolvedBranch.displayName,
        status: "error",
        commitCount: 0,
        hasConflicts: false,
        message: "Could not preview this merge.",
        detail: message,
      }
    }
  }

  async mergeBranch(args: {
    projectId: string
    projectPath: string
    branch: SelectedBranch
  }): Promise<ChatMergeBranchResult> {
    const repo = await resolveRepo(args.projectPath)
    if (!repo) {
      throw new Error("Project is not in a git repository")
    }

    const currentDirtyPaths = await listDirtyPaths(repo.repoRoot)
    if (currentDirtyPaths.length > 0) {
      return {
        ok: false,
        title: "Merge blocked",
        message: "Commit, discard, or stash your local changes before merging.",
        snapshotChanged: false,
      }
    }

    const resolvedBranch = await resolveSelectedBranchRef(repo.repoRoot, args.branch)
    const commitCount = await getMergeCommitCount(repo.repoRoot, resolvedBranch.ref)
    if (commitCount === 0) {
      return {
        ok: false,
        title: "Already up to date",
        message: `${resolvedBranch.displayName} is already merged into ${await getBranchName(repo.repoRoot) ?? "the current branch"}.`,
        snapshotChanged: false,
      }
    }

    const mergeResult = await runGit(["merge", "--no-edit", resolvedBranch.ref], repo.repoRoot)
    const detail = formatGitFailure(mergeResult)

    if (mergeResult.exitCode !== 0) {
      const snapshotChanged = await this.refreshSnapshot(args.projectId, args.projectPath)
      const normalized = detail.toLowerCase()
      const title = normalized.includes("conflict")
        ? "Merge conflicts need resolution"
        : "Merge failed"
      const fallback = normalized.includes("conflict")
        ? "Git reported merge conflicts while merging this branch."
        : "Git could not merge this branch."
      return createMergeActionFailure({
        title,
        detail,
        fallback,
        snapshotChanged,
      })
    }

    const snapshotChanged = await this.refreshSnapshot(args.projectId, args.projectPath)
    return {
      ok: true,
      branchName: await getBranchName(repo.repoRoot),
      snapshotChanged,
    }
  }

  async checkoutBranch(args: {
    projectId: string
    projectPath: string
    branch: SelectedBranch
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

    const snapshotChanged = await this.refreshSnapshot(args.projectId, args.projectPath)
    return {
      ok: true,
      branchName: await getBranchName(repo.repoRoot),
      snapshotChanged,
    }
  }

  async createBranch(args: {
    projectId: string
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

    const snapshotChanged = await this.refreshSnapshot(args.projectId, args.projectPath)
    return {
      ok: true,
      branchName,
      snapshotChanged,
    }
  }

  async syncBranch(args: {
    projectId: string
    projectPath: string
    action: "fetch" | "pull" | "push" | "publish"
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

      const snapshotChanged = await this.refreshSnapshot(args.projectId, args.projectPath)
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

    if (args.action === "push") {
      if (!hasUpstream) {
        return {
          ok: false,
          action: args.action,
          title: "Push failed",
          message: "This branch does not have an upstream remote branch configured yet.",
          snapshotChanged: false,
        }
      }

      const pushResult = await runGit(["push"], repo.repoRoot)
      if (pushResult.exitCode !== 0) {
        const detail = formatGitFailure(pushResult)
        return createSyncPushFailure(detail, false)
      }

      const snapshotChanged = await this.refreshSnapshot(args.projectId, args.projectPath)
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

    const snapshotChanged = await this.refreshSnapshot(args.projectId, args.projectPath)
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

    const currentDirtyPaths = await listDirtyPaths(repo.repoRoot)
    const selectedFiles = await Promise.all(normalizedPaths.map(async (selectedPath) => {
      const entry = currentDirtyPaths.find((candidate) => candidate.path === selectedPath)
      if (!entry) {
        throw new Error(`File is no longer changed: ${selectedPath}`)
      }

      const beforePath = entry.previousPath ?? selectedPath
      const beforeText = await readBaseFile(repo.repoRoot, repo.baseCommit, beforePath)
      const afterText = await readWorktreeFile(repo.repoRoot, selectedPath)
      const patch = await createPatch(beforePath, selectedPath, beforeText, afterText)

      return {
        path: selectedPath,
        changeType: entry.changeType,
        patch,
      }
    }))

    const branchName = await getBranchName(repo.repoRoot)
    return await generateCommitMessageDetailed({
      cwd: repo.repoRoot,
      branchName,
      files: selectedFiles,
    })
  }

  async commitFiles(args: {
    projectId: string
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
    const [hasUpstream, originRemoteUrl] = await Promise.all([
      hasUpstreamBranch(repo.repoRoot),
      getOriginRemoteUrl(repo.repoRoot),
    ])
    const hasOriginRemote = originRemoteUrl !== null

    const currentDirtyEntries = await listDirtyPaths(repo.repoRoot)
    const currentDirtyPathsByPath = new Map(currentDirtyEntries.map((entry) => [entry.path, entry]))
    const missingPaths = normalizedPaths.filter((relativePath) => !currentDirtyPathsByPath.has(relativePath))
    if (missingPaths.length > 0) {
      throw new Error(`File is no longer changed: ${missingPaths[0]}`)
    }

    const trackedPaths = normalizedPaths.filter((relativePath) => !currentDirtyPathsByPath.get(relativePath)?.isUntracked)
    if (trackedPaths.length > 0) {
      const addTrackedResult = await runGit(["add", "-u", "--", ...trackedPaths], repo.repoRoot)
      if (addTrackedResult.exitCode !== 0) {
        return createCommitFailure(args.mode, formatGitFailure(addTrackedResult))
      }
    }

    const untrackedPaths = normalizedPaths.filter((relativePath) => currentDirtyPathsByPath.get(relativePath)?.isUntracked)
    if (untrackedPaths.length > 0) {
      const addUntrackedResult = await runGit(["add", "--", ...untrackedPaths], repo.repoRoot)
      if (addUntrackedResult.exitCode !== 0) {
        return createCommitFailure(args.mode, formatGitFailure(addUntrackedResult))
      }
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

    const snapshotChanged = await this.refreshSnapshot(args.projectId, args.projectPath)
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

    if (!hasUpstream && !hasOriginRemote) {
      return {
        ok: true,
        mode: args.mode,
        branchName,
        pushed: false,
        snapshotChanged,
      } satisfies DiffCommitResult
    }

    const pushResult = hasUpstream
      ? await runGit(["push"], repo.repoRoot)
      : await runGit(["push", "-u", "origin", "HEAD"], repo.repoRoot)
    if (pushResult.exitCode !== 0) {
      return createPushFailure(args.mode, formatGitFailure(pushResult), snapshotChanged)
    }

    const postPushSnapshotChanged = await this.refreshSnapshot(args.projectId, args.projectPath)

    return {
      ok: true,
      mode: args.mode,
      branchName,
      pushed: true,
      snapshotChanged: snapshotChanged || postPushSnapshotChanged,
    } satisfies DiffCommitResult
  }

  async discardFile(args: {
    projectId: string
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
      await rmPathRecursive(path.join(repo.repoRoot, entry.path))
    } else if (entry.changeType === "added") {
      await discardAddedPath(repo.repoRoot, repo.baseCommit !== null, entry.path)
      await rmPathRecursive(path.join(repo.repoRoot, entry.path))
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
      snapshotChanged: await this.refreshSnapshot(args.projectId, args.projectPath),
    }
  }

  async ignoreFile(args: {
    projectId: string
    projectPath: string
    path: string
  }) {
    const ignoreEntry = normalizeRepoRelativePath(args.path)
    const repo = await resolveRepo(args.projectPath)
    if (!repo) {
      throw new Error("Project is not in a git repository")
    }

    const dirtyPaths = await listDirtyPaths(repo.repoRoot)
    const exactEntry = dirtyPaths.find((candidate) => candidate.path === ignoreEntry)
    if (exactEntry && !exactEntry.isUntracked) {
      throw new Error("Only untracked files can be ignored from the diff viewer")
    }

    const entry = dirtyPaths.find((candidate) => candidate.isUntracked && (candidate.path === ignoreEntry || candidate.path.startsWith(ignoreEntry)))
    if (!entry) {
      throw new Error(`File is no longer changed: ${ignoreEntry}`)
    }

    const gitignorePath = path.join(repo.repoRoot, ".gitignore")
    const currentContents = await readTextFileOrNull(gitignorePath)
    const nextContents = appendGitIgnoreEntry(currentContents, ignoreEntry)
    if (nextContents !== currentContents) {
      await writeTextFile(gitignorePath, nextContents)
    }

    return {
      snapshotChanged: await this.refreshSnapshot(args.projectId, args.projectPath),
    }
  }
}
