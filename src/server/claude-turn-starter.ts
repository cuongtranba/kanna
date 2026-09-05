import type { AgentProvider } from "../shared/types"
import { isCodexReasoningEffort, providerUsesSdkSession } from "../shared/types"
import { isClaudeSdkProvider } from "./provider-catalog"
import type { ChatRecord } from "./events"
import type { ActiveTurn, StartingTurn } from "./claude-session-state"
import type { JsonValue } from "../shared/json"
import type { HarnessTurn, HarnessToolRequest } from "./harness-types"
import type {
  StartTurnAfterTurnStartedCtx,
  StartTurnDeps,
  StartTurnForChatArgs,
} from "./claude-turn-starter-types"
import { OAuthPoolUnavailableError } from "./oauth-errors"
import { buildPromptText } from "./claude-prompt-helpers"
import { buildHistoryPrimer, shouldInjectPrimer } from "./history-primer"
import { fallbackTitleFromMessage } from "./generate-title"
import { parseMentions, type ParsedMention } from "./mention-parser"
import { resolveProjectInstructions, resolveSpawnPaths, resolveStackProjects } from "./claude-session-config"
import { buildCodexDeveloperInstructions } from "../shared/kanna-system-prompt"
import { timestamped } from "./claude-message-normalizer"
import { logClaudeSteer, logSendToStartingProfile } from "./claude-steer-log"
import { log } from "../shared/log"
import { withSpan } from "./observability"
import { LOG_PREFIX } from "../shared/branding"

const PRIMER_TAIL_LIMIT = 1000

export type {
  StartClaudeTurnArgs,
  StartTurnAppSettings,
  StartTurnDeps,
  StartTurnForChatArgs,
} from "./claude-turn-starter-types"


export async function startTurnForChat(
  deps: StartTurnDeps,
  args: StartTurnForChatArgs,
): Promise<void> {
  return withSpan(
    "kanna.turn.start",
    {
      "kanna.chat_id": args.chatId,
      "kanna.provider": args.provider,
      "kanna.model": args.model,
      "kanna.plan_mode": args.planMode,
    },
    () => startTurnForChatOuter(deps, args),
  )
}

async function startTurnForChatOuter(
  deps: StartTurnDeps,
  args: StartTurnForChatArgs,
): Promise<void> {
  logSendToStartingProfile(args.profile, "start_turn.begin", {
    chatId: args.chatId,
    provider: args.provider,
    appendUserPrompt: args.appendUserPrompt,
    planMode: args.planMode,
  })

  const draining = deps.drainingStreams.get(args.chatId)
  if (draining) {
    draining.turn.close()
    deps.clearDrainingStream(args.chatId)
  }

  deps.subagentOrchestrator.clearChatCancellation(args.chatId)

  const chat = deps.store.requireChat(args.chatId)
  if (deps.activeTurns.has(args.chatId) || deps.startingTurns.has(args.chatId)) {
    throw new Error("Chat is already running")
  }

  const starting: StartingTurn = {
    chatId: args.chatId,
    provider: args.provider,
    startedAt: Date.now(),
    cancelRequested: false,
  }
  deps.startingTurns.set(args.chatId, starting)
  deps.emitStateChange(args.chatId, { immediate: true })

  try {
    await startTurnForChatInner(deps, args, starting, chat)
  } finally {
    if (deps.startingTurns.get(args.chatId) === starting) {
      deps.startingTurns.delete(args.chatId)
    }
  }
}

