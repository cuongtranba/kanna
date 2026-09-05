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

import type { AgentProvider, ChatAttachment, ContextWindowUsageSnapshot, CustomModelEntry, QueuedChatMessage, TranscriptEntry } from "../shared/types"
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
  isClaudeSdkProvider,
  normalizeClaudeModelOptions,
  normalizeCodexModelOptions,
  normalizeServerModel,
} from "./provider-catalog"
import { buildSteeredMessageContent } from "./claude-prompt-helpers"
import { isChatBusy } from "./claude-session-state-queries"
import type { CompactionTurnKind, SessionBackgroundTask } from "./claude-session-state"
import {
  buildCodexCompactPrompt,
  parseBuiltinCommand,
  type BuiltinCommand,
} from "../shared/builtin-commands"
import type { SlashCommandExpansion } from "../shared/slash-expansion"
import { providerExpandsSlashCommands } from "../shared/types"

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
  /**
   * Latest context-window usage, read from the transcript TAIL rather than the
   * whole file. OPTIONAL by design: the hand-rolled store fakes across the
   * agent suites are injected as `store as never`, so a required member would
   * pass typecheck and then fail at runtime — the exact failure
   * adr-20260813-transcript-memory-budget records as "tried and reverted".
   */
  getLatestContextWindowUsage?: (chatId: string) => ContextWindowUsageSnapshot | null
}

/** Subset of the activeTurns map used by the send command handler. */
interface ActiveTurnsMap {
  has(chatId: string): boolean
  get(chatId: string): { compactionTurn?: CompactionTurnKind } | undefined
}

/** Subset of the startingTurns map used by the send command handler. */
interface StartingTurnsMap {
  has(chatId: string): boolean
}

/** Subset of the claudeSessions map used by the send command handler. */
interface ClaudeSessionsMap {
  get(chatId: string): {
    backgroundTasks: ReadonlyMap<string, SessionBackgroundTask>
    backgroundTaskDeadlineAt: number
    backgroundTaskWakeCount: number
    selfWakeActive: boolean
    backgroundTaskWakeSuppressed: boolean
    noteUserSend(maxMs: number, now: number): void
  } | undefined
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

  /**
   * Turns whose provider session is still booting. Checked alongside
   * `activeTurns` everywhere "is this chat busy?" is asked — `activeTurns`
   * alone let a second send race a concurrent turn during the spawn.
   */
  startingTurns: StartingTurnsMap

  /** Parked tool continuations — only `.has()` is consulted (via isChatBusy). */
  pendingTools: { has(chatId: string): boolean }

  /** The claude-sessions map. Used to re-arm background-task state on user send. */
  claudeSessions: ClaudeSessionsMap

  /** Background-task keep-alive window in ms (for the user-send re-arm). */
  resolveBackgroundTaskMaxMs(): number

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

  /** Wipe every provider's context for the chat — backs the `/clear` builtin. */
  clearChatContext(chatId: string): Promise<void>

  /** Dispatch a parsed `/cron` message (arm/list/manage or validation error). Returns the job id for arm commands, null otherwise. */
  runCronCommand(chatId: string, result: import("../shared/cron/types").CronParseResult, model?: string): Promise<string | null>

  /**
   * Resolve a `/name args` line against the chat's local skill / command
   * catalog and return the prompt to run in its place. `null` when the line
   * names nothing local — the message is then sent exactly as typed.
   *
   * Required, not optional: a provider added without this wiring would silently
   * lose every skill, which is the defect this exists to fix.
   */
  expandSlashCommand(chatId: string, content: string): SlashCommandExpansion | null
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

export interface ProviderSettings {
  model: string
  effort: string | undefined
  serviceTier: "fast" | undefined
  planMode: boolean
}

/**
 * Resolve the model/effort/planMode settings for a new provider turn.
 * Falls through provider-specific normalization logic.
 */
export function getProviderSettings(
  provider: AgentProvider,
  options: SendMessageOptions,
  customModels: readonly CustomModelEntry[],
): ProviderSettings {
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
  // Explicit branch, never `??`: `null` is a meaningful answer here (a chat
  // just past a compact_boundary, or one with no usage yet), so a nullish
  // coalesce would fall through to the whole-transcript read on exactly the
  // chats the tail read exists to spare.
  const usage = deps.store.getLatestContextWindowUsage
    ? deps.store.getLatestContextWindowUsage(chatId)
    : getLatestContextWindowUsage(deps.store.getMessages(chatId))
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
    cronRun: options?.cronRun,
  })
  deps.emitStateChange(chatId)
  return queued
}

