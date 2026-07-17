import {
  formatGitFailure,
  runGit,
  summarizeGitFailure,
} from "./diff-store-io.adapter"
import {
  createBranchActionFailure,
  createMergeActionFailure,
  extractGitHubRepoSlug,
  fetchGitHubPullRequests,
  getBranchName,
  getBranchUpdatedAtMap,
  getGitHubRemoteSlugs,
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
} from "./diff-store-git-branch.adapter"
import type { SelectedBranch } from "./diff-store-git-branch.adapter"
import { createSyncPushFailure } from "./diff-store-errors"
import { listDirtyPaths } from "./diff-store-file-ops.adapter"
import type {
  ChatBranchListEntry,
  ChatBranchListResult,
  ChatCheckoutBranchResult,
  ChatCreateBranchResult,
  ChatMergeBranchResult,
  ChatMergePreviewResult,
  ChatSyncResult,
} from "../shared/types"

export interface DiffStoreBranchOpsDeps {
  readonly refreshSnapshot: (projectId: string, projectPath: string) => Promise<boolean>
}

export async function listBranches(
  _deps: DiffStoreBranchOpsDeps,
  args: { projectPath: string }
): Promise<ChatBranchListResult> {
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

export async function previewMergeBranch(
  _deps: DiffStoreBranchOpsDeps,
  args: { projectPath: string; branch: SelectedBranch }
): Promise<ChatMergePreviewResult> {
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

export async function mergeBranch(
  deps: DiffStoreBranchOpsDeps,
  args: { projectId: string; projectPath: string; branch: SelectedBranch }
): Promise<ChatMergeBranchResult> {
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
    const snapshotChanged = await deps.refreshSnapshot(args.projectId, args.projectPath)
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

  const snapshotChanged = await deps.refreshSnapshot(args.projectId, args.projectPath)
  return {
    ok: true,
    branchName: await getBranchName(repo.repoRoot),
    snapshotChanged,
  }
}

export async function checkoutBranch(
  deps: DiffStoreBranchOpsDeps,
  args: {
    projectId: string
    projectPath: string
    branch: SelectedBranch
    bringChanges?: boolean
  }
): Promise<ChatCheckoutBranchResult> {
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

  const snapshotChanged = await deps.refreshSnapshot(args.projectId, args.projectPath)
  return {
    ok: true,
    branchName: await getBranchName(repo.repoRoot),
    snapshotChanged,
  }
}

export async function createBranch(
  deps: DiffStoreBranchOpsDeps,
  args: {
    projectId: string
    projectPath: string
    name: string
    baseBranchName?: string
  }
): Promise<ChatCreateBranchResult> {
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

  const snapshotChanged = await deps.refreshSnapshot(args.projectId, args.projectPath)
  return {
    ok: true,
    branchName,
    snapshotChanged,
  }
}

export async function syncBranch(
  deps: DiffStoreBranchOpsDeps,
  args: {
    projectId: string
    projectPath: string
    action: "fetch" | "pull" | "push" | "publish"
  }
): Promise<ChatSyncResult> {
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

    const snapshotChanged = await deps.refreshSnapshot(args.projectId, args.projectPath)
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

    const snapshotChanged = await deps.refreshSnapshot(args.projectId, args.projectPath)
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

  const snapshotChanged = await deps.refreshSnapshot(args.projectId, args.projectPath)
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
