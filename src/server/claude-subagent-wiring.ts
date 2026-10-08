
import type { JsonValue } from "../shared/json"
import type {
  CustomModelEntry,
  LlmProviderSnapshot,
  McpServerConfig,
  Subagent,
} from "../shared/types"
import type { HarnessToolRequest } from "./harness-types"
import type { ArmedLoopInfo, ChatTaskStorePort, KannaMcpDelegationContext } from "./kanna-mcp"
import type { ChatRecord, ProjectRecord, StackRecord, SubagentRunEvent } from "./events"
import type { ProviderRunStart, SubagentOrchestrator } from "./subagent-orchestrator"
import type { BuildSubagentProviderRunArgs } from "./subagent-provider-run"
import { buildSubagentProviderRun } from "./subagent-provider-run"
import type { ChatPermissionPolicy } from "../shared/permission-policy"
import type { CodexAppServerManager } from "./codex-app-server"
import type { RealpathFn } from "./paths"
import { resolveSubagentRoots } from "./paths"
import { toJsonObject } from "./json-boundary"
import { resolveProjectInstructions, resolveSpawnPaths, resolveStackProjects } from "./claude-session-config"
import { openrouterAuthReady, claudeAuthReady } from "./provider-catalog"
import { OAuthPoolUnavailableError } from "./oauth-errors"
import type { startClaudeSession as StartClaudeSessionFn } from "./claude-session-start"
import type { OAuthBearers } from "./claude-session-config-helpers"
import type { BeaconRegistry } from "./beacon-registry"
import type { BeaconConfig } from "../shared/beacon-config"
import type { ToolCallbackService } from "./tool-callback"


interface SubagentWiringStore {
  requireChat(chatId: string): ChatRecord
  getProject(id: string): ProjectRecord | null | undefined
  getStack(stackId: string): StackRecord | null | undefined
  appendSubagentEvent(event: SubagentRunEvent): Promise<void>
}

interface SubagentWiringOAuthPool {
  hasUsable(reservedFor?: string): boolean
  pickActive(chatId: string): { id: string; token: string; label: string; baseUrl?: string } | null | undefined
  markUsed(tokenId: string): void
  hasAnyToken(): boolean
}


export interface SubagentWiringDeps {
  store: SubagentWiringStore

  startClaudeSessionFn: typeof StartClaudeSessionFn

  subagentOrchestrator: SubagentOrchestrator
  codexManager: CodexAppServerManager
  oauthPool: SubagentWiringOAuthPool | null

  subagentPendingResolvers: Map<string, { resolve: (v: JsonValue) => void; reject: (e: Error) => void }>

  realpath: RealpathFn

  getEnabledCustomMcpServers: () => readonly McpServerConfig[]
  buildOAuthBearers: (servers: readonly McpServerConfig[]) => Promise<OAuthBearers>
  resolveChatPolicy: (chatId: string) => ChatPermissionPolicy
  emitStateChange: (chatId: string) => void
  buildPoolUnavailableMessage: (reservedFor: string, scopeSuffix: string) => string
  getAppSettingsSnapshot: () => {
    globalPromptAppend?: string
    customModels?: readonly CustomModelEntry[]
  }
  readLlmProvider: () => Promise<LlmProviderSnapshot>
  subagentPendingKey: (chatId: string, runId: string, toolUseId: string) => string
  getArmedLoop?: (chatId: string) => ArmedLoopInfo | null
  chatTaskStore?: ChatTaskStorePort
  beaconRegistry?: BeaconRegistry
  getBeacons?: () => readonly BeaconConfig[]
  toolCallback?: ToolCallbackService | null
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
  beaconToolsAllowed = false,
): NonNullable<BuildSubagentProviderRunArgs["startClaudeSession"]> {
  return async (a) => {
    const enabledMcpServers = deps.getEnabledCustomMcpServers()
    const { byServerId: oauthBearers } = await deps.buildOAuthBearers(enabledMcpServers)
    return deps.startClaudeSessionFn({
      ...a,
      customMcpServers: enabledMcpServers,
      oauthBearers,
      beaconRegistry: deps.beaconRegistry,
      getBeacons: deps.getBeacons,
      beaconToolsAllowed,
      toolCallback: beaconToolsAllowed ? (deps.toolCallback ?? undefined) : undefined,
    })
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
    startClaudeSession: buildClaudeSubagentStarter(deps, args.subagent.allowBeaconTools === true),
    subagentOrchestrator: deps.subagentOrchestrator,
    delegationContext,
    getArmedLoop: deps.getArmedLoop,
    chatTaskStore: deps.chatTaskStore,
    codexManager: deps.codexManager,
    onToolRequest,
    globalPromptAppend: deps.getAppSettingsSnapshot().globalPromptAppend,
    customModels: deps.getAppSettingsSnapshot().customModels,
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
      if (!picked) return null
      return { token: picked.token, baseUrl: picked.baseUrl }
    },
    readOpenRouterKey: async () => {
      const provider = await deps.readLlmProvider()
      return provider.apiKey || null
    },
  })
}
