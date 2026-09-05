
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
  getLatestContextWindowUsage?: (chatId: string) => ContextWindowUsageSnapshot | null
}

interface ActiveTurnsMap {
  has(chatId: string): boolean
  get(chatId: string): { compactionTurn?: CompactionTurnKind } | undefined
}

interface StartingTurnsMap {
  has(chatId: string): boolean
}

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

interface AutoResumeByChatMap {
  set(chatId: string, value: boolean): void
}

interface SendCommandAnalytics {
  track(event: string): void
}


export interface SendCommandDeps {
  store: SendCommandStore

  activeTurns: ActiveTurnsMap

  startingTurns: StartingTurnsMap

  pendingTools: { has(chatId: string): boolean }

  claudeSessions: ClaudeSessionsMap

  resolveBackgroundTaskMaxMs(): number

  autoResumeByChat: AutoResumeByChatMap

  analytics: SendCommandAnalytics

  getAppSettingsSnapshot(): { customModels?: readonly CustomModelEntry[] }

  stopLoop(chatId: string, reason: "goal_met" | "user_send" | "chat_deleted"): Promise<void>

  emitStateChange(chatId: string): void

  startTurnForChat(args: StartTurnForChatArgs): Promise<void>

  clearChatContext(chatId: string): Promise<void>

  runCronCommand(chatId: string, result: import("../shared/cron/types").CronParseResult, model?: string): Promise<string | null>

  expandSlashCommand(chatId: string, content: string): SlashCommandExpansion | null
}


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


export function shouldInjectProactiveCompact(
  deps: SendCommandDeps,
  chatId: string,
  content: string,
): boolean {
  if (content.trimStart().startsWith("/")) return false
  const failures = deps.store.getChat(chatId)?.compactFailureCount ?? 0
  if (failures >= MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES) return false
  const usage = deps.store.getLatestContextWindowUsage
    ? deps.store.getLatestContextWindowUsage(chatId)
    : getLatestContextWindowUsage(deps.store.getMessages(chatId))
  return shouldProactivelyCompact(usage)
}

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

function resolveSlashExpansion(
  deps: SendCommandDeps,
  chatId: string,
  provider: AgentProvider,
  content: string,
): SlashCommandExpansion | null {
  if (providerExpandsSlashCommands(provider)) return null
  return deps.expandSlashCommand(chatId, content)
}

function expansionTurnArgs(
  expansion: SlashCommandExpansion | null,
): Pick<StartTurnForChatArgs, "promptOverride" | "expandedCommand"> {
  if (!expansion) return {}
  return {
    promptOverride: expansion.prompt,
    expandedCommand: { name: expansion.name, kind: expansion.kind },
  }
}

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

export async function dequeueAndStartQueuedMessage(
  deps: SendCommandDeps,
  chatId: string,
  queuedMessage: QueuedChatMessage,
  options?: { steered?: boolean; replay?: boolean },
): Promise<void> {
  const release = () => deps.store.removeQueuedMessage(chatId, queuedMessage.id)
  const chat = deps.store.requireChat(chatId)

  const provider = resolveProvider(queuedMessage, chat.provider)
  const customModels = deps.getAppSettingsSnapshot().customModels ?? []
  const settings = getProviderSettings(provider, queuedMessage, customModels)

  const builtin = options?.steered ? null : parseBuiltinCommand(queuedMessage.content)
  if (builtin) {
    await runBuiltinCommand(deps, chatId, builtin, provider, settings, release)
    await maybeStartNextQueuedMessage(deps, chatId)
    return
  }

  const isRateLimitFallback = queuedMessage.autoContinue !== undefined
    && queuedMessage.content === "continue"
  const alreadyAppended = options?.replay === true
    && !options.steered
    && isPromptAlreadyAppended(deps.store.getMessages(chatId), queuedMessage)

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

export async function sendCommand(
  deps: SendCommandDeps,
  command: Extract<ClientCommand, { type: "chat.send" }>,
): Promise<{ chatId: string; queuedMessageId?: string; queued?: true }> {
  const profile: SendToStartingProfile | null = command.clientTraceId
    ? { traceId: command.clientTraceId, startedAt: performance.now() }
    : null
  let chatId = command.chatId

  const existingClaudeSession = chatId ? deps.claudeSessions.get(chatId) : undefined
  existingClaudeSession?.noteUserSend(deps.resolveBackgroundTaskMaxMs(), Date.now())

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

  const chat = deps.store.requireChat(chatId)
  const provider = resolveProvider(command, chat.provider)
  const customModels = deps.getAppSettingsSnapshot().customModels ?? []
  const settings = getProviderSettings(provider, command, customModels)
  deps.analytics.track("message_sent")

  const builtin = parseBuiltinCommand(command.content)
  if (builtin) {
    await runBuiltinCommand(deps, chatId, builtin, provider, settings)
    return { chatId }
  }

  if (
    provider === "claude"
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
      appendUserPrompt: false,
      profile,
    })
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
