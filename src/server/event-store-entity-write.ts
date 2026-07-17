/**
 * Project, stack, chat entity write operations and session/turn write ops
 * extracted from event-store.ts.
 *
 * All functions follow the pattern: build an event using a builder from
 * event-store-write-ops, then delegate to `deps.append`. This file is pure
 * (no direct disk IO), so it does NOT carry the .adapter.ts suffix.
 *
 * Must NOT import from event-store.ts (no circular deps).
 */
import type { AgentProvider, QueuedChatMessage, SlashCommand, StackBinding } from "../shared/types"
import type { ChatPermissionPolicyOverride } from "../shared/permission-policy"
import type { AutoContinueEvent } from "./auto-continue/events"
import type { ChatRecord, StackRecord, StoreEvent, StoreState, TurnRunConfig } from "./events"
import type { StorageBackend } from "./storage/backend"
import {
  buildAddProjectToStackEvent,
  buildChatPolicyOverrideEvent,
  buildChatProviderEvent,
  buildChatReadStateEvent,
  buildChatSourceHashEvent,
  buildCompactFailuresEvent,
  buildCreateChatEvent,
  buildCreateStackEvent,
  buildEnqueueMessageResult,
  buildOpenProjectResult,
  buildPendingForkSessionTokenEvent,
  buildPlanModeEvent,
  buildRemoveProjectEvent,
  buildRemoveProjectFromStackEvent,
  buildRemoveQueuedMessageEvent,
  buildRemoveStackEvent,
  buildRenameStackEvent,
  buildRenameChatEvent,
  buildSessionCommandsEvent,
  buildSessionTokenEvent,
  buildSetProjectStarEvent,
  buildTurnCancelledEvent,
  buildTurnFailedEvent,
  buildTurnFinishedEvent,
  buildTurnStartedEvent,
  computeNewSidebarOrder,
} from "./event-store-write-ops"
import { writeSidebarOrderFile } from "./event-store-snapshot"

// ─── Entity write deps ────────────────────────────────────────────────────

export interface EntityWriteDeps {
  readonly storage: StorageBackend
  readonly dataDir: string
  readonly sidebarProjectOrderPath: string
  readonly projectsLogPath: string
  readonly chatsLogPath: string
  readonly queuedMessagesLogPath: string
  readonly stacksLogPath: string
  readonly projectsById: StoreState["projectsById"]
  readonly projectIdsByPath: StoreState["projectIdsByPath"]
  readonly chatsById: Map<string, ChatRecord>
  readonly queuedMessagesByChatId: StoreState["queuedMessagesByChatId"]
  readonly stacksById: StoreState["stacksById"]
  /** Mutable ref for the sidebar project order. */
  readonly sidebarProjectOrderRef: { value: string[] }
  /** Read the current write-chain promise. */
  getWriteChain: () => Promise<void>
  /** Replace the write-chain promise. */
  setWriteChain: (p: Promise<void>) => void
  /** Core append: writes event to disk and applies to in-memory state. */
  append: <T extends StoreEvent>(filePath: string, event: T) => Promise<void>
}

// ─── Session / turn write deps ────────────────────────────────────────────

export interface SessionWriteDeps {
  readonly chatsById: Map<string, ChatRecord>
  readonly turnsLogPath: string
  readonly schedulesLogPath: string
  append: <T extends StoreEvent>(filePath: string, event: T) => Promise<void>
}

// ─── Project ops ───────────────────────────────────────────────────────────

export async function openProject(
  deps: EntityWriteDeps,
  localPath: string,
  title?: string,
) {
  const result = buildOpenProjectResult(
    { projectsById: deps.projectsById, projectIdsByPath: deps.projectIdsByPath },
    localPath,
    title,
  )
  if (result.kind === "existing") return result.project
  await deps.append(deps.projectsLogPath, result.event)
  return deps.projectsById.get(result.event.projectId)!
}

export async function removeProject(deps: EntityWriteDeps, projectId: string) {
  const event = buildRemoveProjectEvent(deps.projectsById, projectId)
  await deps.append(deps.projectsLogPath, event)
}

