import {
  query,
  type HookCallbackMatcher,
  type HookEvent,
  type HookInput,
  type HookJSONOutput,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk"
import type { CompactionTrigger } from "../shared/transcript-types"
import { createKannaMcpServer, type KannaMcpArgs } from "./kanna-mcp"
import { KANNA_MCP_SERVER_NAME } from "../shared/tools"
import { homedir } from "node:os"
import type { McpServerConfig } from "../shared/types"
import { KANNA_SYSTEM_PROMPT_BASE } from "../shared/kanna-system-prompt"
import {
  buildCanUseTool,
  buildClaudeEnv,
  LOOP_BLOCKED_NATIVE_TOOLS,
  LOOP_BLOCKED_TOOL_MESSAGE,
} from "./claude-spawn-helpers"
import {
  buildUserMcpServers,
  CLAUDE_TOOLSET,
  SDK_RESTRICTED_FS_NATIVE_TOOLS,
} from "./claude-session-config"
import { toSdkEffort } from "./claude-prompt-helpers"
import { withAdditionalDirectoryMemory } from "./claude-spawn-helpers"
import type { SdkEndpointEnv } from "./sdk-endpoint"
import { AsyncMessageQueue, toClaudeMessageStream } from "./claude-sdk-queue"
import { createClaudeHarnessStream } from "./claude-harness-stream"
import { parseConfiguredContextWindowFromModelId } from "./claude-usage-math"
import { log } from "../shared/log"
import type { ClaudeSessionHandle, HarnessToolRequest } from "./harness-types"
import type { ToolCallbackService } from "./tool-callback"
import type { ChatPermissionPolicy } from "../shared/permission-policy"
import type { ModelPrice } from "../shared/token-pricing"
import type { JsonValue } from "../shared/json"

export interface CompactionEvent {
  phase: "pre" | "post"
  chatId: string
  sessionId: string
  trigger?: CompactionTrigger
  summary?: string
}

function compactionTriggerOf(value: string | undefined): CompactionTrigger | undefined {
  return value === "auto" || value === "manual" ? value : undefined
}

function buildCompactionHooks(
  chatId: string,
  onCompaction: (event: CompactionEvent) => void,
): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
  const observe = (phase: "pre" | "post") => async (input: HookInput): Promise<HookJSONOutput> => {
    if (input.agent_id !== undefined) return {}
    const trigger = "trigger" in input ? compactionTriggerOf(input.trigger) : undefined
    const summary = "compact_summary" in input && typeof input.compact_summary === "string"
      ? input.compact_summary
      : undefined
    try {
      onCompaction({
        phase,
        chatId,
        sessionId: input.session_id,
        ...(trigger !== undefined ? { trigger } : {}),
        ...(summary !== undefined ? { summary } : {}),
      })
    } catch (error) {
      log.warn("[kanna/claude] onCompaction observer failed", String(error))
    }
    return {}
  }
  return {
    PreCompact: [{ hooks: [observe("pre")] }],
    PostCompact: [{ hooks: [observe("post")] }],
  }
}

function buildLoopGuardHooks(
  isLoopArmed: () => boolean,
  blockedTools: readonly string[],
): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
  const guard = async (input: HookInput): Promise<HookJSONOutput> => {
    if (input.hook_event_name !== "PreToolUse") return {}
    if (!blockedTools.includes(input.tool_name) || !isLoopArmed()) return {}
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: `${input.tool_name} ${LOOP_BLOCKED_TOOL_MESSAGE}`,
      },
    }
  }
  return { PreToolUse: [{ hooks: [guard] }] }
}

function buildSessionHooks(
  args: { chatId?: string; onCompaction?: (event: CompactionEvent) => void; isLoopArmed?: () => boolean },
  blockedTools: readonly string[],
): Partial<Record<HookEvent, HookCallbackMatcher[]>> | undefined {
  const hooks = {
    ...(args.onCompaction && args.chatId ? buildCompactionHooks(args.chatId, args.onCompaction) : {}),
    ...(args.isLoopArmed ? buildLoopGuardHooks(args.isLoopArmed, blockedTools) : {}),
  }
  return Object.keys(hooks).length > 0 ? hooks : undefined
}

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

export type KannaMcpCapabilities = Omit<
  KannaMcpArgs,
  "projectId" | "localPath" | "chatId" | "sessionId" | "toolCallback" | "chatPolicy" | "restrictedAllowedPaths" | "parseMermaid"
>

