import { AGENT_PROVIDERS } from "./core-types"
import type {
  AgentProvider,
  ChatAttachment,
  ChatBackgroundTask,
  ChatRuntime,
  ChatSnapshot,
  CloudflareTunnelRecord,
  ProviderCatalogEntry,
  QueuedChatMessage,
} from "./types"
import type { ChatBranchHistorySnapshot, ChatDiffFile, ChatDiffSnapshot } from "./git-diff-types"

export type EqualityMap<T> = { [K in keyof Required<T>]: (a: T[K], b: T[K]) => boolean }

function strictEqual<T>(a: T, b: T): boolean {
  return a === b
}

function isPlainFieldRecord<V>(value: V): value is V & object {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function sameFieldValue<V>(left: V, right: V): boolean {
  if (Object.is(left, right)) return true
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, index) => sameFieldValue(item, right[index]))
  }
  if (isPlainFieldRecord(left) && isPlainFieldRecord(right)) return sameFields(left, right)
  return false
}

export function sameFields<T extends object>(left: T, right: T, ignoredKeys: readonly string[] = []): boolean {
  if (left === right) return true
  let leftCount = 0
  for (const key in left) {
    if (ignoredKeys.includes(key)) continue
    leftCount += 1
    if (!(key in right) || !sameFieldValue(left[key], right[key])) return false
  }
  let rightCount = 0
  for (const key in right) {
    if (!ignoredKeys.includes(key)) rightCount += 1
  }
  return leftCount === rightCount
}

function sameByMap<T extends object>(map: EqualityMap<T>, a: T, b: T): boolean {
  for (const key in map) {
    if (!map[key](a[key], b[key])) return false
  }
  return true
}

function sameSessionTokensByProvider(
  a: Partial<Record<AgentProvider, string | null>>,
  b: Partial<Record<AgentProvider, string | null>>,
): boolean {
  return AGENT_PROVIDERS.every((provider) => a[provider] === b[provider])
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
  return sameByMap(CHAT_RUNTIME_EQUALITY, a, b)
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
  return sameByMap(CHAT_DIFF_SNAPSHOT_EQUALITY, a, b)
}

function sameTranscriptEntries(left: ChatSnapshot["messages"] | null | undefined, right: ChatSnapshot["messages"] | null | undefined) {
  if (left === right) return true
  if (!left || !right) return false
  if (left.length !== right.length) return false
  return left.every((entry, index) => entry._id === right[index]?._id)
}

function sameProviders(left: ProviderCatalogEntry[] | null | undefined, right: ProviderCatalogEntry[] | null | undefined) {
  if (left === right) return true
  if (!left || !right) return false
  if (left.length !== right.length) return false
  return left.every((provider, index) => provider.id === right[index]?.id)
}

function sameHistory(left: ChatSnapshot["history"] | null | undefined, right: ChatSnapshot["history"] | null | undefined) {
  if (left === right) return true
  if (!left || !right) return false
  return left.hasOlder === right.hasOlder
    && left.olderCursor === right.olderCursor
    && left.recentLimit === right.recentLimit
}

function sameQueuedMessage(left: QueuedChatMessage, right: QueuedChatMessage) {
  return left.id === right.id
    && left.content === right.content
    && left.createdAt === right.createdAt
    && left.provider === right.provider
    && left.model === right.model
    && left.planMode === right.planMode
    && JSON.stringify(left.modelOptions) === JSON.stringify(right.modelOptions)
    && sameAttachmentArray(left.attachments, right.attachments)
}

function sameAttachmentArray(left: ChatAttachment[], right: ChatAttachment[]) {
  if (left === right) return true
  if (left.length !== right.length) return false
  return left.every((attachment, index) => {
    const other = right[index]
    return Boolean(other)
      && attachment.id === other.id
      && attachment.kind === other.kind
      && attachment.displayName === other.displayName
      && attachment.absolutePath === other.absolutePath
      && attachment.relativePath === other.relativePath
      && attachment.contentUrl === other.contentUrl
      && attachment.mimeType === other.mimeType
      && attachment.size === other.size
  })
}