export async function setProjectStar(
  deps: EntityWriteDeps,
  projectId: string,
  starred: boolean,
) {
  const event = buildSetProjectStarEvent(deps.projectsById, projectId, starred)
  await deps.append(deps.projectsLogPath, event)
}

// ─── Stack ops ─────────────────────────────────────────────────────────────

export async function createStack(
  deps: EntityWriteDeps,
  title: string,
  projectIds: string[],
): Promise<StackRecord> {
  const event = buildCreateStackEvent(
    { projectsById: deps.projectsById, stacksById: deps.stacksById },
    title,
    projectIds,
  )
  await deps.append(deps.stacksLogPath, event)
  return deps.stacksById.get(event.stackId)!
}

export async function renameStack(
  deps: EntityWriteDeps,
  stackId: string,
  title: string,
) {
  const event = buildRenameStackEvent(deps.stacksById, stackId, title)
  if (event) await deps.append(deps.stacksLogPath, event)
}

export async function removeStack(deps: EntityWriteDeps, stackId: string) {
  const event = buildRemoveStackEvent(deps.stacksById, stackId)
  if (event) await deps.append(deps.stacksLogPath, event)
}

export async function addProjectToStack(
  deps: EntityWriteDeps,
  stackId: string,
  projectId: string,
) {
  const event = buildAddProjectToStackEvent(
    { projectsById: deps.projectsById, stacksById: deps.stacksById },
    stackId,
    projectId,
  )
  if (event) await deps.append(deps.stacksLogPath, event)
}

export async function removeProjectFromStack(
  deps: EntityWriteDeps,
  stackId: string,
  projectId: string,
) {
  const event = buildRemoveProjectFromStackEvent(deps.stacksById, stackId, projectId)
  if (event) await deps.append(deps.stacksLogPath, event)
}

// ─── Sidebar ───────────────────────────────────────────────────────────────

export async function setSidebarProjectOrder(
  deps: EntityWriteDeps,
  projectIds: string[],
): Promise<void> {
  const newOrder = computeNewSidebarOrder(
    deps.projectsById,
    deps.sidebarProjectOrderRef.value,
    projectIds,
  )
  if (!newOrder) return
  const newChain = deps.getWriteChain().then(async () => {
    await writeSidebarOrderFile(deps.storage, deps.dataDir, deps.sidebarProjectOrderPath, newOrder)
    deps.sidebarProjectOrderRef.value = [...newOrder]
  })
  deps.setWriteChain(newChain)
  await newChain
}

// ─── Chat lifecycle ops ────────────────────────────────────────────────────

export async function createChat(
  deps: EntityWriteDeps,
  projectId: string,
  options?: { stackId?: string; stackBindings?: StackBinding[] },
): Promise<ChatRecord> {
  const event = buildCreateChatEvent(
    { projectsById: deps.projectsById, stacksById: deps.stacksById },
    projectId,
    options,
  )
  await deps.append(deps.chatsLogPath, event)
  return deps.chatsById.get(event.chatId)!
}

export async function renameChat(
  deps: EntityWriteDeps,
  chatId: string,
  title: string,
) {
  const event = buildRenameChatEvent(deps.chatsById, chatId, title)
  if (event) await deps.append(deps.chatsLogPath, event)
}

export async function setChatProvider(
  deps: EntityWriteDeps,
  chatId: string,
  provider: AgentProvider,
) {
  const ev = buildChatProviderEvent(deps.chatsById, chatId, provider)
  if (ev) await deps.append(deps.chatsLogPath, ev)
}

export async function setPlanMode(
  deps: EntityWriteDeps,
  chatId: string,
  planMode: boolean,
) {
  const ev = buildPlanModeEvent(deps.chatsById, chatId, planMode)
  if (ev) await deps.append(deps.chatsLogPath, ev)
}

export async function setCompactFailureCount(
  deps: EntityWriteDeps,
  chatId: string,
  compactFailureCount: number,
) {
  const ev = buildCompactFailuresEvent(deps.chatsById, chatId, compactFailureCount)
  if (ev) await deps.append(deps.chatsLogPath, ev)
}

