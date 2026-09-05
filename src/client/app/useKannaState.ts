import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react"
import { useShallow } from "zustand/react/shallow"
import { PROVIDERS, type AgentProvider, type AppSettingsPatch, type AskUserQuestionAnswerMap, type ChatAttachment, type ChatDiffSnapshot, type ChatHistoryPage, type ClaudeAuthSettings, type CloudflareTunnelSettings, type GitWorktree, type KeybindingsSnapshot, type LocalProjectsSnapshot, type LlmProviderSnapshot, type LlmProviderValidationResult, type ModelOptions, type OpenRouterModel, type ProviderCatalogEntry, type PushConfigSnapshot, type QueuedChatMessage, type SidebarChatRow, type SidebarData, type StackSummary, type TranscriptEntry, type UpdateSnapshot, type UserPromptEntry } from "../../shared/types"
import { NEW_CHAT_COMPOSER_ID, type ComposerState, useChatPreferencesStore } from "../stores/chatPreferencesStore"
import { DEFAULT_EDITOR_PRESET, getEditorPresetLabel } from "../stores/terminalPreferencesStore"
import { useAppSettingsStore } from "../stores/appSettingsStore"
import { useChatInputStore } from "../stores/chatInputStore"
import { useSlashCommandsStore } from "../stores/slashCommandsStore"
import { usePreferencesStore } from "../stores/preferences"
import type { ChatSnapshot, CloudflareTunnelRecord, ProjectCommandsSnapshot } from "../../shared/types"
import type { ChatOpsEvent } from "../../shared/chat-ops"
import type { AskUserQuestionItem } from "../components/messages/types"
import type { OpenLocalLinkTarget } from "../components/messages/shared"
import { processTranscriptMessages } from "../lib/parseTranscript"
import { generateUUID } from "../lib/utils"
import { canCancelStatus, getLatestToolIds, isPrimaryChatInstance, isProcessingStatus } from "./derived"
import type { KannaSocket, SocketStatus } from "./socket"
import type { ChatPermissionPolicyOverride, ToolRequestDecision } from "../../shared/permission-policy"
import { useWorkflowsStore } from "../stores/workflowsStore"
import { useOpenRouterModelsStore } from "../stores/openrouterModelsStore"
import { gitSnapshotKey, useKannaStateStore } from "../stores/kannaStateStore"
import { useChatStateStore, selectChatSlice } from "../stores/chatStateStore"
import type { EditorOpenSettings, ImportSessionsByIdsResult, OpenExternalAction, WorkflowsSnapshot } from "../../shared/protocol"
import { log } from "../../shared/log"
import type { JsonObject, JsonValue } from "../../shared/json"
import { encodeAskUserQuestionResult } from "../lib/askUserQuestionJson"
import type { StoragePort } from "../ports/storagePort"
import type { DomPort } from "../ports/domPort"
import type { TimerPort } from "../ports/timerPort"
import { localStorageAdapter, sessionStorageAdapter } from "../adapters/storage.adapter"
import { domAdapter } from "../adapters/dom.adapter"
import { timerAdapter } from "../adapters/timer.adapter"
import { getProjectIdForChat, type ProjectRequest } from "./useAppGlobalState"
import { sameRuntime } from "../../shared/equality"
import { useAppGlobalContext } from "./AppGlobalProvider"
import type { ChatNavigatorPort } from "./chatNavigator"

export {
  applySidebarProjectOrder,
  getNewestRemainingChatId,
  getProjectIdForChat,
  getUiUpdateRestartReconnectAction,
  deriveUiRestartActivity,
  shouldHandleUiUpdateReloadRequest,
  getUiUpdateReadinessPath,
  resolveComposeIntent,
} from "./useAppGlobalState"
export type { UiRestartActivity, ProjectRequest, StartChatIntent } from "./useAppGlobalState"

function sameTranscriptEntries(left: ChatSnapshot["messages"] | null | undefined, right: ChatSnapshot["messages"] | null | undefined) {
  if (left === right) return true
  if (!left || !right) return false
  if (left.length !== right.length) return false
  return left.every((entry, index) => entry._id === right[index]?._id)
}

function mergeOpenRouterModels(
  providers: ProviderCatalogEntry[],
  models: OpenRouterModel[],
): ProviderCatalogEntry[] {
  if (models.length === 0) return providers
  return providers.map((entry) => {
    if (entry.id !== "openrouter") return entry
    return {
      ...entry,
      models: models.map((m) => ({
        id: m.id,
        label: m.label,
      })),
    }
  })
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

export function applyProjectCommandsSnapshot(
  subscribedProjectId: string,
  snapshot: ProjectCommandsSnapshot | null,
): void {
  if (!snapshot || snapshot.projectId !== subscribedProjectId) return
  useSlashCommandsStore.getState().setForProject(snapshot.projectId, snapshot.commands)
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

function mergeTranscriptEntries(olderHistoryEntries: TranscriptEntry[], recentEntries: TranscriptEntry[]) {
  const deduped = new Map<string, TranscriptEntry>()
  for (const entry of olderHistoryEntries) {
    deduped.set(entry._id, entry)
  }
  for (const entry of recentEntries) {
    deduped.set(entry._id, entry)
  }
  return [...deduped.values()]
}

export function getPreviousPrompt(messages: ReturnType<typeof processTranscriptMessages>) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.kind === "user_prompt" && message.content.trim().length > 0) {
      return message.content
    }
  }
  return null
}

const NEW_CHAT_OPTIMISTIC_SCOPE = "__new_chat__"

export interface OptimisticUserPrompt {
  id: string
  scopeId: string
  signature: string
  requiredMatchCount: number
  entry: UserPromptEntry
}

function serializeAttachmentSignature(attachment: ChatAttachment) {
  return JSON.stringify({
    id: attachment.id,
    kind: attachment.kind,
    displayName: attachment.displayName,
    relativePath: attachment.relativePath,
    mimeType: attachment.mimeType,
    size: attachment.size,
    contentUrl: attachment.contentUrl,
  })
}

export function getUserPromptSignature(content: string, attachments: ChatAttachment[] = []) {
  return JSON.stringify({
    content,
    attachments: attachments.map(serializeAttachmentSignature),
  })
}

