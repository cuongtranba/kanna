/**
 * Standalone send/queue handler cluster for AgentCoordinator.
 *
 * Extracted from agent.ts so the message-send pipeline and queue management
 * logic lives in its own testable module. The coordinator delegates to these
 * functions by passing an object literal that satisfies `SendCommandDeps`.
 *
 * Side-effect seal: this module contains NO direct IO (no node:fs, no HTTP
 * calls, no Bun primitives). Every effectful operation is injected through
 * the deps interface.
 */

import type { AgentProvider, ChatAttachment, CustomModelEntry, QueuedChatMessage, TranscriptEntry } from "../shared/types"
import { resolveClaudeApiModelId } from "../shared/types"
import type { ClientCommand } from "../shared/protocol"
import {
  logSendToStartingProfile,
  type SendMessageOptions,
  type SendToStartingProfile,
} from "./claude-steer-log"
import type { StartTurnForChatArgs } from "./claude-turn-starter"
import {
  getLatestContextWindowUsage,
  MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES,
  shouldProactivelyCompact,
} from "./proactive-compact"
import {
  codexServiceTierFromModelOptions,
  getServerProviderCatalog,
  normalizeClaudeModelOptions,
  normalizeCodexModelOptions,
  normalizeServerModel,
} from "./provider-catalog"
import { buildSteeredMessageContent } from "./claude-prompt-helpers"

// ---------------------------------------------------------------------------
// Structural sub-interfaces — only the slices this module calls.
// ---------------------------------------------------------------------------

/** Subset of EventStore used by the send command handler. */
interface SendCommandStore {
  createChat(projectId: string): Promise<{ id: string }>
  requireChat(chatId: string): { provider: AgentProvider | null }
  getChat(chatId: string): { compactFailureCount?: number } | null
  enqueueMessage(
    chatId: string,
    message: Omit<QueuedChatMessage, "id" | "createdAt"> & Partial<Pick<QueuedChatMessage, "id" | "createdAt">>,
  ): Promise<QueuedChatMessage>
  removeQueuedMessage(chatId: string, queuedMessageId: string): Promise<void>
  getQueuedMessages?: (chatId: string) => readonly QueuedChatMessage[]
  getMessages(chatId: string): readonly TranscriptEntry[]
}

/** Subset of the activeTurns map used by the send command handler. */
interface ActiveTurnsMap {
  has(chatId: string): boolean
  get(chatId: string): { proactiveCompactInjection?: boolean } | undefined
}

/** Subset of the claudeSessions map used by the send command handler. */
interface ClaudeSessionsMap {
  get(chatId: string): { backgroundTaskIds: Set<string>; backgroundTaskDeadlineAt: number } | undefined
}

/** Subset of the autoResumeByChat map used by the send command handler. */
interface AutoResumeByChatMap {
  set(chatId: string, value: boolean): void
}

/** Minimal analytics interface needed by the send command handler. */
interface SendCommandAnalytics {
  track(event: string): void
}

// ---------------------------------------------------------------------------
// Dependency bundle injected by AgentCoordinator
// ---------------------------------------------------------------------------

export interface SendCommandDeps {
  /** The event store — for creating chats, queuing messages, and reading state. */
  store: SendCommandStore

  /** The active-turns map. Read-only from the handler's perspective (has/get). */
  activeTurns: ActiveTurnsMap

  /** The claude-sessions map. Used to clear background-task state on user send. */
  claudeSessions: ClaudeSessionsMap

  /** Per-chat auto-resume preference map. */
  autoResumeByChat: AutoResumeByChatMap

  /** Analytics reporter. */
  analytics: SendCommandAnalytics

  /** Returns the current app settings snapshot (for customModels). */
  getAppSettingsSnapshot(): { customModels?: readonly CustomModelEntry[] }

  /** Disarm the armed loop (user takeover). */
  stopLoop(chatId: string, reason: "goal_met" | "user_send" | "chat_deleted"): Promise<void>

