
import type { JsonValue } from "../shared/json"
import type {
  AgentProvider,
  ClaudeDriverPreference,
  LlmProviderSnapshot,
  McpServerConfig,
  OpenRouterModel,
  ResolvedStackBinding,
  Subagent,
} from "../shared/types"
import { buildKannaSystemPromptAppend, type KannaSystemPromptOptions } from "../shared/kanna-system-prompt"
import { resolveModelPrice, stripModelVariantSuffix } from "../shared/token-pricing"
import type { ModelPrice } from "../shared/token-pricing"
import { maskOauthKey } from "../shared/mask-oauth-key"
import { log } from "../shared/log"
import { OAuthPoolUnavailableError } from "./oauth-errors"
import type { ClaudeSessionHandle, HarnessTurn, HarnessToolRequest } from "./harness-types"
import { ClaudeSessionState } from "./claude-session-state"
import type { ActiveTurn, SessionBackgroundTask } from "./claude-session-state"
import type { KannaMcpDelegationContext, SetupLoopHandlerResult } from "./kanna-mcp"
import type { LoopSetupInput } from "./loop-template"
import type { BoardRegistry } from "./board-registry"
import type { LoopState } from "./auto-continue/read-model"
import { toArmedLoopInfo } from "./claude-loop-commands"
import type { ChatPermissionPolicy } from "../shared/permission-policy"
import type { StartClaudeSessionPtyArgs } from "./claude-pty/driver"
import type { SubagentOrchestrator } from "./subagent-orchestrator"
import type { TunnelGateway } from "./cloudflare-tunnel/gateway"
import type { ToolCallbackService } from "./tool-callback"
import type { ClaudePtyRegistry } from "./claude-pty/pid-registry.adapter"
import type { PtyInstanceRegistry } from "./claude-pty/pty-instance-registry"
import type { WorkflowRegistry } from "./workflow-registry"
import type { SubagentTranscriptRegistry } from "./subagent-transcript-registry"
import type { startClaudeSession as StartClaudeSessionFn } from "./claude-session-start"


interface SpawnOAuthPool {
  pickActive(chatId: string): { id: string; token: string; label: string } | null | undefined
  hasAnyToken(): boolean
  markUsed(tokenId: string): void
  release(chatId: string): void
}


export interface SpawnClaudeTurnArgs {
  chatId: string
  projectId: string
  localPath: string
  additionalDirectories?: string[]
  stackProjects?: ResolvedStackBinding[]
  instructions?: Omit<KannaSystemPromptOptions, "stackProjects">
  model: string
  effort?: string
  planMode: boolean
  sessionToken: string | null
  forkSession: boolean
  onToolRequest: (request: HarnessToolRequest) => Promise<JsonValue>
  provider: AgentProvider
}


export interface SpawnClaudeTurnDeps {
  claudeSessions: Map<string, ClaudeSessionState>
  activeTurns: Map<string, ActiveTurn>
  mentionedSubagentIdsByChat: Map<string, string[]>

  oauthPool: SpawnOAuthPool | null

  startClaudeSessionFn: typeof StartClaudeSessionFn
  startClaudeSessionPTYFn: (args: StartClaudeSessionPtyArgs) => Promise<ClaudeSessionHandle>

  subagentOrchestrator: SubagentOrchestrator
  toolCallback: ToolCallbackService | null
  tunnelGateway: TunnelGateway | null
  claudePtyRegistry: ClaudePtyRegistry | null
  ptyInstanceRegistry: PtyInstanceRegistry | null
  workflowRegistry: WorkflowRegistry | null
  subagentTranscriptRegistry: SubagentTranscriptRegistry | null

