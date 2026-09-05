
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
import type { JsonValue } from "../shared/json"
import type { ModelPrice } from "../shared/token-pricing"

export interface AppSettingsSnapshot {
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
  }
}

export interface ClaudeSessionLifecycleOptions {
  idleMs: number
  maxResidentSessions: number
  sweepIntervalMs: number
  backgroundTaskMaxMs: number
  backgroundTaskMaxWakes: number
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
    onToolRequest: (request: HarnessToolRequest) => Promise<JsonValue>
    systemPromptAppend?: string
    openrouterApiKey?: string | null
    subagentOrchestrator?: SubagentOrchestrator
    delegationContext?: KannaMcpDelegationContext
    systemPromptOverride?: string
    initialPrompt?: string
    toolCallback?: ToolCallbackService
    chatPolicy?: ChatPermissionPolicy
    customMcpServers?: readonly McpServerConfig[]
    oauthBearers?: ReadonlyMap<string, string>
    restrictedAllowedPaths?: string[]
    setupLoop?: (input: LoopSetupInput) => Promise<SetupLoopHandlerResult>
    armCron?: (command: string) => Promise<{ jobId: string }>
    updateCron?: (jobId: string, patch: import("../shared/cron/types").CronJobPatch) => Promise<void>
    stopLoop?: () => Promise<void>
    isLoopArmed?: () => boolean
    keepAlive?: boolean
    turnPrice?: ModelPrice | null
    contextWindowOverride?: number
  }) => Promise<ClaudeSessionHandle>
  startClaudeSessionPTY?: (args: StartClaudeSessionPtyArgs) => Promise<ClaudeSessionHandle>
  claudeLimitDetector?: LimitDetector
  codexLimitDetector?: LimitDetector
  scheduleManager?: ScheduleManager
  cronScheduler?: import("./cron/scheduler").CronScheduler
  getAutoResumePreference?: () => boolean
  openrouterFirstEntryTimeoutMs?: number
  getSubagents?: () => Subagent[]
  getAppSettingsSnapshot?: () => AppSettingsSnapshot
  throwOnClaudeSessionStart?: boolean
  oauthPool?: OAuthTokenPool
  toolCallback?: ToolCallbackService
  chatPolicy?: ChatPermissionPolicy
  claudeSessionLifecycle?: Partial<ClaudeSessionLifecycleOptions>
  claudePtyRegistry?: import("./claude-pty/pid-registry.adapter").ClaudePtyRegistry
  ptyInstanceRegistry?: import("./claude-pty/pty-instance-registry").PtyInstanceRegistry
  workflowRegistry?: import("./workflow-registry").WorkflowRegistry
  boardRegistry?: import("./board-registry").BoardRegistry
  loopTrackingRegistry?: import("./loop-tracking-registry").LoopTrackingRegistry
  subagentTranscriptRegistry?: import("./subagent-transcript-registry").SubagentTranscriptRegistry
  readLlmProvider?: () => Promise<LlmProviderSnapshot>
  listOpenRouterModels?: () => Promise<import("../shared/types").OpenRouterModel[]>
  localCatalog?: import("./local-catalog").LocalCatalogService
  persistOAuthState?: (id: string, oauth: McpOAuthState) => void
  backgroundTaskOutputRegistry?: import("./background-task-output-registry").BackgroundTaskOutputRegistry
}
