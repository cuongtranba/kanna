import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk"
import type { BoardRegistry } from "./board-registry"
import {
  createKannaMcpServer,
  type KannaMcpDelegationContext,
  type SetupLoopHandlerResult,
  type ArmedLoopInfo,
} from "./kanna-mcp"
import type { LoopSetupInput } from "./loop-template"
import { KANNA_MCP_SERVER_NAME } from "../shared/tools"
import { homedir } from "node:os"
import type { McpServerConfig } from "../shared/types"
import { KANNA_SYSTEM_PROMPT_APPEND } from "../shared/kanna-system-prompt"
import {
  buildCanUseTool,
  buildClaudeEnv,
  LOOP_BLOCKED_NATIVE_TOOLS,
} from "./claude-spawn-helpers"
import {
  buildUserMcpServers,
  CLAUDE_TOOLSET,
  SDK_RESTRICTED_FS_NATIVE_TOOLS,
} from "./claude-session-config"
import { toSdkEffort } from "./claude-prompt-helpers"
import { withAdditionalDirectoryMemory } from "./claude-spawn-helpers"
import { AsyncMessageQueue, toClaudeMessageStream } from "./claude-sdk-queue"
import { createClaudeHarnessStream } from "./claude-harness-stream"
import { parseConfiguredContextWindowFromModelId } from "./claude-usage-math"
import { log } from "../shared/log"
import type { ClaudeSessionHandle, HarnessToolRequest } from "./harness-types"
import type { SubagentOrchestrator } from "./subagent-orchestrator"
import type { TunnelGateway } from "./cloudflare-tunnel/gateway"
import type { ToolCallbackService } from "./tool-callback"
import type { ChatPermissionPolicy } from "../shared/permission-policy"
import type { ModelPrice } from "../shared/token-pricing"
import type { JsonValue } from "../shared/json"

export type StartClaudeSessionDeps = {
  readonly buildCanUseTool: typeof buildCanUseTool
  readonly buildClaudeEnv: typeof buildClaudeEnv
  readonly loopBlockedNativeTools: readonly string[]
  readonly AsyncMessageQueueCtor: { new <T>(): { push(value: T): void; close(): void } & AsyncIterable<T> }
  readonly toClaudeMessageStream: typeof toClaudeMessageStream
  readonly createClaudeHarnessStream: typeof createClaudeHarnessStream
  readonly parseConfiguredContextWindowFromModelId: typeof parseConfiguredContextWindowFromModelId
  readonly buildUserMcpServers: typeof buildUserMcpServers
  readonly claudeToolset: readonly string[]
  readonly sdkRestrictedFsNativeTools: readonly string[]
}

export function buildStartClaudeSessionDeps(): StartClaudeSessionDeps {
  return {
    buildCanUseTool,
    buildClaudeEnv,
    loopBlockedNativeTools: LOOP_BLOCKED_NATIVE_TOOLS,
    AsyncMessageQueueCtor: AsyncMessageQueue,
    toClaudeMessageStream,
    createClaudeHarnessStream,
    parseConfiguredContextWindowFromModelId,
    buildUserMcpServers,
    claudeToolset: CLAUDE_TOOLSET,
    sdkRestrictedFsNativeTools: SDK_RESTRICTED_FS_NATIVE_TOOLS,
  }
}

