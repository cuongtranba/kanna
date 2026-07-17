/**
 * Turn spawning pipeline for AgentCoordinator.
 *
 * Extracted from agent.ts to reduce file size. Contains the two adjacent
 * private methods that form the "spawn and route" logic:
 *   - startTurnForChat   — validates state, appends user prompt, records turn_started
 *   - startTurnAfterTurnStarted — picks provider, spawns session, routes to codec
 *
 * All IO is delegated through the StartTurnDeps interface; this file is pure
 * orchestration and therefore does NOT need an `.adapter.ts` suffix.
 */
import type {
  AgentProvider,
  ChatAttachment,
  ResolvedStackBinding,
  Subagent,
  TranscriptEntry,
  ClaudeDriverPreference,
} from "../shared/types"
import { isCodexReasoningEffort, providerUsesSdkSession } from "../shared/types"
import { isClaudeSdkProvider } from "./provider-catalog"
import type { ChatRecord, ProjectRecord } from "./events"
import type { ActiveTurn, ClaudeSessionState } from "./claude-session-state"
import type { AnyValue } from "../shared/errors"
import type { HarnessTurn, HarnessToolRequest } from "./harness-types"
import type { EventStore } from "./event-store"
import type { CodexAppServerManager } from "./codex-app-server"
import type { SubagentOrchestrator } from "./subagent-orchestrator"
import { OAuthPoolUnavailableError } from "./oauth-errors"
import { buildPromptText } from "./claude-prompt-helpers"
import { buildHistoryPrimer, shouldInjectPrimer } from "./history-primer"
import { fallbackTitleFromMessage } from "./generate-title"
import { parseMentions, type ParsedMention } from "./mention-parser"
import { resolveSpawnPaths, resolveStackProjects } from "./claude-session-config"
import { timestamped } from "./claude-message-normalizer"
import {
  logClaudeSteer,
  logSendToStartingProfile,
  type SendToStartingProfile,
} from "./claude-steer-log"
import { log } from "../shared/log"
import { LOG_PREFIX } from "../shared/branding"

// ---------------------------------------------------------------------------
// Dep types
// ---------------------------------------------------------------------------

/** Args for the inner startClaudeTurn dep — mirrors the private method signature. */
export interface StartClaudeTurnArgs {
  chatId: string
  projectId: string
  localPath: string
  additionalDirectories?: string[]
  stackProjects?: ResolvedStackBinding[]
  model: string
  effort?: string
  planMode: boolean
  sessionToken: string | null
  forkSession: boolean
  onToolRequest: (request: HarnessToolRequest) => Promise<AnyValue>
  provider: AgentProvider
}

/** Args for recreateActiveTurnFromSession dep — mirrors the private method signature. */
export interface RecreateActiveTurnArgs {
  chatId: string
  provider: AgentProvider
  model: string
  effort?: string
  serviceTier?: "fast"
  planMode: boolean
  clientTraceId?: string
}

/** AppSettings snapshot fields consumed by this module. */
export interface StartTurnAppSettings {
  globalPromptAppend?: string
}

/**
 * All AgentCoordinator fields / methods accessed by the turn spawning pipeline.
 * Passed as a single deps argument to the two extracted functions.
 */
export interface StartTurnDeps {
  // Maps (mutable — methods read and write these)
  activeTurns: Map<string, ActiveTurn>
  claudeSessions: Map<string, ClaudeSessionState>
  drainingStreams: Map<string, { turn: HarnessTurn }>
  mentionedSubagentIdsByChat: Map<string, string[]>

  // Service objects
  store: EventStore
  codexManager: CodexAppServerManager
  subagentOrchestrator: Pick<SubagentOrchestrator, "clearChatCancellation">

  // Callbacks for private AgentCoordinator methods
  clearDrainingStream: (chatId: string) => void
  emitStateChange: (chatId: string, options?: { immediate?: boolean }) => void
  resolveClaudeDriverPreference: () => ClaudeDriverPreference
  getSubagents: () => Subagent[]
  getAppSettingsSnapshot: () => StartTurnAppSettings
  /** Fired in background (return value discarded). */
  generateTitleInBackground: (chatId: string, content: string, localPath: string, optimisticTitle: string) => Promise<void>
  recreateActiveTurnFromSession: (args: RecreateActiveTurnArgs) => ActiveTurn | undefined
  startClaudeTurn: (args: StartClaudeTurnArgs) => Promise<HarnessTurn>
  findLastUserMessageId: (chatId: string) => string | null
  /** Fires the runTurn loop (return value discarded). */
  runTurn: (active: ActiveTurn) => void
}

