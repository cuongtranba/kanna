
import path from "node:path"
import type { AgentProvider, QueuedChatMessage, StackBinding } from "../shared/types"
import { STORE_VERSION } from "../shared/types"
import { GLOBAL_PROMPT_APPEND_MAX_CHARS } from "../shared/app-settings-types"
import type { ChatPermissionPolicyOverride, ToolRequest, ToolRequestDecision, ToolRequestStatus } from "../shared/permission-policy"
import type {
  ChatEvent,
  ChatRecord,
  ProjectEvent,
  ProjectRecord,
  QueuedMessageEvent,
  StackEvent,
  StackRecord,
  StoreState,
  ToolRequestEvent,
  TurnEvent,
  TurnRunConfig,
} from "./events"
import { resolveLocalPath } from "./paths"


function requireChat(chatsById: Map<string, ChatRecord>, chatId: string): ChatRecord {
  const chat = chatsById.get(chatId)
  if (!chat || chat.deletedAt) throw new Error("Chat not found")
  return chat
}


export type OpenProjectResult =
  | { kind: "existing"; project: ProjectRecord }
  | { kind: "new"; event: Extract<ProjectEvent, { type: "project_opened" }> }

export function buildOpenProjectResult(
  state: Pick<StoreState, "projectsById" | "projectIdsByPath">,
  localPath: string,
  title?: string,
): OpenProjectResult {
  const normalized = resolveLocalPath(localPath)
  const existingId = state.projectIdsByPath.get(normalized)
  if (existingId) {
    const existing = state.projectsById.get(existingId)
    if (existing && !existing.deletedAt) return { kind: "existing", project: existing }
  }
  const hiddenProject = [...state.projectsById.values()]
    .find((p) => p.localPath === normalized && p.deletedAt)
  const projectId = hiddenProject?.id ?? crypto.randomUUID()
  const event: Extract<ProjectEvent, { type: "project_opened" }> = {
    v: STORE_VERSION,
    type: "project_opened",
    timestamp: Date.now(),
    projectId,
    localPath: normalized,
    title: title?.trim() || path.basename(normalized) || normalized,
  }
  return { kind: "new", event }
}

export function buildRemoveProjectEvent(
  projectsById: Map<string, { id: string; deletedAt?: number }>,
  projectId: string,
): ProjectEvent {
  const project = projectsById.get(projectId)
  if (!project || project.deletedAt) throw new Error("Project not found")
  return { v: STORE_VERSION, type: "project_removed", timestamp: Date.now(), projectId }
}

export function buildSetProjectStarEvent(
  projectsById: Map<string, { id: string; deletedAt?: number }>,
  projectId: string,
  starred: boolean,
): ProjectEvent {
  const project = projectsById.get(projectId)
  if (!project || project.deletedAt) throw new Error("Project not found")
  const now = Date.now()
  return {
    v: STORE_VERSION,
    type: "project_star_set",
    timestamp: now,
    projectId,
    starredAt: starred ? now : null,
  }
}


export function buildCreateStackEvent(
  state: Pick<StoreState, "projectsById" | "stacksById">,
  title: string,
  projectIds: string[],
): StackEvent & { stackId: string } {
  const trimmed = title.trim()
  if (trimmed === "") throw new Error("Stack title cannot be empty")
  if (projectIds.length < 2) throw new Error("Stack requires at least 2 projects")
  if (new Set(projectIds).size !== projectIds.length) throw new Error("Stack projectIds contain duplicates")
  for (const id of projectIds) {
    const project = state.projectsById.get(id)
    if (!project || project.deletedAt) throw new Error(`Project not found: ${id}`)
  }
  const stackId = crypto.randomUUID()
  return {
    v: STORE_VERSION,
    type: "stack_added",
    timestamp: Date.now(),
    stackId,
    title: trimmed,
    projectIds: [...projectIds],
  }
}

export function buildRenameStackEvent(
  stacksById: Map<string, StackRecord>,
  stackId: string,
  title: string,
): StackEvent | null {
  const stack = stacksById.get(stackId)
  if (!stack || stack.deletedAt) throw new Error("Stack not found")
  const trimmed = title.trim()
  if (trimmed === "") throw new Error("Stack title cannot be empty")
  if (trimmed === stack.title) return null
  return { v: STORE_VERSION, type: "stack_renamed", timestamp: Date.now(), stackId, title: trimmed }
}