/**
 * Run a slash command Kanna implements itself.
 *
 * `/clear` is pure Kanna state — no model call, no turn. `/compact` is a turn
 * either way, but its shape depends on the provider: the claude CLI has a real
 * compaction, and Codex's app-server has no compaction request at all, so
 * Kanna asks the model to summarize and reshapes the reply in the turn runner.
 */
export async function runBuiltinCommand(
  deps: SendCommandDeps,
  chatId: string,
  command: BuiltinCommand,
  provider: AgentProvider,
  settings: ProviderSettings,
  onCommitted?: () => Promise<void>,
): Promise<void> {
  if (command.name === "clear") {
    await deps.clearChatContext(chatId)
    await onCommitted?.()
    return
  }

  // `/cron` never starts a turn — arm/list/manage (or a validation-error
  // entry) is pure Kanna state, like `/clear`.
  if (command.name === "cron") {
    await deps.runCronCommand(chatId, command.result, settings.model)
    await onCommitted?.()
    return
  }

  const cliPassthrough = isClaudeSdkProvider(provider)
  const cliCommand = command.instructions ? `/compact ${command.instructions}` : "/compact"
  await deps.startTurnForChat({
    chatId,
    provider,
    content: cliPassthrough ? cliCommand : buildCodexCompactPrompt(command.instructions),
    attachments: [],
    model: settings.model,
    effort: settings.effort,
    serviceTier: settings.serviceTier,
    planMode: false,
    appendUserPrompt: false,
    onTurnRecorded: onCommitted,
  })

  const active = deps.activeTurns.get(chatId)
  if (active) active.compactionTurn = cliPassthrough ? "user" : "codex_summary"
}

/**
 * The prompt a `/name args` line should actually run, when the provider's own
 * harness cannot resolve it.
 *
 * Returns `null` — meaning "send the message unchanged" — for claude and
 * openrouter (the claude CLI expands it there, and expanding twice would bypass
 * its own skill machinery), and for any line the local catalog does not know.
 */
function resolveSlashExpansion(
  deps: SendCommandDeps,
  chatId: string,
  provider: AgentProvider,
  content: string,
): SlashCommandExpansion | null {
  if (providerExpandsSlashCommands(provider)) return null
  return deps.expandSlashCommand(chatId, content)
}

/** The `startTurnForChat` fields an expansion contributes; empty when there is none. */
function expansionTurnArgs(
  expansion: SlashCommandExpansion | null,
): Pick<StartTurnForChatArgs, "promptOverride" | "expandedCommand"> {
  if (!expansion) return {}
  return {
    promptOverride: expansion.prompt,
    expandedCommand: { name: expansion.name, kind: expansion.kind },
  }
}

/**
 * True when the transcript already ends with the `user_prompt` this queued
 * message would append.
 *
 * Only reachable on replay: a turn that appended its prompt and then died
 * before `recordTurnStarted` leaves the message queued (dequeue-on-commit),
 * so boot recovery restarts it. Identity is the durable `autoContinue`
 * scheduleId when present, else exact content — and only against the TRAILING
 * entry, which in steady state is a `result`, never the prompt about to run.
 */
export function isPromptAlreadyAppended(
  messages: readonly TranscriptEntry[],
  queuedMessage: QueuedChatMessage,
): boolean {
  const last = messages[messages.length - 1]
  if (last?.kind !== "user_prompt") return false
  if (queuedMessage.autoContinue) {
    return last.autoContinue?.scheduleId === queuedMessage.autoContinue.scheduleId
  }
  return last.content === queuedMessage.content
}

/**
 * Dequeue a specific queued message and start a turn for it.
 * If `options.steered` is true, the content is wrapped as a steered message.
 */
