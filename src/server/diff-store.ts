import path from "node:path"
import {
  formatGitFailure,
  runCommand,
  runGit,
  summarizeGitFailure,
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
import { normalizeRepoRelativePath } from "./diff-store-parse"
import {
  createEmptyState,
  snapshotsEqual,
} from "./diff-store-state"
import type { StoredChatDiffState } from "./diff-store-state"
import {
  computeCurrentFiles,
  createPatch,
  findDirtyPath,
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
} from "../shared/types"
import {
  checkoutBranch,
  createBranch,
  listBranches,
  mergeBranch,
  previewMergeBranch,
  syncBranch,
} from "./diff-store-branch-ops.adapter"
import type { DiffStoreBranchOpsDeps } from "./diff-store-branch-ops.adapter"
import {
  commitFiles,
  discardFile,
  generateCommitMessage,
  ignoreFile,
} from "./diff-store-commit-ops.adapter"
import type { DiffStoreCommitOpsDeps } from "./diff-store-commit-ops.adapter"

// Re-exports for backwards compatibility with other modules
export { runGit, formatGitFailure, extractGitHubRepoSlug, fetchGitHubPullRequests, fetchGitHubReleases }
export { appendGitIgnoreEntry } from "./diff-store-parse"

export class DiffStore {
  /**
   * Git state per REPO PATH, not per project.
   *
   * A chat can run in a git worktree of its project, and a worktree is a
   * different working tree with its own branch, its own dirty files and its own
   * upstream. Keying by project id gave every chat in a project one shared
   * entry: a worktree chat and a main-checkout chat overwrote each other's
   * state and thrashed each other's broadcasts. A path is what a git command
   * actually operates on, so keying by it is collision-free by construction.
   *
   * The key is the path the CALLER gave, not the repo root `resolveRepo` finds.
   * Reads are synchronous (the envelope builder is pure), so a read cannot
   * resolve a repo; keeping get and refresh on the same key is what makes them
   * agree.
   */
  private readonly states = new Map<string, StoredChatDiffState>()

  constructor(_: string) {}

  async initialize() {}

  async initializeGit(args: {
    projectPath: string
  }): Promise<BranchActionSuccess | BranchActionFailure> {
    const existingRepo = await resolveRepo(args.projectPath)
    if (existingRepo) {
      const snapshotChanged = await this.refreshSnapshot(args.projectPath)
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
    const snapshotChanged = await this.refreshSnapshot(args.projectPath)
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

    const snapshotChanged = await this.refreshSnapshot(args.projectPath)
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

  getSnapshot(repoPath: string): ChatDiffSnapshot {
    const state = this.states.get(repoPath) ?? createEmptyState()
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

  async refreshSnapshot(repoPath: string) {
    const repo = await resolveRepo(repoPath)
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
      const changed = !snapshotsEqual(this.states.get(repoPath), nextState)
      this.states.set(repoPath, nextState)
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
    const changed = !snapshotsEqual(this.states.get(repoPath), nextState)
    this.states.set(repoPath, nextState)
    return changed
  }

  private buildBranchOpsDeps(): DiffStoreBranchOpsDeps {
    return {
      refreshSnapshot: (repoPath) => this.refreshSnapshot(repoPath),
    }
  }

  private buildCommitOpsDeps(): DiffStoreCommitOpsDeps {
    return {
      refreshSnapshot: (repoPath) => this.refreshSnapshot(repoPath),
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
    projectPath: string
    branch: SelectedBranch
  }): Promise<ChatMergeBranchResult> {
    return mergeBranch(this.buildBranchOpsDeps(), args)
  }

  async checkoutBranch(args: {
    projectPath: string
    branch: SelectedBranch
    bringChanges?: boolean
  }): Promise<ChatCheckoutBranchResult> {
    return checkoutBranch(this.buildBranchOpsDeps(), args)
  }

  async createBranch(args: {
    projectPath: string
    name: string
    baseBranchName?: string
  }): Promise<ChatCreateBranchResult> {
    return createBranch(this.buildBranchOpsDeps(), args)
  }

  async syncBranch(args: {
    projectPath: string
    action: "fetch" | "pull" | "push" | "publish"
  }): Promise<ChatSyncResult> {
    return syncBranch(this.buildBranchOpsDeps(), args)
  }

  async generateCommitMessage(args: {
    projectPath: string
    paths: string[]
  }) {
    return generateCommitMessage(this.buildCommitOpsDeps(), args)
  }

  async commitFiles(args: {
    projectPath: string
    paths: string[]
    summary: string
    description?: string
    mode: DiffCommitMode
  }) {
    return commitFiles(this.buildCommitOpsDeps(), args)
  }

  async discardFile(args: {
    projectPath: string
    path: string
  }) {
    return discardFile(this.buildCommitOpsDeps(), args)
  }

  async ignoreFile(args: {
    projectPath: string
    path: string
  }) {
    return ignoreFile(this.buildCommitOpsDeps(), args)
  }
}