function normalizeInstructionsEdit(current: string | undefined, next: string): string | null {
  const trimmed = next.trim()
  if (trimmed.length > GLOBAL_PROMPT_APPEND_MAX_CHARS) {
    throw new Error(`instructions must be ${GLOBAL_PROMPT_APPEND_MAX_CHARS} characters or fewer`)
  }
  if (trimmed === (current ?? "")) return null
  return trimmed
}

export function buildSetProjectInstructionsEvent(
  projectsById: Map<string, ProjectRecord>,
  projectId: string,
  instructions: string,
): ProjectEvent | null {
  const project = projectsById.get(projectId)
  if (!project || project.deletedAt) throw new Error("Project not found")
  const next = normalizeInstructionsEdit(project.instructions, instructions)
  if (next === null) return null
  return { v: STORE_VERSION, type: "project_instructions_set", timestamp: Date.now(), projectId, instructions: next }
}

export function buildSetStackInstructionsEvent(
  stacksById: Map<string, StackRecord>,
  stackId: string,
  instructions: string,
): StackEvent | null {
  const stack = stacksById.get(stackId)
  if (!stack || stack.deletedAt) throw new Error("Stack not found")
  const next = normalizeInstructionsEdit(stack.instructions, instructions)
  if (next === null) return null
  return { v: STORE_VERSION, type: "stack_instructions_set", timestamp: Date.now(), stackId, instructions: next }
}

export function buildRemoveStackEvent(
  stacksById: Map<string, StackRecord>,
  stackId: string,
): StackEvent | null {
  const stack = stacksById.get(stackId)
  if (!stack) throw new Error("Stack not found")
  if (stack.deletedAt) return null
  return { v: STORE_VERSION, type: "stack_removed", timestamp: Date.now(), stackId }
}

export function buildAddProjectToStackEvent(
  state: Pick<StoreState, "projectsById" | "stacksById">,
  stackId: string,
  projectId: string,
): StackEvent | null {
  const stack = state.stacksById.get(stackId)
  if (!stack || stack.deletedAt) throw new Error("Stack not found")
  const project = state.projectsById.get(projectId)
  if (!project || project.deletedAt) throw new Error("Project not found")
  if (stack.projectIds.includes(projectId)) return null
  return { v: STORE_VERSION, type: "stack_project_added", timestamp: Date.now(), stackId, projectId }
}

export function buildRemoveProjectFromStackEvent(
  stacksById: Map<string, StackRecord>,
  stackId: string,
  projectId: string,
): StackEvent | null {
  const stack = stacksById.get(stackId)
  if (!stack || stack.deletedAt) throw new Error("Stack not found")
  if (!stack.projectIds.includes(projectId)) return null
  if (stack.projectIds.length <= 2) {
    throw new Error("Stack must keep at least 2 projects. Delete the stack instead.")
  }
  return { v: STORE_VERSION, type: "stack_project_removed", timestamp: Date.now(), stackId, projectId }
}


export function computeNewSidebarOrder(
  projectsById: Map<string, { deletedAt?: number }>,
  currentOrder: string[],
  requestedIds: string[],
): string[] | null {
  const valid = requestedIds.filter((id) => {
    const p = projectsById.get(id)
    return Boolean(p && !p.deletedAt)
  })
  const unique = [...new Set(valid)]
  if (
    unique.length === currentOrder.length
    && unique.every((id, i) => currentOrder[i] === id)
  ) {
    return null
  }
  return unique
}


export function buildCreateChatEvent(
  state: Pick<StoreState, "projectsById" | "stacksById">,
  projectId: string,
  options?: { stackId?: string; stackBindings?: StackBinding[] },
): ChatEvent & { chatId: string } {
  const project = state.projectsById.get(projectId)
  if (!project || project.deletedAt) throw new Error("Project not found")

  if (options?.stackId !== undefined && options.stackBindings === undefined) {
    throw new Error("stackId requires stackBindings")
  }

  if (options?.stackBindings !== undefined) {
    const stack = options.stackId === undefined ? null : state.stacksById.get(options.stackId)
    if (options.stackId !== undefined && (!stack || stack.deletedAt)) throw new Error("Stack not found")
    if (options.stackBindings.length === 0) throw new Error("stackBindings cannot be empty")
    const primaries = options.stackBindings.filter((b) => b.role === "primary")
    if (primaries.length !== 1) throw new Error("Exactly one primary binding required")
    const seenProjects = new Set<string>()
    for (const binding of options.stackBindings) {
      if (seenProjects.has(binding.projectId)) throw new Error("Duplicate projectId in stackBindings")
      seenProjects.add(binding.projectId)
      if (stack && !stack.projectIds.includes(binding.projectId)) {
        throw new Error(`Binding projectId not a member of stack: ${binding.projectId}`)
      }
      const peer = state.projectsById.get(binding.projectId)
      if (!peer || peer.deletedAt) throw new Error(`Project not found: ${binding.projectId}`)
      if (typeof binding.worktreePath !== "string" || binding.worktreePath.trim() === "") {
        throw new Error("worktreePath must be a non-empty string")
      }
    }
    if (primaries[0].projectId !== projectId) {
      throw new Error("Primary binding projectId must match createChat projectId")
    }
  }

  const chatId = crypto.randomUUID()
  return {
    v: STORE_VERSION,
    type: "chat_created",
    timestamp: Date.now(),
    chatId,
    projectId,
    title: "New Chat",
    ...(options?.stackId !== undefined ? { stackId: options.stackId } : {}),
    ...(options?.stackBindings !== undefined
      ? { stackBindings: options.stackBindings.map((b) => ({ ...b })) }
      : {}),
  }
}