export async function dequeueAndStartQueuedMessage(
  deps: SendCommandDeps,
  chatId: string,
  queuedMessage: QueuedChatMessage,
  options?: { steered?: boolean; replay?: boolean },
): Promise<void> {
  // Released only once the message's effect is durable — see `onTurnRecorded`.
  // Removing it up front lost the message outright when the process died
  // mid-spawn, which silently stranded autonomous loops whose only wake
  // trigger it was. See adr-20260813-queued-message-dequeue-on-commit.
  const release = () => deps.store.removeQueuedMessage(chatId, queuedMessage.id)
  const chat = deps.store.requireChat(chatId)

  // Mentions no longer short-circuit the main turn (Anthropic-style
  // Task-tool pattern). The main agent always runs; mention metadata is
  // still attached to the user_prompt entry by `startTurnForChat` →
  // `appendUserPrompt`.
  const provider = resolveProvider(queuedMessage, chat.provider)
  const customModels = deps.getAppSettingsSnapshot().customModels ?? []
  const settings = getProviderSettings(provider, queuedMessage, customModels)

  // A steered message is an injection into a live session, not a fresh turn —
  // a builtin there has nothing to act on, so it falls through as text.
  const builtin = options?.steered ? null : parseBuiltinCommand(queuedMessage.content)
  if (builtin) {
    await runBuiltinCommand(deps, chatId, builtin, provider, settings, release)
    await maybeStartNextQueuedMessage(deps, chatId)
    return
  }

  // Auto-continue rate-limit recovery sends the literal "continue" as a
  // resume signal. Appending it as a user_prompt entry adds noise to the
  // transcript (shows as an "auto-sent" bubble right before a COMPACTED
  // divider, confusing the user). Suppress the entry for that fallback
  // case; agent-driven wakes with a meaningful custom prompt still appear.
  const isRateLimitFallback = queuedMessage.autoContinue !== undefined
    && queuedMessage.content === "continue"
  // Only the boot-recovery path can replay a prompt a crashed turn already
  // wrote, and reading the transcript here costs a full load + deep clone —
  // so the steady-state drain never pays for it.
  const alreadyAppended = options?.replay === true
    && !options.steered
    && isPromptAlreadyAppended(deps.store.getMessages(chatId), queuedMessage)

  // Same gate as the builtin dispatch above: a steered message is an injection
  // into a live session, so a slash command there falls through as text.
  const expansion = options?.steered
    ? null
    : resolveSlashExpansion(deps, chatId, provider, queuedMessage.content)

  await deps.startTurnForChat({
    chatId,
    provider,
    content: options?.steered ? buildSteeredMessageContent(queuedMessage.content) : queuedMessage.content,
    ...expansionTurnArgs(expansion),
    attachments: queuedMessage.attachments,
    model: settings.model,
    effort: settings.effort,
    serviceTier: settings.serviceTier,
    planMode: settings.planMode,
    appendUserPrompt: !isRateLimitFallback && !alreadyAppended,
    steered: options?.steered,
    autoContinue: queuedMessage.autoContinue,
    cronRun: queuedMessage.cronRun,
    onTurnRecorded: release,
  })
}

/**
 * If no turn is active and a queued message exists, dequeue and start it.
 * Returns `true` if a queued message was started, `false` otherwise.
 */
export async function maybeStartNextQueuedMessage(
  deps: SendCommandDeps,
  chatId: string,
  options?: { replay?: boolean },
): Promise<boolean> {
  if (isChatBusy(deps, chatId)) return false
  const nextQueuedMessage = typeof deps.store.getQueuedMessages === "function"
    ? deps.store.getQueuedMessages(chatId)[0]
    : undefined
  if (!nextQueuedMessage) return false
  await dequeueAndStartQueuedMessage(deps, chatId, nextQueuedMessage, options)
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

  // A real user chat.send RE-ARMS (never clears) any background-task
  // keep-alive guard. Clearing here let the idle reaper silently kill a
  // healthy long-running watch ~10 min after any user message — the same
  // silent-death class adr-20260801-background-task-wake-escalation fixes
  // in the sweep. Pending ids stay authoritative (settle edges / snapshots
  // remove them); the send just refreshes the deadline and restores the
  // watchdog wake budget.
  const existingClaudeSession = chatId ? deps.claudeSessions.get(chatId) : undefined
  existingClaudeSession?.noteUserSend(deps.resolveBackgroundTaskMaxMs(), Date.now())

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

  // isChatBusy is the single busy derivation: live turn, booting turn,
  // parked question, or streaming self-wake all queue the send. The
  // self-wake / parked-question cases drain when the wake's terminal result
  // arrives (see the runner's disarm branch).
  if (isChatBusy(deps, chatId)) {
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

  // Builtins are dispatched after the busy check on purpose: a `/clear` typed
  // mid-turn queues like any other message and runs when the turn drains,
  // leaving every startingTurns / pendingTools / isChatBusy invariant alone.
  const builtin = parseBuiltinCommand(command.content)
  if (builtin) {
    await runBuiltinCommand(deps, chatId, builtin, provider, settings)
    return { chatId }
  }

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
    if (compactActive) compactActive.compactionTurn = "proactive"

    logSendToStartingProfile(profile, "chat_send.proactive_compact_injected", {
      chatId,
      provider,
      model: settings.model,
      queuedUserMessageId: queuedMessage.id,
    })

    return { chatId, queuedMessageId: queuedMessage.id, queued: true as const }
  }

  // A local skill or command, expanded for a provider that cannot do it
  // itself. Sits after the builtin dispatch (so `/clear` is never shadowed by a
  // project command of the same name) and after the proactive-compact branch
  // (which already declines to fire on any line starting with `/`).
  const expansion = resolveSlashExpansion(deps, chatId, provider, command.content)

  await deps.startTurnForChat({
    chatId,
    provider,
    content: command.content,
    ...expansionTurnArgs(expansion),
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