  /** Emit a state-change event for a chat. */
  emitStateChange(chatId: string): void

  /** Start a new provider turn for the given chat. */
  startTurnForChat(args: StartTurnForChatArgs): Promise<void>
}

// ---------------------------------------------------------------------------
// Pure helpers (no deps required)
// ---------------------------------------------------------------------------

/**
 * Resolve the provider to use for a new message, falling back through the
 * command option → chat's current provider → "claude".
 */
export function resolveProvider(
  options: SendMessageOptions,
  currentProvider: AgentProvider | null,
): AgentProvider {
  return options.provider ?? currentProvider ?? "claude"
}

/**
 * Resolve the model/effort/planMode settings for a new provider turn.
 * Falls through provider-specific normalization logic.
 */
export function getProviderSettings(
  provider: AgentProvider,
  options: SendMessageOptions,
  customModels: readonly CustomModelEntry[],
) {
  const catalog = getServerProviderCatalog(provider)

  if (provider === "claude") {
    const model = normalizeServerModel(provider, options.model, customModels)
    const modelOptions = normalizeClaudeModelOptions(model, options.modelOptions, options.effort, customModels)
    return {
      model: resolveClaudeApiModelId(model, modelOptions.contextWindow),
      effort: modelOptions.reasoningEffort,
      serviceTier: undefined,
      planMode: catalog.supportsPlanMode ? Boolean(options.planMode) : false,
    }
  }

  if (provider === "openrouter") {
    // OpenRouter's model list is fetched dynamically (settings.listOpenRouterModels),
    // so the static server catalog is empty and normalizeServerModel would collapse
    // every selection to the default. Trust the client-selected id — OpenRouter
    // rejects invalid ids at the API — falling back to the default only when blank.
    return {
      model: options.model?.trim() || catalog.defaultModel,
      effort: undefined,
      serviceTier: undefined,
      planMode: catalog.supportsPlanMode ? Boolean(options.planMode) : false,
    }
  }

  const modelOptions = normalizeCodexModelOptions(options.modelOptions, options.effort)
  return {
    model: normalizeServerModel(provider, options.model, customModels),
    effort: modelOptions.reasoningEffort,
    serviceTier: codexServiceTierFromModelOptions(modelOptions),
    planMode: catalog.supportsPlanMode ? Boolean(options.planMode) : false,
  }
}

// ---------------------------------------------------------------------------
// Exported standalone functions
// ---------------------------------------------------------------------------

/**
 * Check whether a proactive `/compact` turn should be injected before the
 * user's real message. Returns false for slash commands and when the circuit
 * breaker has tripped (too many consecutive compact failures).
 */
export function shouldInjectProactiveCompact(
  deps: SendCommandDeps,
  chatId: string,
  content: string,
): boolean {
  // Never recurse — if the user (or Kanna itself) is already sending a
  // slash command, run it as-is. Compacting before `/clear` or another
  // `/compact` would be wasted work.
  if (content.trimStart().startsWith("/")) return false
  const failures = deps.store.getChat(chatId)?.compactFailureCount ?? 0
  if (failures >= MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES) return false
  const usage = getLatestContextWindowUsage(deps.store.getMessages(chatId))
  return shouldProactivelyCompact(usage)
}

/**
 * Append a message to the chat's queue and emit a state-change event.
 * Returns the newly created queued message.
 */
export async function enqueueMessage(
  deps: SendCommandDeps,
  chatId: string,
  content: string,
  attachments: ChatAttachment[],
  options?: SendMessageOptions,
): Promise<QueuedChatMessage> {
  const queued = await deps.store.enqueueMessage(chatId, {
    content,
    attachments,
    provider: options?.provider,
    model: options?.model,
    modelOptions: options?.modelOptions,
    planMode: options?.planMode,
    autoContinue: options?.autoContinue,
  })
  deps.emitStateChange(chatId)
  return queued
}

/**
 * Dequeue a specific queued message and start a turn for it.
 * If `options.steered` is true, the content is wrapped as a steered message.
 */
