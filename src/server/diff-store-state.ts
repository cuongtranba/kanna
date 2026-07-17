import type {
  BranchMetadata,
  ChatBranchHistorySnapshot,
  ChatDiffFile,
  ChatDiffSnapshot,
  UpstreamStatus,
} from "../shared/types"

export interface StoredChatDiffState extends BranchMetadata, UpstreamStatus {
  status: ChatDiffSnapshot["status"]
  files: ChatDiffFile[]
  branchHistory: ChatBranchHistorySnapshot
}

export function createEmptyState(): StoredChatDiffState {
  return {
    status: "unknown",
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
  }
}

export function branchMetadataEqual(left: BranchMetadata, right: BranchMetadata): boolean {
  return left.branchName === right.branchName
    && left.defaultBranchName === right.defaultBranchName
    && left.hasOriginRemote === right.hasOriginRemote
    && left.originRepoSlug === right.originRepoSlug
    && left.hasUpstream === right.hasUpstream
}

export function upstreamStatusEqual(left: UpstreamStatus, right: UpstreamStatus): boolean {
  return left.aheadCount === right.aheadCount
    && left.behindCount === right.behindCount
    && left.lastFetchedAt === right.lastFetchedAt
}

export function branchHistoryEqual(left: ChatBranchHistorySnapshot, right: ChatBranchHistorySnapshot): boolean {
  if (left.entries.length !== right.entries.length) return false
  return left.entries.every((entry, index) => {
    const other = right.entries[index]
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
}

export function snapshotsEqual(left: StoredChatDiffState | undefined, right: StoredChatDiffState): boolean {
  if (!left) {
    return right.status === "unknown" && right.files.length === 0
  }
  if (left.status !== right.status) return false
  if (!branchMetadataEqual(left, right)) return false
  if (!upstreamStatusEqual(left, right)) return false
  if (left.files.length !== right.files.length) return false
  if (!branchHistoryEqual(left.branchHistory, right.branchHistory)) return false
  return left.files.every((file, index) => {
    const other = right.files[index]
    return Boolean(other)
      && file.path === other.path
      && file.changeType === other.changeType
      && file.isUntracked === other.isUntracked
      && file.additions === other.additions
      && file.deletions === other.deletions
      && file.patchDigest === other.patchDigest
      && file.mimeType === other.mimeType
      && file.size === other.size
  })
}
