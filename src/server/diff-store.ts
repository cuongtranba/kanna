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
  extractGitHubRepoSlug,
  fetchGitHubPullRequests,
  fetchGitHubReleases,
  getBranchHistory,
  getBranchName,
  getGhAuthInfo,
  getGitHubOwners,
  getLastFetchedAt,
  getOriginRemoteUrl,
  getUpstreamStatusCounts,
  hasUpstreamBranch,
  resolveDefaultBranchName,
  resolveRepo,
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
import {
  checkoutBranch,
  createBranch,
  listBranches,
  mergeBranch,
  previewMergeBranch,
  syncBranch,
} from "./diff-store-branch-ops.adapter"
import type { DiffStoreBranchOpsDeps } from "./diff-store-branch-ops.adapter"

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

  private buildBranchOpsDeps(): DiffStoreBranchOpsDeps {
    return {
      refreshSnapshot: (projectId, projectPath) => this.refreshSnapshot(projectId, projectPath),
    }
  }

  async listBranches(args: {
    projectPath: string
  }): Promise<ChatBranchListResult> {
    return listBranches(this.buildBranchOpsDeps(), args)
  }

  async previewMergeBranch(args: {
    projectPath: string
    branch: SelectedBranch
  }): Promise<ChatMergePreviewResult> {
    return previewMergeBranch(this.buildBranchOpsDeps(), args)
  }

  async mergeBranch(args: {
    projectId: string
    projectPath: string
    branch: SelectedBranch
  }): Promise<ChatMergeBranchResult> {
    return mergeBranch(this.buildBranchOpsDeps(), args)
  }

  async checkoutBranch(args: {
    projectId: string
    projectPath: string
    branch: SelectedBranch
    bringChanges?: boolean
  }): Promise<ChatCheckoutBranchResult> {
    return checkoutBranch(this.buildBranchOpsDeps(), args)
  }

  async createBranch(args: {
    projectId: string
    projectPath: string
    name: string
    baseBranchName?: string
  }): Promise<ChatCreateBranchResult> {
    return createBranch(this.buildBranchOpsDeps(), args)
  }

  async syncBranch(args: {
    projectId: string
    projectPath: string
    action: "fetch" | "pull" | "push" | "publish"
  }): Promise<ChatSyncResult> {
    return syncBranch(this.buildBranchOpsDeps(), args)
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