export async function startClaudeSession(args: {
  projectId: string
  localPath: string
  model: string
  effort?: string
  planMode: boolean
  sessionToken: string | null
  forkSession: boolean
  oauthToken: string | null
  openrouterApiKey?: string | null
  additionalDirectories?: string[]
  chatId?: string
  tunnelGateway?: TunnelGateway | null
  onToolRequest: (request: HarnessToolRequest) => Promise<JsonValue>
  systemPromptAppend?: string
  systemPromptOverride?: string
  initialPrompt?: string
  toolCallback?: ToolCallbackService
  chatPolicy?: ChatPermissionPolicy
  subagentOrchestrator?: SubagentOrchestrator
  delegationContext?: KannaMcpDelegationContext
  customMcpServers?: readonly McpServerConfig[]
  oauthBearers?: ReadonlyMap<string, string>
  restrictedAllowedPaths?: string[]
  setupLoop?: (input: LoopSetupInput) => Promise<SetupLoopHandlerResult>
  armCron?: (command: string) => Promise<{ jobId: string }>
  updateCron?: (jobId: string, patch: import("../shared/cron/types").CronJobPatch) => Promise<void>
  stopLoop?: () => Promise<void>
  resumeLoop?: () => Promise<import("./loop-wake-recovery").ResumeLoopResult>
  isLoopArmed?: () => boolean
  getArmedLoop?: (chatId: string) => ArmedLoopInfo | null
  boardRegistry?: BoardRegistry
  maxTurns?: number
  keepAlive?: boolean
  turnPrice?: ModelPrice | null
  contextWindowOverride?: number
},
  _deps: StartClaudeSessionDeps = buildStartClaudeSessionDeps(),
): Promise<ClaudeSessionHandle> {
  const canUseTool = _deps.buildCanUseTool({
    localPath: args.localPath,
    chatId: args.chatId,
    sessionToken: args.sessionToken,
    onToolRequest: args.onToolRequest,
    toolCallback: args.toolCallback,
    chatPolicy: args.chatPolicy,
    isLoopArmed: args.isLoopArmed,
  })

  const promptQueue = new _deps.AsyncMessageQueueCtor<SDKUserMessage>()

  const q = query({
    prompt: promptQueue,
    options: {
      cwd: args.localPath,
      ...(args.additionalDirectories && args.additionalDirectories.length > 0
        ? { additionalDirectories: args.additionalDirectories }
        : {}),
      model: args.model,
      effort: toSdkEffort(args.effort),
      resume: args.sessionToken ?? undefined,
      forkSession: args.forkSession,
      permissionMode: args.planMode ? "plan" : "acceptEdits",
      canUseTool,
      ...(args.isLoopArmed?.() ? { disallowedTools: [..._deps.loopBlockedNativeTools] } : {}),
      ...(args.maxTurns !== undefined ? { maxTurns: args.maxTurns } : {}),
      tools: args.restrictedAllowedPaths && args.restrictedAllowedPaths.length > 0
        ? _deps.claudeToolset.filter((t) => !new Set<string>(_deps.sdkRestrictedFsNativeTools).has(t))
        : [..._deps.claudeToolset],
      mcpServers: {
        [KANNA_MCP_SERVER_NAME]: createKannaMcpServer({
          projectId: args.projectId,
          localPath: args.localPath,
          chatId: args.chatId,
          sessionId: args.sessionToken ?? undefined,
          tunnelGateway: args.tunnelGateway ?? null,
          toolCallback: args.toolCallback,
          chatPolicy: args.chatPolicy,
          subagentOrchestrator: args.subagentOrchestrator,
          delegationContext: args.delegationContext,
          restrictedAllowedPaths: args.restrictedAllowedPaths,
          setupLoop: args.setupLoop,
          armCron: args.armCron,
          updateCron: args.updateCron,
          stopLoop: args.stopLoop,
          resumeLoop: args.resumeLoop,
          getArmedLoop: args.getArmedLoop,
          boardRegistry: args.boardRegistry,
        }),
        ..._deps.buildUserMcpServers(args.customMcpServers ?? [], args.oauthBearers),
      },
      systemPrompt: args.systemPromptOverride != null
        ? args.systemPromptOverride
        : {
            type: "preset",
            preset: "claude_code",
            append: args.systemPromptAppend ?? KANNA_SYSTEM_PROMPT_APPEND,
          },
      settingSources: ["user", "project", "local"],
      pathToClaudeCodeExecutable: process.env.CLAUDE_EXECUTABLE?.replace(/^~(?=\/|$)/, homedir()) || undefined,
      env: withAdditionalDirectoryMemory(
        _deps.buildClaudeEnv(process.env, args.oauthToken, args.openrouterApiKey ? { apiKey: args.openrouterApiKey } : null),
        args.additionalDirectories,
      ),
    },
  })

  const enqueueUserPrompt = (content: string) => {
    promptQueue.push({
      type: "user",
      message: { role: "user", content },
      parent_tool_use_id: null,
      session_id: args.sessionToken ?? "",
    })
  }

  if (args.initialPrompt != null) {
    promptQueue.push({
      type: "user",
      message: {
        role: "user",
        content: args.initialPrompt,
      },
      parent_tool_use_id: null,
      session_id: args.sessionToken ?? undefined,
    })
    if (!args.keepAlive) {
      promptQueue.close()
    }
  }

  const { sessionClosed, resolveSessionClosed } = makeSessionClosedSignal()

  return {
    provider: "claude",
    stream: _deps.createClaudeHarnessStream(
      _deps.toClaudeMessageStream(q),
      args.contextWindowOverride ?? _deps.parseConfiguredContextWindowFromModelId(args.model),
      args.turnPrice ? () => args.turnPrice ?? null : undefined,
    ),
    getAccountInfo: async () => {
      try {
        return await q.accountInfo()
      } catch {
        return null
      }
    },
    interrupt: async () => {
      await q.interrupt()
    },
    sendPrompt: async (content: string) => {
      enqueueUserPrompt(content)
    },
    setModel: async (model: string) => {
      await q.setModel(model)
    },
    setPermissionMode: async (planMode: boolean) => {
      await q.setPermissionMode(planMode ? "plan" : "acceptEdits")
    },
    getSupportedCommands: async () => {
      try {
        return await q.supportedCommands()
      } catch (error) {
        log.warn("[kanna/claude] supportedCommands failed", String(error))
        return []
      }
    },
    ...(args.keepAlive ? {
      pushChannelPrompt: async (content: string) => {
        enqueueUserPrompt(content)
      },
    } : {}),
    close: () => {
      promptQueue.close()
      q.close()
      resolveSessionClosed()
    },
    closed: sessionClosed,
  }
}

function makeSessionClosedSignal(): { sessionClosed: Promise<void>; resolveSessionClosed: () => void } {
  let resolveSessionClosed!: () => void
  const sessionClosed = new Promise<void>((resolve) => { resolveSessionClosed = resolve })
  return { sessionClosed, resolveSessionClosed }
}
