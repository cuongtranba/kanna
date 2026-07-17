// Git diff, branch, and worktree types.
// Extracted from types.ts to keep the barrel lean.
// All external consumers importing from "../shared/types" continue to work unchanged.

export interface ChatDiffFile {
  path: string
  changeType: "added" | "deleted" | "modified" | "renamed"
  isUntracked: boolean
  additions: number
  deletions: number
  patchDigest: string
  mimeType?: string
  size?: number
}

export interface ChatBranchHistoryEntry {
  sha: string
  summary: string
  description: string
  authorName?: string
  authoredAt: string
  tags: string[]
  githubUrl?: string
}

export interface ChatBranchHistorySnapshot {
  entries: ChatBranchHistoryEntry[]
}

export type ChatBranchListEntryKind = "local" | "remote" | "pull_request"

export interface ChatBranchListEntry {
  id: string
  kind: ChatBranchListEntryKind
  name: string
  displayName: string
  updatedAt?: string
  description?: string
  remoteRef?: string
  prNumber?: number
  prTitle?: string
  headRefName?: string
  headLabel?: string
  headRepoCloneUrl?: string
  isCrossRepository?: boolean
}

export interface ChatBranchListResult {
  currentBranchName?: string
  defaultBranchName?: string
  recent: ChatBranchListEntry[]
  local: ChatBranchListEntry[]
  remote: ChatBranchListEntry[]
  pullRequests: ChatBranchListEntry[]
  pullRequestsStatus: "available" | "unavailable" | "error"
  pullRequestsError?: string
}

export interface GitHubPublishInfo {
  ghInstalled: boolean
  authenticated: boolean
  activeAccountLogin?: string
  owners: string[]
  suggestedRepoName: string
}

export interface GitHubRepoAvailabilityResult {
  available: boolean
  message: string
}

export interface BranchMetadata {
  branchName?: string
  defaultBranchName?: string
  hasOriginRemote?: boolean
  originRepoSlug?: string
  hasUpstream?: boolean
}

export interface UpstreamStatus {
  aheadCount?: number
  behindCount?: number
  lastFetchedAt?: string
}

export interface ChatDiffSnapshot extends BranchMetadata, UpstreamStatus {
  status: "unknown" | "ready" | "no_repo"
  files: ChatDiffFile[]
  branchHistory?: ChatBranchHistorySnapshot
}

export interface BranchActionSuccess {
  ok: true
  branchName?: string
  snapshotChanged: boolean
}

export interface BranchActionFailure {
  ok: false
  title: string
  message: string
  detail?: string
  cancelled?: boolean
  snapshotChanged?: boolean
}

export type ChatSyncSuccess = BranchActionSuccess & {
  action: "fetch" | "pull" | "push" | "publish"
  aheadCount?: number
  behindCount?: number
}

export type ChatSyncFailure = BranchActionFailure & {
  action: "fetch" | "pull" | "push" | "publish"
}

export type ChatSyncResult = ChatSyncSuccess | ChatSyncFailure

export type DiffCommitMode = "commit_and_push" | "commit_only"

export type ChatCheckoutBranchSuccess = BranchActionSuccess
export type ChatCheckoutBranchFailure = BranchActionFailure
export type ChatCheckoutBranchResult = ChatCheckoutBranchSuccess | ChatCheckoutBranchFailure

export type ChatCreateBranchSuccess = BranchActionSuccess & { branchName: string }
export type ChatCreateBranchFailure = BranchActionFailure
export type ChatCreateBranchResult = ChatCreateBranchSuccess | ChatCreateBranchFailure

export type ChatMergePreviewStatus = "up_to_date" | "mergeable" | "conflicts" | "error"

export interface ChatMergePreviewResult {
  currentBranchName?: string
  targetBranchName: string
  targetDisplayName: string
  status: ChatMergePreviewStatus
  commitCount: number
  hasConflicts: boolean
  message: string
  detail?: string
}

export type ChatMergeBranchSuccess = BranchActionSuccess
export type ChatMergeBranchFailure = BranchActionFailure
export type ChatMergeBranchResult = ChatMergeBranchSuccess | ChatMergeBranchFailure

export type DiffCommitSuccess = BranchActionSuccess & {
  mode: DiffCommitMode
  pushed: boolean
}

export type DiffCommitFailure = BranchActionFailure & {
  mode: DiffCommitMode
  phase: "commit" | "push"
  localCommitCreated?: boolean
}

export type DiffCommitResult = DiffCommitSuccess | DiffCommitFailure

export interface GitWorktree {
  path: string                 // absolute
  branch: string               // e.g. "main", "feat/x", "(detached)"
  sha: string                  // HEAD commit sha
  isPrimary: boolean
  isLocked: boolean            // git has flagged this worktree as locked (pruning inhibited)
}
