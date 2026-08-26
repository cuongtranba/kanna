import type { AgentProvider, ChatBackgroundTask, ChatRuntime } from "./types"
import type { ChatBranchHistorySnapshot, ChatDiffFile, ChatDiffSnapshot } from "./git-diff-types"

export type EqualityMap<T> = { [K in keyof Required<T>]: (a: T[K], b: T[K]) => boolean }

function strictEqual<T>(a: T, b: T): boolean {
  return a === b
}

function sameSessionTokensByProvider(
  a: Partial<Record<AgentProvider, string | null>>,
  b: Partial<Record<AgentProvider, string | null>>,
): boolean {
  const providers: AgentProvider[] = ["claude", "codex", "openrouter"]
  for (const key of providers) {
    if (a[key] !== b[key]) return false
  }
  return true
}

function sameBackgroundTasks(a: ChatBackgroundTask[], b: ChatBackgroundTask[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  return a.every((task, index) => {
    const other = b[index]
    return other !== undefined
      && task.id === other.id
      && task.taskType === other.taskType
      && task.description === other.description
      && task.startedAt === other.startedAt
  })
}

export const CHAT_RUNTIME_EQUALITY: EqualityMap<ChatRuntime> = {
  chatId: strictEqual,
  projectId: strictEqual,
  localPath: strictEqual,
  title: strictEqual,
  status: strictEqual,
  isDraining: strictEqual,
  provider: strictEqual,
  planMode: strictEqual,
  sessionTokensByProvider: sameSessionTokensByProvider,
  timings: () => true,
  policyOverride: () => true,
  sessionState: () => true,
  backgroundTasks: sameBackgroundTasks,
}

export function sameRuntime(a: ChatRuntime | null | undefined, b: ChatRuntime | null | undefined): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return CHAT_RUNTIME_EQUALITY.chatId(a.chatId, b.chatId)
    && CHAT_RUNTIME_EQUALITY.projectId(a.projectId, b.projectId)
    && CHAT_RUNTIME_EQUALITY.localPath(a.localPath, b.localPath)
    && CHAT_RUNTIME_EQUALITY.title(a.title, b.title)
    && CHAT_RUNTIME_EQUALITY.status(a.status, b.status)
    && CHAT_RUNTIME_EQUALITY.isDraining(a.isDraining, b.isDraining)
    && CHAT_RUNTIME_EQUALITY.provider(a.provider, b.provider)
    && CHAT_RUNTIME_EQUALITY.planMode(a.planMode, b.planMode)
    && CHAT_RUNTIME_EQUALITY.sessionTokensByProvider(a.sessionTokensByProvider, b.sessionTokensByProvider)
    && CHAT_RUNTIME_EQUALITY.timings(a.timings, b.timings)
    && CHAT_RUNTIME_EQUALITY.policyOverride(a.policyOverride, b.policyOverride)
    && CHAT_RUNTIME_EQUALITY.sessionState(a.sessionState, b.sessionState)
    && CHAT_RUNTIME_EQUALITY.backgroundTasks(a.backgroundTasks, b.backgroundTasks)
}

function sameDiffFiles(a: ChatDiffFile[], b: ChatDiffFile[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  return a.every((file, index) => {
    const other = b[index]
    return Boolean(other)
      && file.path === other!.path
      && file.changeType === other!.changeType
      && file.isUntracked === other!.isUntracked
      && file.additions === other!.additions
      && file.deletions === other!.deletions
      && file.patchDigest === other!.patchDigest
      && file.mimeType === other!.mimeType
      && file.size === other!.size
  })
}

function sameBranchHistory(
  a: ChatBranchHistorySnapshot | undefined,
  b: ChatBranchHistorySnapshot | undefined,
): boolean {
  const leftHistory = a?.entries ?? []
  const rightHistory = b?.entries ?? []
  if (leftHistory.length !== rightHistory.length) return false
  return leftHistory.every((entry, index) => {
    const other = rightHistory[index]
    return Boolean(other)
      && entry.sha === other!.sha
      && entry.summary === other!.summary
      && entry.description === other!.description
      && entry.authorName === other!.authorName
      && entry.authoredAt === other!.authoredAt
      && entry.githubUrl === other!.githubUrl
      && entry.tags.length === other!.tags.length
      && entry.tags.every((tag, tagIndex) => tag === other!.tags[tagIndex])
  })
}

export const CHAT_DIFF_SNAPSHOT_EQUALITY: EqualityMap<ChatDiffSnapshot> = {
  status: strictEqual,
  files: sameDiffFiles,
  branchHistory: sameBranchHistory,
  branchName: strictEqual,
  defaultBranchName: strictEqual,
  hasOriginRemote: strictEqual,
  originRepoSlug: strictEqual,
  hasUpstream: strictEqual,
  aheadCount: strictEqual,
  behindCount: strictEqual,
  lastFetchedAt: strictEqual,
}

export function sameDiffs(
  a: ChatDiffSnapshot | null | undefined,
  b: ChatDiffSnapshot | null | undefined,
): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return CHAT_DIFF_SNAPSHOT_EQUALITY.status(a.status, b.status)
    && CHAT_DIFF_SNAPSHOT_EQUALITY.files(a.files, b.files)
    && CHAT_DIFF_SNAPSHOT_EQUALITY.branchHistory(a.branchHistory, b.branchHistory)
    && CHAT_DIFF_SNAPSHOT_EQUALITY.branchName(a.branchName, b.branchName)
    && CHAT_DIFF_SNAPSHOT_EQUALITY.defaultBranchName(a.defaultBranchName, b.defaultBranchName)
    && CHAT_DIFF_SNAPSHOT_EQUALITY.hasOriginRemote(a.hasOriginRemote, b.hasOriginRemote)
    && CHAT_DIFF_SNAPSHOT_EQUALITY.originRepoSlug(a.originRepoSlug, b.originRepoSlug)
    && CHAT_DIFF_SNAPSHOT_EQUALITY.hasUpstream(a.hasUpstream, b.hasUpstream)
    && CHAT_DIFF_SNAPSHOT_EQUALITY.aheadCount(a.aheadCount, b.aheadCount)
    && CHAT_DIFF_SNAPSHOT_EQUALITY.behindCount(a.behindCount, b.behindCount)
    && CHAT_DIFF_SNAPSHOT_EQUALITY.lastFetchedAt(a.lastFetchedAt, b.lastFetchedAt)
}
