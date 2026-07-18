/**
 * Pure event-builder functions for EventStore write operations.
 *
 * Each function validates its inputs (throwing on error), then constructs and
 * returns the event object that the EventStore should persist. Returning `null`
 * signals a no-op (state is already the desired value, so no event is needed).
 *
 * Extracted from event-store.ts to reduce file size. All functions are pure —
 * no IO, no side effects (side-effect seal: IO lives in *.adapter.ts files).
 */

import path from "node:path"
import type { AgentProvider, QueuedChatMessage, SlashCommand, StackBinding } from "../shared/types"
import { STORE_VERSION } from "../shared/types"
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
import { slashCommandsEqual } from "./event-store-helpers"

// ─── Internal helper ───────────────────────────────────────────────────────

function requireChat(chatsById: Map<string, ChatRecord>, chatId: string): ChatRecord {
  const chat = chatsById.get(chatId)
  if (!chat || chat.deletedAt) throw new Error("Chat not found")
  return chat
}

// ─── Project builders ─────────────────────────────────────────────────────

export type OpenProjectResult =
  | { kind: "existing"; project: ProjectRecord }
  | { kind: "new"; event: Extract<ProjectEvent, { type: "project_opened" }> }

/** Resolves an existing project or builds the `project_opened` event for a new one. */
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

/** Builds the `project_removed` event. Throws if the project is not found. */
export function buildRemoveProjectEvent(
  projectsById: Map<string, { id: string; deletedAt?: number }>,
  projectId: string,
): ProjectEvent {
  const project = projectsById.get(projectId)
  if (!project || project.deletedAt) throw new Error("Project not found")
  return { v: STORE_VERSION, type: "project_removed", timestamp: Date.now(), projectId }
}

/** Builds the `project_star_set` event. Throws if the project is not found. */
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

// ─── Stack builders ───────────────────────────────────────────────────────

/** Builds the `stack_added` event. Throws on invalid inputs. */
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

/** Builds the `stack_renamed` event, or `null` if the title is unchanged. Throws if not found. */
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

/** Builds the `stack_removed` event, or `null` if already deleted. Throws if not found. */
export function buildRemoveStackEvent(
  stacksById: Map<string, StackRecord>,
  stackId: string,
): StackEvent | null {
  const stack = stacksById.get(stackId)
  if (!stack) throw new Error("Stack not found")
  if (stack.deletedAt) return null
  return { v: STORE_VERSION, type: "stack_removed", timestamp: Date.now(), stackId }
}

/** Builds the `stack_project_added` event, or `null` if already a member. Throws if not found. */
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

/** Builds the `stack_project_removed` event, or `null` if not a member. Throws on constraint violations. */
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

// ─── Sidebar order ────────────────────────────────────────────────────────

/**
 * Computes the new de-duplicated + validated sidebar order.
 * Returns `null` if the order is unchanged (caller can skip the write).
 */
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

// ─── Chat lifecycle builders ───────────────────────────────────────────────

