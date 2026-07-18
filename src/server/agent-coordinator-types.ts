/**
 * Public types for AgentCoordinator construction.
 *
 * Extracted from agent.ts so the coordinator's constructor-arg surface can be
 * read independently of the full class body (agent.ts was 1300+ LOC).
 */

import type { AnalyticsReporter } from "./analytics"
import type { CodexAppServerManager } from "./codex-app-server"
import type { GenerateChatTitleResult } from "./generate-title"
import type { ClaudeSessionHandle, HarnessToolRequest } from "./harness-types"
import type {
  ClaudeDriverPreference,
  CustomModelEntry,
  LlmProviderSnapshot,
  McpOAuthState,
  McpServerConfig,
  Subagent,
} from "../shared/types"
import type { EventStore } from "./event-store"
import type { KannaMcpDelegationContext, SetupLoopHandlerResult } from "./kanna-mcp"
import type { LoopSetupInput } from "./loop-template"
import type { LimitDetector } from "./auto-continue/limit-detector"
import type { ScheduleManager } from "./auto-continue/schedule-manager"
import type { TunnelGateway } from "./cloudflare-tunnel/gateway"
import type { OAuthTokenPool } from "./oauth-pool/oauth-token-pool"
import type { SubagentOrchestrator } from "./subagent-orchestrator"
import type { ToolCallbackService } from "./tool-callback"
import type { ChatPermissionPolicy } from "../shared/permission-policy"
import type { StartClaudeSessionPtyArgs } from "./claude-pty/driver"
import type { AnyValue } from "../shared/errors"
import type { OrchRunDetail, OrchRunInput } from "../shared/orchestration-types"
import type { ModelPrice } from "../shared/token-pricing"

/** App settings snapshot returned by `getAppSettingsSnapshot`. */
export interface AppSettingsSnapshot {
  claudeAuth?: { authenticated?: boolean } | null
  claudeDriver?: {
    preference?: ClaudeDriverPreference
    lifecycle?: { idleTimeoutMs?: number; maxConcurrent?: number }
  }
  globalPromptAppend?: string
  customMcpServers?: readonly McpServerConfig[]
  customModels?: readonly CustomModelEntry[]
  subagentRuntime?: {
    runTimeoutMs?: number
    defaultLoopSubagentId?: string | null
    defaultOrchSubagentId?: string | null
  }
}

export interface ClaudeSessionLifecycleOptions {
  idleMs: number
  maxResidentSessions: number
  sweepIntervalMs: number
  /** Max time a warm PTY session is held open solely because a background Bash
   * task is still pending (no other activity). Bounds a hung/never-completing
   * task so it cannot pin a process forever.
   * See adr-20260604-pty-background-task-keepalive. */
  backgroundTaskMaxMs: number
}