export function countMatchingUserPrompts(entries: TranscriptEntry[], signature: string) {
  return entries.reduce((count, entry) => {
    if (entry.kind !== "user_prompt") return count
    return count + (getUserPromptSignature(entry.content, entry.attachments ?? []) === signature ? 1 : 0)
  }, 0)
}

export function reconcileOptimisticUserPrompts(
  optimisticPrompts: OptimisticUserPrompt[],
  scopeId: string,
  serverEntries: TranscriptEntry[],
) {
  const matchCounts = new Map<string, number>()
  for (const entry of serverEntries) {
    if (entry.kind !== "user_prompt") continue
    const signature = getUserPromptSignature(entry.content, entry.attachments ?? [])
    matchCounts.set(signature, (matchCounts.get(signature) ?? 0) + 1)
  }

  return optimisticPrompts.filter((prompt) => {
    if (prompt.scopeId !== scopeId) return true
    return (matchCounts.get(prompt.signature) ?? 0) < prompt.requiredMatchCount
  })
}

export function pruneOptimisticOnQueuedAck(
  optimisticPrompts: OptimisticUserPrompt[],
  optimisticId: string,
  ack: { queued?: boolean },
): OptimisticUserPrompt[] {
  if (!ack.queued) return optimisticPrompts
  if (!optimisticPrompts.some((prompt) => prompt.id === optimisticId)) return optimisticPrompts
  return optimisticPrompts.filter((prompt) => prompt.id !== optimisticId)
}

const INITIAL_CHAT_RECENT_LIMIT = 200
const CHAT_HISTORY_PAGE_SIZE = 500

export function shouldMarkActiveChatRead(dom?: Pick<DomPort, "getVisibilityState" | "hasFocus">) {
  const d = dom ?? domAdapter
  return d.getVisibilityState() === "visible" && d.hasFocus()
}


function logKannaState(message: string, details?: JsonValue) {
  void message
  void details
}

const liveChatSubscriptions = new Map<string, { count: number; unsubscribe: () => void }>()

function chatIdOfSubscriptionKey(key: string): string {
  const separator = key.lastIndexOf(":")
  return separator === -1 ? key : key.slice(0, separator)
}

function hasLiveSubscriptionForChat(chatId: string): boolean {
  for (const key of liveChatSubscriptions.keys()) {
    if (chatIdOfSubscriptionKey(key) === chatId) return true
  }
  return false
}

function acquireChatSubscription(key: string, create: () => () => void): () => void {
  const existing = liveChatSubscriptions.get(key)
  if (existing) {
    existing.count += 1
  } else {
    liveChatSubscriptions.set(key, { count: 1, unsubscribe: create() })
  }

  let released = false
  return () => {
    if (released) return
    released = true
    const entry = liveChatSubscriptions.get(key)
    if (!entry) return
    entry.count -= 1
    if (entry.count > 0) return
    liveChatSubscriptions.delete(key)
    entry.unsubscribe()

    const chatId = chatIdOfSubscriptionKey(key)
    queueMicrotask(() => {
      if (hasLiveSubscriptionForChat(chatId)) return
      useChatStateStore.getState().releaseChat(chatId)
    })
  }
}

export const __testing = {
  acquireChatSubscription,
  hasLiveSubscriptionForChat,
}

const SEND_TO_STARTING_PROFILE_STORAGE_KEY = "kanna:profile-send-to-starting"

interface SendToStartingTrace {
  traceId: string
  optimisticId: string
  startedAt: number
  serverChatId: string | null
  routeChatIdAtSend: string | null
  contentPreview: string
  ackAt?: number
  snapshotAt?: number
  startingStatusAt?: number
  startingRenderedAt?: number
}

function isSendToStartingProfilingEnabled(
  sessStore: StoragePort,
  localStore: StoragePort,
) {
  try {
    return sessStore.getItem(SEND_TO_STARTING_PROFILE_STORAGE_KEY) === "1"
      || localStore.getItem(SEND_TO_STARTING_PROFILE_STORAGE_KEY) === "1"
  } catch {
    return false
  }
}

function elapsedTraceMs(startedAt: number) {
  return Number((performance.now() - startedAt).toFixed(1))
}

function logSendToStartingTrace(
  trace: SendToStartingTrace | null | undefined,
  stage: string,
  details?: JsonObject,
  session: StoragePort = sessionStorageAdapter,
  local: StoragePort = localStorageAdapter,
) {
  if (!trace || !isSendToStartingProfilingEnabled(session, local)) {
    return
  }

  log.debug("[kanna/send->starting][client]", {
    traceId: trace.traceId,
    stage,
    elapsedMs: elapsedTraceMs(trace.startedAt),
    serverChatId: trace.serverChatId,
    routeChatIdAtSend: trace.routeChatIdAtSend,
    ...details,
  })
}

function composerStateFromSendOptions(options?: {
  provider?: AgentProvider
  model?: string
  modelOptions?: ModelOptions
  planMode?: boolean
}): ComposerState | null {
  if (options?.provider === "claude" && options.model && options.modelOptions?.claude) {
    return {
      provider: "claude",
      model: options.model,
      modelOptions: {
        reasoningEffort: options.modelOptions.claude.reasoningEffort ?? "high",
        contextWindow: options.modelOptions.claude.contextWindow ?? "200k",
      },
      planMode: Boolean(options.planMode),
    }
  }

  if (options?.provider === "codex" && options.model && options.modelOptions?.codex) {
    return {
      provider: "codex",
      model: options.model,
      modelOptions: {
        reasoningEffort: options.modelOptions.codex.reasoningEffort ?? "high",
        fastMode: options.modelOptions.codex.fastMode ?? false,
      },
      planMode: Boolean(options.planMode),
    }
  }

  return null
}

export function shouldAutoFollowTranscript(distanceFromBottom: number) {
  return distanceFromBottom < 24
}

export const TRANSCRIPT_PADDING_BOTTOM_OFFSET = 30

export function getTranscriptPaddingBottom(inputHeight: number) {
  return inputHeight + TRANSCRIPT_PADDING_BOTTOM_OFFSET
}

export function getNextMeasuredInputHeight(previousHeight: number, measuredHeight: number) {
  return measuredHeight > 0 ? measuredHeight : previousHeight
}

