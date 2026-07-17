/**
 * Standalone Claude session spawner — the logic extracted from the private
 * `startClaudeTurn` method of AgentCoordinator.
 *
 * Responsibilities:
 *   - Decide whether an existing session can be reused or must be evicted and
 *     replaced (localPath / effort / forkSession / loop-armed flip).
 *   - Pick an OAuth pool token, look up OpenRouter pricing, build the system
 *     prompt append and delegation context, then spawn the ClaudeSessionHandle
 *     via either the PTY or SDK driver.
 *   - Register the new ClaudeSessionState in the claudeSessions map, fire
 *     enforceClaudeSessionBudget, start the session event loop, and load slash
 *     commands in the background.
 *   - When reusing an existing session: update lastUsedAt, call setModel /
 *     setPermissionMode if the options changed.
 *   - Return a HarnessTurn built from the session handle.
 *
 * Side-effect seal: this module contains NO direct IO (no node:fs, no HTTP
 * calls, no Bun primitives). Every effectful operation is injected through
 * SpawnClaudeTurnDeps so the module remains testable without real drivers.
 */

import type { AnyValue } from "../shared/errors"
import type {
  AgentProvider,
  ClaudeDriverPreference,
  LlmProviderSnapshot,
  McpServerConfig,
  OpenRouterModel,
  ResolvedStackBinding,
  Subagent,
} from "../shared/types"
import { buildKannaSystemPromptAppend } from "../shared/kanna-system-prompt"
import { resolveModelPrice, stripModelVariantSuffix } from "../shared/token-pricing"
import type { ModelPrice } from "../shared/token-pricing"
import { maskOauthKey } from "../shared/mask-oauth-key"
import { log } from "../shared/log"
import { OAuthPoolUnavailableError } from "./oauth-errors"
import type { ClaudeSessionHandle, HarnessTurn, HarnessToolRequest } from "./harness-types"
import type { ActiveTurn, ClaudeSessionState, SlashCommand } from "./claude-session-state"
import type { KannaMcpDelegationContext, SetupLoopHandlerResult } from "./kanna-mcp"
import type { LoopSetupInput } from "./loop-template"
import type { LoopState } from "./auto-continue/read-model"
import type { ChatPermissionPolicy } from "../shared/permission-policy"
import type { OrchRunDetail, OrchRunInput } from "../shared/orchestration-types"
import type { StartClaudeSessionPtyArgs } from "./claude-pty/driver"
import type { SubagentOrchestrator } from "./subagent-orchestrator"
import type { TunnelGateway } from "./cloudflare-tunnel/gateway"
import type { ToolCallbackService } from "./tool-callback"
import type { ClaudePtyRegistry } from "./claude-pty/pid-registry.adapter"
import type { PtyInstanceRegistry } from "./claude-pty/pty-instance-registry"
import type { WorkflowRegistry } from "./workflow-registry"
import type { SubagentTranscriptRegistry } from "./subagent-transcript-registry"
// Type-only import from the SDK session start module — no IO is pulled in.
import type { startClaudeSession as StartClaudeSessionFn } from "./claude-session-start"

// ---------------------------------------------------------------------------
// Minimal structural interfaces — only the operations this module calls.
// ---------------------------------------------------------------------------

/** Subset of OAuthTokenPool used by spawnClaudeTurn. */
interface SpawnOAuthPool {
  pickActive(chatId: string): { id: string; token: string; label: string } | null | undefined
  hasAnyToken(): boolean
  markUsed(tokenId: string): void
  release(chatId: string): void
}

/** Subset of EventStore used by spawnClaudeTurn (only for slash-command load). */
interface SpawnStore {
  recordSessionCommandsLoaded(chatId: string, commands: SlashCommand[]): Promise<void>
}

// ---------------------------------------------------------------------------
// Exported arg types
// ---------------------------------------------------------------------------

/** Arguments for spawnClaudeTurn — mirrors the private startClaudeTurn args. */
export interface SpawnClaudeTurnArgs {
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

// ---------------------------------------------------------------------------
// Dependency bundle
// ---------------------------------------------------------------------------

/**
 * All AgentCoordinator fields and methods accessed by spawnClaudeTurn.
 *
 * Mutable maps are passed directly; private methods are exposed as function
 * references so the extracted function can be tested independently.
 */
export interface SpawnClaudeTurnDeps {
  // Mutable session state maps
  claudeSessions: Map<string, ClaudeSessionState>
  activeTurns: Map<string, ActiveTurn>
  mentionedSubagentIdsByChat: Map<string, string[]>