export interface AgentCoordinatorArgs {
  store: EventStore
  onStateChange: (chatId?: string, options?: { immediate?: boolean }) => void
  analytics?: AnalyticsReporter
  codexManager?: CodexAppServerManager
  generateTitle?: (messageContent: string, cwd: string) => Promise<GenerateChatTitleResult>
  tunnelGateway?: TunnelGateway
  startClaudeSession?: (args: {
    projectId: string
    localPath: string
    model: string
    effort?: string
    planMode: boolean
    sessionToken: string | null
    forkSession: boolean
    oauthToken: string | null
    additionalDirectories?: string[]
    chatId?: string
    tunnelGateway?: TunnelGateway | null
    onToolRequest: (request: HarnessToolRequest) => Promise<AnyValue>
    /** Append text for the claude_code preset's `systemPrompt.append`. */
    systemPromptAppend?: string
    /** When set, redirect the SDK to OpenRouter instead of Anthropic. */
    openrouterApiKey?: string | null
    /** Orchestrator for delegate_subagent. Omit to hide the tool. */
    subagentOrchestrator?: SubagentOrchestrator
    /** Per-spawn delegation context (depth / ancestor chain / parentUserMessageId resolver). */
    delegationContext?: KannaMcpDelegationContext
    /** Subagent-only override — REPLACES the claude_code preset append entirely. */
    systemPromptOverride?: string
    /** Subagent-only one-shot prompt — closes the queue after the single turn. */
    initialPrompt?: string
    /** Routes AskUserQuestion/ExitPlanMode through tool-callback when KANNA_MCP_TOOL_CALLBACKS=1. */
    toolCallback?: ToolCallbackService
    /** Per-chat permission policy. Defaults to POLICY_DEFAULT if omitted. */
    chatPolicy?: ChatPermissionPolicy
    /** Enabled user MCP servers, merged into the SDK's mcpServers map. */
    customMcpServers?: readonly McpServerConfig[]
    /** Pre-resolved oauth bearer tokens keyed by server id. */
    oauthBearers?: ReadonlyMap<string, string>
    /** Folder-restricted subagent: disallow native FS tools + allowlist mcp__kanna__*. */
    restrictedAllowedPaths?: string[]
    /** Backs the `setup_loop` MCP tool. Omit to hide the tool. */
    setupLoop?: (input: LoopSetupInput) => Promise<SetupLoopHandlerResult>
    /** Backs the `stop_loop` MCP tool. Omit to hide the tool. */
    stopLoop?: () => Promise<void>
    /** Live check: true while an autonomous loop is armed. */
    isLoopArmed?: () => boolean
    /** Backs the `orch_run` / `orch_run_status` / `orch_cancel_run` MCP tools. Main-chat only. */
    runOrch?: (input: OrchRunInput) => Promise<{ ok: true; runId: string } | { ok: false; errors: string[] }>
    cancelOrchRun?: (runId: string) => Promise<void>
    getOrchRunStatus?: (runId: string) => OrchRunDetail | null
    /** Keep the SDK prompt queue open after the initial prompt for multi-turn keep-alive. */
    keepAlive?: boolean
    /** Per-turn price for computing cost when the provider doesn't report it (OpenRouter). */
    turnPrice?: ModelPrice | null
    /** Overrides the configured context window (OpenRouter model contextLength). */
    contextWindowOverride?: number
  }) => Promise<ClaudeSessionHandle>
  startClaudeSessionPTY?: (args: StartClaudeSessionPtyArgs) => Promise<ClaudeSessionHandle>
  claudeLimitDetector?: LimitDetector
  codexLimitDetector?: LimitDetector
  scheduleManager?: ScheduleManager
  getAutoResumePreference?: () => boolean
  /**
   * Watchdog (ms) for an OpenRouter turn whose SDK stream emits no transcript
   * entry after the session-token handshake. Default 120000 (2 min).
   */
  openrouterFirstEntryTimeoutMs?: number
  getSubagents?: () => Subagent[]
  getAppSettingsSnapshot?: () => AppSettingsSnapshot
  throwOnClaudeSessionStart?: boolean
  oauthPool?: OAuthTokenPool
  /** Populated on boot; will be consumed by canUseTool. */
  toolCallback?: ToolCallbackService
  /** Per-chat permission policy forwarded to startClaudeSession. Defaults to POLICY_DEFAULT if omitted. */
  chatPolicy?: ChatPermissionPolicy
  /** Claude subprocess lifecycle tuning. Defaults are conservative and may be overridden in tests. */
  claudeSessionLifecycle?: Partial<ClaudeSessionLifecycleOptions>
  /** On-disk registry of claude PTY children for crash-orphan reap on next boot. */
  claudePtyRegistry?: import("./claude-pty/pid-registry.adapter").ClaudePtyRegistry
  /** In-memory live-status registry surfaced to the UI. */
  ptyInstanceRegistry?: import("./claude-pty/pty-instance-registry").PtyInstanceRegistry
  /** Registry of workflow runs per chat, populated by PTY driver from the on-disk workflows dir. */
  workflowRegistry?: import("./workflow-registry").WorkflowRegistry
  /** Registry mapping each chat to its `…/subagents` dir for Agent child-transcript drill-in. */
  subagentTranscriptRegistry?: import("./subagent-transcript-registry").SubagentTranscriptRegistry
  /** Reads the persisted LLM provider snapshot (OpenRouter key source). */
  readLlmProvider?: () => Promise<LlmProviderSnapshot>
  /** Lists OpenRouter models (with pricing + contextLength) for cost computation. */
  listOpenRouterModels?: () => Promise<import("../shared/types").OpenRouterModel[]>
  /** Local skill + slash command catalog (user, project, plugin scans). */
  localCatalog?: import("./local-catalog").LocalCatalogService
  /** Persist updated OAuth state for a custom MCP server (called after token refresh at spawn). */
  persistOAuthState?: (id: string, oauth: McpOAuthState) => void
}
