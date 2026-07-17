/**
 * Subagent provider-run wiring — standalone extraction from AgentCoordinator.
 *
 * Responsibilities:
 *   - buildClaudeSubagentStarter — builds the startClaudeSession callback for
 *     subagent runs: PTY/SDK dispatch, OAuth, MCP config, pool wiring.
 *   - buildSubagentProviderRunForChat — constructs the full ProviderRunStart
 *     bundle for a subagent run bound to a specific chat.
 *
 * Side-effect seal: this module contains NO direct IO (no node:fs, no HTTP
 * calls, no Bun primitives). Every effectful operation is injected through
 * SubagentWiringDeps so the module remains testable without real drivers.
 * The `realpath` function is injected as a dep (RealpathFn) rather than
 * imported from `paths-fs.adapter` directly.
 */

import type { AnyValue } from "../shared/errors"
import type {
  ClaudeDriverPreference,
  LlmProviderSnapshot,
  McpServerConfig,
  Subagent,
} from "../shared/types"
import type { HarnessToolRequest } from "./harness-types"
import type { ClaudeSessionHandle } from "./harness-types"
import type { KannaMcpDelegationContext } from "./kanna-mcp"
import type { ChatRecord, ProjectRecord, SubagentRunEvent } from "./events"
import type { ProviderRunStart, SubagentOrchestrator } from "./subagent-orchestrator"
import type { BuildSubagentProviderRunArgs } from "./subagent-provider-run"
import { buildSubagentProviderRun } from "./subagent-provider-run"
import type { StartClaudeSessionPtyArgs } from "./claude-pty/driver"
import type { ChatPermissionPolicy } from "../shared/permission-policy"
import type { ToolCallbackService } from "./tool-callback"
import type { TunnelGateway } from "./cloudflare-tunnel/gateway"
import type { ClaudePtyRegistry } from "./claude-pty/pid-registry.adapter"
import type { PtyInstanceRegistry } from "./claude-pty/pty-instance-registry"
import type { WorkflowRegistry } from "./workflow-registry"
import type { CodexAppServerManager } from "./codex-app-server"
import type { RealpathFn } from "./paths"
import { resolveSubagentRoots } from "./paths"
import { resolveSpawnPaths, resolveStackProjects } from "./claude-session-config"
import { openrouterAuthReady } from "./provider-catalog"
import { OAuthPoolUnavailableError } from "./oauth-errors"
// Type-only import — no IO is pulled in from the SDK session start module.
import type { startClaudeSession as StartClaudeSessionFn } from "./claude-session-start"

// ---------------------------------------------------------------------------
// Structural sub-interfaces — only the operations this module calls.
// ---------------------------------------------------------------------------

/** Subset of EventStore used by subagent wiring. */
interface SubagentWiringStore {
  requireChat(chatId: string): ChatRecord
  getProject(id: string): ProjectRecord | null | undefined
  appendSubagentEvent(event: SubagentRunEvent): Promise<void>
}

/** Subset of OAuthTokenPool used by subagent wiring. */
interface SubagentWiringOAuthPool {
  hasUsable(reservedFor?: string): boolean
  pickActive(chatId: string): { id: string; token: string; label: string } | null | undefined
  markUsed(tokenId: string): void
  hasAnyToken(): boolean
}

// ---------------------------------------------------------------------------
// Dependency bundle
// ---------------------------------------------------------------------------

/**
 * All AgentCoordinator fields and methods accessed by the subagent wiring
 * functions. Passed as a single deps object so both functions stay testable
 * without a real coordinator.
 */
export interface SubagentWiringDeps {
  // Store (structural subset — no concrete EventStore import)
  store: SubagentWiringStore

  // Session-start function references (injected so tests can stub them)
  startClaudeSessionFn: typeof StartClaudeSessionFn
  startClaudeSessionPTYFn: (args: StartClaudeSessionPtyArgs) => Promise<ClaudeSessionHandle>

  // Opaque state passed through to the start functions
  toolCallback: ToolCallbackService | null
  tunnelGateway: TunnelGateway | null
  claudePtyRegistry: ClaudePtyRegistry | null
  ptyInstanceRegistry: PtyInstanceRegistry | null
  workflowRegistry: WorkflowRegistry | null
  subagentOrchestrator: SubagentOrchestrator
  codexManager: CodexAppServerManager
  oauthPool: SubagentWiringOAuthPool | null

  // Per-run pending resolver registry (shared with the coordinator's cancel paths)
  subagentPendingResolvers: Map<string, { resolve: (v: AnyValue) => void; reject: (e: Error) => void }>

  // IO injection — realpath wraps realpathSync but is IO; inject via deps
  realpath: RealpathFn