  // OAuth pool (structural subset)
  oauthPool: SpawnOAuthPool | null

  // Store (structural subset)
  store: SpawnStore

  // Session-start function references (injected so tests can stub them)
  startClaudeSessionFn: typeof StartClaudeSessionFn
  startClaudeSessionPTYFn: (args: StartClaudeSessionPtyArgs) => Promise<ClaudeSessionHandle>

  // Opaque state references passed through to the start functions
  subagentOrchestrator: SubagentOrchestrator
  toolCallback: ToolCallbackService | null
  tunnelGateway: TunnelGateway | null
  claudePtyRegistry: ClaudePtyRegistry | null
  ptyInstanceRegistry: PtyInstanceRegistry | null
  workflowRegistry: WorkflowRegistry | null
  subagentTranscriptRegistry: SubagentTranscriptRegistry | null

  // Method references for private AgentCoordinator helpers
  resolveClaudeDriverPreference: () => ClaudeDriverPreference
  isLoopArmed: (chatId: string) => LoopState | null
  closeClaudeSession: (chatId: string, session: ClaudeSessionState) => void
  enforceClaudeSessionBudget: (protectedChatId?: string) => void
  readLlmProvider: () => Promise<LlmProviderSnapshot>
  buildPoolUnavailableMessage: (reservedFor: string, scopeSuffix: string) => string
  listOpenRouterModelsFn: (() => Promise<OpenRouterModel[]>) | null
  getSubagents: () => Subagent[]
  getAppSettingsSnapshot: () => { globalPromptAppend?: string }
  getEnabledCustomMcpServers: () => readonly McpServerConfig[]
  buildOAuthBearers: (servers: readonly McpServerConfig[]) => Promise<Map<string, string>>
  setupLoop: (chatId: string, input: LoopSetupInput) => Promise<SetupLoopHandlerResult>
  stopLoop: (chatId: string, reason: "goal_met" | "user_send" | "chat_deleted") => Promise<void>
  runOrchestration: (
    chatId: string,
    input: OrchRunInput,
  ) => Promise<{ ok: true; runId: string } | { ok: false; errors: string[] }>
  cancelOrchRun: (runId: string) => Promise<void>
  getOrchRunDetail: (runId: string) => OrchRunDetail | null
  resolveChatPolicy: (chatId: string) => ChatPermissionPolicy
  /** Fires the session event loop. Return value is discarded (fire-and-forget). */
  runClaudeSession: (session: ClaudeSessionState) => void
  mergeLocalCatalog: (commands: SlashCommand[], cwd: string) => SlashCommand[]
  emitStateChange: (chatId: string) => void
}

// ---------------------------------------------------------------------------
// Core function
// ---------------------------------------------------------------------------

/**
 * Spawns or reuses a Claude session for a chat turn.
 *
 * Extracted from AgentCoordinator.startClaudeTurn. Behavior is identical to
 * the original private method; all side-effectful operations are injected via
 * `deps`.
 *
 * Returns a HarnessTurn that delegates interrupt / getAccountInfo to the live
 * session handle. The stream is empty (the event loop in runClaudeSession is
 * the actual reader).
 */
export async function spawnClaudeTurn(
  deps: SpawnClaudeTurnDeps,
  args: SpawnClaudeTurnArgs,
): Promise<HarnessTurn> {
  let session = deps.claudeSessions.get(args.chatId)

  const driverIsPty = args.provider !== "openrouter"
    && deps.resolveClaudeDriverPreference() === "pty"
  const loopArmedNow = deps.isLoopArmed(args.chatId) !== null

  if (
    !session ||
    session.localPath !== args.localPath ||
    session.effort !== args.effort ||
    args.forkSession ||
    session.additionalDirectories.join("|") !== (args.additionalDirectories ?? []).join("|") ||
    // Both drivers bake the loop tool-block into the spawn (PTY via
    // --disallowedTools CLI args, SDK via options.disallowedTools), so an
    // armed-state flip (arm OR disarm) requires a fresh session. The SDK's
    // dynamic canUseTool deny remains as belt-and-suspenders mid-turn.
    session.loopArmedAtSpawn !== loopArmedNow
  ) {
    if (session) {
      deps.closeClaudeSession(args.chatId, session)
    }

    deps.enforceClaudeSessionBudget(args.chatId)
    const isOpenRouter = args.provider === "openrouter"
    const openrouterApiKey = isOpenRouter ? (await deps.readLlmProvider()).apiKey : null
    const picked = isOpenRouter ? null : (deps.oauthPool?.pickActive(args.chatId) ?? null)
    // If the pool is populated but every token is currently unusable
    // (limited/error/disabled/reserved), refuse to spawn rather than let
    // the CLI fall back to its keychain auth — that path serves whichever
    // login the CLI binary's keychain holds, which is typically
    // expired in a pool-managed setup and produces opaque 401 loops.
    if (!isOpenRouter && deps.oauthPool && deps.oauthPool.hasAnyToken() && !picked) {
      throw new OAuthPoolUnavailableError(deps.buildPoolUnavailableMessage(args.chatId, ""))
    }
    if (picked) deps.oauthPool!.markUsed(picked.id)

    let openrouterTurnPrice: ModelPrice | null = null
    let openrouterContextWindow: number | undefined
    if (isOpenRouter && deps.listOpenRouterModelsFn) {
      try {
        const models = await deps.listOpenRouterModelsFn()
        // OpenRouter routing variants (":nitro", ":floor", ...) aren't their
        // own /models entries — fall back to the base id for pricing/context.
        const baseModelId = stripModelVariantSuffix(args.model)
        const m = models.find((x) => x.id === args.model)
          ?? models.find((x) => x.id === baseModelId)
        openrouterTurnPrice = resolveModelPrice(baseModelId, m?.pricing ?? null)
        if (m && m.contextLength > 0) openrouterContextWindow = m.contextLength
      } catch (err) {
        log.warn("[kanna/agent] openrouter pricing lookup failed", String(err))
      }
    }

    const usePty = driverIsPty
    const systemPromptAppend = buildKannaSystemPromptAppend(deps.getSubagents(), {
      globalPromptAppend: deps.getAppSettingsSnapshot().globalPromptAppend,
      stackProjects: args.stackProjects,
    })
    const chatIdForCtx = args.chatId
    const delegationContext: KannaMcpDelegationContext = {
      parentSubagentId: null,
      parentRunId: null,
      ancestorSubagentIds: [],
      depth: 0,
      getParentUserMessageId: () => deps.activeTurns.get(chatIdForCtx)?.userMessageId ?? null,
      getMentionedSubagentIds: () => deps.mentionedSubagentIdsByChat.get(chatIdForCtx) ?? [],
    }
    const enabledMcpServers = deps.getEnabledCustomMcpServers()
    const oauthBearers = await deps.buildOAuthBearers(enabledMcpServers)
    let started: ClaudeSessionHandle
    try {
      started = usePty
        ? await deps.startClaudeSessionPTYFn({
            chatId: args.chatId,
            projectId: args.projectId,
            localPath: args.localPath,
            model: args.model,
            effort: args.effort,
            planMode: args.planMode,
            sessionToken: args.sessionToken,
            forkSession: args.forkSession,
            oauthToken: picked?.token ?? null,
            oauthLabel: picked?.label,
            oauthKeyMasked: picked ? maskOauthKey(picked.token) : undefined,
            additionalDirectories: args.additionalDirectories,
            onToolRequest: args.onToolRequest,
            systemPromptAppend,
            subagentOrchestrator: deps.subagentOrchestrator,
            delegationContext,
            setupLoop: delegationContext.depth === 0
              ? (input) => deps.setupLoop(chatIdForCtx, input)
              : undefined,
            stopLoop: delegationContext.depth === 0
              ? () => deps.stopLoop(chatIdForCtx, "goal_met")
              : undefined,
            isLoopArmed: delegationContext.depth === 0
              ? () => deps.isLoopArmed(chatIdForCtx) !== null
              : undefined,
            runOrch: delegationContext.depth === 0
              ? (input) => deps.runOrchestration(chatIdForCtx, input)
              : undefined,
            cancelOrchRun: delegationContext.depth === 0
              ? (runId) => deps.cancelOrchRun(runId)
              : undefined,
            getOrchRunStatus: delegationContext.depth === 0
              ? (runId) => deps.getOrchRunDetail(runId)
              : undefined,
            toolCallback: deps.toolCallback ?? undefined,
            tunnelGateway: deps.tunnelGateway,
            chatPolicy: deps.resolveChatPolicy(args.chatId),
            ptyRegistry: deps.claudePtyRegistry ?? undefined,
            ptyInstanceRegistry: deps.ptyInstanceRegistry ?? undefined,
            workflowRegistry: deps.workflowRegistry ?? undefined,
            subagentTranscriptRegistry: deps.subagentTranscriptRegistry ?? undefined,
            customMcpServers: enabledMcpServers,
            oauthBearers,
          })
        : await deps.startClaudeSessionFn({
            projectId: args.projectId,
            localPath: args.localPath,
            model: args.model,
            effort: args.effort,
            planMode: args.planMode,
            sessionToken: args.sessionToken,
            forkSession: args.forkSession,
            oauthToken: picked?.token ?? null,
            openrouterApiKey,
            additionalDirectories: args.additionalDirectories,
            chatId: args.chatId,
            tunnelGateway: deps.tunnelGateway,
            onToolRequest: args.onToolRequest,
            systemPromptAppend,
            subagentOrchestrator: deps.subagentOrchestrator,
            delegationContext,
            setupLoop: delegationContext.depth === 0
              ? (input) => deps.setupLoop(chatIdForCtx, input)
              : undefined,
            stopLoop: delegationContext.depth === 0
              ? () => deps.stopLoop(chatIdForCtx, "goal_met")
              : undefined,
            isLoopArmed: delegationContext.depth === 0
              ? () => deps.isLoopArmed(chatIdForCtx) !== null
              : undefined,
            runOrch: delegationContext.depth === 0
              ? (input) => deps.runOrchestration(chatIdForCtx, input)
              : undefined,
            cancelOrchRun: delegationContext.depth === 0
              ? (runId) => deps.cancelOrchRun(runId)
              : undefined,
            getOrchRunStatus: delegationContext.depth === 0
              ? (runId) => deps.getOrchRunDetail(runId)
              : undefined,
            toolCallback: deps.toolCallback ?? undefined,
            chatPolicy: deps.resolveChatPolicy(args.chatId),
            customMcpServers: enabledMcpServers,
            oauthBearers,
            turnPrice: openrouterTurnPrice,
            contextWindowOverride: openrouterContextWindow,
          })
    } catch (err) {
      // Spawn failed before we registered the session — release the OAuth
      // pool reservation. Without this the token stays "in use" until process
      // restart, eventually starving every chat once all tokens are reserved.
      if (picked) deps.oauthPool?.release(args.chatId)
      throw err
    }

    session = {
      id: crypto.randomUUID(),
      chatId: args.chatId,
      session: started,
      localPath: args.localPath,
      additionalDirectories: args.additionalDirectories ?? [],
      model: args.model,
      effort: args.effort,
      planMode: args.planMode,
      sessionToken: args.sessionToken,
      accountInfoLoaded: false,
      nextPromptSeq: 0,
      pendingPromptSeqs: [],
      activeTokenId: picked?.id ?? null,
      oauthKeyMasked: picked ? maskOauthKey(picked.token) : null,
      oauthLabel: picked?.label ?? null,
      openrouterKeyMasked: openrouterApiKey ? maskOauthKey(openrouterApiKey) : null,
      openrouterModel: isOpenRouter ? args.model : null,
      lastUsedAt: Date.now(),
      backgroundTaskIds: new Set<string>(),
      backgroundTaskDeadlineAt: 0,
      loopArmedAtSpawn: loopArmedNow,
      cancelledResultPending: 0,
      suppressSessionTokenPersist: false,
    }
    deps.claudeSessions.set(args.chatId, session)
    deps.enforceClaudeSessionBudget(args.chatId)
    void deps.runClaudeSession(session)
    void (async () => {
      try {
        const commands = await started.getSupportedCommands()
        const merged = deps.mergeLocalCatalog(commands, args.localPath)
        await deps.store.recordSessionCommandsLoaded(args.chatId, merged)
        deps.emitStateChange(args.chatId)
      } catch (error) {
        log.warn("[kanna/agent] failed to load slash commands", String(error))
      }
    })()
  } else {
    session.lastUsedAt = Date.now()
    if (session.model !== args.model) {
      await session.session.setModel(args.model)
      session.model = args.model
    }
    if (session.planMode !== args.planMode) {
      await session.session.setPermissionMode(args.planMode)
      session.planMode = args.planMode
    }
  }

  return {
    provider: "claude",
    stream: {
      async *[Symbol.asyncIterator]() {},
    },
    getAccountInfo: session.session.getAccountInfo,
    interrupt: session.session.interrupt,
    close: () => {},
  }
}