export function getActiveChatSnapshot(chatSnapshot: ChatSnapshot | null, activeChatId: string | null): ChatSnapshot | null {
  if (!chatSnapshot) return null
  if (!activeChatId) return null
  if (chatSnapshot.runtime.chatId !== activeChatId) {
    logKannaState("stale snapshot masked", {
      routeChatId: activeChatId,
      snapshotChatId: chatSnapshot.runtime.chatId,
      snapshotProvider: chatSnapshot.runtime.provider,
    })
    return null
  }
  return chatSnapshot
}

export interface KannaState {
  socket: KannaSocket
  activeChatId: string | null
  activeProjectId: string | null
  sidebarData: SidebarData
  localProjects: LocalProjectsSnapshot | null
  updateSnapshot: UpdateSnapshot | null
  chatSnapshot: ChatSnapshot | null
  chatDiffSnapshot: ChatDiffSnapshot | null
  keybindings: KeybindingsSnapshot | null
  pushConfig: PushConfigSnapshot | null
  llmProvider: LlmProviderSnapshot | null
  connectionStatus: SocketStatus
  sidebarReady: boolean
  uiRestartActive: boolean
  uiRestartLabel: string
  localProjectsReady: boolean
  commandError: string | null
  startingLocalPath: string | null
  sidebarOpen: boolean
  sidebarCollapsed: boolean
  messages: ReturnType<typeof processTranscriptMessages>
  queuedMessages: QueuedChatMessage[]
  previousPrompt: string | null
  latestToolIds: ReturnType<typeof getLatestToolIds>
  runtime: ChatSnapshot["runtime"] | null
  runtimeStatus: string | null
  isHistoryLoading: boolean
  hasOlderHistory: boolean
  availableProviders: ProviderCatalogEntry[]
  isProcessing: boolean
  canCancel: boolean
  isDraining: boolean
  navbarLocalPath?: string
  editorLabel: string
  hasSelectedProject: boolean
  addProjectModalOpen: boolean
  openSidebar: () => void
  closeSidebar: () => void
  collapseSidebar: () => void
  expandSidebar: () => void
  openAddProjectModal: () => void
  closeAddProjectModal: () => void
  loadOlderHistory: () => Promise<void>
  handleCreateChat: (projectId: string) => Promise<void>
  handleForkChat: (chat: SidebarChatRow) => Promise<void>
  handleOpenLocalProject: (localPath: string) => Promise<void>
  handleCreateProject: (project: ProjectRequest) => Promise<void>
  handleCheckForUpdates: (options?: { force?: boolean }) => Promise<void>
  handleInstallUpdate: (version?: string) => Promise<void>
  handleForceReload: () => Promise<void>
  handleReadAppSettings: () => Promise<void>
  handleWriteAppSettings: (patch: AppSettingsPatch) => Promise<void>
  handleTestMcpServer: (id: string) => Promise<void>
  handleStartMcpOAuth: (id: string) => Promise<{ ok: boolean; authorizationUrl?: string; alreadyAuthenticated?: boolean; error?: string }>
  handleCompleteMcpOAuth: (id: string, callbackUrl: string) => Promise<{ ok: boolean; error?: string }>
  handleSetChatPolicyOverride: (chatId: string, policyOverride: ChatPermissionPolicyOverride | null) => Promise<void>
  handleWriteCloudflareTunnel: (patch: Partial<CloudflareTunnelSettings>) => Promise<void>
  handleWriteClaudeAuth: (patch: Partial<ClaudeAuthSettings>) => Promise<void>
  handleTestOAuthToken: (token: string) => Promise<{ ok: boolean; error: string | null }>
  handleReadLlmProvider: () => Promise<void>
  handleWriteLlmProvider: (value: Pick<LlmProviderSnapshot, "provider" | "apiKey" | "model" | "baseUrl">) => Promise<void>
  handleValidateLlmProvider: (value: Pick<LlmProviderSnapshot, "provider" | "apiKey" | "model" | "baseUrl">) => Promise<LlmProviderValidationResult>
  handleSignOut: () => Promise<void>
  handleSend: (content: string, options?: { provider?: AgentProvider; model?: string; modelOptions?: ModelOptions; planMode?: boolean; attachments?: ChatAttachment[] }) => Promise<void>
  handleSteerQueuedMessage: (queuedMessageId: string) => Promise<void>
  handleRemoveQueuedMessage: (queuedMessageId: string) => Promise<void>
  handleCancel: () => Promise<void>
  handleStopDraining: () => Promise<void>
  handleRenameChat: (chat: SidebarChatRow) => Promise<void>
  handleArchiveChat: (chat: SidebarChatRow) => Promise<void>
  handleOpenArchivedChat: (chatId: string) => Promise<void>
  handleDeleteChat: (chat: SidebarChatRow) => Promise<void>
  handleDeleteBulkChats: (chatIds: string[]) => Promise<void>
  handleHideProject: (projectId: string) => Promise<void>
  handleToggleProjectStar: (projectId: string, starred: boolean) => Promise<void>
  handleReorderProjectGroups: (projectIds: string[]) => Promise<void>
  stacks: StackSummary[]
  handleSetProjectInstructions: (projectId: string, instructions: string) => Promise<void>
  handleCreateStack: (title: string, projectIds: string[]) => Promise<void>
  handleRenameStack: (stackId: string, title: string) => Promise<void>
  handleRemoveStack: (stackId: string) => Promise<void>
  handleAddProjectToStack: (stackId: string, projectId: string) => Promise<void>
  handleRemoveProjectFromStack: (stackId: string, projectId: string) => Promise<void>
  handleSetStackInstructions: (stackId: string, instructions: string) => Promise<void>
  handleCreateStackChat: (primaryProjectId: string, stackId: string, stackBindings: Array<{ projectId: string; worktreePath: string; role: "primary" | "additional" }>) => Promise<void>
  handleListStackWorktrees: (projectId: string) => Promise<GitWorktree[]>
  importClaudeSessions: () => Promise<{ imported: number; updated: number; skipped: number; failed: number; newProjects: number }>
  importClaudeSession: (sessionIds: string[]) => Promise<ImportSessionsByIdsResult>
  handleCopyPath: (localPath: string) => Promise<void>
  handleOpenExternal: (action: OpenExternalAction, editor?: EditorOpenSettings) => Promise<void>
  handleOpenExternalPath: (action: "open_finder" | "open_editor", localPath: string) => Promise<void>
  handleOpenLocalLink: (target: OpenLocalLinkTarget, action?: OpenExternalAction, editor?: EditorOpenSettings) => Promise<void>
  handleCompose: () => void
  chatNavigator: ChatNavigatorPort
  handleAskUserQuestion: (
    toolUseId: string,
    questions: AskUserQuestionItem[],
    answers: AskUserQuestionAnswerMap
  ) => Promise<void>
  handleExitPlanMode: (
    toolUseId: string,
    confirmed: boolean,
    clearContext?: boolean,
    message?: string
  ) => Promise<void>
  handleSubagentAskUserQuestion: (
    runId: string,
    toolUseId: string,
    questions: AskUserQuestionItem[],
    answers: AskUserQuestionAnswerMap,
  ) => Promise<void>
  handleSubagentExitPlanMode: (
    runId: string,
    toolUseId: string,
    response: { confirmed: boolean; clearContext?: boolean; message?: string },
  ) => Promise<void>
  handleToolRequestAnswer: (toolRequestId: string, decision: ToolRequestDecision) => Promise<void>
}

