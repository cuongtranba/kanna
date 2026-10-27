import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react"
import { useShallow } from "zustand/react/shallow"
import { type AgentProvider, type AskUserQuestionAnswerMap, type ChatAttachment, type ChatDiffSnapshot, type ModelOptions, type ProviderCatalogEntry, type QueuedChatMessage, type TranscriptEntry, type UserPromptEntry } from "../../shared/types"
import { NEW_CHAT_COMPOSER_ID, useChatPreferencesStore } from "../stores/chatPreferencesStore"
import { DEFAULT_EDITOR_PRESET, getEditorPresetLabel } from "../stores/terminalPreferencesStore"
import { useAppSettingsStore } from "../stores/appSettingsStore"
import { useChatInputStore } from "../stores/chatInputStore"
import { useSlashCommandsStore } from "../stores/slashCommandsStore"
import { usePreferencesStore } from "../stores/preferences"
import type { ChatSnapshot, ProjectCommandsSnapshot, AskUserQuestionItem } from "../../shared/types"
import type { ChatOpsEvent } from "../../shared/chat-ops"
import { processTranscriptMessages } from "../lib/parseTranscript"
import { generateUUID } from "../lib/utils"
import { reportCommandFailure, surfaceCommandError, withCommandFeedback } from "../lib/commandFeedback"
import { onRejected, toError } from "../../shared/errors"
import { getLatestToolIds, isActiveChatStatus, isPrimaryChatInstance } from "./derived"
import type { ToolRequestDecision } from "../../shared/permission-policy"
import { useWorkflowsStore } from "../stores/workflowsStore"
import { useLiveBlockStore } from "../stores/liveBlockStore"
import { opsSettleLiveBlock } from "../../shared/live-block"
import { useOpenRouterModelsStore } from "../stores/openrouterModelsStore"
import { gitSnapshotKey, useKannaStateStore } from "../stores/kannaStateStore"
import { useChatStateStore, selectChatSlice } from "../stores/chatStateStore"
import type { ChatLiveEvent, WorkflowsSnapshot } from "../../shared/protocol"
import { encodeAskUserQuestionResult } from "../lib/askUserQuestionJson"
import type { DomPort } from "../ports/domPort"
import type { TimerPort } from "../ports/timerPort"
import { domAdapter } from "../adapters/dom.adapter"
import { timerAdapter } from "../adapters/timer.adapter"
import { getProjectIdForChat, type AppGlobalState } from "./useAppGlobalState"
import { fromSendOptions } from "../lib/composerSendOptions"
import { sendToStartingProfiler } from "./sendToStartingProfiler"
import { useProviderCatalog, withOpenRouterModels } from "./useProviderCatalog"
import { sameChatSnapshotCore } from "../../shared/equality"
import { useAppGlobalContext } from "./AppGlobalProvider"

export {
  applySidebarProjectOrder,
  getProjectIdForChat,
  resolveComposeIntent,
} from "./useAppGlobalState"
export type { StartChatIntent } from "./useAppGlobalState"

export function applyProjectCommandsSnapshot(
  subscribedProjectId: string,
  snapshot: ProjectCommandsSnapshot | null,
): void {
  if (!snapshot || snapshot.projectId !== subscribedProjectId) return
  useSlashCommandsStore.getState().setForProject(snapshot.projectId, snapshot.commands)
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
  if (chatSnapshot.runtime.chatId !== activeChatId) return null
  return chatSnapshot
}

export interface KannaState extends AppGlobalState {
  activeChatId: string | null
  activeProjectId: string | null
  chatSnapshot: ChatSnapshot | null
  chatDiffSnapshot: ChatDiffSnapshot | null
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
  loadOlderHistory: () => Promise<void>
  handleSend: (content: string, options?: { provider?: AgentProvider; model?: string; modelOptions?: ModelOptions; planMode?: boolean; attachments?: ChatAttachment[] }) => Promise<void>
  handleSteerQueuedMessage: (queuedMessageId: string) => Promise<void>
  handleRemoveQueuedMessage: (queuedMessageId: string) => Promise<void>
  handleCancel: () => Promise<void>
  handleStopDraining: () => Promise<void>
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
  dom?: DomPort
  timer?: TimerPort
}

