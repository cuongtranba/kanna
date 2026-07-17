import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk"
import {
  createKannaMcpServer,
  type KannaMcpDelegationContext,
  type SetupLoopHandlerResult,
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
import { AsyncMessageQueue, toClaudeMessageStream } from "./claude-sdk-queue"
import { createClaudeHarnessStream } from "./claude-harness-stream"
import { parseConfiguredContextWindowFromModelId } from "./claude-usage-math"
import { log } from "../shared/log"
import type { ClaudeSessionHandle, HarnessToolRequest } from "./harness-types"
import type { SubagentOrchestrator } from "./subagent-orchestrator"
import type { TunnelGateway } from "./cloudflare-tunnel/gateway"
import type { ToolCallbackService } from "./tool-callback"
import type { ChatPermissionPolicy } from "../shared/permission-policy"
import type { OrchRunDetail, OrchRunInput } from "../shared/orchestration-types"
import type { ModelPrice } from "../shared/token-pricing"
import type { AnyValue } from "../shared/errors"

export async function startClaudeSession(args: {
  projectId: string
  localPath: string
  model: string
  effort?: string
  planMode: boolean
  sessionToken: string | null
  forkSession: boolean
  oauthToken: string | null
  /** When set, redirect the SDK to OpenRouter instead of Anthropic. */
  openrouterApiKey?: string | null
  additionalDirectories?: string[]
  chatId?: string
  tunnelGateway?: TunnelGateway | null
  onToolRequest: (request: HarnessToolRequest) => Promise<AnyValue>
  systemPromptAppend?: string
  systemPromptOverride?: string
  initialPrompt?: string
  /** Routes AskUserQuestion/ExitPlanMode through tool-callback when KANNA_MCP_TOOL_CALLBACKS=1. */
  toolCallback?: ToolCallbackService
  /** Per-chat permission policy. Defaults to POLICY_DEFAULT if omitted. */
  chatPolicy?: ChatPermissionPolicy
  /** Orchestrator for delegate_subagent. Omit to hide the tool. */
  subagentOrchestrator?: SubagentOrchestrator
  /** Per-spawn delegation context (depth / ancestor chain / parentUserMessageId resolver). */
  delegationContext?: KannaMcpDelegationContext
  /** Enabled user MCP servers, merged into the SDK's mcpServers map. */
  customMcpServers?: readonly McpServerConfig[]
  /** Pre-resolved oauth bearer tokens keyed by server id (from ensureFreshMcpToken). */
  oauthBearers?: ReadonlyMap<string, string>
  /** Folder-restricted subagent: disallow native FS tools, allowlist mcp__kanna__*, per-run path-deny. */
  restrictedAllowedPaths?: string[]
  /** Backs the `setup_loop` MCP tool. Omit to hide the tool. */
  setupLoop?: (input: LoopSetupInput) => Promise<SetupLoopHandlerResult>
  /** Backs the `stop_loop` MCP tool. Omit to hide the tool. */
  stopLoop?: () => Promise<void>
  /** Live check: true while an autonomous loop is armed — blocks direct-edit native tools. */
  isLoopArmed?: () => boolean
  /** Backs the `orch_run` / `orch_run_status` / `orch_cancel_run` MCP tools. Main-chat only. */
  runOrch?: (input: OrchRunInput) => Promise<{ ok: true; runId: string } | { ok: false; errors: string[] }>
  cancelOrchRun?: (runId: string) => Promise<void>
  getOrchRunStatus?: (runId: string) => OrchRunDetail | null
  /**
   * Agentic-turn bound passed natively to the SDK query() (Claude Code's
   * per-agent frontmatter maxTurns analog): the SDK stops gracefully and
   * keeps the accumulated output. Used by subagent spawns.
   */
  maxTurns?: number
  /** When true, leave the prompt queue open after initialPrompt and expose pushChannelPrompt on the handle. */
  keepAlive?: boolean
  /** Per-turn price for computing cost when the provider doesn't report it (OpenRouter). */
  turnPrice?: ModelPrice | null
  /** Overrides the configured context window (OpenRouter model contextLength). */
  contextWindowOverride?: number
}): Promise<ClaudeSessionHandle> {
  const canUseTool = buildCanUseTool({
    localPath: args.localPath,
    chatId: args.chatId,
    sessionToken: args.sessionToken,
    onToolRequest: args.onToolRequest,
    toolCallback: args.toolCallback,
    chatPolicy: args.chatPolicy,
    isLoopArmed: args.isLoopArmed,
  })

  const promptQueue = new AsyncMessageQueue<SDKUserMessage>()

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
      // Filter-at-spawn (Claude Code's filterToolsForAgent pattern): while a
      // loop is armed the direct-edit tools are removed from the tool list the
      // model sees, so it cannot even attempt them. The dynamic canUseTool
      // deny stays as belt-and-suspenders; an armed-state flip respawns the
      // session (see loopArmedAtSpawn in startClaudeTurn).
      ...(args.isLoopArmed?.() ? { disallowedTools: [...LOOP_BLOCKED_NATIVE_TOOLS] } : {}),
      // Per-agent turn bound, threaded from Subagent.maxTurns. The SDK emits
      // a graceful stop at the limit — accumulated output is preserved,
      // matching Claude Code's max_turns_reached semantics.
      ...(args.maxTurns !== undefined ? { maxTurns: args.maxTurns } : {}),
      tools: args.restrictedAllowedPaths && args.restrictedAllowedPaths.length > 0
        ? CLAUDE_TOOLSET.filter((t) => !new Set<string>(SDK_RESTRICTED_FS_NATIVE_TOOLS).has(t))
        : [...CLAUDE_TOOLSET],
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
          stopLoop: args.stopLoop,
          runOrch: args.runOrch,
          cancelOrchRun: args.cancelOrchRun,
          getOrchRunStatus: args.getOrchRunStatus,
        }),
        ...buildUserMcpServers(args.customMcpServers ?? [], args.oauthBearers),
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
      env: buildClaudeEnv(process.env, args.oauthToken, args.openrouterApiKey ? { apiKey: args.openrouterApiKey } : null),
    },
  })

  // Follow-up turns (sendPrompt + keep-alive pushChannelPrompt) share one
  // queue-push policy so the two transports cannot drift apart.
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

  return {
    provider: "claude",
    stream: createClaudeHarnessStream(
      toClaudeMessageStream(q),
      args.contextWindowOverride ?? parseConfiguredContextWindowFromModelId(args.model),
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
      // Do NOT cancel pending tool-callback records here. close() also fires
      // on token rotation and idle-session sweep — both of which preserve
      // the model's logical turn (it will resume / re-emit). Denying
      // mid-turn used to mask the question prompt as a silent drop. Pending
      // records are now reaped by the explicit chat.cancel / chat.delete
      // paths in ws-router.ts and by recoverOnStartup on server boot.
    },
  }
}