export function buildRenameChatEvent(
  chatsById: Map<string, ChatRecord>,
  chatId: string,
  title: string,
): ChatEvent | null {
  const trimmed = title.trim()
  if (!trimmed) return null
  const chat = requireChat(chatsById, chatId)
  if (chat.title === trimmed) return null
  return { v: STORE_VERSION, type: "chat_renamed", timestamp: Date.now(), chatId, title: trimmed }
}

export function buildArchiveChatEvent(chatsById: Map<string, ChatRecord>, chatId: string): ChatEvent {
  requireChat(chatsById, chatId)
  return { v: STORE_VERSION, type: "chat_archived", timestamp: Date.now(), chatId }
}

export function buildUnarchiveChatEvent(chatsById: Map<string, ChatRecord>, chatId: string): ChatEvent {
  requireChat(chatsById, chatId)
  return { v: STORE_VERSION, type: "chat_unarchived", timestamp: Date.now(), chatId }
}


export function buildChatProviderEvent(
  chatsById: Map<string, ChatRecord>,
  chatId: string,
  provider: AgentProvider,
): ChatEvent | null {
  const chat = requireChat(chatsById, chatId)
  if (chat.provider === provider) return null
  return { v: STORE_VERSION, type: "chat_provider_set", timestamp: Date.now(), chatId, provider }
}

export function buildPlanModeEvent(
  chatsById: Map<string, ChatRecord>,
  chatId: string,
  planMode: boolean,
): ChatEvent | null {
  const chat = requireChat(chatsById, chatId)
  if (chat.planMode === planMode) return null
  return { v: STORE_VERSION, type: "chat_plan_mode_set", timestamp: Date.now(), chatId, planMode }
}

export function buildCompactFailuresEvent(
  chatsById: Map<string, ChatRecord>,
  chatId: string,
  compactFailureCount: number,
): ChatEvent | null {
  const chat = requireChat(chatsById, chatId)
  if ((chat.compactFailureCount ?? 0) === compactFailureCount) return null
  return {
    v: STORE_VERSION, type: "chat_compact_failures_set", timestamp: Date.now(),
    chatId, compactFailureCount,
  }
}

export function buildChatReadStateEvent(
  chatsById: Map<string, ChatRecord>,
  chatId: string,
  unread: boolean,
): ChatEvent | null {
  const chat = requireChat(chatsById, chatId)
  if (chat.unread === unread) return null
  return { v: STORE_VERSION, type: "chat_read_state_set", timestamp: Date.now(), chatId, unread }
}

export function buildChatPolicyOverrideEvent(
  chatsById: Map<string, ChatRecord>,
  chatId: string,
  policyOverride: ChatPermissionPolicyOverride | null,
): ChatEvent {
  requireChat(chatsById, chatId)
  return {
    v: STORE_VERSION, type: "chat_policy_override_set", timestamp: Date.now(),
    chatId, policyOverride,
  }
}

export function buildChatSourceHashEvent(
  chatsById: Map<string, ChatRecord>,
  chatId: string,
  sourceHash: string | null,
): ChatEvent | null {
  const chat = requireChat(chatsById, chatId)
  if (chat.sourceHash === sourceHash) return null
  return { v: STORE_VERSION, type: "chat_source_hash_set", timestamp: Date.now(), chatId, sourceHash }
}