export interface StartClaudeSessionArgs {
  projectId: string
  localPath: string
  model: string
  effort?: string
  planMode: boolean
  sessionToken: string | null
  forkSession: boolean
  oauthToken: string | null
  oauthBaseUrl?: string | null
  endpoint?: SdkEndpointEnv | null
  additionalDirectories?: string[]
  chatId?: string
  onToolRequest: (request: HarnessToolRequest) => Promise<JsonValue>
  systemPromptAppend?: string
  systemPromptOverride?: string
  initialPrompt?: string
  toolCallback?: ToolCallbackService
  chatPolicy?: ChatPermissionPolicy
  customMcpServers?: readonly McpServerConfig[]
  oauthBearers?: ReadonlyMap<string, string>
  restrictedAllowedPaths?: string[]
  kannaMcp?: KannaMcpCapabilities
  isLoopArmed?: () => boolean
  maxTurns?: number
  keepAlive?: boolean
  turnPrice?: ModelPrice | null
  costBaselineUsd?: number
  contextWindowOverride?: number
  onCompaction?: (event: CompactionEvent) => void
  streamLiveBlocks?: boolean
}

export async function startClaudeSession(
  args: StartClaudeSessionArgs,
  _deps: StartClaudeSessionDeps = buildStartClaudeSessionDeps(),
): Promise<ClaudeSessionHandle> {
  const canUseTool = _deps.buildCanUseTool({
    localPath: args.localPath,
    chatId: args.chatId,
    sessionToken: args.sessionToken,
    onToolRequest: args.onToolRequest,
    toolCallback: args.toolCallback,
    chatPolicy: args.chatPolicy,
  })

  const promptQueue = new _deps.AsyncMessageQueueCtor<SDKUserMessage>()
  const sessionHooks = buildSessionHooks(args, _deps.loopBlockedNativeTools)

  const q = query({
    prompt: promptQueue,
    options: {
      cwd: args.localPath,
      ...(args.additionalDirectories && args.additionalDirectories.length > 0
        ? { additionalDirectories: args.additionalDirectories }
        : {}),
      model: args.model,
      effort: toSdkEffort(args.effort),
      extraArgs: { "thinking-display": "summarized" },
      ...(args.streamLiveBlocks === true ? { includePartialMessages: true } : {}),
      resume: args.sessionToken ?? undefined,
      forkSession: args.forkSession,
      permissionMode: args.planMode ? "plan" : "acceptEdits",
      canUseTool,
      ...(args.isLoopArmed?.() ? { disallowedTools: [..._deps.loopBlockedNativeTools] } : {}),
      ...(sessionHooks ? { hooks: sessionHooks } : {}),
      ...(args.maxTurns !== undefined ? { maxTurns: args.maxTurns } : {}),
      tools: args.restrictedAllowedPaths && args.restrictedAllowedPaths.length > 0
        ? _deps.claudeToolset.filter((t) => !new Set<string>(_deps.sdkRestrictedFsNativeTools).has(t))
        : [..._deps.claudeToolset],
      mcpServers: {
        [KANNA_MCP_SERVER_NAME]: createKannaMcpServer({
          ...args.kannaMcp,
          projectId: args.projectId,
          localPath: args.localPath,
          chatId: args.chatId,
          sessionId: args.sessionToken ?? undefined,
          toolCallback: args.toolCallback,
          chatPolicy: args.chatPolicy,
          restrictedAllowedPaths: args.restrictedAllowedPaths,
        }),
        ..._deps.buildUserMcpServers(args.customMcpServers ?? [], args.oauthBearers),
      },
      systemPrompt: args.systemPromptOverride != null
        ? args.systemPromptOverride
        : {
            type: "preset",
            preset: "claude_code",
            append: args.systemPromptAppend ?? KANNA_SYSTEM_PROMPT_BASE,
          },
      settingSources: ["user", "project", "local"],
      pathToClaudeCodeExecutable: process.env.CLAUDE_EXECUTABLE?.replace(/^~(?=\/|$)/, homedir()) || undefined,
      env: withAdditionalDirectoryMemory(
        _deps.buildClaudeEnv(
          process.env,
          args.oauthToken,
          args.endpoint ?? null,
          args.oauthBaseUrl,
        ),
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
    stream: _deps.createClaudeHarnessStream(_deps.toClaudeMessageStream(q), {
      contextWindow: args.contextWindowOverride ?? _deps.parseConfiguredContextWindowFromModelId(args.model),
      turnPrice: args.turnPrice,
      costBaselineUsd: args.costBaselineUsd,
    }),
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