export interface KannaStatePorts {
  localStore?: StoragePort
  sessStore?: StoragePort
  dom?: DomPort
  timer?: TimerPort
}

export function useKannaState(activeChatId: string | null, ports: KannaStatePorts = {}): KannaState {
  const localStore = ports.localStore ?? localStorageAdapter
  const sessStore = ports.sessStore ?? sessionStorageAdapter
  const dom = ports.dom ?? domAdapter
  const timer = ports.timer ?? timerAdapter
  const appGlobal = useAppGlobalContext()
  const socket = appGlobal.socket
  const optimisticScopeId = activeChatId ?? NEW_CHAT_OPTIMISTIC_SCOPE


  const chatSnapshot = useChatStateStore((state) => selectChatSlice(state, activeChatId ?? "").chatSnapshot)
  const chatResyncNonce = useChatStateStore((state) => selectChatSlice(state, activeChatId ?? "").chatResyncNonce)
  const olderHistoryEntries = useChatStateStore((state) => selectChatSlice(state, activeChatId ?? "").olderHistoryEntries)
  const isHistoryLoading = useChatStateStore((state) => selectChatSlice(state, activeChatId ?? "").isHistoryLoading)
  const historyCursor = useChatStateStore((state) => selectChatSlice(state, activeChatId ?? "").historyCursor)
  const hasOlderHistory = useChatStateStore((state) => selectChatSlice(state, activeChatId ?? "").hasOlderHistory)
  const chatReady = useChatStateStore((state) => selectChatSlice(state, activeChatId ?? "").chatReady)
  const diffSnapshotsByKey = useKannaStateStore((state) => state.diffSnapshotsByKey)
  const selectedProjectId = useKannaStateStore((state) => state.selectedProjectId)
  const pendingChatId = useKannaStateStore((state) => state.pendingChatId)
  const optimisticUserPrompts = useKannaStateStore((state) => state.optimisticUserPrompts)
  const optimisticProcessing = useChatStateStore((state) => state.optimisticProcessing[optimisticScopeId] ?? null)
  const focusEpoch = useKannaStateStore((state) => state.focusEpoch)
  const sendToStartingProfilesRef = useRef<Map<string, SendToStartingTrace>>(new Map())
  const draftChatIds = useChatInputStore(useShallow((state) => Object.keys(state.drafts).sort()))
  const attachmentDraftChatIds = useChatInputStore(
    useShallow((state) => Object.keys(state.attachmentDrafts).sort())
  )
  const chatSubscriptionDebugRef = useRef(0)
  const lastStartingRenderedTraceIdRef = useRef<string | null>(null)
  const lastActiveProjectDiffRef = useRef<{ key: string | null; diffs: ChatDiffSnapshot | null }>({
    key: null,
    diffs: null,
  })
  const editorLabel = getEditorPresetLabel(useAppSettingsStore((s) => s.settings?.editor.preset ?? DEFAULT_EDITOR_PRESET))

  const activeChatSnapshot = useMemo(
    () => getActiveChatSnapshot(chatSnapshot, activeChatId),
    [activeChatId, chatSnapshot]
  )
  const runtime = activeChatSnapshot?.runtime ?? null

  const { connectionStatus } = appGlobal
  const sidebarProjectGroups = appGlobal.sidebarData.projectGroups
  const sidebarProjectGroupsForLogRef = useRef(sidebarProjectGroups)
  useLayoutEffect(() => {
    sidebarProjectGroupsForLogRef.current = sidebarProjectGroups
  })


  const activeProjectId = useMemo(
    () => activeChatSnapshot?.runtime.projectId
      ?? getProjectIdForChat(sidebarProjectGroups, activeChatId)
      ?? selectedProjectId,
    [activeChatId, activeChatSnapshot?.runtime.projectId, selectedProjectId, sidebarProjectGroups]
  )

  /* eslint-disable react-hooks/refs */
  const chatDiffSnapshot = useMemo(() => {
    const key = activeProjectId ? gitSnapshotKey(activeProjectId, activeChatId) : null
    const currentDiffs = key
      ? (diffSnapshotsByKey[key] ?? (activeProjectId ? diffSnapshotsByKey[activeProjectId] ?? null : null))
      : null
    if (key && currentDiffs) {
      lastActiveProjectDiffRef.current = { key, diffs: currentDiffs }
      return currentDiffs
    }

    if (key && lastActiveProjectDiffRef.current.key === key) {
      return lastActiveProjectDiffRef.current.diffs
    }

    return currentDiffs
  }, [activeChatId, activeProjectId, diffSnapshotsByKey])
  /* eslint-enable react-hooks/refs */

  const queuedMessages = activeChatSnapshot?.queuedMessages ?? []
  const optimisticRuntimeStatus = optimisticProcessing !== null && (!runtime || runtime.status === "idle")
    ? "starting"
    : null
  const effectiveRuntimeStatus = optimisticRuntimeStatus ?? runtime?.status ?? null
  const baseAvailableProviders = activeChatSnapshot?.availableProviders ?? PROVIDERS
  const openrouterModels = useOpenRouterModelsStore(useShallow((s) => s.models))
  const availableProviders = useMemo(
    () => mergeOpenRouterModels(baseAvailableProviders, openrouterModels),
    [baseAvailableProviders, openrouterModels],
  )
  const isProcessing = isProcessingStatus(effectiveRuntimeStatus ?? undefined)
  const canCancel = canCancelStatus(effectiveRuntimeStatus ?? undefined)
  const isDraining = runtime?.isDraining ?? false
  const fallbackLocalProjectPath = appGlobal.localProjects?.projects[0]?.localPath ?? null
  const navbarLocalPath =
    runtime?.localPath
    ?? fallbackLocalProjectPath
    ?? sidebarProjectGroups[0]?.localPath
  const hasSelectedProject = Boolean(
    selectedProjectId
    ?? runtime?.projectId
    ?? sidebarProjectGroups[0]?.groupKey
    ?? fallbackLocalProjectPath
  )


  useEffect(() => {
    if (connectionStatus !== "connected") return

    const protectedChatIds = [...new Set([...draftChatIds, ...attachmentDraftChatIds])].sort()
    void socket.command({ type: "chat.setDraftProtection", chatIds: protectedChatIds }).catch((error) => {
      useKannaStateStore.getState().setCommandError(error instanceof Error ? error.message : String(error))
    })
  }, [attachmentDraftChatIds, connectionStatus, draftChatIds, socket])

  useEffect(() => {
    if (!activeChatId) {
      logKannaState("clearing chat snapshot for non-chat route")
      return
    }

    const subscriptionId = ++chatSubscriptionDebugRef.current
    const chatId = activeChatId
    return acquireChatSubscription(`${chatId}:${chatResyncNonce}`, () => {
    logKannaState("subscribing to chat", {
      subscriptionId,
      activeChatId,
      sidebarProjectGroups: sidebarProjectGroupsForLogRef.current.length,
      sidebarChatCount: sidebarProjectGroupsForLogRef.current.reduce((count, group) => count + group.chats.length, 0),
    })
    useChatStateStore.getState().setChatSnapshot(activeChatId, null)
    useChatStateStore.getState().setChatReady(activeChatId, false)
    const unsubscribe = socket.subscribe<ChatSnapshot | null, ChatOpsEvent>({ type: "chat", chatId: activeChatId, recentLimit: INITIAL_CHAT_RECENT_LIMIT }, (snapshot) => {
      if (snapshot?.runtime.chatId) {
        const matchingTrace = [...sendToStartingProfilesRef.current.values()]
          .filter((trace) => trace.serverChatId === snapshot.runtime.chatId)
          .sort((left, right) => right.startedAt - left.startedAt)[0]
        if (matchingTrace && matchingTrace.snapshotAt === undefined) {
          matchingTrace.snapshotAt = performance.now()
          logSendToStartingTrace(matchingTrace, "chat_snapshot_received", {
            status: snapshot.runtime.status,
            messageCount: snapshot.messages.length,
          }, sessStore, localStore)
        }
      }
      useChatStateStore.getState().setChatSnapshot(activeChatId, (current) => {
        const reused = sameChatSnapshotCore(current, snapshot)
        logKannaState("chat snapshot received", {
          subscriptionId,
          activeChatId,
          snapshotChatId: snapshot?.runtime.chatId ?? null,
          snapshotProvider: snapshot?.runtime.provider ?? null,
          snapshotStatus: snapshot?.runtime.status ?? null,
          messageCount: snapshot?.messages.length ?? 0,
          diffStatus: null,
          diffFileCount: 0,
          reusedSnapshot: reused,
        })
        if (!reused) return snapshot
        if (current && snapshot && current.seq !== snapshot.seq) {
          return { ...current, seq: snapshot.seq }
        }
        return current
      })
      const chatStore = useChatStateStore.getState()
      chatStore.adoptServerHistory(activeChatId, {
        olderCursor: snapshot?.history.olderCursor ?? null,
        hasOlder: snapshot?.history.hasOlder ?? false,
      })
      chatStore.setChatReady(activeChatId, true)
      useKannaStateStore.getState().setCommandError(null)
    }, (event) => {
      if (event.type !== "chat.ops" || event.chatId !== activeChatId) return
      const result = useChatStateStore.getState().applyChatOpsEvent(activeChatId, event)
      if (result === "gap") {
        logKannaState("chat.ops gap — forcing resubscribe", { subscriptionId, activeChatId, fromSeq: event.fromSeq, toSeq: event.toSeq })
        useChatStateStore.getState().bumpChatResyncNonce(activeChatId)
      }
    })
    return () => {
      logKannaState("unsubscribing from chat", {
        subscriptionId,
        activeChatId,
        sidebarProjectGroups: sidebarProjectGroupsForLogRef.current.length,
        sidebarChatCount: sidebarProjectGroupsForLogRef.current.reduce((count, group) => count + group.chats.length, 0),
      })
      unsubscribe()
    }
    })
  }, [activeChatId, localStore, sessStore, socket, chatResyncNonce])

  useEffect(() => {
    if (!activeChatId) return
    return socket.subscribe<WorkflowsSnapshot>({ type: "workflows", chatId: activeChatId }, (snapshot) => {
      useWorkflowsStore.getState().setRuns(snapshot.chatId, snapshot.runs)
    })
  }, [activeChatId, socket])

  useEffect(() => {
    if (!activeChatId) {
      logKannaState("clearing chat snapshot for non-chat route")
      return
    }
    if (!isPrimaryChatInstance(activeChatId, appGlobal.routeChatId)) return
    if (!appGlobal.sidebarReady || !chatReady) return
    const exists = sidebarProjectGroups.some((group) => group.chats.some((chat) => chat.chatId === activeChatId))
    if (exists) {
      if (pendingChatId === activeChatId) {
        useKannaStateStore.getState().setPendingChatId(null)
      }
      return
    }
    if (pendingChatId === activeChatId) {
      return
    }
    appGlobal.chatNavigator.closeChat()
  }, [activeChatId, appGlobal.chatNavigator, appGlobal.routeChatId, appGlobal.sidebarReady, chatReady, pendingChatId, sidebarProjectGroups])

  useEffect(() => {
    if (!chatSnapshot) return
    if (!isPrimaryChatInstance(chatSnapshot.runtime.chatId, appGlobal.routeChatId)) return
    useKannaStateStore.getState().setSelectedProjectId(chatSnapshot.runtime.projectId)
    if (pendingChatId === chatSnapshot.runtime.chatId) {
      useKannaStateStore.getState().setPendingChatId(null)
    }
  }, [activeChatId, appGlobal.routeChatId, chatSnapshot, pendingChatId])

  useEffect(() => {
    if (!activeChatId || !appGlobal.sidebarReady) return
    if (!isPrimaryChatInstance(activeChatId, appGlobal.routeChatId)) return
    if (!shouldMarkActiveChatRead(dom)) return
    const activeSidebarChat = sidebarProjectGroups
      .flatMap((group) => group.chats)
      .find((chat) => chat.chatId === activeChatId)
    if (!activeSidebarChat?.unread) return
    void socket.command({ type: "chat.markRead", chatId: activeChatId }).catch((error) => {
      useKannaStateStore.getState().setCommandError(error instanceof Error ? error.message : String(error))
    })
  }, [activeChatId, appGlobal.routeChatId, appGlobal.sidebarReady, dom, focusEpoch, sidebarProjectGroups, socket])



  useEffect(() => {
    logKannaState("active snapshot resolved", {
      routeChatId: activeChatId,
      rawSnapshotChatId: chatSnapshot?.runtime.chatId ?? null,
      rawSnapshotProvider: chatSnapshot?.runtime.provider ?? null,
      activeSnapshotChatId: activeChatSnapshot?.runtime.chatId ?? null,
      activeSnapshotProvider: activeChatSnapshot?.runtime.provider ?? null,
      pendingChatId,
    })
  }, [activeChatId, activeChatSnapshot, chatSnapshot, pendingChatId])

  const serverTranscriptEntries = useMemo(
    () => mergeTranscriptEntries(olderHistoryEntries, activeChatSnapshot?.messages ?? []),
    [activeChatSnapshot?.messages, olderHistoryEntries]
  )
  const optimisticTranscriptEntries = useMemo(
    () => optimisticUserPrompts
      .filter((prompt) => prompt.scopeId === optimisticScopeId)
      .map((prompt) => prompt.entry),
    [optimisticScopeId, optimisticUserPrompts]
  )
  const transcriptEntries = useMemo(
    () => [...serverTranscriptEntries, ...optimisticTranscriptEntries],
    [optimisticTranscriptEntries, serverTranscriptEntries]
  )
  const messages = useMemo(() => processTranscriptMessages(transcriptEntries), [transcriptEntries])
  const previousPrompt = useMemo(() => getPreviousPrompt(messages), [messages])
  const latestToolIds = useMemo(() => getLatestToolIds(messages), [messages])

  useEffect(() => {
    if (!optimisticProcessing) {
      return
    }
    if (runtime?.status && runtime.status !== "idle") {
      useChatStateStore.getState().setOptimisticProcessing(optimisticScopeId, null)
    }
  }, [optimisticProcessing, optimisticScopeId, runtime?.status])

  useEffect(() => {
    if (!optimisticProcessing?.ackedAt) {
      return
    }
    if (runtime?.status && runtime.status !== "idle") {
      return
    }
    const ackedAt = optimisticProcessing.ackedAt
    const timeoutId = timer.setTimeout(() => {
      useChatStateStore.getState().setOptimisticProcessing(optimisticScopeId, (current) => (
        current?.ackedAt === ackedAt ? null : current
      ))
    }, 300)
    return () => timer.clearTimeout(timeoutId)
  }, [optimisticProcessing, optimisticScopeId, runtime?.status, timer])

  useEffect(() => {
    if (!activeChatId || runtime?.status !== "starting") {
      return
    }

    const matchingTrace = [...sendToStartingProfilesRef.current.values()]
      .filter((trace) => trace.serverChatId === activeChatId)
      .sort((left, right) => right.startedAt - left.startedAt)[0]
    if (!matchingTrace || matchingTrace.startingStatusAt !== undefined) {
      return
    }

    matchingTrace.startingStatusAt = performance.now()
    logSendToStartingTrace(matchingTrace, "runtime_status_starting", {
      status: runtime.status,
    }, sessStore, localStore)
  }, [activeChatId, localStore, runtime?.status, sessStore])

  useEffect(() => {
    if (!activeChatId || !runtime || runtime.status === "starting") {
      return
    }

    const matchingTrace = [...sendToStartingProfilesRef.current.values()]
      .filter((trace) => trace.serverChatId === activeChatId)
      .sort((left, right) => right.startedAt - left.startedAt)[0]
    if (!matchingTrace || matchingTrace.startingRenderedAt !== undefined) {
      return
    }

    logSendToStartingTrace(matchingTrace, "starting_not_observed", {
      status: runtime.status,
    }, sessStore, localStore)
    sendToStartingProfilesRef.current.delete(matchingTrace.traceId)
  }, [activeChatId, localStore, runtime, sessStore])

  useLayoutEffect(() => {
    if (!activeChatId || runtime?.status !== "starting") {
      lastStartingRenderedTraceIdRef.current = null
      return
    }

    const matchingTrace = [...sendToStartingProfilesRef.current.values()]
      .filter((trace) => trace.serverChatId === activeChatId)
      .sort((left, right) => right.startedAt - left.startedAt)[0]
    if (!matchingTrace) {
      return
    }

    if (lastStartingRenderedTraceIdRef.current === matchingTrace.traceId) {
      return
    }

    lastStartingRenderedTraceIdRef.current = matchingTrace.traceId
    matchingTrace.startingRenderedAt = performance.now()
    logSendToStartingTrace(matchingTrace, "starting_render_committed", {
      totalMs: elapsedTraceMs(matchingTrace.startedAt),
    }, sessStore, localStore)
    sendToStartingProfilesRef.current.delete(matchingTrace.traceId)
  }, [activeChatId, localStore, runtime?.status, sessStore])

  useEffect(() => {
    useKannaStateStore.getState().setOptimisticUserPrompts((current) => {
      const reconciled = reconcileOptimisticUserPrompts(current, optimisticScopeId, serverTranscriptEntries)
      if (reconciled.length === current.length && reconciled.every((prompt, index) => prompt === current[index])) {
        return current
      }
      return reconciled
    })
  }, [optimisticScopeId, serverTranscriptEntries])


  const loadOlderHistory = useCallback(async () => {
    if (!activeChatId || !historyCursor || isHistoryLoading || !hasOlderHistory) {
      return
    }

    useChatStateStore.getState().setIsHistoryLoading(activeChatId, true)
    try {
      const page = await socket.command<ChatHistoryPage>({
        type: "chat.loadHistory",
        chatId: activeChatId,
        beforeCursor: historyCursor,
        limit: CHAT_HISTORY_PAGE_SIZE,
      })
      const chatStore = useChatStateStore.getState()
      chatStore.setOlderHistoryEntries(activeChatId, (current) => mergeTranscriptEntries(page.messages, current))
      chatStore.setHistoryCursor(activeChatId, page.olderCursor)
      chatStore.setHasOlderHistory(activeChatId, page.hasOlder)
      useKannaStateStore.getState().setCommandError(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      useKannaStateStore.getState().setCommandError(message)
    } finally {
      useChatStateStore.getState().setIsHistoryLoading(activeChatId, false)
    }
  }, [activeChatId, hasOlderHistory, historyCursor, isHistoryLoading, socket])

  const handleSend = useCallback(async (
    content: string,
    options?: { provider?: AgentProvider; model?: string; modelOptions?: ModelOptions; planMode?: boolean; attachments?: ChatAttachment[] }
  ) => {
    const attachments = options?.attachments ?? []
    const optimisticId = generateUUID()
    const clientTraceId = generateUUID()
    const signature = getUserPromptSignature(content, attachments)
    useChatStateStore.getState().setOptimisticProcessing(optimisticScopeId, { ackedAt: null })
    const sendTrace: SendToStartingTrace = {
      traceId: clientTraceId,
      optimisticId,
      startedAt: performance.now(),
      serverChatId: activeChatId,
      routeChatIdAtSend: activeChatId,
      contentPreview: content.slice(0, 80),
    }
    sendToStartingProfilesRef.current.set(clientTraceId, sendTrace)
    logSendToStartingTrace(sendTrace, "handle_send_called", {
      optimisticScopeId,
      attachments: attachments.length,
      contentLength: content.length,
      contentPreview: sendTrace.contentPreview,
    }, sessStore, localStore)
    const requiredMatchCount = countMatchingUserPrompts(serverTranscriptEntries, signature)
      + optimisticUserPrompts.filter((prompt) => prompt.scopeId === optimisticScopeId && prompt.signature === signature).length
      + 1

    useKannaStateStore.getState().setOptimisticUserPrompts((current) => [...current, {
      id: optimisticId,
      scopeId: optimisticScopeId,
      signature,
      requiredMatchCount,
      entry: {
        _id: `optimistic:${optimisticId}`,
        kind: "user_prompt",
        content,
        attachments,
        createdAt: Date.now(),
      },
    }])
    logSendToStartingTrace(sendTrace, "optimistic_prompt_added", {
      optimisticId,
      optimisticScopeId,
    }, sessStore, localStore)

    try {
      let projectId = selectedProjectId ?? sidebarProjectGroups[0]?.groupKey ?? null
      if (!activeChatId && !projectId && fallbackLocalProjectPath) {
        const project = await socket.command<{ projectId: string }>({
          type: "project.open",
          localPath: fallbackLocalProjectPath,
        })
        projectId = project.projectId
        useKannaStateStore.getState().setSelectedProjectId(projectId)
      }

      if (!activeChatId && !projectId) {
        throw new Error("Open a project first")
      }

      const autoResumeOnRateLimit = usePreferencesStore.getState().autoResumeOnRateLimit
      const result = await socket.command<{ chatId?: string; queuedMessageId?: string; queued?: boolean }>({
        type: "chat.send",
        chatId: activeChatId ?? undefined,
        projectId: activeChatId ? undefined : projectId ?? undefined,
        clientTraceId,
        provider: options?.provider,
        content,
        attachments,
        model: options?.model,
        modelOptions: options?.modelOptions,
        planMode: options?.planMode,
        autoResumeOnRateLimit,
      })
      sendTrace.ackAt = performance.now()
      sendTrace.serverChatId = result.chatId ?? sendTrace.serverChatId

      if (result.queued) {
        useKannaStateStore.getState().setOptimisticUserPrompts((current) => pruneOptimisticOnQueuedAck(current, optimisticId, { queued: true }))
        useChatStateStore.getState().setOptimisticProcessing(optimisticScopeId, null)
      } else if (!activeChatId && result.chatId) {
        useChatStateStore.getState().setOptimisticProcessing(optimisticScopeId, null)
        useChatStateStore.getState().setOptimisticProcessing(result.chatId, { ackedAt: performance.now() })
      } else {
        useChatStateStore.getState().setOptimisticProcessing(optimisticScopeId, (current) => (
          current ? { ackedAt: performance.now() } : current
        ))
      }
      logSendToStartingTrace(sendTrace, "chat_send_ack_received", {
        resultChatId: result.chatId ?? null,
        queued: result.queued ?? false,
      }, sessStore, localStore)

      if (!activeChatId && result.chatId) {
        useKannaStateStore.getState().setOptimisticUserPrompts((current) => current.map((prompt) => (
          prompt.id === optimisticId ? { ...prompt, scopeId: result.chatId! } : prompt
        )))
        const chatPreferences = useChatPreferencesStore.getState()
        chatPreferences.setComposerState(
          result.chatId,
          composerStateFromSendOptions(options) ?? chatPreferences.getComposerState(NEW_CHAT_COMPOSER_ID)
        )
        useKannaStateStore.getState().setPendingChatId(result.chatId)
        appGlobal.chatNavigator.openChat(result.chatId)
      }
      useKannaStateStore.getState().setCommandError(null)
    } catch (error) {
      useKannaStateStore.getState().setOptimisticUserPrompts((current) => current.filter((prompt) => prompt.id !== optimisticId))
      useChatStateStore.getState().setOptimisticProcessing(optimisticScopeId, null)
      logSendToStartingTrace(sendTrace, "handle_send_failed", {
        error: error instanceof Error ? error.message : String(error),
      }, sessStore, localStore)
      sendToStartingProfilesRef.current.delete(clientTraceId)
      useKannaStateStore.getState().setCommandError(error instanceof Error ? error.message : String(error))
      throw error
    }
  }, [activeChatId, appGlobal.chatNavigator, fallbackLocalProjectPath, localStore, optimisticScopeId, optimisticUserPrompts, selectedProjectId, serverTranscriptEntries, sessStore, sidebarProjectGroups, socket])

  const handleSteerQueuedMessage = useCallback(async (queuedMessageId: string) => {
    if (!activeChatId) return
    useChatStateStore.getState().setOptimisticProcessing(activeChatId, { ackedAt: null })
    try {
      await socket.command({
        type: "message.steer",
        chatId: activeChatId,
        queuedMessageId,
      })
      useChatStateStore.getState().setOptimisticProcessing(activeChatId, (current) => (
        current ? { ackedAt: performance.now() } : current
      ))
      useKannaStateStore.getState().setCommandError(null)
    } catch (error) {
      useChatStateStore.getState().setOptimisticProcessing(activeChatId, null)
      useKannaStateStore.getState().setCommandError(error instanceof Error ? error.message : String(error))
    }
  }, [activeChatId, socket])

  const handleRemoveQueuedMessage = useCallback(async (queuedMessageId: string) => {
    if (!activeChatId) return
    try {
      await socket.command({
        type: "message.dequeue",
        chatId: activeChatId,
        queuedMessageId,
      })
      useKannaStateStore.getState().setCommandError(null)
    } catch (error) {
      useKannaStateStore.getState().setCommandError(error instanceof Error ? error.message : String(error))
    }
  }, [activeChatId, socket])

  const handleCancel = useCallback(async () => {
    if (!activeChatId) return
    try {
      await socket.command({ type: "chat.cancel", chatId: activeChatId })
    } catch (error) {
      useKannaStateStore.getState().setCommandError(error instanceof Error ? error.message : String(error))
    }
  }, [activeChatId, socket])

  const handleStopDraining = useCallback(async () => {
    if (!activeChatId) return
    try {
      await socket.command({ type: "chat.stopDraining", chatId: activeChatId })
    } catch (error) {
      useKannaStateStore.getState().setCommandError(error instanceof Error ? error.message : String(error))
    }
  }, [activeChatId, socket])

  const handleAskUserQuestion = useCallback(async (
    toolUseId: string,
    questions: AskUserQuestionItem[],
    answers: AskUserQuestionAnswerMap
  ) => {
    if (!activeChatId) return
    try {
      await socket.command({
        type: "chat.respondTool",
        chatId: activeChatId,
        toolUseId,
        result: encodeAskUserQuestionResult(questions, answers),
      })
    } catch (error) {
      useKannaStateStore.getState().setCommandError(error instanceof Error ? error.message : String(error))
      throw error
    }
  }, [activeChatId, socket])

  const handleExitPlanMode = useCallback(async (toolUseId: string, confirmed: boolean, clearContext?: boolean, message?: string) => {
    if (!activeChatId) return
    if (confirmed) {
      useChatPreferencesStore.getState().setChatComposerPlanMode(activeChatId, false)
    }
    try {
      await socket.command({
        type: "chat.respondTool",
        chatId: activeChatId,
        toolUseId,
        result: {
          confirmed,
          ...(clearContext ? { clearContext: true } : {}),
          ...(message ? { message } : {}),
        },
      })
    } catch (error) {
      useKannaStateStore.getState().setCommandError(error instanceof Error ? error.message : String(error))
    }
  }, [activeChatId, socket])

  const handleSubagentAskUserQuestion = useCallback(async (
    runId: string,
    toolUseId: string,
    questions: AskUserQuestionItem[],
    answers: AskUserQuestionAnswerMap,
  ) => {
    if (!activeChatId) return
    try {
      await socket.command({
        type: "chat.respondSubagentTool",
        chatId: activeChatId,
        runId,
        toolUseId,
        result: encodeAskUserQuestionResult(questions, answers),
      })
    } catch (error) {
      useKannaStateStore.getState().setCommandError(error instanceof Error ? error.message : String(error))
    }
  }, [activeChatId, socket])

  const handleSubagentExitPlanMode = useCallback(async (
    runId: string,
    toolUseId: string,
    response: { confirmed: boolean; clearContext?: boolean; message?: string },
  ) => {
    if (!activeChatId) return
    try {
      await socket.command({
        type: "chat.respondSubagentTool",
        chatId: activeChatId,
        runId,
        toolUseId,
        result: response,
      })
    } catch (error) {
      useKannaStateStore.getState().setCommandError(error instanceof Error ? error.message : String(error))
    }
  }, [activeChatId, socket])

  const handleToolRequestAnswer = useCallback(async (toolRequestId: string, decision: ToolRequestDecision) => {
    if (!activeChatId) return
    try {
      await socket.command({
        type: "chat.toolRequestAnswer",
        chatId: activeChatId,
        toolRequestId,
        decision,
      })
    } catch (error) {
      useKannaStateStore.getState().setCommandError(error instanceof Error ? error.message : String(error))
    }
  }, [activeChatId, socket])

  // eslint-disable-next-line react-hooks/refs
  return {
    ...appGlobal,
    activeChatId,
    activeProjectId,
    chatSnapshot,
    chatDiffSnapshot, // eslint-disable-line react-hooks/refs
    messages,
    queuedMessages,
    previousPrompt,
    latestToolIds,
    runtime,
    runtimeStatus: effectiveRuntimeStatus,
    isHistoryLoading,
    hasOlderHistory,
    availableProviders,
    isProcessing,
    canCancel,
    isDraining,
    navbarLocalPath,
    editorLabel,
    hasSelectedProject,
    loadOlderHistory,
    handleSend,
    handleSteerQueuedMessage,
    handleRemoveQueuedMessage,
    handleCancel,
    handleStopDraining,
    handleAskUserQuestion,
    handleExitPlanMode,
    handleSubagentAskUserQuestion,
    handleSubagentExitPlanMode,
    handleToolRequestAnswer,
  }
}