export function useKannaState(activeChatId: string | null, ports: KannaStatePorts = {}): KannaState {
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
  const draftChatIds = useChatInputStore(useShallow((state) => Object.keys(state.drafts).sort()))
  const attachmentDraftChatIds = useChatInputStore(
    useShallow((state) => Object.keys(state.attachmentDrafts).sort())
  )
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
  const fallbackProviders = useProviderCatalog()
  const baseAvailableProviders = activeChatSnapshot?.availableProviders ?? fallbackProviders
  const openrouterModels = useOpenRouterModelsStore(useShallow((s) => s.models))
  const availableProviders = useMemo(
    () => withOpenRouterModels(baseAvailableProviders, openrouterModels),
    [baseAvailableProviders, openrouterModels],
  )
  const isProcessing = isActiveChatStatus(effectiveRuntimeStatus)
  const canCancel = isProcessing
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
    void socket.command({ type: "chat.setDraftProtection", chatIds: protectedChatIds }).catch(onRejected(reportCommandFailure))
  }, [attachmentDraftChatIds, connectionStatus, draftChatIds, socket])

  useEffect(() => {
    if (!activeChatId) return

    const chatId = activeChatId
    return acquireChatSubscription(`${chatId}:${chatResyncNonce}`, () => {
    useChatStateStore.getState().setChatSnapshot(activeChatId, null)
    useChatStateStore.getState().setChatReady(activeChatId, false)
    const unsubscribe = socket.subscribe<ChatSnapshot | null, ChatOpsEvent | ChatLiveEvent>({ type: "chat", chatId: activeChatId, recentLimit: INITIAL_CHAT_RECENT_LIMIT }, (snapshot) => {
      if (snapshot?.runtime.chatId) {
        sendToStartingProfiler.mark(snapshot.runtime.chatId, "chat_snapshot_received", {
          status: snapshot.runtime.status,
          messageCount: snapshot.messages.length,
        })
      }
      useChatStateStore.getState().setChatSnapshot(activeChatId, (current) => {
        const reused = sameChatSnapshotCore(current, snapshot)
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
      if (event.type === "chat.live") {
        if (event.chatId === activeChatId) useLiveBlockStore.getState().setLiveBlock(activeChatId, event.block)
        return
      }
      if (event.type !== "chat.ops" || event.chatId !== activeChatId) return
      const result = useChatStateStore.getState().applyChatOpsEvent(activeChatId, event)
      if (result === "gap") {
        useChatStateStore.getState().bumpChatResyncNonce(activeChatId)
      } else if (opsSettleLiveBlock(event.ops)) useLiveBlockStore.getState().setLiveBlock(activeChatId, null)
    })
    return () => {
      unsubscribe()
      useLiveBlockStore.getState().setLiveBlock(activeChatId, null)
    }
    })
  }, [activeChatId, socket, chatResyncNonce])

  useEffect(() => {
    if (!activeChatId) return
    return socket.subscribe<WorkflowsSnapshot>({ type: "workflows", chatId: activeChatId }, (snapshot) => {
      useWorkflowsStore.getState().setRuns(snapshot.chatId, snapshot.runs)
    })
  }, [activeChatId, socket])

  useEffect(() => {
    if (!activeChatId) return
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
    void socket.command({ type: "chat.markRead", chatId: activeChatId }).catch(onRejected(reportCommandFailure))
  }, [activeChatId, appGlobal.routeChatId, appGlobal.sidebarReady, dom, focusEpoch, sidebarProjectGroups, socket])



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
    if (!activeChatId || runtime?.status !== "starting") return
    sendToStartingProfiler.mark(activeChatId, "runtime_status_starting", { status: runtime.status })
  }, [activeChatId, runtime?.status])

  useEffect(() => {
    if (!activeChatId || !runtime || runtime.status === "starting") return
    sendToStartingProfiler.end(activeChatId, "starting_not_observed", { status: runtime.status })
  }, [activeChatId, runtime])

  useLayoutEffect(() => {
    if (!activeChatId || runtime?.status !== "starting") return
    sendToStartingProfiler.end(activeChatId, "starting_render_committed")
  }, [activeChatId, runtime?.status])

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
    await surfaceCommandError(async () => {
      const page = await socket.command({
        type: "chat.loadHistory",
        chatId: activeChatId,
        beforeCursor: historyCursor,
        limit: CHAT_HISTORY_PAGE_SIZE,
      })
      const chatStore = useChatStateStore.getState()
      chatStore.setOlderHistoryEntries(activeChatId, (current) => mergeTranscriptEntries(page.messages, current))
      chatStore.setHistoryCursor(activeChatId, page.olderCursor)
      chatStore.setHasOlderHistory(activeChatId, page.hasOlder)
    })
    useChatStateStore.getState().setIsHistoryLoading(activeChatId, false)
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
    sendToStartingProfiler.begin({
      traceId: clientTraceId,
      chatId: activeChatId,
      details: {
        optimisticScopeId,
        attachments: attachments.length,
        contentLength: content.length,
        contentPreview: content.slice(0, 80),
      },
    })
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
    sendToStartingProfiler.note(clientTraceId, "optimistic_prompt_added", { optimisticId, optimisticScopeId })

    try {
      let projectId = selectedProjectId ?? sidebarProjectGroups[0]?.groupKey ?? null
      if (!activeChatId && !projectId && fallbackLocalProjectPath) {
        const project = await socket.command({
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
      const result = await socket.command({
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

      if (result.queued) {
        useKannaStateStore.getState().setOptimisticUserPrompts((current) => pruneOptimisticOnQueuedAck(current, optimisticId, { queued: true }))
        useChatStateStore.getState().setOptimisticProcessing(optimisticScopeId, null)
      } else if (!activeChatId) {
        useChatStateStore.getState().setOptimisticProcessing(optimisticScopeId, null)
        useChatStateStore.getState().setOptimisticProcessing(result.chatId, { ackedAt: performance.now() })
      } else {
        useChatStateStore.getState().setOptimisticProcessing(optimisticScopeId, (current) => (
          current ? { ackedAt: performance.now() } : current
        ))
      }
      sendToStartingProfiler.acknowledge(clientTraceId, result.chatId, { queued: result.queued ?? false })

      if (!activeChatId) {
        useKannaStateStore.getState().setOptimisticUserPrompts((current) => current.map((prompt) => (
          prompt.id === optimisticId ? { ...prompt, scopeId: result.chatId } : prompt
        )))
        const chatPreferences = useChatPreferencesStore.getState()
        chatPreferences.setComposerState(
          result.chatId,
          fromSendOptions(options) ?? chatPreferences.getComposerState(NEW_CHAT_COMPOSER_ID)
        )
        useKannaStateStore.getState().setPendingChatId(result.chatId)
        appGlobal.chatNavigator.openChat(result.chatId)
      }
      useKannaStateStore.getState().setCommandError(null)
    } catch (error) {
      useKannaStateStore.getState().setOptimisticUserPrompts((current) => current.filter((prompt) => prompt.id !== optimisticId))
      useChatStateStore.getState().setOptimisticProcessing(optimisticScopeId, null)
      const failure = toError(error)
      sendToStartingProfiler.fail(clientTraceId, failure.message)
      reportCommandFailure(failure)
      throw error
    }
  }, [activeChatId, appGlobal.chatNavigator, fallbackLocalProjectPath, optimisticScopeId, optimisticUserPrompts, selectedProjectId, serverTranscriptEntries, sidebarProjectGroups, socket])

  const handleSteerQueuedMessage = useCallback(async (queuedMessageId: string) => {
    if (!activeChatId) return
    useChatStateStore.getState().setOptimisticProcessing(activeChatId, { ackedAt: null })
    try {
      await withCommandFeedback(() => socket.command({
        type: "message.steer",
        chatId: activeChatId,
        queuedMessageId,
      }))
      useChatStateStore.getState().setOptimisticProcessing(activeChatId, (current) => (
        current ? { ackedAt: performance.now() } : current
      ))
    } catch {
      useChatStateStore.getState().setOptimisticProcessing(activeChatId, null)
    }
  }, [activeChatId, socket])

  const handleRemoveQueuedMessage = useCallback(async (queuedMessageId: string) => {
    if (!activeChatId) return
    await surfaceCommandError(() => socket.command({
      type: "message.dequeue",
      chatId: activeChatId,
      queuedMessageId,
    }))
  }, [activeChatId, socket])

  const handleCancel = useCallback(async () => {
    if (!activeChatId) return
    await surfaceCommandError(() => socket.command({ type: "chat.cancel", chatId: activeChatId }))
  }, [activeChatId, socket])

  const handleStopDraining = useCallback(async () => {
    if (!activeChatId) return
    await surfaceCommandError(() => socket.command({ type: "chat.stopDraining", chatId: activeChatId }))
  }, [activeChatId, socket])

  const handleAskUserQuestion = useCallback(async (
    toolUseId: string,
    questions: AskUserQuestionItem[],
    answers: AskUserQuestionAnswerMap
  ) => {
    if (!activeChatId) return
    await withCommandFeedback(() => socket.command({
      type: "chat.respondTool",
      chatId: activeChatId,
      toolUseId,
      result: encodeAskUserQuestionResult(questions, answers),
    }))
  }, [activeChatId, socket])

  const handleExitPlanMode = useCallback(async (toolUseId: string, confirmed: boolean, clearContext?: boolean, message?: string) => {
    if (!activeChatId) return
    if (confirmed) {
      useChatPreferencesStore.getState().setChatComposerPlanMode(activeChatId, false)
    }
    await surfaceCommandError(() => socket.command({
      type: "chat.respondTool",
      chatId: activeChatId,
      toolUseId,
      result: {
        confirmed,
        ...(clearContext ? { clearContext: true } : {}),
        ...(message ? { message } : {}),
      },
    }))
  }, [activeChatId, socket])

  const handleSubagentAskUserQuestion = useCallback(async (
    runId: string,
    toolUseId: string,
    questions: AskUserQuestionItem[],
    answers: AskUserQuestionAnswerMap,
  ) => {
    if (!activeChatId) return
    await surfaceCommandError(() => socket.command({
      type: "chat.respondSubagentTool",
      chatId: activeChatId,
      runId,
      toolUseId,
      result: encodeAskUserQuestionResult(questions, answers),
    }))
  }, [activeChatId, socket])

  const handleSubagentExitPlanMode = useCallback(async (
    runId: string,
    toolUseId: string,
    response: { confirmed: boolean; clearContext?: boolean; message?: string },
  ) => {
    if (!activeChatId) return
    await surfaceCommandError(() => socket.command({
      type: "chat.respondSubagentTool",
      chatId: activeChatId,
      runId,
      toolUseId,
      result: response,
    }))
  }, [activeChatId, socket])

  const handleToolRequestAnswer = useCallback(async (toolRequestId: string, decision: ToolRequestDecision) => {
    if (!activeChatId) return
    await surfaceCommandError(() => socket.command({
      type: "chat.toolRequestAnswer",
      chatId: activeChatId,
      toolRequestId,
      decision,
    }))
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