// ---------------------------------------------------------------------------
// Arg types (mirror the private method signatures)
// ---------------------------------------------------------------------------

export interface StartTurnForChatArgs {
  chatId: string
  provider: AgentProvider
  content: string
  attachments: ChatAttachment[]
  model: string
  effort?: string
  serviceTier?: "fast"
  planMode: boolean
  appendUserPrompt: boolean
  steered?: boolean
  autoContinue?: { scheduleId: string }
  userClearedContext?: boolean
  profile?: SendToStartingProfile | null
}

interface StartTurnAfterTurnStartedCtx {
  args: StartTurnForChatArgs
  chat: ChatRecord
  project: ProjectRecord
  existingMessages: TranscriptEntry[]
  shouldGenerateTitle: boolean
  optimisticTitle: string | null
  appendedUserMessageId: string | null
}

// ---------------------------------------------------------------------------
// Extracted functions
// ---------------------------------------------------------------------------

/**
 * Extracted from AgentCoordinator.startTurnForChat.
 *
 * Validates pre-conditions, appends the user prompt, records turn_started,
 * then delegates to startTurnAfterTurnStarted.
 */
export async function startTurnForChat(
  deps: StartTurnDeps,
  args: StartTurnForChatArgs,
): Promise<void> {
  logSendToStartingProfile(args.profile, "start_turn.begin", {
    chatId: args.chatId,
    provider: args.provider,
    appendUserPrompt: args.appendUserPrompt,
    planMode: args.planMode,
  })

  // Close any lingering draining stream before starting a new turn.
  const draining = deps.drainingStreams.get(args.chatId)
  if (draining) {
    draining.turn.close()
    deps.clearDrainingStream(args.chatId)
  }

  // A new user turn implicitly clears any prior cancellation marker —
  // otherwise a Stop-then-resend cycle wedges every delegate_subagent
  // call in this chat with "Chat cancelled before run started" until
  // process restart. Mirrors the clear already done by
  // runMentionsForUserMessage for the @mention path.
  deps.subagentOrchestrator.clearChatCancellation(args.chatId)

  const chat = deps.store.requireChat(args.chatId)
  if (deps.activeTurns.has(args.chatId)) {
    throw new Error("Chat is already running")
  }

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

  const existingMessages = deps.store.getMessages(args.chatId)
  const shouldGenerateTitle = args.appendUserPrompt && chat.title === "New Chat" && existingMessages.length === 0
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

  try {
    await startTurnAfterTurnStarted(deps, {
      args,
      chat,
      project,
      existingMessages,
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
    // OAuth-pool refusal: persist the formatted refusal (with chat-link
    // markdown produced by `buildPoolUnavailableMessage`) as a `result`
    // transcript entry so the UI's transcript renders it inline and
    // durably, instead of relying on the ephemeral commandError banner
    // that gets wiped by the next chat snapshot tick.
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
    // Swallow refusals — the transcript entry above is the user-facing
    // signal. Re-throwing would surface a transient commandError banner
    // that races with snapshot ticks and visibly flickers (see #235).
    if (isOAuthRefusal) {
      return
    }
    throw error
  }
}

/**
 * Extracted from AgentCoordinator.startTurnAfterTurnStarted.
 *
 * Picks provider, resolves session tokens / priming, spawns the SDK/PTY
 * claude session or Codex turn, registers the ActiveTurn, and routes to
 * the codec (runTurn vs sendPrompt on the SDK queue).
 */
async function startTurnAfterTurnStarted(
  deps: StartTurnDeps,
  ctx: StartTurnAfterTurnStartedCtx,
): Promise<void> {
  const { args, chat, project, existingMessages, shouldGenerateTitle, optimisticTitle, appendedUserMessageId } = ctx
  if (shouldGenerateTitle) {
    void deps.generateTitleInBackground(args.chatId, args.content, project.localPath, optimisticTitle ?? "New Chat")
  }

  const onToolRequest = async (request: HarnessToolRequest): Promise<AnyValue> => {
    let active = deps.activeTurns.get(args.chatId)
    if (!active) {
      // The prior turn's `result` event already deleted the activeTurn, but
      // the Claude SDK fired another `canUseTool` — happens when the SDK
      // self-resumes after a background task notification. Re-promote a
      // minimal activeTurn from the live session so the question renders
      // instead of failing with "Chat turn ended unexpectedly".
      active = deps.recreateActiveTurnFromSession(args)
      if (!active) {
        throw new Error("Chat turn ended unexpectedly")
      }
    }

    active.status = "waiting_for_user"
    active.waitStartedAt = Date.now()
    deps.emitStateChange(args.chatId)

    // Capture in a const to give TypeScript a stable narrowed reference inside
    // the Promise executor (re-assignment to `active` after the if-block could
    // theoretically happen but doesn't in practice; const makes the intent clear).
    const narrowedActive = active
    return await new Promise<AnyValue>((resolve) => {
      narrowedActive.pendingTool = {
        toolUseId: request.tool.toolId,
        tool: request.tool,
        resolve,
      }
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
  const userPromptText = buildPromptText(args.content, args.attachments)
  const primer = shouldPrime
    ? buildHistoryPrimer(existingMessages, targetProvider, userPromptText)
    : null
  const promptContent = primer ?? userPromptText

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
      stackProjects: resolveStackProjects(chat, (id) => deps.store.getProject(id)?.title),
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
    // Codex single-cwd: peer worktrees not passed to startSession. Cross-root writes use grantRoot.
    const sessionToken = await deps.codexManager.startSession({
      chatId: args.chatId,
      cwd: resolveSpawnPaths(chat, project.localPath).cwd,
      projectId: project.id,
      model: args.model,
      serviceTier: args.serviceTier,
      sessionToken: existingToken,
      pendingForkSessionToken: pendingForkToken,
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
      developerInstructions: deps.getAppSettingsSnapshot().globalPromptAppend,
    })
    logSendToStartingProfile(args.profile, "start_turn.provider_boot.ready", {
      chatId: args.chatId,
      provider: args.provider,
      model: args.model,
    })
  }

  const active: ActiveTurn = {
    chatId: args.chatId,
    provider: args.provider,
    turn,
    model: args.model,
    effort: args.effort,
    serviceTier: args.serviceTier,
    planMode: args.planMode,
    status: args.provider === "claude" ? "running" : "starting",
    pendingTool: null,
    postToolFollowUp: null,
    hasFinalResult: false,
    cancelRequested: false,
    cancelRecorded: false,
    clientTraceId: args.profile?.traceId,
    profilingStartedAt: args.profile?.startedAt,
    waitStartedAt: null,
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
          // OpenRouter routes through the SDK with ANTHROPIC_AUTH_TOKEN set to
          // the OpenRouter key, so the SDK self-reports tokenSource
          // "ANTHROPIC_AUTH_TOKEN" with no account — mislabeling the chat as
          // Anthropic. Override with the OpenRouter identity instead.
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
            // Mirror the PTY driver's deriveAccountInfoFromOauth: when the
            // turn was started with a kanna OAuth-pool token, surface its
            // name as organization and tag the source so the UI renders
            // "Pool token" identically across drivers. SDK-reported extras
            // (email, subscriptionType) are preserved.
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
    // claude and openrouter both deliver their prompt through the SDK
    // session queue; gating this on `=== "claude"` is what left openrouter's
    // prompt undelivered, hanging every openrouter turn until the watchdog.
    const session = deps.claudeSessions.get(args.chatId)
    if (!session) {
      throw new Error("SDK session was not initialized")
    }
    const promptSeq = session.nextPromptSeq + 1
    session.nextPromptSeq = promptSeq
    session.pendingPromptSeqs.push(promptSeq)
    // A new turn starts: clear any stale cancellation marker so a previous
    // cancel that never produced a tail result can't suppress this turn's
    // real result.
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