export async function dequeueAndStartQueuedMessage(
  deps: SendCommandDeps,
  chatId: string,
  queuedMessage: QueuedChatMessage,
  options?: { steered?: boolean },
): Promise<void> {
  await deps.store.removeQueuedMessage(chatId, queuedMessage.id)
  const chat = deps.store.requireChat(chatId)

  // Mentions no longer short-circuit the main turn (Anthropic-style
  // Task-tool pattern). The main agent always runs; mention metadata is
  // still attached to the user_prompt entry by `startTurnForChat` →
  // `appendUserPrompt`.
  const provider = resolveProvider(queuedMessage, chat.provider)
  const customModels = deps.getAppSettingsSnapshot().customModels ?? []
  const settings = getProviderSettings(provider, queuedMessage, customModels)

  // Auto-continue rate-limit recovery sends the literal "continue" as a
  // resume signal. Appending it as a user_prompt entry adds noise to the
  // transcript (shows as an "auto-sent" bubble right before a COMPACTED
  // divider, confusing the user). Suppress the entry for that fallback
  // case; agent-driven wakes with a meaningful custom prompt still appear.
  const isRateLimitFallback = queuedMessage.autoContinue !== undefined
    && queuedMessage.content === "continue"

  await deps.startTurnForChat({
    chatId,
    provider,
    content: options?.steered ? buildSteeredMessageContent(queuedMessage.content) : queuedMessage.content,
    attachments: queuedMessage.attachments,
    model: settings.model,
    effort: settings.effort,
    serviceTier: settings.serviceTier,
    planMode: settings.planMode,
    appendUserPrompt: !isRateLimitFallback,
    steered: options?.steered,
    autoContinue: queuedMessage.autoContinue,
  })
}

/**
 * If no turn is active and a queued message exists, dequeue and start it.
 * Returns `true` if a queued message was started, `false` otherwise.
 */
export async function maybeStartNextQueuedMessage(
  deps: SendCommandDeps,
  chatId: string,
): Promise<boolean> {
  if (deps.activeTurns.has(chatId)) return false
  const nextQueuedMessage = typeof deps.store.getQueuedMessages === "function"
    ? deps.store.getQueuedMessages(chatId)[0]
    : undefined
  if (!nextQueuedMessage) return false
  await dequeueAndStartQueuedMessage(deps, chatId, nextQueuedMessage)
  return true
}

/**
 * Handle a `chat.send` command:
 * 1. Clears background-task keep-alive guard on the existing session.
 * 2. Disarms any armed loop (user takeover).
 * 3. Creates the chat if it doesn't exist yet.
 * 4. If a turn is active, enqueues the message and returns `queued: true`.
 * 5. Optionally injects a proactive `/compact` turn ahead of the real message.
 * 6. Otherwise starts the turn immediately.
 */