  resolveClaudeDriverPreference: () => ClaudeDriverPreference
  isLoopArmed: (chatId: string) => LoopState | null
  boardRegistry?: BoardRegistry
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
  armCron: (chatId: string, command: string) => Promise<{ jobId: string }>
  updateCron?: (chatId: string, jobId: string, patch: import("../shared/cron/types").CronJobPatch) => Promise<void>
  stopLoop: (chatId: string, reason: "goal_met" | "user_send" | "chat_deleted") => Promise<void>
  resumeLoop: (chatId: string) => Promise<import("./loop-wake-recovery").ResumeLoopResult>
  resolveChatPolicy: (chatId: string) => ChatPermissionPolicy
  runClaudeSession: (session: ClaudeSessionState) => void
  emitStateChange: (chatId: string) => void
}


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
    session.loopArmedAtSpawn !== loopArmedNow
  ) {
    if (session) {
      deps.closeClaudeSession(args.chatId, session)
    }

    deps.enforceClaudeSessionBudget(args.chatId)
    const isOpenRouter = args.provider === "openrouter"
    const openrouterApiKey = isOpenRouter ? (await deps.readLlmProvider()).apiKey : null
    const picked = isOpenRouter ? null : (deps.oauthPool?.pickActive(args.chatId) ?? null)
    if (!isOpenRouter && deps.oauthPool && deps.oauthPool.hasAnyToken() && !picked) {
      throw new OAuthPoolUnavailableError(deps.buildPoolUnavailableMessage(args.chatId, ""))
    }
    if (picked) deps.oauthPool!.markUsed(picked.id)

    let openrouterTurnPrice: ModelPrice | null = null
    let openrouterContextWindow: number | undefined
    if (isOpenRouter && deps.listOpenRouterModelsFn) {
      try {
        const models = await deps.listOpenRouterModelsFn()
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
      ...args.instructions,
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
            armCron: delegationContext.depth === 0
              ? (command: string) => deps.armCron(chatIdForCtx, command)
              : undefined,
            updateCron: delegationContext.depth === 0 && deps.updateCron
              ? (jobId, patch) => deps.updateCron!(chatIdForCtx, jobId, patch)
              : undefined,
            stopLoop: delegationContext.depth === 0
              ? () => deps.stopLoop(chatIdForCtx, "goal_met")
              : undefined,
            resumeLoop: delegationContext.depth === 0
              ? () => deps.resumeLoop(chatIdForCtx)
              : undefined,
            isLoopArmed: delegationContext.depth === 0
              ? () => deps.isLoopArmed(chatIdForCtx) !== null
              : undefined,
            getArmedLoop: (id) => toArmedLoopInfo(deps.isLoopArmed(id)),
            boardRegistry: deps.boardRegistry,
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
            armCron: delegationContext.depth === 0
              ? (command: string) => deps.armCron(chatIdForCtx, command)
              : undefined,
            updateCron: delegationContext.depth === 0 && deps.updateCron
              ? (jobId, patch) => deps.updateCron!(chatIdForCtx, jobId, patch)
              : undefined,
            stopLoop: delegationContext.depth === 0
              ? () => deps.stopLoop(chatIdForCtx, "goal_met")
              : undefined,
            resumeLoop: delegationContext.depth === 0
              ? () => deps.resumeLoop(chatIdForCtx)
              : undefined,
            isLoopArmed: delegationContext.depth === 0
              ? () => deps.isLoopArmed(chatIdForCtx) !== null
              : undefined,
            getArmedLoop: (id) => toArmedLoopInfo(deps.isLoopArmed(id)),
            boardRegistry: deps.boardRegistry,
            toolCallback: deps.toolCallback ?? undefined,
            chatPolicy: deps.resolveChatPolicy(args.chatId),
            customMcpServers: enabledMcpServers,
            oauthBearers,
            turnPrice: openrouterTurnPrice,
            contextWindowOverride: openrouterContextWindow,
          })
    } catch (err) {
      if (picked) deps.oauthPool?.release(args.chatId)
      throw err
    }

    session = new ClaudeSessionState({
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
      backgroundTasks: new Map<string, SessionBackgroundTask>(),
      backgroundTaskDeadlineAt: 0,
      backgroundTaskWakeCount: 0,
      backgroundTasksLevelSourced: false,
      selfWakeActive: false,
      recentToolDescriptions: new Map<string, string>(),
      backgroundLaunchToolIds: new Set<string>(),
      loopArmedAtSpawn: loopArmedNow,
      cancelledResultPending: 0,
      suppressSessionTokenPersist: false,
      backgroundTaskWakeSuppressed: false,
    })
    deps.claudeSessions.set(args.chatId, session)
    deps.enforceClaudeSessionBudget(args.chatId)
    void deps.runClaudeSession(session)
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
