import { sameDiffs } from "../shared/equality"
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

export function snapshotsEqual(left: StoredChatDiffState | undefined, right: StoredChatDiffState): boolean {
  if (!left) {
    return right.status === "unknown" && right.files.length === 0
  }
  return sameDiffs(left, right)
}