function sameQueuedMessages(left: ChatSnapshot["queuedMessages"] | null | undefined, right: ChatSnapshot["queuedMessages"] | null | undefined) {
  if (left === right) return true
  if (!left || !right) return false
  if (left.length !== right.length) return false
  return left.every((message, index) => sameQueuedMessage(message, right[index]!))
}

function sameSchedules(left: ChatSnapshot["schedules"] | null | undefined, right: ChatSnapshot["schedules"] | null | undefined) {
  if (left === right) return true
  if (!left || !right) return false
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  if (leftKeys.length !== rightKeys.length) return false
  return leftKeys.every((key) => {
    const l = left[key]
    const r = right[key]
    if (!l || !r) return false
    return l.state === r.state
      && l.scheduledAt === r.scheduledAt
      && l.resetAt === r.resetAt
      && l.detectedAt === r.detectedAt
      && l.tz === r.tz
  })
}

function sameTunnels(left: Record<string, CloudflareTunnelRecord> | null | undefined, right: Record<string, CloudflareTunnelRecord> | null | undefined) {
  if (left === right) return true
  if (!left || !right) return false
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  if (leftKeys.length !== rightKeys.length) return false
  return leftKeys.every((key) => {
    const l = left[key]
    const r = right[key]
    if (!l || !r) return false
    return l.state === r.state
      && l.url === r.url
      && l.error === r.error
      && l.port === r.port
      && l.activatedAt === r.activatedAt
      && l.stoppedAt === r.stoppedAt
  })
}

function sameSubagentRuns(
  left: ChatSnapshot["subagentRuns"] | null | undefined,
  right: ChatSnapshot["subagentRuns"] | null | undefined,
) {
  if (left === right) return true
  if (!left || !right) return false
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  if (leftKeys.length !== rightKeys.length) return false
  return leftKeys.every((key) => {
    const l = left[key]
    const r = right[key]
    if (!l || !r) return false
    return l.status === r.status
      && l.entries.length === r.entries.length
      && (l.finalText ?? "") === (r.finalText ?? "")
      && (l.pendingTool?.toolUseId ?? null) === (r.pendingTool?.toolUseId ?? null)
      && (l.usage?.outputTokens ?? null) === (r.usage?.outputTokens ?? null)
      && l.finishedAt === r.finishedAt
      && (l.error?.code ?? null) === (r.error?.code ?? null)
  })
}

function sameLoopProgress(
  left: ChatSnapshot["loopProgress"],
  right: ChatSnapshot["loopProgress"],
) {
  if (left === right) return true
  if (left.armed !== right.armed) return false
  if (left.rows.length !== right.rows.length) return false
  const rowsMatch = left.rows.every((l, i) => {
    const r = right.rows[i]
    return r != null && l.runId === r.runId && l.status === r.status && l.label === r.label
  })
  if (!rowsMatch) return false
  const lr = left.rateLimit
  const rr = right.rateLimit
  if ((lr == null) !== (rr == null)) return false
  if (lr && rr) return lr.resetAt === rr.resetAt && lr.scheduled === rr.scheduled
  return true
}

export function sameChatSnapshotCore(left: ChatSnapshot | null, right: ChatSnapshot | null) {
  if (left === right) return true
  if (!left || !right) return false
  return sameRuntime(left.runtime, right.runtime)
    && sameQueuedMessages(left.queuedMessages, right.queuedMessages)
    && sameTranscriptEntries(left.messages, right.messages)
    && sameHistory(left.history, right.history)
    && sameProviders(left.availableProviders, right.availableProviders)
    && sameSchedules(left.schedules, right.schedules)
    && left.liveScheduleId === right.liveScheduleId
    && sameTunnels(left.tunnels, right.tunnels)
    && left.liveTunnelId === right.liveTunnelId
    && sameSubagentRuns(left.subagentRuns, right.subagentRuns)
    && sameLoopProgress(left.loopProgress, right.loopProgress)
}