async function startTurnForChatInner(
  deps: StartTurnDeps,
  args: StartTurnForChatArgs,
  starting: StartingTurn,
  chat: ChatRecord,
): Promise<void> {
  if (chat.provider !== args.provider) {
    await deps.store.setChatProvider(args.chatId, args.provider)
    logSendToStartingProfile(args.profile, "start_turn.provider_set", {
      chatId: args.chatId,
      provider: args.provider,
    })
  }
  await deps.store.setPlanMode(args.chatId, args.planMode)
  logSendToStartingProfile(args.profile, "start_turn.plan_mode_set", {
    chatId: args.chatId,
    planMode: args.planMode,
  })

  const loadExistingMessages = () => deps.store.getRecentRawEntries(args.chatId, PRIMER_TAIL_LIMIT)
  const shouldGenerateTitle = args.appendUserPrompt
    && chat.title === "New Chat"
    && !chat.hasMessages
    && loadExistingMessages().length === 0
  const optimisticTitle = shouldGenerateTitle ? fallbackTitleFromMessage(args.content) : null

  if (optimisticTitle) {
    await deps.store.renameChat(args.chatId, optimisticTitle)
    logSendToStartingProfile(args.profile, "start_turn.optimistic_title_set", {
      chatId: args.chatId,
      title: optimisticTitle,
    })
  }

  const project = deps.store.getProject(chat.projectId)
  if (!project) {
    throw new Error("Project not found")
  }

  let appendedUserMessageId: string | null = null
  if (args.appendUserPrompt) {
    const parsedMentions = parseMentions(args.content, deps.getSubagents())
    const subagentMentions = parsedMentions
      .filter((mention): mention is Extract<ParsedMention, { kind: "subagent" }> => mention.kind === "subagent")
      .map((mention) => ({ subagentId: mention.subagentId, raw: mention.raw }))
    deps.mentionedSubagentIdsByChat.set(
      args.chatId,
      subagentMentions.map((m) => m.subagentId),
    )
    const unknownSubagentMentions = parsedMentions
      .filter((mention): mention is Extract<ParsedMention, { kind: "unknown-subagent" }> => mention.kind === "unknown-subagent")
      .map((mention) => ({ name: mention.name, raw: mention.raw }))
    const userPromptEntry = timestamped(
      {
        kind: "user_prompt",
        content: args.content,
        attachments: args.attachments,
        steered: args.steered,
        autoContinue: args.autoContinue,
        ...(subagentMentions.length > 0 ? { subagentMentions } : {}),
        ...(unknownSubagentMentions.length > 0 ? { unknownSubagentMentions } : {}),
        ...(args.expandedCommand ? { expandedCommand: args.expandedCommand } : {}),
      },
      Date.now()
    )
    await deps.store.appendMessage(args.chatId, userPromptEntry)
    appendedUserMessageId = userPromptEntry._id
    logSendToStartingProfile(args.profile, "start_turn.user_prompt_appended", {
      chatId: args.chatId,
      entryId: userPromptEntry._id,
    })
  }
  await deps.store.recordTurnStarted(args.chatId, {
    provider: args.provider,
    model: args.model,
    ...(args.effort !== undefined ? { effort: args.effort } : {}),
    ...(args.serviceTier !== undefined ? { serviceTier: args.serviceTier } : {}),
    planMode: args.planMode,
    driver: deps.resolveClaudeDriverPreference(),
  })
  logSendToStartingProfile(args.profile, "start_turn.turn_started_recorded", {
    chatId: args.chatId,
  })
  await args.onTurnRecorded?.()

  try {
    await startTurnAfterTurnStarted(deps, {
      args,
      starting,
      chat,
      project,
      loadExistingMessages,
      shouldGenerateTitle,
      optimisticTitle,
      appendedUserMessageId,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const isOAuthRefusal = error instanceof OAuthPoolUnavailableError
    log.error(`${LOG_PREFIX} startTurnForChat failed after turn_started`, {
      chatId: args.chatId,
      provider: args.provider,
      model: args.model,
      planMode: args.planMode,
      error: message,
      stack: error instanceof Error ? error.stack : undefined,
      kind: isOAuthRefusal ? "oauth_pool_unavailable" : "unknown",
    })
    if (isOAuthRefusal) {
      try {
        await deps.store.appendMessage(
          args.chatId,
          timestamped({
            kind: "result",
            subtype: "error",
            isError: true,
            durationMs: 0,
            result: message,
          })
        )
      } catch (appendErr) {
        log.error(`${LOG_PREFIX} append refusal result entry failed`, {
          chatId: args.chatId,
          appendErr: appendErr instanceof Error ? appendErr.message : String(appendErr),
        })
      }
    }
    try {
      await deps.store.recordTurnFailed(args.chatId, message)
    } catch (recordErr) {
      log.error(`${LOG_PREFIX} recordTurnFailed also failed`, {
        chatId: args.chatId,
        recordErr: recordErr instanceof Error ? recordErr.message : String(recordErr),
      })
    }
    deps.activeTurns.delete(args.chatId)
    deps.emitStateChange(args.chatId, { immediate: true })
    if (isOAuthRefusal) {
      return
    }
    throw error
  }
}

async function startTurnAfterTurnStarted(
  deps: StartTurnDeps,
  ctx: StartTurnAfterTurnStartedCtx,
): Promise<void> {
  const { args, starting, chat, project, loadExistingMessages, shouldGenerateTitle, optimisticTitle, appendedUserMessageId } = ctx
  if (shouldGenerateTitle) {
    void deps.generateTitleInBackground(args.chatId, args.content, project.localPath, optimisticTitle ?? "New Chat")
  }

  const onToolRequest = async (request: HarnessToolRequest): Promise<JsonValue> => {
    const active = deps.activeTurns.get(args.chatId)
    if (active) {
      active.status = "waiting_for_user"
      active.waitStartedAt = Date.now()
    }
    deps.emitStateChange(args.chatId)

    return await new Promise<JsonValue>((resolve) => {
      deps.pendingTools.park(args.chatId, {
        toolUseId: request.tool.toolId,
        provider: args.provider,
        tool: request.tool,
        parkedAt: Date.now(),
        resolve,
      })
    })
  }

  const targetProvider: AgentProvider = args.provider
  const existingToken = chat.sessionTokensByProvider[targetProvider] ?? null
  const pendingForkToken = chat.pendingForkSessionToken?.provider === targetProvider
    ? chat.pendingForkSessionToken.token
    : null
  const shouldPrime = shouldInjectPrimer(
    chat.sessionTokensByProvider,
    targetProvider,
    Boolean(args.userClearedContext),
  )
  const userPromptText = buildPromptText(args.promptOverride ?? args.content, args.attachments)
  const primer = shouldPrime
    ? buildHistoryPrimer(loadExistingMessages(), targetProvider, userPromptText)
    : null
  const promptContent = primer ?? userPromptText

  const lookupProject = (id: string) => {
    const p = deps.store.getProject(id)
    return p ? { title: p.title, instructions: p.instructions } : undefined
  }
  const instructionOptions = {
    globalPromptAppend: deps.getAppSettingsSnapshot().globalPromptAppend,
    stackInstructions: chat.stackId ? deps.store.getStack(chat.stackId)?.instructions : undefined,
    projectInstructions: resolveProjectInstructions(chat, lookupProject),
  }
  const stackProjects = resolveStackProjects(chat, (id) => {
    const p = lookupProject(id)
    return p ? { title: p.title, active: true } : undefined
  })

  let turn: HarnessTurn
  if (isClaudeSdkProvider(args.provider)) {
    logSendToStartingProfile(args.profile, "start_turn.provider_boot.begin", {
      chatId: args.chatId,
      provider: args.provider,
      model: args.model,
    })
    const spawn = resolveSpawnPaths(chat, project.localPath)
    turn = await deps.startClaudeTurn({
      chatId: args.chatId,
      projectId: project.id,
      localPath: spawn.cwd,
      additionalDirectories: spawn.additionalDirectories,
      stackProjects,
      instructions: instructionOptions,
      model: args.model,
      effort: args.effort,
      planMode: args.planMode,
      sessionToken: pendingForkToken ?? existingToken,
      forkSession: pendingForkToken != null,
      onToolRequest,
      provider: args.provider,
    })
    logSendToStartingProfile(args.profile, "start_turn.provider_boot.ready", {
      chatId: args.chatId,
      provider: args.provider,
      model: args.model,
    })
  } else {
    logSendToStartingProfile(args.profile, "start_turn.provider_boot.begin", {
      chatId: args.chatId,
      provider: args.provider,
      model: args.model,
    })
    const sessionToken = await deps.codexManager.startSession({
      chatId: args.chatId,
      cwd: resolveSpawnPaths(chat, project.localPath).cwd,
      projectId: project.id,
      model: args.model,
      serviceTier: args.serviceTier,
      sessionToken: existingToken,
      pendingForkSessionToken: pendingForkToken,
      developerInstructions: buildCodexDeveloperInstructions({
        ...instructionOptions,
        stackProjects,
        skills: deps.listSkills(args.chatId),
      }),
    })
    if (pendingForkToken && sessionToken) {
      await deps.store.setPendingForkSessionToken(args.chatId, null)
    }
    logSendToStartingProfile(args.profile, "start_turn.session_ready", {
      chatId: args.chatId,
      provider: args.provider,
      model: args.model,
    })
    turn = await deps.codexManager.startTurn({
      chatId: args.chatId,
      content: promptContent,
      model: args.model,
      effort: isCodexReasoningEffort(args.effort) ? args.effort : undefined,
      serviceTier: args.serviceTier,
      planMode: args.planMode,
      onToolRequest,
    })
    logSendToStartingProfile(args.profile, "start_turn.provider_boot.ready", {
      chatId: args.chatId,
      provider: args.provider,
      model: args.model,
    })
  }

  if (starting.cancelRequested) {
    logSendToStartingProfile(args.profile, "start_turn.cancelled_during_boot", {
      chatId: args.chatId,
      provider: args.provider,
    })
    try {
      await Promise.race([
        turn.interrupt(),
        new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
      ])
    } catch {
    }
    turn.close()
    if (args.provider === "claude" && deps.resolveClaudeDriverPreference() === "pty") {
      const session = deps.claudeSessions.get(args.chatId)
      if (session) deps.closeClaudeSession(args.chatId, session)
    }
    return
  }

  const active: ActiveTurn = {
    chatId: args.chatId,
    provider: args.provider,
    turn,
    startedAt: starting.startedAt,
    sessionId: deps.claudeSessions.get(args.chatId)?.id,
    model: args.model,
    effort: args.effort,
    serviceTier: args.serviceTier,
    planMode: args.planMode,
    status: args.provider === "claude" ? "running" : "starting",
    postToolFollowUp: null,
    hasFinalResult: false,
    cancelRequested: false,
    cancelRecorded: false,
    clientTraceId: args.profile?.traceId,
    profilingStartedAt: args.profile?.startedAt,
    waitStartedAt: null,
    cronRun: args.cronRun,
    userMessageId: appendedUserMessageId ?? deps.findLastUserMessageId(args.chatId),
  }
  deps.activeTurns.set(args.chatId, active)
  logSendToStartingProfile(args.profile, "start_turn.active_turn_registered", {
    chatId: args.chatId,
    status: active.status,
  })
  deps.emitStateChange(args.chatId, { immediate: active.status === "starting" })
  logSendToStartingProfile(args.profile, "start_turn.state_change_emitted", {
    chatId: args.chatId,
    status: active.status,
  })

  if (turn.getAccountInfo) {
    void turn.getAccountInfo()
      .then(async (accountInfo) => {
        const session = deps.claudeSessions.get(args.chatId)
        if (args.provider === "openrouter") {
          if (!session) return
          if (session.accountInfoLoaded) return
          session.accountInfoLoaded = true
          await deps.store.appendMessage(args.chatId, timestamped({
            kind: "account_info",
            accountInfo: {
              tokenSource: "openrouter",
              ...(session.openrouterKeyMasked ? { oauthKeyMasked: session.openrouterKeyMasked } : {}),
              ...(session.openrouterModel ? { organization: session.openrouterModel } : {}),
            },
          }))
          deps.emitStateChange(args.chatId)
        } else {
          if (!accountInfo) return
          let augmented = accountInfo
          if (args.provider === "claude") {
            if (!session) return
            if (session.accountInfoLoaded) return
            session.accountInfoLoaded = true
            if (session.activeTokenId) {
              augmented = {
                ...accountInfo,
                tokenSource: "kanna-oauth-pool",
                ...(session.oauthLabel ? { organization: session.oauthLabel } : {}),
                ...(session.oauthKeyMasked ? { oauthKeyMasked: session.oauthKeyMasked } : {}),
              }
            } else if (session.oauthKeyMasked && !accountInfo.oauthKeyMasked) {
              augmented = { ...accountInfo, oauthKeyMasked: session.oauthKeyMasked }
            }
          }
          await deps.store.appendMessage(args.chatId, timestamped({ kind: "account_info", accountInfo: augmented }))
          deps.emitStateChange(args.chatId)
        }
      })
      .catch(() => undefined)
  }

  if (providerUsesSdkSession(args.provider)) {
    const session = deps.claudeSessions.get(args.chatId)
    if (!session) {
      throw new Error("SDK session was not initialized")
    }
    const promptSeq = session.nextPromptSeq + 1
    session.nextPromptSeq = promptSeq
    session.pendingPromptSeqs.push(promptSeq)
    session.cancelledResultPending = 0
    active.claudePromptSeq = promptSeq
    logClaudeSteer("claude_prompt_sent", {
      chatId: args.chatId,
      sessionId: session.id,
      promptSeq,
      activeStatus: active.status,
      contentPreview: args.content.slice(0, 160),
      pendingPromptSeqs: [...session.pendingPromptSeqs],
    })
    await session.session.sendPrompt(promptContent)
    session.lastUsedAt = Date.now()
    logSendToStartingProfile(args.profile, "start_turn.claude_prompt_sent", {
      chatId: args.chatId,
    })
    return
  }

  void deps.runTurn(active)
}
