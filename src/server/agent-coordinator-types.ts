
import type { AgentAppSettingsView } from "./agent-app-settings-view"
import type { AnalyticsReporter } from "./analytics"
import type { StartClaudeSessionArgs } from "./claude-session-start"
import type { CodexAppServerManager } from "./codex-app-server"
import type { GenerateChatTitleResult } from "./generate-title"
import type { ClaudeSessionHandle } from "./harness-types"
import type {
  LlmProviderSnapshot,
  McpOAuthState,
  Subagent,
} from "../shared/types"
import type { EventStore } from "./event-store"
import type { LimitDetector } from "./auto-continue/limit-detector"
import type { ScheduleManager } from "./auto-continue/schedule-manager"
import type { TunnelGateway } from "./cloudflare-tunnel/gateway"
import type { OAuthTokenPool } from "./oauth-pool/oauth-token-pool"
import type { ToolCallbackService } from "./tool-callback"
import type { ChatPermissionPolicy } from "../shared/permission-policy"
import type { AgentRuntimeConfig } from "./agent-runtime-config"

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
  startClaudeSession?: (args: StartClaudeSessionArgs) => Promise<ClaudeSessionHandle>
  claudeLimitDetector?: LimitDetector
  codexLimitDetector?: LimitDetector
  scheduleManager?: ScheduleManager
  cronScheduler?: import("./cron/scheduler").CronScheduler
  getAutoResumePreference?: () => boolean
  runtimeConfig?: AgentRuntimeConfig
  getSubagents?: () => Subagent[]
  getAppSettingsSnapshot?: () => Partial<AgentAppSettingsView>
  oauthPool?: OAuthTokenPool
  toolCallback?: ToolCallbackService
  chatPolicy?: ChatPermissionPolicy
  claudeSessionLifecycle?: Partial<ClaudeSessionLifecycleOptions>
  workflowRegistry?: import("./workflow-registry").WorkflowRegistry
  boardRegistry?: import("./board-registry").BoardRegistry
  inboxRegistry?: import("./inbox/inbox-registry").InboxRegistry
  beaconRegistry?: import("./beacon-registry").BeaconRegistry
  getBeacons?: () => readonly import("../shared/beacon-config").BeaconConfig[]
  subagentTranscriptRegistry?: import("./subagent-transcript-registry").SubagentTranscriptRegistry
  readLlmProvider?: () => Promise<LlmProviderSnapshot>
  getCustomProviderCredential?: (id: string) => import("../shared/custom-providers").CustomProviderCredential | null
  listOpenRouterModels?: () => Promise<import("../shared/types").OpenRouterModel[]>
  localCatalog?: import("./local-catalog").LocalCatalogService
  persistOAuthState?: (id: string, oauth: McpOAuthState) => void
  backgroundTaskOutputRegistry?: import("./background-task-output-registry").BackgroundTaskOutputRegistry
  liveBlocks?: import("./live-block-throttle").LiveBlockHub
  genuiDatasets?: import("./genui/dataset-service").GenUIDatasetService
  onTurnOutcome?: (chatId: string, outcome: "finished" | "failed" | "cancelled") => void
}