/** Builds the `chat_created` event after full validation. Throws on invalid inputs. */
export function buildCreateChatEvent(
  state: Pick<StoreState, "projectsById" | "stacksById">,
  projectId: string,
  options?: { stackId?: string; stackBindings?: StackBinding[] },
): ChatEvent & { chatId: string } {
  const project = state.projectsById.get(projectId)
  if (!project || project.deletedAt) throw new Error("Project not found")

  if (options?.stackId !== undefined || options?.stackBindings !== undefined) {
    if (options.stackId === undefined || options.stackBindings === undefined) {
      throw new Error("stackId and stackBindings must be provided together")
    }
    const stack = state.stacksById.get(options.stackId)
    if (!stack || stack.deletedAt) throw new Error("Stack not found")
    if (options.stackBindings.length === 0) throw new Error("stackBindings cannot be empty")
    const primaries = options.stackBindings.filter((b) => b.role === "primary")
    if (primaries.length !== 1) throw new Error("Exactly one primary binding required")
    const seenProjects = new Set<string>()
    for (const binding of options.stackBindings) {
      if (seenProjects.has(binding.projectId)) throw new Error("Duplicate projectId in stackBindings")
      seenProjects.add(binding.projectId)
      if (!stack.projectIds.includes(binding.projectId)) {
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

/** Builds the `chat_renamed` event, or `null` if the title is unchanged / empty. */
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

/** Builds the `chat_archived` event. Throws if the chat is not found. */
export function buildArchiveChatEvent(chatsById: Map<string, ChatRecord>, chatId: string): ChatEvent {
  requireChat(chatsById, chatId)
  return { v: STORE_VERSION, type: "chat_archived", timestamp: Date.now(), chatId }
}

/** Builds the `chat_unarchived` event. Throws if the chat is not found. */
export function buildUnarchiveChatEvent(chatsById: Map<string, ChatRecord>, chatId: string): ChatEvent {
  requireChat(chatsById, chatId)
  return { v: STORE_VERSION, type: "chat_unarchived", timestamp: Date.now(), chatId }
}

// ─── Chat state-setter builders ────────────────────────────────────────────

/** Builds the `chat_provider_set` event, or `null` if the provider is unchanged. */
export function buildChatProviderEvent(
  chatsById: Map<string, ChatRecord>,
  chatId: string,
  provider: AgentProvider,
): ChatEvent | null {
  const chat = requireChat(chatsById, chatId)
  if (chat.provider === provider) return null
  return { v: STORE_VERSION, type: "chat_provider_set", timestamp: Date.now(), chatId, provider }
}

/** Builds the `chat_plan_mode_set` event, or `null` if unchanged. */
export function buildPlanModeEvent(
  chatsById: Map<string, ChatRecord>,
  chatId: string,
  planMode: boolean,
): ChatEvent | null {
  const chat = requireChat(chatsById, chatId)
  if (chat.planMode === planMode) return null
  return { v: STORE_VERSION, type: "chat_plan_mode_set", timestamp: Date.now(), chatId, planMode }
}

/** Builds the `chat_compact_failures_set` event, or `null` if unchanged. */
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

/** Builds the `chat_read_state_set` event, or `null` if unchanged. */
export function buildChatReadStateEvent(
  chatsById: Map<string, ChatRecord>,
  chatId: string,
  unread: boolean,
): ChatEvent | null {
  const chat = requireChat(chatsById, chatId)
  if (chat.unread === unread) return null
  return { v: STORE_VERSION, type: "chat_read_state_set", timestamp: Date.now(), chatId, unread }
}

/** Builds the `chat_policy_override_set` event. Throws if the chat is not found. */
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

/** Builds the `chat_source_hash_set` event, or `null` if unchanged. */
export function buildChatSourceHashEvent(
  chatsById: Map<string, ChatRecord>,
  chatId: string,
  sourceHash: string | null,
): ChatEvent | null {
  const chat = requireChat(chatsById, chatId)
  if (chat.sourceHash === sourceHash) return null
  return { v: STORE_VERSION, type: "chat_source_hash_set", timestamp: Date.now(), chatId, sourceHash }
}

// ─── Queued-message builders ───────────────────────────────────────────────

/** Builds the `queued_message_enqueued` event and the resolved QueuedChatMessage. */
export function buildEnqueueMessageResult(
  chatsById: Map<string, ChatRecord>,
  chatId: string,
  message: Omit<QueuedChatMessage, "id" | "createdAt"> & Partial<Pick<QueuedChatMessage, "id" | "createdAt">>,
): { event: QueuedMessageEvent; queuedMessage: QueuedChatMessage } {
  requireChat(chatsById, chatId)
  const queuedMessage: QueuedChatMessage = {
    id: message.id ?? crypto.randomUUID(),
    content: message.content,
    attachments: [...(message.attachments ?? [])],
    createdAt: message.createdAt ?? Date.now(),
    provider: message.provider,
    model: message.model,
    modelOptions: message.modelOptions,
    planMode: message.planMode,
    autoContinue: message.autoContinue,
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

/** Builds the `queued_message_removed` event. Throws if not found. */
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

// ─── Turn / session builders ───────────────────────────────────────────────

/** Builds the `turn_started` event. Throws if the chat is not found. */
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

/** Builds the `turn_finished` event. Throws if the chat is not found. */
export function buildTurnFinishedEvent(chatsById: Map<string, ChatRecord>, chatId: string): TurnEvent {
  requireChat(chatsById, chatId)
  return { v: STORE_VERSION, type: "turn_finished", timestamp: Date.now(), chatId }
}

/** Builds the `turn_failed` event. Throws if the chat is not found. */
export function buildTurnFailedEvent(
  chatsById: Map<string, ChatRecord>,
  chatId: string,
  error: string,
): TurnEvent {
  requireChat(chatsById, chatId)
  return { v: STORE_VERSION, type: "turn_failed", timestamp: Date.now(), chatId, error }
}

/** Builds the `turn_cancelled` event. Throws if the chat is not found. */
export function buildTurnCancelledEvent(chatsById: Map<string, ChatRecord>, chatId: string): TurnEvent {
  requireChat(chatsById, chatId)
  return { v: STORE_VERSION, type: "turn_cancelled", timestamp: Date.now(), chatId }
}

/** Builds the `session_token_set` event, or `null` if unchanged. */
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

/** Builds the `session_commands_loaded` event, or `null` if commands are unchanged. */
export function buildSessionCommandsEvent(
  chatsById: Map<string, ChatRecord>,
  chatId: string,
  commands: SlashCommand[],
): TurnEvent | null {
  const chat = requireChat(chatsById, chatId)
  const normalized = commands.map((c) => ({
    name: c.name,
    description: c.description,
    argumentHint: c.argumentHint,
  }))
  if (chat.slashCommands && slashCommandsEqual(chat.slashCommands, normalized)) return null
  return {
    v: STORE_VERSION, type: "session_commands_loaded", timestamp: Date.now(),
    chatId, commands: normalized,
  }
}

/** Builds the `pending_fork_session_token_set` event, or `null` if unchanged. */
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

// ─── Tool-request builders ────────────────────────────────────────────────

/** Builds the `tool_request_put` event. */
export function buildPutToolRequestEvent(req: ToolRequest): ToolRequestEvent {
  return { v: 3, type: "tool_request_put", timestamp: Date.now(), request: req }
}

/** Builds the `tool_request_resolved` event. Throws if the request id is unknown. */
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

// ─── Re-export ProjectRecord for callers of OpenProjectResult ─────────────

export type { ProjectRecord } from "./events"