  // Method references for private AgentCoordinator helpers
  resolveClaudeDriverPreference: () => ClaudeDriverPreference
  getEnabledCustomMcpServers: () => readonly McpServerConfig[]
  buildOAuthBearers: (servers: readonly McpServerConfig[]) => Promise<Map<string, string>>
  resolveChatPolicy: (chatId: string) => ChatPermissionPolicy
  emitStateChange: (chatId: string) => void
  buildPoolUnavailableMessage: (reservedFor: string, scopeSuffix: string) => string
  getAppSettingsSnapshot: () => {
    globalPromptAppend?: string
    claudeAuth?: { authenticated?: boolean } | null
  }
  readLlmProvider: () => Promise<LlmProviderSnapshot>
  subagentPendingKey: (chatId: string, runId: string, toolUseId: string) => string
}

// ---------------------------------------------------------------------------
// Exported args type for buildSubagentProviderRunForChat
// ---------------------------------------------------------------------------

export interface BuildSubagentProviderRunForChatArgs {
  subagent: Subagent
  chatId: string
  primer: string | null
  userInstruction: string | null
  runId: string
  abortSignal: AbortSignal
  depth: number
  ancestorSubagentIds: string[]
  parentUserMessageId: string
  /**
   * Orchestration workers run in an isolated git worktree, not the chat cwd.
   * When set, this overrides the resolved cwd, disables workingDir/allowedPaths
   * restriction, and drops additional dirs / stack labelling (the worktree is
   * a self-contained checkout).
   */
  cwdOverride?: string
}

// ---------------------------------------------------------------------------
// Core functions
// ---------------------------------------------------------------------------

/**
 * D6 — subagent Claude starter. When `KANNA_CLAUDE_DRIVER=pty` the subagent
 * turn runs through the PTY driver (subscription billing) instead of always
 * falling back to the SDK (API billing). Adapts the SDK-shaped
 * `startClaudeSession` arg to `StartClaudeSessionPtyArgs`, injecting the
 * coordinator-owned preflight / toolCallback / tunnel / policy context and
 * `oneShot: true` so the REPL closes after the single subagent turn.
 *
 * Extracted from AgentCoordinator.buildClaudeSubagentStarter.
 */
export function buildClaudeSubagentStarter(
  deps: SubagentWiringDeps,
): NonNullable<BuildSubagentProviderRunArgs["startClaudeSession"]> {
  return async (a) => {
    const enabledMcpServers = deps.getEnabledCustomMcpServers()
    const oauthBearers = await deps.buildOAuthBearers(enabledMcpServers)
    if (deps.resolveClaudeDriverPreference() === "pty") {
      return deps.startClaudeSessionPTYFn({
        chatId: a.chatId ?? "",
        projectId: a.projectId,
        localPath: a.localPath,
        model: a.model,
        effort: a.effort,
        planMode: a.planMode,
        sessionToken: a.sessionToken,
        forkSession: a.forkSession,
        oauthToken: a.oauthToken,
        additionalDirectories: a.additionalDirectories,
        onToolRequest: a.onToolRequest,
        systemPromptOverride: a.systemPromptOverride,
        initialPrompt: a.initialPrompt,
        subagentOrchestrator: a.subagentOrchestrator,
        delegationContext: a.delegationContext,
        toolCallback: deps.toolCallback ?? undefined,
        tunnelGateway: deps.tunnelGateway,
        chatPolicy: a.chatId ? deps.resolveChatPolicy(a.chatId) : undefined,
        oneShot: true,
        ptyRegistry: deps.claudePtyRegistry ?? undefined,
        ptyInstanceRegistry: deps.ptyInstanceRegistry ?? undefined,
        workflowRegistry: deps.workflowRegistry ?? undefined,
        customMcpServers: enabledMcpServers,
        oauthBearers,
        restrictedAllowedPaths: a.restrictedAllowedPaths,
        keepAlive: a.keepAlive,
      })
    }
    return deps.startClaudeSessionFn({ ...a, customMcpServers: enabledMcpServers, oauthBearers })
  }
}

/**
 * Constructs the full ProviderRunStart bundle for a subagent run bound to a
 * specific chat. Resolves the cwd, builds the delegation context, wires up the
 * interactive tool-request forwarder, and delegates to `buildSubagentProviderRun`.
 *
 * Extracted from AgentCoordinator.buildSubagentProviderRunForChat.
 */
