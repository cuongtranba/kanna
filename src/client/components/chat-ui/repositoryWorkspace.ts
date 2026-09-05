import type {
  ChatAttachment,
  ChatBranchListEntry,
  ChatBranchListResult,
  ChatDiffFile,
  ChatDiffSnapshot,
  DiffCommitMode,
} from "../../../shared/types"

export type RepositorySyncAction = "fetch" | "pull" | "publish"

export interface RepositorySnapshot {
  syncAction: RepositorySyncAction
  compareUrl: string | null
  canOpenPullRequest: boolean
  primaryCommitMode: DiffCommitMode
  isPublishedBranch: boolean
  isPublishableBranch: boolean
  hasRemoteOrigin: boolean
  behindCount: number
  aheadCount: number
  encodedBranchName: string | null
  resolvedBranchName: string
}

export interface BranchListSnapshot {
  currentName: string | undefined
  recent: ChatBranchListEntry[]
  local: ChatBranchListEntry[]
  remote: ChatBranchListEntry[]
  pullRequests: ChatBranchListEntry[]
  totalPullRequestCount: number
}

export function getBranchCandidatePriority(entry: ChatBranchListEntry): number {
  switch (entry.kind) {
    case "local":
      return 0
    case "pull_request":
      return 1
    case "remote":
    default:
      return 2
  }
}

export function dedupeBranchEntries(entries: ChatBranchListEntry[]): Map<string, ChatBranchListEntry> {
  const selectedByName = new Map<string, ChatBranchListEntry>()
  for (const entry of entries) {
    const existing = selectedByName.get(entry.name)
    if (!existing || getBranchCandidatePriority(entry) < getBranchCandidatePriority(existing)) {
      selectedByName.set(entry.name, entry)
    }
  }
  return selectedByName
}

export interface BranchGroups {
  defaultBranch: ChatBranchListEntry | undefined
  recent: ChatBranchListEntry[]
  other: ChatBranchListEntry[]
}

export function getMergeBranchGroups(
  branchList: ChatBranchListResult,
  currentBranchName?: string,
): BranchGroups {
  const uniqueEntriesByName = dedupeBranchEntries([
    ...branchList.local,
    ...branchList.pullRequests,
    ...branchList.remote,
  ])
  if (currentBranchName) {
    uniqueEntriesByName.delete(currentBranchName)
  }

  const usedNames = new Set<string>(currentBranchName ? [currentBranchName] : [])
  const defaultBranch = branchList.defaultBranchName
    ? uniqueEntriesByName.get(branchList.defaultBranchName)
    : undefined

  if (defaultBranch) {
    usedNames.add(defaultBranch.name)
  }

  const recent = branchList.recent
    .map((entry) => uniqueEntriesByName.get(entry.name) ?? entry)
    .filter((entry): entry is ChatBranchListEntry => Boolean(entry) && !usedNames.has(entry.name))

  for (const entry of recent) {
    usedNames.add(entry.name)
  }

  const other = [...uniqueEntriesByName.values()]
    .filter((entry) => !usedNames.has(entry.name))
    .sort((left, right) => left.displayName.localeCompare(right.displayName))

  return { defaultBranch, recent, other }
}

export function filterBranchEntries(
  entries: ChatBranchListEntry[],
  normalizedQuery: string,
): ChatBranchListEntry[] {
  if (!normalizedQuery) return entries
  return entries.filter((entry) =>
    [entry.displayName, entry.name, entry.description, entry.prTitle, entry.headLabel].some(
      (value) => value?.toLowerCase().includes(normalizedQuery),
    ),
  )
}

export function deriveBranchListSnapshot(
  branchList: ChatBranchListResult | null,
  currentBranchName: string | undefined,
  query: string,
): BranchListSnapshot {
  const normalizedQuery = query.trim().toLowerCase()
  const filter = (entries: ChatBranchListEntry[]) =>
    filterBranchEntries(entries, normalizedQuery)

  const currentName = branchList?.currentBranchName ?? currentBranchName
  const pullRequestHeadNames = new Set(
    (branchList?.pullRequests ?? []).map((entry) => entry.headRefName ?? entry.name),
  )

  const recent = filter(branchList?.recent ?? []).filter((entry) => entry.name !== currentName)
  const local = filter(branchList?.local ?? []).filter((entry) => entry.name !== currentName)
  const remote = filter(branchList?.remote ?? []).filter(
    (entry) => entry.name !== currentName && !pullRequestHeadNames.has(entry.name),
  )
  const pullRequests = filter(branchList?.pullRequests ?? []).filter(
    (entry) => entry.name !== currentName,
  )

  return {
    currentName,
    recent,
    local,
    remote,
    pullRequests,
    totalPullRequestCount: branchList?.pullRequests.length ?? 0,
  }
}