export async function sendCommand(
  deps: SendCommandDeps,
  command: Extract<ClientCommand, { type: "chat.send" }>,
): Promise<{ chatId: string; queuedMessageId?: string; queued?: true }> {
  const profile: SendToStartingProfile | null = command.clientTraceId
    ? { traceId: command.clientTraceId, startedAt: performance.now() }
    : null
  let chatId = command.chatId

  // A real user chat.send means the agent is active again — release any
  // background-task keep-alive guard so the session reaps normally afterward.
  // Auto-continue / agent wakes bypass `send` and intentionally do NOT clear it.
  const existingClaudeSession = chatId ? deps.claudeSessions.get(chatId) : undefined
  if (existingClaudeSession) {
    existingClaudeSession.backgroundTaskIds.clear()
    existingClaudeSession.backgroundTaskDeadlineAt = 0
  }

  // A real user send is a takeover: disarm any armed loop so tools are
  // restored and the generic wake path resumes. Auto-continue / background
  // wakes bypass `send`, so they do NOT disarm.
  // Awaited so a failed event-log write surfaces instead of silently
  // leaving the loop armed (and tools blocked) after the takeover.
  if (chatId) await deps.stopLoop(chatId, "user_send")

  logSendToStartingProfile(profile, "chat_send.received", {
    existingChatId: command.chatId ?? null,
    projectId: command.projectId ?? null,
  })

  if (!chatId) {
    if (!command.projectId) {
      throw new Error("Missing projectId for new chat")
    }
    const created = await deps.store.createChat(command.projectId)
    chatId = created.id
    deps.analytics.track("chat_created")
    logSendToStartingProfile(profile, "chat_send.chat_created", {
      chatId,
      projectId: command.projectId,
    })
  }

  if (typeof command.autoResumeOnRateLimit === "boolean" && chatId) {
    deps.autoResumeByChat.set(chatId, command.autoResumeOnRateLimit)
  }

  if (deps.activeTurns.has(chatId)) {
    deps.analytics.track("message_sent")
    const queuedMessage = await enqueueMessage(deps, chatId, command.content, command.attachments ?? [], {
      provider: command.provider,
      model: command.model,
      modelOptions: command.modelOptions,
      effort: command.effort,
      planMode: command.planMode,
    })
    return { chatId, queuedMessageId: queuedMessage.id, queued: true as const }
  }

  // Mentions no longer short-circuit the main turn. The main agent always
  // runs and decides whether to delegate via `mcp__kanna__delegate_subagent`
  // (Anthropic-style Task-tool pattern). `parseMentions` still runs inside
  // `startTurnForChat` → `appendUserPrompt` so the user_prompt entry
  // continues to carry `subagentMentions` metadata for UI badges + analytics.
  const chat = deps.store.requireChat(chatId)
  const provider = resolveProvider(command, chat.provider)
  const customModels = deps.getAppSettingsSnapshot().customModels ?? []
  const settings = getProviderSettings(provider, command, customModels)
  deps.analytics.track("message_sent")

  // Proactive compact: if the latest usage snapshot crossed claude-code's
  // auto-compact threshold, inject a synthetic `/compact` turn ahead of the
  // user's real message. The user's prompt sits in the queue and runs after
  // `/compact` produces its summary, so the next turn ships with a bounded
  // history instead of looping on "Prompt is too long".
  if (
    provider === "claude" // openrouter intentionally excluded: /compact is claude-CLI-specific
    && shouldInjectProactiveCompact(deps, chatId, command.content)
  ) {
    const queuedMessage = await enqueueMessage(deps, chatId, command.content, command.attachments ?? [], {
      provider: command.provider,
      model: command.model,
      modelOptions: command.modelOptions,
      effort: command.effort,
      planMode: command.planMode,
    })
    await deps.startTurnForChat({
      chatId,
      provider,
      content: "/compact",
      attachments: [],
      model: settings.model,
      effort: settings.effort,
      serviceTier: settings.serviceTier,
      planMode: settings.planMode,
      // /compact is a slash command, not the user's actual message — don't
      // persist a user_prompt transcript entry for it.
      appendUserPrompt: false,
      profile,
    })
    // Tag the active turn so the result handler can update the circuit
    // breaker (reset on success / increment on failure).
    const compactActive = deps.activeTurns.get(chatId)
    if (compactActive) compactActive.proactiveCompactInjection = true

    logSendToStartingProfile(profile, "chat_send.proactive_compact_injected", {
      chatId,
      provider,
      model: settings.model,
      queuedUserMessageId: queuedMessage.id,
    })

    return { chatId, queuedMessageId: queuedMessage.id, queued: true as const }
  }

  await deps.startTurnForChat({
    chatId,
    provider,
    content: command.content,
    attachments: command.attachments ?? [],
    model: settings.model,
    effort: settings.effort,
    serviceTier: settings.serviceTier,
    planMode: settings.planMode,
    appendUserPrompt: true,
    profile,
  })

  logSendToStartingProfile(profile, "chat_send.ready_for_ack", {
    chatId,
    provider,
    model: settings.model,
  })

  return { chatId }
}