export function buildSubagentProviderRunForChat(
  deps: SubagentWiringDeps,
  args: BuildSubagentProviderRunForChatArgs,
): ProviderRunStart {
  const chat = deps.store.requireChat(args.chatId)
  const project = deps.store.getProject(chat.projectId)
  if (!project) throw new Error(`Project ${chat.projectId} not found for chat ${args.chatId}`)
  const spawn = resolveSpawnPaths(chat, project.localPath)
  const restriction =
    args.cwdOverride === undefined &&
    (args.subagent.workingDir !== undefined || args.subagent.allowedPaths !== undefined)
      ? resolveSubagentRoots(
          spawn.cwd,
          args.subagent.workingDir,
          args.subagent.allowedPaths,
          deps.realpath,
        )
      : null

  const onToolRequest = async (request: HarnessToolRequest): Promise<AnyValue> => {
    if (
      request.tool.toolKind !== "ask_user_question" &&
      request.tool.toolKind !== "exit_plan_mode"
    ) {
      // Non-interactive tools (bash, read, write, ...) — SDK handles
      // them via canUseTool wrapper. No forwarding needed.
      return null
    }
    const toolUseId = request.tool.toolId
    const key = deps.subagentPendingKey(args.chatId, args.runId, toolUseId)
    await deps.store.appendSubagentEvent({
      v: 3,
      type: "subagent_tool_pending",
      timestamp: Date.now(),
      chatId: args.chatId,
      runId: args.runId,
      toolUseId,
      toolKind: request.tool.toolKind,
      input: request.tool.input,
    })
    deps.emitStateChange(args.chatId)
    deps.subagentOrchestrator.notifySubagentToolPending(args.runId)
    return await new Promise<AnyValue>((resolve, reject) => {
      // Defensive: if `canUseTool` somehow fires twice for the same
      // (chatId, runId, toolUseId) — e.g. SDK retry — reject the previous
      // resolver before overwriting so its Promise doesn't leak.
      const existing = deps.subagentPendingResolvers.get(key)
      if (existing) {
        existing.reject(new Error("superseded by retry"))
      }
      deps.subagentPendingResolvers.set(key, { resolve, reject })
    })
  }

  const delegationContext: KannaMcpDelegationContext = {
    parentSubagentId: args.subagent.id,
    parentRunId: args.runId,
    ancestorSubagentIds: [...args.ancestorSubagentIds, args.subagent.id],
    depth: args.depth + 1,
    // For sub-spawn-sub, the parent_user_message_id stays anchored to the
    // chat turn that started the whole chain — that's the attribution the
    // run_started events use, and the orchestrator's depth/cycle checks
    // protect against runaway chains.
    getParentUserMessageId: () => args.parentUserMessageId,
    // Subagents cannot inherit the user's @-mention authority: manual-trigger
    // gates are enforced only at the top-level turn where the user typed the mention.
    getMentionedSubagentIds: () => [],
  }

  return buildSubagentProviderRun({
    subagent: args.subagent,
    chatId: args.chatId,
    primer: args.primer,
    userInstruction: args.userInstruction,
    runId: args.runId,
    abortSignal: args.abortSignal,
    cwd: args.cwdOverride ?? restriction?.cwd ?? spawn.cwd,
    additionalDirectories: args.cwdOverride ? [] : spawn.additionalDirectories,
    // Only label stack projects for unrestricted runs — a path-restricted
    // subagent cannot reach every root, so listing them all would mislead.
    stackProjects:
      args.cwdOverride || restriction
        ? []
        : resolveStackProjects(chat, (id) => deps.store.getProject(id)?.title),
    allowedPaths: restriction?.allowedPaths,
    projectId: project.id,
    startClaudeSession: buildClaudeSubagentStarter(deps),
    // PTY claude has no native maxTurns (interactive CLI) — the orchestrator
    // applies a host-side tool-call-count backstop for PTY + Codex runs.
    claudeDriverIsPty: deps.resolveClaudeDriverPreference() === "pty",
    subagentOrchestrator: deps.subagentOrchestrator,
    delegationContext,
    codexManager: deps.codexManager,
    onToolRequest,
    globalPromptAppend: deps.getAppSettingsSnapshot().globalPromptAppend,
    authReady: async (provider) => {
      if (provider === "openrouter") {
        return openrouterAuthReady(await deps.readLlmProvider())
      }
      if (provider === "claude") {
        const settings = deps.getAppSettingsSnapshot()
        // Pass parent chat id so a token already reserved by the parent
        // counts as usable. Subagent runs are sequential under the parent
        // (parent's turn is paused), so sharing the parent's reservation
        // is correct — see oauth-token-pool isEligible.
        return Boolean(
          settings.claudeAuth?.authenticated || deps.oauthPool?.hasUsable(args.chatId),
        )
      }
      return true
    },
    pickOauthToken: () => {
      // Subagent inherits the parent chat's reservation by re-picking under
      // the same chatId. pickActive treats the parent's reservation as
      // owned-by-self (drops + re-binds to chatId), so the lifecycle stays
      // bound to the parent's close path — no separate subagent release.
      const picked = deps.oauthPool?.pickActive(args.chatId) ?? null
      if (deps.oauthPool && deps.oauthPool.hasAnyToken() && !picked) {
        throw new OAuthPoolUnavailableError(
          deps.buildPoolUnavailableMessage(args.chatId, " for subagent run"),
        )
      }
      if (picked) deps.oauthPool!.markUsed(picked.id)
      return picked?.token ?? null
    },
  })
}