export function formatRelativeTime(isoTimestamp: string): string {
  const timestamp = Date.parse(isoTimestamp)
  if (!Number.isFinite(timestamp)) {
    return ""
  }

  const diffMs = Date.now() - timestamp
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  const week = 7 * day
  const month = 30 * day
  const year = 365 * day

  if (diffMs < minute) return "just now"
  if (diffMs < hour) return `${Math.round(diffMs / minute)}m ago`
  if (diffMs < day) return `${Math.round(diffMs / hour)}hr ago`
  if (diffMs < week) return `${Math.round(diffMs / day)}d ago`
  if (diffMs < month) return `${Math.round(diffMs / week)}wk ago`
  if (diffMs < year) return `${Math.round(diffMs / month)}mo ago`
  return `${Math.round(diffMs / year)}yr ago`
}

export function formatFetchTooltip(isoTimestamp?: string): string {
  if (!isoTimestamp) {
    return "No local fetch recorded"
  }
  return `Last fetched ${formatRelativeTime(isoTimestamp)}`
}

export function canIgnoreDiffFile(file: ChatDiffFile): boolean {
  return file.isUntracked
}

export function canIgnoreDiffFolder(file: ChatDiffFile): boolean {
  if (!canIgnoreDiffFile(file)) {
    return false
  }
  return file.path.includes("/")
}

export function shouldLoadDiffPatchNow(args: {
  isCollapsed: boolean
  hasPreviewAttachment: boolean
  patch?: string
  patchError?: string
  isPatchLoading: boolean
}): boolean {
  return (
    !args.isCollapsed
    && !args.hasPreviewAttachment
    && args.patch === undefined
    && args.patchError === undefined
    && !args.isPatchLoading
  )
}

export function getDiffPreviewAttachment(
  projectId: string | null,
  file: ChatDiffFile,
): ChatAttachment | null {
  if (
    !projectId
    || !file.mimeType
    || typeof file.size !== "number"
    || file.changeType === "deleted"
  ) {
    return null
  }

  if (!file.mimeType.startsWith("image/") && file.mimeType !== "application/pdf") {
    return null
  }

  return {
    id: `diff:${file.path}`,
    kind: file.mimeType.startsWith("image/") ? "image" : "file",
    displayName: file.path.split("/").pop() ?? file.path,
    absolutePath: file.path,
    relativePath: file.path,
    contentUrl: `/api/projects/${projectId}/files/${encodeURIComponent(file.path)}/content`,
    mimeType: file.mimeType,
    size: file.size,
  }
}

function encodeGitBranchName(branchName: string): string {
  return branchName.split("/").map((segment) => encodeURIComponent(segment)).join("/")
}

export function deriveRepositorySnapshot(diffs: ChatDiffSnapshot): RepositorySnapshot {
  const behindCount = diffs.behindCount ?? 0
  const aheadCount = diffs.aheadCount ?? 0
  const isPublishedBranch = diffs.hasUpstream === true
  const isPublishableBranch = diffs.hasUpstream === false && Boolean(diffs.branchName)
  const hasRemoteOrigin = diffs.hasOriginRemote === true
  const encodedBranchName = diffs.branchName ? encodeGitBranchName(diffs.branchName) : null

  let syncAction: RepositorySyncAction
  if (isPublishableBranch) {
    syncAction = "publish"
  } else if (behindCount > 0) {
    syncAction = "pull"
  } else {
    syncAction = "fetch"
  }

  const compareUrl =
    diffs.originRepoSlug && encodedBranchName
      ? `https://github.com/${diffs.originRepoSlug}/compare/${encodedBranchName}?expand=1`
      : null

  const canOpenPullRequest = Boolean(
    isPublishedBranch
    && compareUrl
    && diffs.branchName
    && diffs.branchName !== diffs.defaultBranchName,
  )

  const primaryCommitMode: DiffCommitMode = hasRemoteOrigin ? "commit_and_push" : "commit_only"
  const resolvedBranchName = diffs.branchName ?? "current branch"

  return {
    syncAction,
    compareUrl,
    canOpenPullRequest,
    primaryCommitMode,
    isPublishedBranch,
    isPublishableBranch,
    hasRemoteOrigin,
    behindCount,
    aheadCount,
    encodedBranchName,
    resolvedBranchName,
  }
}