export function buildEnqueueMessageResult(
  chatsById: Map<string, ChatRecord>,
  chatId: string,
  message: Omit<QueuedChatMessage, "id" | "createdAt"> & Partial<Pick<QueuedChatMessage, "id" | "createdAt">>,
): { event: QueuedMessageEvent; queuedMessage: QueuedChatMessage } {
  requireChat(chatsById, chatId)
  const queuedMessage: QueuedChatMessage = {
    ...message,
    id: message.id ?? crypto.randomUUID(),
    attachments: [...(message.attachments ?? [])],
    createdAt: message.createdAt ?? Date.now(),
  }
  const event: QueuedMessageEvent = {
    v: STORE_VERSION,
    type: "queued_message_enqueued",
    timestamp: queuedMessage.createdAt,
    chatId,
    message: queuedMessage,
  }
  return { event, queuedMessage }
}

export function buildRemoveQueuedMessageEvent(
  chatsById: Map<string, ChatRecord>,
  queuedMessagesByChatId: Map<string, QueuedChatMessage[]>,
  chatId: string,
  queuedMessageId: string,
): QueuedMessageEvent {
  requireChat(chatsById, chatId)
  const existing = queuedMessagesByChatId.get(chatId) ?? []
  if (!existing.some((e) => e.id === queuedMessageId)) throw new Error("Queued message not found")
  return {
    v: STORE_VERSION, type: "queued_message_removed",
    timestamp: Date.now(), chatId, queuedMessageId,
  }
}


export function buildTurnStartedEvent(
  chatsById: Map<string, ChatRecord>,
  chatId: string,
  runConfig?: TurnRunConfig,
): TurnEvent {
  requireChat(chatsById, chatId)
  return {
    v: STORE_VERSION, type: "turn_started", timestamp: Date.now(),
    chatId, ...(runConfig ? { runConfig } : {}),
  }
}

export function buildTurnFinishedEvent(chatsById: Map<string, ChatRecord>, chatId: string): TurnEvent {
  requireChat(chatsById, chatId)
  return { v: STORE_VERSION, type: "turn_finished", timestamp: Date.now(), chatId }
}

export function buildTurnFailedEvent(
  chatsById: Map<string, ChatRecord>,
  chatId: string,
  error: string,
): TurnEvent {
  requireChat(chatsById, chatId)
  return { v: STORE_VERSION, type: "turn_failed", timestamp: Date.now(), chatId, error }
}

export function buildTurnCancelledEvent(chatsById: Map<string, ChatRecord>, chatId: string): TurnEvent {
  requireChat(chatsById, chatId)
  return { v: STORE_VERSION, type: "turn_cancelled", timestamp: Date.now(), chatId }
}

export function buildSessionTokenEvent(
  chatsById: Map<string, ChatRecord>,
  chatId: string,
  provider: AgentProvider,
  sessionToken: string | null,
): TurnEvent | null {
  const chat = requireChat(chatsById, chatId)
  if ((chat.sessionTokensByProvider[provider] ?? null) === sessionToken) return null
  return {
    v: STORE_VERSION, type: "session_token_set", timestamp: Date.now(),
    chatId, sessionToken, provider,
  }
}

export function buildPendingForkSessionTokenEvent(
  chatsById: Map<string, ChatRecord>,
  chatId: string,
  value: { provider: AgentProvider; token: string } | null,
): TurnEvent | null {
  const chat = requireChat(chatsById, chatId)
  const current = chat.pendingForkSessionToken ?? null
  const same =
    (current == null && value == null)
    || (current != null && value != null
      && current.provider === value.provider
      && current.token === value.token)
  if (same) return null
  return {
    v: STORE_VERSION, type: "pending_fork_session_token_set", timestamp: Date.now(),
    chatId,
    pendingForkSessionToken: value?.token ?? null,
    provider: value?.provider,
  }
}


export function buildPutToolRequestEvent(req: ToolRequest): ToolRequestEvent {
  return { v: 3, type: "tool_request_put", timestamp: Date.now(), request: req }
}

export function buildResolveToolRequestEvent(
  toolRequestsById: Map<string, ToolRequest>,
  id: string,
  args: {
    status: ToolRequestStatus
    decision?: ToolRequestDecision
    resolvedAt: number
    mismatchReason?: string
  },
): ToolRequestEvent {
  if (!toolRequestsById.has(id)) throw new Error(`resolveToolRequest: unknown id ${id}`)
  return {
    v: 3,
    type: "tool_request_resolved",
    timestamp: Date.now(),
    id,
    status: args.status,
    decision: args.decision,
    resolvedAt: args.resolvedAt,
    mismatchReason: args.mismatchReason,
  }
}


export type { ProjectRecord } from "./events"