export async function setChatReadState(
  deps: EntityWriteDeps,
  chatId: string,
  unread: boolean,
) {
  const ev = buildChatReadStateEvent(deps.chatsById, chatId, unread)
  if (ev) await deps.append(deps.chatsLogPath, ev)
}

export async function setChatPolicyOverride(
  deps: EntityWriteDeps,
  chatId: string,
  policyOverride: ChatPermissionPolicyOverride | null,
) {
  await deps.append(
    deps.chatsLogPath,
    buildChatPolicyOverrideEvent(deps.chatsById, chatId, policyOverride),
  )
}

export async function setSourceHash(
  deps: EntityWriteDeps,
  chatId: string,
  sourceHash: string | null,
) {
  const ev = buildChatSourceHashEvent(deps.chatsById, chatId, sourceHash)
  if (ev) await deps.append(deps.chatsLogPath, ev)
}

// ─── Queued message ops ────────────────────────────────────────────────────

export async function enqueueMessage(
  deps: EntityWriteDeps,
  chatId: string,
  message: Omit<QueuedChatMessage, "id" | "createdAt"> & Partial<Pick<QueuedChatMessage, "id" | "createdAt">>,
) {
  const { event, queuedMessage } = buildEnqueueMessageResult(deps.chatsById, chatId, message)
  await deps.append(deps.queuedMessagesLogPath, event)
  return queuedMessage
}

export async function removeQueuedMessage(
  deps: EntityWriteDeps,
  chatId: string,
  queuedMessageId: string,
) {
  const event = buildRemoveQueuedMessageEvent(
    deps.chatsById, deps.queuedMessagesByChatId, chatId, queuedMessageId,
  )
  await deps.append(deps.queuedMessagesLogPath, event)
}

// ─── Session / turn write ops ─────────────────────────────────────────────

export async function recordTurnStarted(
  deps: SessionWriteDeps,
  chatId: string,
  runConfig?: TurnRunConfig,
) {
  await deps.append(deps.turnsLogPath, buildTurnStartedEvent(deps.chatsById, chatId, runConfig))
}

export async function recordTurnFinished(deps: SessionWriteDeps, chatId: string) {
  await deps.append(deps.turnsLogPath, buildTurnFinishedEvent(deps.chatsById, chatId))
}

export async function recordTurnFailed(
  deps: SessionWriteDeps,
  chatId: string,
  error: string,
) {
  await deps.append(deps.turnsLogPath, buildTurnFailedEvent(deps.chatsById, chatId, error))
}

export async function recordTurnCancelled(deps: SessionWriteDeps, chatId: string) {
  await deps.append(deps.turnsLogPath, buildTurnCancelledEvent(deps.chatsById, chatId))
}

export async function setSessionTokenForProvider(
  deps: SessionWriteDeps,
  chatId: string,
  provider: AgentProvider,
  sessionToken: string | null,
) {
  const ev = buildSessionTokenEvent(deps.chatsById, chatId, provider, sessionToken)
  if (ev) await deps.append(deps.turnsLogPath, ev)
}

export async function recordSessionCommandsLoaded(
  deps: SessionWriteDeps,
  chatId: string,
  commands: SlashCommand[],
) {
  const ev = buildSessionCommandsEvent(deps.chatsById, chatId, commands)
  if (ev) await deps.append(deps.turnsLogPath, ev)
}

export async function setPendingForkSessionToken(
  deps: SessionWriteDeps,
  chatId: string,
  value: { provider: AgentProvider; token: string } | null,
) {
  const ev = buildPendingForkSessionToken(deps.chatsById, chatId, value)
  if (ev) await deps.append(deps.turnsLogPath, ev)
}

export async function appendAutoContinueEvent(
  deps: SessionWriteDeps,
  event: AutoContinueEvent,
) {
  return deps.append(deps.schedulesLogPath, event)
}

// ─── Private helper ───────────────────────────────────────────────────────

function buildPendingForkSessionToken(
  chatsById: Map<string, ChatRecord>,
  chatId: string,
  value: { provider: AgentProvider; token: string } | null,
) {
  return buildPendingForkSessionTokenEvent(chatsById, chatId, value)
}
