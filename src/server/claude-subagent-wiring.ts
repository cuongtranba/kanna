
import type { JsonValue } from "../shared/json"
import type {
  ClaudeDriverPreference,
  LlmProviderSnapshot,
  McpServerConfig,
  Subagent,
} from "../shared/types"
import type { HarnessToolRequest } from "./harness-types"
import type { ClaudeSessionHandle } from "./harness-types"
import type { ArmedLoopInfo, KannaMcpDelegationContext } from "./kanna-mcp"
import type { ChatRecord, ProjectRecord, StackRecord, SubagentRunEvent } from "./events"
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
import { toJsonObject } from "./json-boundary"
import { resolveProjectInstructions, resolveSpawnPaths, resolveStackProjects } from "./claude-session-config"
import { openrouterAuthReady, claudeAuthReady } from "./provider-catalog"
import { OAuthPoolUnavailableError } from "./oauth-errors"
import type { startClaudeSession as StartClaudeSessionFn } from "./claude-session-start"


interface SubagentWiringStore {
  requireChat(chatId: string): ChatRecord
  getProject(id: string): ProjectRecord | null | undefined
  getStack(stackId: string): StackRecord | null | undefined
  appendSubagentEvent(event: SubagentRunEvent): Promise<void>
}

interface SubagentWiringOAuthPool {
  hasUsable(reservedFor?: string): boolean
  pickActive(chatId: string): { id: string; token: string; label: string } | null | undefined
  markUsed(tokenId: string): void
  hasAnyToken(): boolean
}


export interface SubagentWiringDeps {
  store: SubagentWiringStore

  startClaudeSessionFn: typeof StartClaudeSessionFn
  startClaudeSessionPTYFn: (args: StartClaudeSessionPtyArgs) => Promise<ClaudeSessionHandle>

  toolCallback: ToolCallbackService | null
  tunnelGateway: TunnelGateway | null
  claudePtyRegistry: ClaudePtyRegistry | null
  ptyInstanceRegistry: PtyInstanceRegistry | null
  workflowRegistry: WorkflowRegistry | null
  subagentOrchestrator: SubagentOrchestrator
  codexManager: CodexAppServerManager
  oauthPool: SubagentWiringOAuthPool | null

  subagentPendingResolvers: Map<string, { resolve: (v: JsonValue) => void; reject: (e: Error) => void }>

  realpath: RealpathFn

  resolveClaudeDriverPreference: () => ClaudeDriverPreference
  getEnabledCustomMcpServers: () => readonly McpServerConfig[]
  buildOAuthBearers: (servers: readonly McpServerConfig[]) => Promise<Map<string, string>>
  resolveChatPolicy: (chatId: string) => ChatPermissionPolicy
  emitStateChange: (chatId: string) => void
  buildPoolUnavailableMessage: (reservedFor: string, scopeSuffix: string) => string
  getAppSettingsSnapshot: () => {
    globalPromptAppend?: string
  }
  readLlmProvider: () => Promise<LlmProviderSnapshot>
  subagentPendingKey: (chatId: string, runId: string, toolUseId: string) => string
  getArmedLoop?: (chatId: string) => ArmedLoopInfo | null
}


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
}


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
        maxTurns: a.maxTurns,
        keepAlive: a.keepAlive,
        getArmedLoop: a.getArmedLoop,
      })
    }
    return deps.startClaudeSessionFn({ ...a, customMcpServers: enabledMcpServers, oauthBearers })
  }
}

export function buildSubagentProviderRunForChat(
  deps: SubagentWiringDeps,
  args: BuildSubagentProviderRunForChatArgs,
): ProviderRunStart {
  const chat = deps.store.requireChat(args.chatId)
  const project = deps.store.getProject(chat.projectId)
  if (!project) throw new Error(`Project ${chat.projectId} not found for chat ${args.chatId}`)
  const spawn = resolveSpawnPaths(chat, project.localPath)
  const restriction =
    args.subagent.workingDir !== undefined || args.subagent.allowedPaths !== undefined
      ? resolveSubagentRoots(
          spawn.cwd,
          args.subagent.workingDir,
          args.subagent.allowedPaths,
          deps.realpath,
        )
      : null

  const onToolRequest = async (request: HarnessToolRequest): Promise<JsonValue> => {
    if (
      request.tool.toolKind !== "ask_user_question" &&
      request.tool.toolKind !== "exit_plan_mode"
    ) {
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
      input: toJsonObject(request.tool.input),
    })
    deps.emitStateChange(args.chatId)
    deps.subagentOrchestrator.notifySubagentToolPending(args.runId)
    return await new Promise<JsonValue>((resolve, reject) => {
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
    getParentUserMessageId: () => args.parentUserMessageId,
    getMentionedSubagentIds: () => [],
  }

  return buildSubagentProviderRun({
    subagent: args.subagent,
    chatId: args.chatId,
    primer: args.primer,
    userInstruction: args.userInstruction,
    runId: args.runId,
    abortSignal: args.abortSignal,
    cwd: restriction?.cwd ?? spawn.cwd,
    additionalDirectories: spawn.additionalDirectories,
    stackProjects: restriction
      ? []
      : resolveStackProjects(chat, (id) => {
          const p = deps.store.getProject(id)
          return p ? { title: p.title, active: true } : undefined
        }),
    instructions: restriction ? undefined : {
      stackInstructions: chat.stackId ? deps.store.getStack(chat.stackId)?.instructions : undefined,
      projectInstructions: resolveProjectInstructions(chat, (id) => {
        const p = deps.store.getProject(id)
        return p ? { title: p.title, instructions: p.instructions } : undefined
      }),
    },
    allowedPaths: restriction?.allowedPaths,
    projectId: project.id,
    startClaudeSession: buildClaudeSubagentStarter(deps),
    claudeDriverIsPty: deps.resolveClaudeDriverPreference() === "pty",
    subagentOrchestrator: deps.subagentOrchestrator,
    delegationContext,
    getArmedLoop: deps.getArmedLoop,
    codexManager: deps.codexManager,
    onToolRequest,
    globalPromptAppend: deps.getAppSettingsSnapshot().globalPromptAppend,
    authReady: async (provider) => {
      if (provider === "openrouter") {
        return openrouterAuthReady(await deps.readLlmProvider())
      }
      if (provider === "claude") {
        return claudeAuthReady(deps.oauthPool, args.chatId)
      }
      return true
    },
    pickOauthToken: () => {
      const picked = deps.oauthPool?.pickActive(args.chatId) ?? null
      if (deps.oauthPool && deps.oauthPool.hasAnyToken() && !picked) {
        throw new OAuthPoolUnavailableError(
          deps.buildPoolUnavailableMessage(args.chatId, " for subagent run"),
        )
      }
      if (picked) deps.oauthPool!.markUsed(picked.id)
      return picked?.token ?? null
    },
    readOpenRouterKey: async () => {
      const provider = await deps.readLlmProvider()
      return provider.apiKey || null
    },
  })
}
