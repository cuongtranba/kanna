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
import type { ActiveTurn, ClaudeSessionState, StartingTurn } from "./claude-session-state"
import type { PendingToolSlots } from "./pending-tool-slot"
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
import { withSpan } from "./observability"
import { LOG_PREFIX } from "../shared/branding"

const PRIMER_TAIL_LIMIT = 1000

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
  /**
   * Turns whose provider session is still booting. Registered synchronously
   * here before the first `await` and removed in a `finally`, so cancel /
   * send-queueing / status derivation all see the chat as busy during the
   * spawn window.
   */
  startingTurns: Map<string, StartingTurn>
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
  /**
   * Tear down a Claude session. Only used when a cancel lands mid-boot under
   * the PTY driver, where interrupting the fresh turn kills the CLI and the
   * session in `claudeSessions` is left dead.
   */
  closeClaudeSession: (chatId: string, session: ClaudeSessionState) => void
  getSubagents: () => Subagent[]
  getAppSettingsSnapshot: () => StartTurnAppSettings
  /** Fired in background (return value discarded). */
  generateTitleInBackground: (chatId: string, content: string, localPath: string, optimisticTitle: string) => Promise<void>
  pendingTools: PendingToolSlots
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
  cronRun?: import("../shared/cron/types").CronRunTag
  userClearedContext?: boolean
  profile?: SendToStartingProfile | null
  /**
   * Invoked once `turn_started` is durably recorded — the point after which
   * this turn is replayable from the event log. Callers that hold the turn's
   * only durable trigger (a queued message) release it here, so a crash
   * before this point leaves the trigger intact instead of losing the turn.
   */
  onTurnRecorded?: () => Promise<void>
}

interface StartTurnAfterTurnStartedCtx {
  args: StartTurnForChatArgs
  /** This boot's marker — checked once the provider session resolves. */
  starting: StartingTurn
  chat: ChatRecord
  project: ProjectRecord
  /** Lazy: reads recent tail entries for primer injection — avoids loading the full transcript. */
  loadExistingMessages: () => readonly TranscriptEntry[]
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
  if (deps.activeTurns.has(args.chatId) || deps.startingTurns.has(args.chatId)) {
    throw new Error("Chat is already running")
  }

  // Claim the chat BEFORE the first await. Everything from here to the
  // `activeTurns.set` below is async (store writes, then a full provider
  // session spawn), and until this marker existed the chat looked idle to
  // cancel, to `chat.send`, and to the snapshot — so Stop silently no-oped
  // and a second send raced in a concurrent turn.
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
    // Identity-guarded: a cancel may have removed this marker and a newer turn
    // may have registered its own. Only ever clear our own.
    if (deps.startingTurns.get(args.chatId) === starting) {
      deps.startingTurns.delete(args.chatId)
    }
  }
}

/**
 * The original body of `startTurnForChat`, minus the starting-marker
 * bookkeeping its caller now owns.
 */
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

  // Both reads below are lazy on purpose. The `&&` chain short-circuits for
  // any chat that already has a title, and the primer thunk runs only when
  // a primer is actually built. getRecentRawEntries reads only the tail via
  // readTranscriptTail — avoids loading a multi-MB transcript for every loop
  // iteration where shouldInjectPrimer is true (session_token cleared by /clear).
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
  const { args, starting, chat, project, loadExistingMessages, shouldGenerateTitle, optimisticTitle, appendedUserMessageId } = ctx
  if (shouldGenerateTitle) {
    void deps.generateTitleInBackground(args.chatId, args.content, project.localPath, optimisticTitle ?? "New Chat")
  }

  const onToolRequest = async (request: HarnessToolRequest): Promise<AnyValue> => {
    // The request may arrive OUTSIDE any Kanna turn — the SDK self-resumes
    // after a background-task notification and calls `canUseTool` with the
    // prior turn long finalized. The parked continuation lives in the
    // per-chat PendingToolSlots either way; when a turn IS live, its status
    // additionally flips to waiting_for_user for the composer.
    const active = deps.activeTurns.get(args.chatId)
    if (active) {
      active.status = "waiting_for_user"
      active.waitStartedAt = Date.now()
    }
    deps.emitStateChange(args.chatId)

    return await new Promise<AnyValue>((resolve) => {
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
  const userPromptText = buildPromptText(args.content, args.attachments)
  const primer = shouldPrime
    ? buildHistoryPrimer(loadExistingMessages(), targetProvider, userPromptText)
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

  // Stop landed while the provider session was booting. `cancelChat` has
  // already written the `interrupted` entry and flipped the chat to idle, so
  // tear the freshly-spawned turn down silently — never register it, never
  // run it.
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
      // best-effort — close() below is the backstop
    }
    turn.close()
    // Under PTY the turn handle is a ghost facade over the long-lived session
    // and interrupt() sends SIGINT, killing the CLI — drop the dead session so
    // the next turn respawns. Mirrors the active-turn path in
    // claude-cancel-handler.ts.
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
    // Binds the turn to the session it runs on, so that session can still
    // recognise (and fail-close) its own turn after an out-of-band teardown
    // has unregistered it. Undefined for providers with no Claude session.
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
