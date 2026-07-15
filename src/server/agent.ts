import { query, type CanUseTool, type PermissionResult, type Query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk"
import { createKannaMcpServer, type KannaMcpDelegationContext, type SetupLoopHandlerResult } from "./kanna-mcp"
import type { LoopSetupInput } from "./loop-template"
import { reconcileTrackingFile, validateLoopSetup } from "./loop-template"
import { ensureTrackingFile } from "./loop-template-io.adapter"
import { KANNA_MCP_SERVER_NAME } from "../shared/tools"
import { homedir } from "node:os"
import type {
  AccountInfo,
  AgentProvider,
  ChatAttachment,
  ContextWindowUsageSnapshot,
  LlmProviderSnapshot,
  McpOAuthState,
  McpServerConfig,
  ModelOptions,
  NormalizedToolCall,
  PendingToolSnapshot,
  KannaStatus,
  ProviderUsage,
  QueuedChatMessage,
  ResolvedStackBinding,
  SlashCommand,
  Subagent,
  TranscriptEntry,
} from "../shared/types"
import type { ChatRecord, ProjectRecord } from "./events"
import { buildHistoryPrimer, shouldInjectPrimer } from "./history-primer"
import {
  getLatestContextWindowUsage,
  MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES,
  shouldProactivelyCompact,
} from "./proactive-compact"
import { normalizeToolCall } from "../shared/tools"
import type { ClientCommand } from "../shared/protocol"
import { LOG_PREFIX } from "../shared/branding"
import { KANNA_SYSTEM_PROMPT_APPEND, buildKannaSystemPromptAppend } from "../shared/kanna-system-prompt"
import { EventStore } from "./event-store"
import type { AnalyticsReporter } from "./analytics"
import { NoopAnalyticsReporter } from "./analytics"
import { CodexAppServerManager } from "./codex-app-server"
import { resolveSubagentRoots } from "./paths"
import { realpathAdapter } from "./paths-fs.adapter"
import { type GenerateChatTitleResult, generateTitleForChatDetailed } from "./generate-title"
import type { HarnessEvent, HarnessToolRequest, HarnessTurn } from "./harness-types"
import {
  codexServiceTierFromModelOptions,
  getServerProviderCatalog,
  isClaudeSdkProvider,
  normalizeClaudeModelOptions,
  normalizeCodexModelOptions,
  normalizeServerModel,
  openrouterAuthReady,
} from "./provider-catalog"
import { readLlmProviderSnapshot } from "./llm-provider"
import { computeCostUsd, resolveModelPrice, stripModelVariantSuffix } from "../shared/token-pricing"
import type { ModelPrice } from "../shared/token-pricing"
import { isCodexReasoningEffort, providerUsesSdkSession, resolveClaudeApiModelId, type ClaudeDriverPreference, type CustomModelEntry } from "../shared/types"
import { fallbackTitleFromMessage } from "./generate-title"
import { AUTO_CONTINUE_EVENT_VERSION, type AutoContinueEvent } from "./auto-continue/events"
import { ClaudeLimitDetector, CodexLimitDetector, type LimitDetection, type LimitDetector } from "./auto-continue/limit-detector"
import { ClaudeAuthErrorDetector, type AuthErrorDetection } from "./auto-continue/auth-error-detector"
import type { ScheduleManager } from "./auto-continue/schedule-manager"
import { deriveChatSchedules, deriveLoopState, type LoopState } from "./auto-continue/read-model"
import type { TunnelGateway } from "./cloudflare-tunnel/gateway"
import { OAuthTokenPool } from "./oauth-pool/oauth-token-pool"
import { maskOauthKey } from "../shared/mask-oauth-key"
import { parseMentions, type ParsedMention } from "./mention-parser"
import { SubagentOrchestrator, type BackgroundRunOutcome, type ProviderRunStart } from "./subagent-orchestrator"
import { buildSubagentProviderRun, type BuildSubagentProviderRunArgs } from "./subagent-provider-run"
import { OrchestrationQueue, type WorkerResult, type WorkerSpawnArgs } from "./orchestration-queue"
import { createOrchWorktreeOps } from "./orchestration-worktree.adapter"
import { runCommandInWorktree } from "./orchestration-exec-io.adapter"
import { toOrchRunDetail, validateOrchRun, type OrchRunContext } from "./orchestration-input"
import type { OrchRunDetail, OrchRunInput } from "../shared/orchestration-types"
import type { ToolCallbackService } from "./tool-callback"
import type { ChatPermissionPolicy } from "../shared/permission-policy"
import { mergePolicyOverride, POLICY_DEFAULT } from "../shared/permission-policy"
import { startClaudeSessionPTY, type StartClaudeSessionPtyArgs } from "./claude-pty/driver"
import { computeWorkflowsDir } from "./claude-pty/jsonl-path.adapter"
import { ensureFreshMcpToken } from "./mcp-oauth.adapter"
import { log } from "../shared/log"
import { type AnyValue, isRecord } from "../shared/errors"

type SdkMcpEntry =
  | { type: "stdio"; command: string; args: string[]; env: Record<string, string>; cwd?: string }
  | { type: "http"; url: string; headers: Record<string, string> }
  | { type: "sse"; url: string; headers: Record<string, string> }
  | { type: "ws"; url: string; headers: Record<string, string> }

export function buildUserMcpServers(
  servers: readonly McpServerConfig[],
  oauthBearers: ReadonlyMap<string, string> = new Map(),
): Record<string, SdkMcpEntry> {
  const out: Record<string, SdkMcpEntry> = {}
  for (const s of servers) {
    if (!s.enabled) continue
    if (s.name === KANNA_MCP_SERVER_NAME) continue
    if (s.transport === "stdio") {
      out[s.name] = {
        type: "stdio",
        command: s.command,
        args: s.args,
        env: s.env,
        ...(s.cwd ? { cwd: s.cwd } : {}),
      }
    } else {
      const bearer = oauthBearers.get(s.id)
      const headers = bearer ? { ...s.headers, Authorization: `Bearer ${bearer}` } : s.headers
      out[s.name] = {
        type: s.transport,
        url: s.url,
        headers,
      }
    }
  }
  return out
}

export function resolveSpawnPaths(
  chat: Pick<ChatRecord, "id" | "stackBindings">,
  fallbackLocalPath: string,
): { cwd: string; additionalDirectories: string[] } {
  if (!chat.stackBindings || chat.stackBindings.length === 0) {
    return { cwd: fallbackLocalPath, additionalDirectories: [] }
  }
  const primary = chat.stackBindings.find((b) => b.role === "primary")
  if (!primary) {
    throw new Error(`Chat ${chat.id} has stackBindings but no primary`)
  }
  const additionalDirectories = chat.stackBindings
    .filter((b) => b.role === "additional")
    .map((b) => b.worktreePath)
  return { cwd: primary.worktreePath, additionalDirectories }
}

/**
 * Resolve a chat's stack bindings into named entries for the system prompt.
 * Mirrors the read-model resolver in `read-models.ts` — looks each binding's
 * project title up via `lookupProjectTitle`, falling back to `(missing)` /
 * `projectStatus: "missing"` when the project no longer exists. Solo chats
 * (no `stackBindings`) resolve to an empty list (no prompt block).
 */
export function resolveStackProjects(
  chat: Pick<ChatRecord, "stackBindings">,
  lookupProjectTitle: (projectId: string) => string | undefined,
): ResolvedStackBinding[] {
  if (!chat.stackBindings || chat.stackBindings.length === 0) return []
  return chat.stackBindings.map((b) => {
    const title = lookupProjectTitle(b.projectId)
    return {
      projectId: b.projectId,
      projectTitle: title ?? "(missing)",
      worktreePath: b.worktreePath,
      role: b.role,
      projectStatus: title !== undefined ? "active" : "missing",
    }
  })
}

export const CLAUDE_TOOLSET = [
  "Skill",
  "WebFetch",
  "WebSearch",
  "Task",
  "TaskOutput",
  "Workflow",
  "Bash",
  "Glob",
  "Grep",
  "Read",
  "Edit",
  "Write",
  "TodoWrite",
  "KillShell",
  "AskUserQuestion",
  "EnterPlanMode",
  "ExitPlanMode",
] as const

/** Native FS tools the SDK driver disallows when a subagent is folder-restricted. */
const SDK_RESTRICTED_FS_NATIVE_TOOLS = ["Read", "Edit", "Write", "Bash", "Glob", "Grep", "WebFetch"] as const

interface PendingToolRequest {
  toolUseId: string
  tool: NormalizedToolCall & { toolKind: "ask_user_question" | "exit_plan_mode" }
  resolve: (result: AnyValue) => void
}

interface ActiveTurn {
  chatId: string
  provider: AgentProvider
  turn: HarnessTurn
  claudePromptSeq?: number
  model: string
  effort?: string
  serviceTier?: "fast"
  planMode: boolean
  status: KannaStatus
  pendingTool: PendingToolRequest | null
  postToolFollowUp: { content: string; planMode: boolean } | null
  hasFinalResult: boolean
  cancelRequested: boolean
  cancelRecorded: boolean
  clientTraceId?: string
  profilingStartedAt?: number
  waitStartedAt: number | null
  // True when this turn was synthesised by Kanna to inject `/compact` before
  // the user's real message. Used to update the per-chat compact circuit
  // breaker on completion (reset on success, increment on failure).
  proactiveCompactInjection?: boolean
  // _id of the user_prompt entry that triggered this turn (when appended on
  // this turn). Used to attribute main-Claude-initiated subagent runs to the
  // originating user message.
  userMessageId: string | null
}

export interface ClaudeSessionHandle {
  provider: "claude"
  stream: AsyncIterable<HarnessEvent>
  getAccountInfo?: () => Promise<AccountInfo | null>
  interrupt: () => Promise<void>
  close: () => void
  sendPrompt: (content: string) => Promise<void>
  setModel: (model: string) => Promise<void>
  setPermissionMode: (planMode: boolean) => Promise<void>
  getSupportedCommands: () => Promise<SlashCommand[]>
  /** Present only for keep-alive channel-delivery sessions; drives turn 2+. */
  pushChannelPrompt?: (text: string) => Promise<void>
}

interface ClaudeSessionState {
  id: string
  chatId: string
  session: ClaudeSessionHandle
  localPath: string
  additionalDirectories: string[]
  model: string
  effort?: string
  planMode: boolean
  sessionToken: string | null
  accountInfoLoaded: boolean
  nextPromptSeq: number
  pendingPromptSeqs: number[]
  activeTokenId: string | null
  oauthKeyMasked: string | null
  oauthLabel: string | null
  // OpenRouter turns route through the SDK with ANTHROPIC_AUTH_TOKEN set to the
  // OpenRouter key, so the SDK self-reports a misleading Anthropic source. Hold
  // the OpenRouter identity here to surface it in the account_info entry.
  openrouterKeyMasked: string | null
  openrouterModel: string | null
  lastUsedAt: number
  // Claude-Code background Bash tasks (`Bash(run_in_background: true)`) run as
  // children of this PTY process and notify completion via a `<task-notification>`
  // transcript line that the continuous tail re-enters as a real turn — but ONLY
  // if the process is still alive. Track launched task ids + a keep-alive
  // deadline so the idle reaper / budget enforcer does not tear the process down
  // mid-flight. See adr-20260604-pty-background-task-keepalive.
  backgroundTaskIds: Set<string>
  backgroundTaskDeadlineAt: number
  // Armed-loop state captured at spawn. Both drivers bake the loop tool-block
  // into the spawn (PTY: --disallowedTools CLI args; SDK: options.disallowedTools
  // so the model never sees the blocked tools — Claude Code's filter-at-spawn
  // pattern). When the armed state changes (setup_loop arms / stop_loop or
  // user-send disarms) the session must be respawned at the next turn boundary
  // or the block goes stale.
  loopArmedAtSpawn: boolean
  /** SDK only: set once the workflows dir has been registered for this session. */
  workflowsDirRegistered?: boolean
  // Number of cancelled turns awaiting their interrupt-induced tail `result`.
  // The SDK's `interrupt()` resolves the query loop with a `result` whose
  // subtype is `error_during_execution` (NOT `cancelled`) and empty text, which
  // would otherwise render as "An unknown error occurred." after the
  // `interrupted` entry. Set on cancel, consumed (and the tail suppressed) when
  // that result arrives, reset on each new turn so a no-tail cancel can't leak
  // suppression onto a later real error.
  cancelledResultPending: number
  // Set by clearClaudeSessionContext (/clear machinery: setup_loop, background
  // delivery). Once the chat's context is declared cleared, any session_token
  // this in-flight session still emits belongs to the OLD conversation and
  // must never re-persist over the wipe. Fresh spawns start unsuppressed.
  suppressSessionTokenPersist: boolean
}

interface ClaudeSessionLifecycleOptions {
  idleMs: number
  maxResidentSessions: number
  sweepIntervalMs: number
  // Max time a warm PTY session is held open solely because a background Bash
  // task is still pending (no other activity). Bounds a hung/never-completing
  // task so it cannot pin a process forever. See
  // adr-20260604-pty-background-task-keepalive.
  backgroundTaskMaxMs: number
}

interface AgentCoordinatorArgs {
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
    /**
     * Append text for the claude_code preset's `systemPrompt.append`.
     * Defaults to the static refusal-policy blurb; production callers in
     * `agent.ts` pass the dynamic value from `buildKannaSystemPromptAppend`
     * so the subagent roster is embedded.
     */
    systemPromptAppend?: string
    /** When set, redirect the SDK to OpenRouter instead of Anthropic. */
    openrouterApiKey?: string | null
    /** Orchestrator for delegate_subagent. Omit to hide the tool. */
    subagentOrchestrator?: SubagentOrchestrator
    /** Per-spawn delegation context (depth / ancestor chain / parentUserMessageId resolver). */
    delegationContext?: KannaMcpDelegationContext
    /**
     * Subagent-only override. When set, REPLACES the claude_code preset
     * append on systemPrompt entirely. Primary chats leave this unset.
     */
    systemPromptOverride?: string
    /**
     * Subagent-only one-shot prompt. When set, the SDK queue is primed with
     * this prompt and closed immediately so the session terminates after the
     * single turn. Primary chats leave this unset and call sendPrompt later.
     */
    initialPrompt?: string
    /** Routes AskUserQuestion/ExitPlanMode through tool-callback when KANNA_MCP_TOOL_CALLBACKS=1. */
    toolCallback?: ToolCallbackService
    /** Per-chat permission policy. Defaults to POLICY_DEFAULT if omitted. */
    chatPolicy?: ChatPermissionPolicy
    /** Enabled user MCP servers, merged into the SDK's mcpServers map. */
    customMcpServers?: readonly McpServerConfig[]
    /** Pre-resolved oauth bearer tokens keyed by server id. */
    oauthBearers?: ReadonlyMap<string, string>
    /** Folder-restricted subagent: disallow native FS tools + allowlist mcp__kanna__* + per-run path-deny scope. */
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
    /** Keep the SDK prompt queue open after the initial prompt to allow multi-turn keep-alive. */
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
   * entry (no `system_init`) after the session-token handshake. OpenRouter
   * routes through the Claude SDK; a stalled upstream leaves the stream open
   * but silent, so the `runClaudeSession` for-await never returns or throws
   * and the existing fail-close never fires. On timeout the watchdog
   * interrupts + closes the session so the stream ends and the turn is
   * recorded failed. OpenRouter-only; cleared on the first entry. Default
   * 120000 (2 min).
   */
  openrouterFirstEntryTimeoutMs?: number
  getSubagents?: () => Subagent[]
  getAppSettingsSnapshot?: () => {
    claudeAuth?: { authenticated?: boolean } | null
    claudeDriver?: {
      preference?: ClaudeDriverPreference
      lifecycle?: { idleTimeoutMs?: number; maxConcurrent?: number }
    }
    globalPromptAppend?: string
    customMcpServers?: readonly McpServerConfig[]
    customModels?: readonly CustomModelEntry[]
    subagentRuntime?: { runTimeoutMs?: number; defaultLoopSubagentId?: string | null; defaultOrchSubagentId?: string | null }
  }
  throwOnClaudeSessionStart?: boolean
  oauthPool?: OAuthTokenPool
  /** Populated on boot; will be consumed by canUseTool in Task 11. */
  toolCallback?: ToolCallbackService
  /** Per-chat permission policy forwarded to startClaudeSession. Defaults to POLICY_DEFAULT if omitted. */
  chatPolicy?: ChatPermissionPolicy
  /** Claude subprocess lifecycle tuning. Defaults are conservative and may be overridden in tests. */
  claudeSessionLifecycle?: Partial<ClaudeSessionLifecycleOptions>
  /** On-disk registry of claude PTY children for crash-orphan reap on next boot. Forwarded to every PTY spawn. */
  claudePtyRegistry?: import("./claude-pty/pid-registry.adapter").ClaudePtyRegistry
  /** In-memory live-status registry surfaced to the UI. Forwarded to every PTY spawn. */
  ptyInstanceRegistry?: import("./claude-pty/pty-instance-registry").PtyInstanceRegistry
  /** Registry of workflow runs per chat, populated by PTY driver from the on-disk workflows dir. */
  workflowRegistry?: import("./workflow-registry").WorkflowRegistry
  /** Registry mapping each chat to its `…/subagents` dir for on-demand Agent child-transcript drill-in. */
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

interface SendToStartingProfile {
  traceId: string
  startedAt: number
}

function isClaudeSteerLoggingEnabled() {
  return process.env.KANNA_LOG_CLAUDE_STEER === "1"
}

function logClaudeSteer(stage: string, details?: Record<string, unknown>) {
  if (!isClaudeSteerLoggingEnabled()) return
  log.info("[kanna/claude-steer]", JSON.stringify({
    stage,
    ...details,
  }))
}

const STEERED_MESSAGE_PREFIX = `<system-message>
The user would like to inform you of something while you continue to work. Acknowledge receipt immediately with a text response, then continue with the task at hand, incorporating the user's feedback if needed.
</system-message>`

interface SendMessageOptions {
  provider?: AgentProvider
  model?: string
  modelOptions?: ModelOptions
  effort?: string
  planMode?: boolean
  autoContinue?: { scheduleId: string }
}

export function timestamped<T extends Omit<TranscriptEntry, "_id" | "createdAt">>(
  entry: T,
  createdAt = Date.now()
) {
  return {
    _id: crypto.randomUUID(),
    createdAt,
    ...entry,
  }
}

function isPromptTooLongMessage(message: string): boolean {
  return /\bprompt\b.*\btoo\s+long\b/i.test(message)
    || /\bprompt\b.*\btoo\s+large\b/i.test(message)
}

// The stored session token points at a conversation the Claude CLI never
// persisted (e.g. a spawn interrupted before its first write). Every resume
// then fails instantly — and the doomed spawn mints yet another unpersisted
// session id, so without clearing the token the chat is wedged forever. The
// message rides in result.errors (debugRaw); result text is empty.
function isNoConversationFoundMessage(message: string): boolean {
  return /No conversation found with session ID/i.test(message)
}

function stringFromUnknown<T>(value: T): string {
  if (typeof value === "string") return value
  if (value === undefined || value === null) return ""
  try {
    // JSON.stringify returns the JS value `undefined` (not a string) for
    // functions/symbols, which would drop the `result` key on persist and
    // break the `result: string` contract; coerce to "" in that case.
    return JSON.stringify(value, null, 2) ?? ""
  } catch {
    return String(value)
  }
}

function buildSteeredMessageContent(content: string) {
  return content.trim().length > 0
    ? `${STEERED_MESSAGE_PREFIX}\n\n${content}`
    : STEERED_MESSAGE_PREFIX
}

function asRecord<T>(value: T): Record<string, unknown> | null {
  return isRecord(value) ? value : null
}

function asNumber<T>(value: T): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function escapeXmlAttribute(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("\"", "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
}

function isSendToStartingProfilingEnabled() {
  return process.env.KANNA_PROFILE_SEND_TO_STARTING === "1"
}

/** Narrows a free-form effort string to the SDK-accepted union without a cast. */
function toSdkEffort(effort: string | undefined): "low" | "medium" | "high" | "xhigh" | "max" | undefined {
  if (effort === "low" || effort === "medium" || effort === "high" || effort === "xhigh" || effort === "max") {
    return effort
  }
  return undefined
}

function elapsedProfileMs(startedAt: number) {
  return Number((performance.now() - startedAt).toFixed(1))
}

function logSendToStartingProfile(
  profile: SendToStartingProfile | null | undefined,
  stage: string,
  details?: Record<string, unknown>
) {
  if (!profile || !isSendToStartingProfilingEnabled()) {
    return
  }

  log.info("[kanna/send->starting][server]", JSON.stringify({
    traceId: profile.traceId,
    stage,
    elapsedMs: elapsedProfileMs(profile.startedAt),
    ...details,
  }))
}

export function buildAttachmentHintText(attachments: ChatAttachment[]) {
  if (attachments.length === 0) return ""

  const lines = attachments.map((attachment) => (
    `<attachment kind="${escapeXmlAttribute(attachment.kind)}" mime_type="${escapeXmlAttribute(attachment.mimeType)}" path="${escapeXmlAttribute(attachment.absolutePath)}" project_path="${escapeXmlAttribute(attachment.relativePath)}" size_bytes="${attachment.size}" display_name="${escapeXmlAttribute(attachment.displayName)}" />`
  ))

  return [
    "<kanna-attachments>",
    ...lines,
    "</kanna-attachments>",
  ].join("\n")
}

export function buildPromptText(content: string, attachments: ChatAttachment[]) {
  const attachmentHint = buildAttachmentHintText(attachments)
  if (!attachmentHint) {
    return content.trim()
  }

  const trimmed = content.trim()
  return [
    trimmed || "Please inspect the attached files.",
    attachmentHint,
  ].join("\n\n").trim()
}

function discardedToolResult(
  tool: NormalizedToolCall & { toolKind: "ask_user_question" | "exit_plan_mode" }
) {
  if (tool.toolKind === "ask_user_question") {
    return {
      discarded: true,
      answers: {},
    }
  }

  return {
    discarded: true,
  }
}

export function normalizeClaudeUsageSnapshot<T>(
  value: T,
  maxTokens?: number,
): ContextWindowUsageSnapshot | null {
  const usage = asRecord(value)
  if (!usage) return null

  const directInputTokens = asNumber(usage.input_tokens) ?? asNumber(usage.inputTokens) ?? 0
  const cacheCreationInputTokens =
    asNumber(usage.cache_creation_input_tokens) ?? asNumber(usage.cacheCreationInputTokens) ?? 0
  const cacheReadInputTokens =
    asNumber(usage.cache_read_input_tokens) ?? asNumber(usage.cacheReadInputTokens) ?? 0
  const outputTokens = asNumber(usage.output_tokens) ?? asNumber(usage.outputTokens) ?? 0
  const reasoningOutputTokens =
    asNumber(usage.reasoning_output_tokens) ?? asNumber(usage.reasoningOutputTokens)
  const toolUses = asNumber(usage.tool_uses) ?? asNumber(usage.toolUses)
  const durationMs = asNumber(usage.duration_ms) ?? asNumber(usage.durationMs)

  const inputTokens = directInputTokens + cacheCreationInputTokens + cacheReadInputTokens
  const usedTokens = inputTokens + outputTokens
  if (usedTokens <= 0) {
    return null
  }

  return {
    usedTokens,
    inputTokens,
    ...(cacheReadInputTokens > 0 ? { cachedInputTokens: cacheReadInputTokens } : {}),
    ...(outputTokens > 0 ? { outputTokens } : {}),
    ...(reasoningOutputTokens !== undefined ? { reasoningOutputTokens } : {}),
    lastUsedTokens: usedTokens,
    lastInputTokens: inputTokens,
    ...(cacheReadInputTokens > 0 ? { lastCachedInputTokens: cacheReadInputTokens } : {}),
    ...(outputTokens > 0 ? { lastOutputTokens: outputTokens } : {}),
    ...(reasoningOutputTokens !== undefined ? { lastReasoningOutputTokens: reasoningOutputTokens } : {}),
    ...(toolUses !== undefined ? { toolUses } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(typeof maxTokens === "number" && maxTokens > 0 ? { maxTokens } : {}),
    compactsAutomatically: false,
  }
}

// Resolve the single `context_window_updated` snapshot emitted at end of a
// turn. `latestUsageSnapshot` is the last per-`assistant`-message usage — a
// single-request view, the real live context size. `accumulatedUsage` is
// derived from SDK `result.usage`, which is CUMULATIVE: it re-counts
// `cache_read_input_tokens` on every tool round-trip, so its `usedTokens`
// balloons to millions on long turns.
//
// The cumulative figure must never become `usedTokens` — proactive-compact
// reads `usedTokens` and would trip far below the real threshold, then the
// no-assistant-usage compact turn would re-inflate and force a second
// compact (the double-compact bug). So cumulative only ever enriches
// `totalProcessedTokens`. When no per-assistant snapshot exists (compact /
// system turns), return null: the caller skips emission and proactive-compact
// falls back to the prior live snapshot (or a compact_boundary → no compact).
export function resolveFinalTurnUsage(
  latestUsageSnapshot: ContextWindowUsageSnapshot | null,
  accumulatedUsage: ContextWindowUsageSnapshot | null,
  lastKnownContextWindow: number | undefined,
): ContextWindowUsageSnapshot | null {
  if (!latestUsageSnapshot) return null
  return {
    ...latestUsageSnapshot,
    ...(typeof lastKnownContextWindow === "number" ? { maxTokens: lastKnownContextWindow } : {}),
    ...(accumulatedUsage && accumulatedUsage.usedTokens > latestUsageSnapshot.usedTokens
      ? { totalProcessedTokens: accumulatedUsage.usedTokens }
      : {}),
  }
}

export function maxClaudeContextWindowFromModelUsage<T>(modelUsage: T): number | undefined {
  const record = asRecord(modelUsage)
  if (!record) return undefined

  let maxContextWindow: number | undefined
  for (const value of Object.values(record)) {
    const usage = asRecord(value)
    const contextWindow = asNumber(usage?.contextWindow) ?? asNumber(usage?.context_window)
    if (contextWindow === undefined) continue
    maxContextWindow = Math.max(maxContextWindow ?? 0, contextWindow)
  }
  return maxContextWindow
}

// The SDK's `result.modelUsage[*].contextWindow` can lie: it reports 200_000 even
// when the user opted into the 1M beta via the `[1m]` model id suffix
// (claude-agent-sdk-typescript#238). Without this hint, proactive-compact would
// trip at 167k tokens — ~17% of the real 1M window — and compact far too often.
// We derive the configured window from the SDK model id and use it as a floor.
export function parseConfiguredContextWindowFromModelId(modelId: string): number | undefined {
  return modelId.endsWith("[1m]") ? 1_000_000 : undefined
}

function normalizeMcpServerEntry(s: AnyValue): { name: string; status: string } {
  if (typeof s === "string") return { name: s, status: "connected" }
  if (isRecord(s) && typeof s.name === "string") {
    return { name: s.name, status: typeof s.status === "string" ? s.status : "connected" }
  }
  return { name: String(s), status: "connected" }
}

// Minimal structural interface for raw SDK JSONL messages. All properties are
// optional so that both real SDK types and partial test fixtures are assignable.
// No `any` or `unknown` — every accessed field is typed concretely.
interface ClaudeRawContentBlock {
  type?: string
  text?: string
  thinking?: string
  signature?: string
  name?: string
  id?: string
  // input is structurally opaque; passed straight through to normalizeToolCall
  input?: AnyValue
  tool_use_id?: string
  // content is opaque (tool_result bodies have nested structures) — passed
  // through as-is to ToolResultEntry.content which accepts any value.
  content?: object | string | null
  is_error?: boolean
}
interface ClaudeRawMessageBody {
  id?: string
  content?: ClaudeRawContentBlock[] | string
  role?: string
  model?: string
  stop_reason?: string | null
  usage?: AnyValue
}
export interface ClaudeRawSdkMessage {
  type?: string
  subtype?: string
  uuid?: string
  model?: string
  tools?: string[]
  agents?: string[]
  slash_commands?: string[]
  mcp_servers?: AnyValue[]
  message?: ClaudeRawMessageBody
  isApiErrorMessage?: boolean
  apiErrorStatus?: number
  request_id?: string
  requestId?: string
  is_error?: boolean
  duration_ms?: number
  result?: string
  total_cost_usd?: number
  status?: string | null
  summary?: string
  skip_transcript?: boolean
  durationMs?: number
  pendingWorkflowCount?: number
  usage?: AnyValue
  modelUsage?: AnyValue
  // SDK rate-limit event fields
  rate_limit_info?: Record<string, string | number | boolean | null>
  session_id?: string
  stop_reason?: string | null
  // Task-notification fields
  task_id?: string
  output_file?: string
  tool_use_id?: string
}

export function getClaudeAssistantMessageUsageId(message: ClaudeRawSdkMessage): string | null {
  if (typeof message?.message?.id === "string" && message.message.id) {
    return message.message.id
  }
  if (typeof message?.uuid === "string" && message.uuid) {
    return message.uuid
  }
  return null
}

// Benign turn-end markers the Claude CLI emits as model "<synthetic>" messages
// (the CVH-family constants in the CLI binary) when a turn ends with nothing to
// say. They carry isApiErrorMessage:false and carry zero information, so they
// are dropped entirely — never rendered as a red api_error card and never as an
// assistant_text bubble. In PTY channel-delivered turns the CLI emits one at the
// start of every turn; surfacing it as assistant_text flipped the UI out of its
// waiting state before the real reply streamed (spinner vanished, placeholder
// read as the answer). See adr-20260607-drop-synthetic-no-response-marker.
const SYNTHETIC_NON_ERROR_PLACEHOLDERS: ReadonlySet<string> = new Set([
  "No response requested.",
  "No action needed.",
  "Nothing needed from you.",
])

// Claude CLI hard-refusals (Usage-Policy / real-time cyber-safeguard block)
// arrive as a model "<synthetic>" message with stop_reason "refusal" and one of
// these phrases in the text. Used to split a deliberate refusal out of the
// generic api_error bucket. See adr-20260607-surface-policy-refusal-entry.
const POLICY_REFUSAL_TEXT_MARKERS: readonly string[] = [
  "violate our Usage Policy",
  "unable to respond to this request",
]

function normalizeToolContent(c: AnyValue): string | Record<string, unknown> | readonly unknown[] | null {
  if (c === null || c === undefined) return null
  if (typeof c === "string") return c
  if (Array.isArray(c)) return c
  if (isRecord(c)) return c
  return null
}

// Type-bridge: ClaudeRawSdkMessage is a structural duck-type — all fields optional.
// Any SDK message object satisfies it at runtime via dynamic field access.
function isSdkToClaudeMessage(m: object): m is ClaudeRawSdkMessage {
  void m
  return true
}
async function* toClaudeMessageStream(q: Query): AsyncGenerator<ClaudeRawSdkMessage> {
  for await (const m of q) {
    if (isSdkToClaudeMessage(m)) yield m
  }
}

export function normalizeClaudeStreamMessage(message: ClaudeRawSdkMessage): TranscriptEntry[] {
  const debugRaw = JSON.stringify(message)
  const messageId = typeof message.uuid === "string" ? message.uuid : undefined

  if (message.type === "system" && message.subtype === "init") {
    return [
      timestamped({
        kind: "system_init",
        messageId,
        provider: "claude",
        model: typeof message.model === "string" ? message.model : "unknown",
        tools: Array.isArray(message.tools) ? message.tools : [],
        agents: Array.isArray(message.agents) ? message.agents : [],
        slashCommands: Array.isArray(message.slash_commands)
          ? message.slash_commands.filter((entry: string) => !entry.startsWith("._"))
          : [],
        mcpServers: Array.isArray(message.mcp_servers)
          ? message.mcp_servers.map((s: AnyValue) => normalizeMcpServerEntry(s))
          : [],
        debugRaw,
      }),
    ]
  }

  if (message.type === "assistant" && Array.isArray(message.message?.content)) {
    const joinedText = message.message.content
      .filter((c): c is ClaudeRawContentBlock & { text: string } => c.type === "text" && typeof c.text === "string")
      .map((c) => c.text)
      .join("")
    // The Claude CLI reuses model "<synthetic>" for two distinct purposes:
    // genuine API errors AND benign turn-end placeholders ("No response
    // requested." etc., the CVH-family constants in the CLI binary). The benign
    // markers carry isApiErrorMessage:false, so a bare synthetic model is NOT
    // sufficient to classify as an error — only treat it as api_error when the
    // flag is set, or the synthetic text is not a known benign placeholder.
    const isSyntheticModel = message.message?.model === "<synthetic>"
    const isBenignSyntheticPlaceholder = isSyntheticModel
      && SYNTHETIC_NON_ERROR_PLACEHOLDERS.has(joinedText.trim())
    if (
      message.isApiErrorMessage === true
      || (isSyntheticModel && !isBenignSyntheticPlaceholder)
    ) {
      const statusFromField = typeof message.apiErrorStatus === "number" ? message.apiErrorStatus : undefined
      const statusFromText = (() => {
        const match = /API Error:\s*(\d{3})/i.exec(joinedText)
        return match ? Number.parseInt(match[1], 10) : undefined
      })()
      let requestId: string | undefined
      if (typeof message.request_id === "string") {
        requestId = message.request_id
      } else if (typeof message.requestId === "string") {
        requestId = message.requestId
      } else {
        requestId = undefined
      }
      // A deliberate model refusal (Usage-Policy / cyber-safeguard block) is NOT
      // a transport error — it carries stop_reason "refusal" and/or the policy
      // phrase. Surface it as its own `policy_refusal` kind so the UI labels it
      // "Blocked — Usage Policy" instead of a generic red API-error card that
      // reads like a network failure. See adr-20260607-surface-policy-refusal-entry.
      const isPolicyRefusal =
        message.message?.stop_reason === "refusal"
        || POLICY_REFUSAL_TEXT_MARKERS.some((marker) => joinedText.includes(marker))
      if (isPolicyRefusal) {
        return [timestamped({
          kind: "policy_refusal",
          messageId,
          text: joinedText,
          requestId,
          debugRaw,
        })]
      }
      return [timestamped({
        kind: "api_error",
        messageId,
        status: statusFromField ?? statusFromText ?? 0,
        text: joinedText,
        requestId,
        debugRaw,
      })]
    }
    // Benign synthetic turn-end marker (not an api_error): drop it. The api_error
    // branch above already claimed any isApiErrorMessage:true message, so a real
    // error carrying the same text still surfaces. Turn termination is driven by
    // the separate system/turn_duration → result message, not this placeholder.
    if (isBenignSyntheticPlaceholder) {
      return []
    }
    const entries: TranscriptEntry[] = []
    for (const content of message.message.content) {
      // Extended-reasoning block. Surface as its own kind so the UI renders it
      // collapsed and the event log keeps reasoning distinct from output. A
      // redacted block carries only a signature (empty thinking) — skip it.
      if (content.type === "thinking" && typeof content.thinking === "string" && content.thinking.length > 0) {
        entries.push(timestamped({
          kind: "assistant_thinking",
          messageId,
          text: content.thinking,
          signature: typeof content.signature === "string" ? content.signature : undefined,
          debugRaw,
        }))
      }
      if (content.type === "text" && typeof content.text === "string") {
        entries.push(timestamped({
          kind: "assistant_text",
          messageId,
          text: content.text,
          debugRaw,
        }))
      }
      if (content.type === "tool_use" && typeof content.name === "string" && typeof content.id === "string") {
        entries.push(timestamped({
          kind: "tool_call",
          messageId,
          tool: normalizeToolCall({
            toolName: content.name,
            toolId: content.id,
            input: isRecord(content.input) ? content.input : {},
          }),
          debugRaw,
        }))
      }
    }
    return entries
  }

  if (message.type === "user" && Array.isArray(message.message?.content)) {
    const entries: TranscriptEntry[] = []
    for (const content of message.message.content) {
      if (content.type === "tool_result" && typeof content.tool_use_id === "string") {
        entries.push(timestamped({
          kind: "tool_result",
          messageId,
          toolId: content.tool_use_id,
          content: normalizeToolContent(content.content),
          isError: Boolean(content.is_error),
          debugRaw,
        }))
      }
      if (message.message.role === "user" && typeof message.message.content === "string") {
        entries.push(timestamped({
          kind: "compact_summary",
          messageId,
          summary: message.message.content,
          debugRaw,
        }))
      }
    }
    return entries
  }

  // No `result.subtype === "compaction"` branch by design: Kanna never relies
  // on the SDK's in-loop auto-compact. The SDK `query()` driver spawns a fresh
  // subprocess per turn and never enters claude-code's REPL loop, so that
  // compaction stop is unreachable here (see proactive-compact.ts). Context
  // compaction is instead driven by Kanna injecting a native `/compact` turn
  // and surfaces purely as the `system/compact_boundary` message handled
  // below — not as a result subtype.
  if (message.type === "result") {
    if (message.subtype === "cancelled") {
      return [timestamped({ kind: "interrupted", messageId, debugRaw })]
    }
    return [
      timestamped({
        kind: "result",
        messageId,
        subtype: message.is_error ? "error" : "success",
        isError: Boolean(message.is_error),
        durationMs: typeof message.duration_ms === "number" ? message.duration_ms : 0,
        result: typeof message.result === "string" ? message.result : stringFromUnknown(message.result),
        costUsd: typeof message.total_cost_usd === "number" ? message.total_cost_usd : undefined,
        debugRaw,
      }),
    ]
  }

  if (message.type === "system" && message.subtype === "status" && typeof message.status === "string") {
    return [timestamped({ kind: "status", messageId, status: message.status, debugRaw })]
  }

  // The Agent SDK emits SDKTaskNotificationMessage when a
  // `Bash(run_in_background)` task settles (status completed|failed|stopped).
  // The model is re-driven natively by the SDK's user-origin task-notification
  // message (the `canUseTool`-after-result self-resume noted in send()), so
  // this branch only SURFACES the completion into the transcript/event log —
  // without it the background work was invisible to Kanna. `skip_transcript`
  // marks ambient/housekeeping tasks the SDK asks consumers to hide inline.
  if (message.type === "system" && message.subtype === "task_notification") {
    const taskStatus = typeof message.status === "string" ? message.status : "completed"
    const summary = typeof message.summary === "string" && message.summary.length > 0
      ? message.summary
      : "(no summary)"
    const taskId = typeof message.task_id === "string" ? message.task_id : undefined
    return [timestamped({
      kind: "status",
      messageId,
      status: `Background task ${taskStatus}: ${summary}`,
      hidden: message.skip_transcript === true ? true : undefined,
      backgroundTaskId: taskId,
      debugRaw,
    })]
  }

  // Interactive TUI claude never writes a `type: "result"` row — it writes
  // `system/turn_duration` instead (per canon/shannon research). Synthesize a
  // turn-end `result` so the agent loop and UI see the turn complete.
  if (message.type === "system" && message.subtype === "turn_duration") {
    let durationMs: number
    if (typeof message.durationMs === "number") {
      durationMs = message.durationMs
    } else if (typeof message.duration_ms === "number") {
      durationMs = message.duration_ms
    } else {
      durationMs = 0
    }
    const pendingWorkflowCount = typeof message.pendingWorkflowCount === "number"
      ? message.pendingWorkflowCount
      : undefined
    return [
      timestamped({
        kind: "result",
        messageId,
        subtype: "success",
        isError: false,
        durationMs,
        result: "",
        costUsd: undefined,
        ...(pendingWorkflowCount !== undefined ? { pendingWorkflowCount } : {}),
        debugRaw,
      }),
    ]
  }

  if (message.type === "system" && message.subtype === "compact_boundary") {
    return [timestamped({ kind: "compact_boundary", messageId, debugRaw })]
  }

  if (message.type === "system" && message.subtype === "context_cleared") {
    return [timestamped({ kind: "context_cleared", messageId, debugRaw })]
  }

  if (
    message.type === "user" &&
    message.message?.role === "user" &&
    typeof message.message.content === "string" &&
    message.message.content.startsWith("This session is being continued")
  ) {
    return [timestamped({ kind: "compact_summary", messageId, summary: message.message.content, debugRaw })]
  }

  return []
}

export async function* createClaudeHarnessStream(
  q: AsyncIterable<ClaudeRawSdkMessage>,
  configuredContextWindow?: number,
  resolveTurnPrice?: () => ModelPrice | null,
): AsyncGenerator<HarnessEvent> {
  let seenAssistantUsageIds = new Set<string>()
  let latestUsageSnapshot: ContextWindowUsageSnapshot | null = null
  let lastKnownContextWindow: number | undefined = configuredContextWindow
  const detector = new ClaudeLimitDetector()
  // SDK rate-limit / api-error turns emit BOTH a synthetic assistant
  // `isApiErrorMessage` (→ `api_error` entry, red card with text) AND a
  // `type:"result"` whose `result` field repeats the same text (→ second
  // red card + "Failed after Xs"). Track per-turn api_error emission so
  // we can scrub the duplicate body off the trailing result entry; the
  // duration footer still renders, the message renders once.
  let apiErrorEmittedInTurn = false

  // Per-turn billed token usage and cost to attach to the result entry.
  // Set when the `type:"result"` SDK message is processed; cleared after
  // the result entry is yielded so they don't leak to a subsequent turn.
  let pendingResultUsage: ProviderUsage | undefined
  let pendingResultCost: number | undefined

  for await (const sdkMessage of q) {
    const sessionToken = typeof sdkMessage.session_id === "string" ? sdkMessage.session_id : null
    if (sessionToken) {
      yield { type: "session_token", sessionToken }
    }

    if (sdkMessage?.type === "rate_limit_event") {
      const detection = detector.detectFromSdkRateLimitInfo("", sdkMessage.rate_limit_info)
      if (detection) {
        yield { type: "rate_limit", rateLimit: { resetAt: detection.resetAt, tz: detection.tz } }
      }
    }

    if (sdkMessage?.type === "assistant") {
      const usageId = getClaudeAssistantMessageUsageId(sdkMessage)
      const usageSnapshot = normalizeClaudeUsageSnapshot(sdkMessage.usage, lastKnownContextWindow)
      if (usageId && usageSnapshot && !seenAssistantUsageIds.has(usageId)) {
        seenAssistantUsageIds.add(usageId)
        latestUsageSnapshot = usageSnapshot
        yield {
          type: "transcript",
          entry: timestamped({
            kind: "context_window_updated",
            usage: usageSnapshot,
          }),
        }
      }
    }

    if (sdkMessage?.type === "result") {
      const resultContextWindow = maxClaudeContextWindowFromModelUsage(sdkMessage.modelUsage)
      // Never let SDK lower the configured window — see comment on
      // parseConfiguredContextWindowFromModelId for the 1M beta footgun.
      if (resultContextWindow !== undefined) {
        lastKnownContextWindow = Math.max(lastKnownContextWindow ?? 0, resultContextWindow)
      }

      const accumulatedUsage = normalizeClaudeUsageSnapshot(
        sdkMessage.usage,
        lastKnownContextWindow,
      )
      const finalUsage = resolveFinalTurnUsage(
        latestUsageSnapshot,
        accumulatedUsage,
        lastKnownContextWindow,
      )

      const providerCostUsd =
        typeof sdkMessage.total_cost_usd === "number"
          ? sdkMessage.total_cost_usd
          : undefined

      let costUsd = providerCostUsd
      if (costUsd === undefined && resolveTurnPrice && finalUsage) {
        const price = resolveTurnPrice()
        if (price) {
          costUsd = computeCostUsd(
            {
              inputTokens: finalUsage.inputTokens,
              cachedInputTokens: finalUsage.cachedInputTokens,
              outputTokens: finalUsage.outputTokens,
            },
            price,
          )
        }
      }

      // Stash billed token figures for the result entry (populated below
      // in the entry loop). Prefer `accumulatedUsage` (the per-turn
      // cumulative that the SDK computes) for tokens; fall back to
      // `finalUsage` when accumulated is null.
      const billed = accumulatedUsage ?? finalUsage
      pendingResultUsage = billed
        ? {
            ...(billed.inputTokens !== undefined ? { inputTokens: billed.inputTokens } : {}),
            ...(billed.outputTokens !== undefined ? { outputTokens: billed.outputTokens } : {}),
            ...(billed.cachedInputTokens !== undefined ? { cachedInputTokens: billed.cachedInputTokens } : {}),
          }
        : undefined
      pendingResultCost = costUsd

      if (finalUsage) {
        const usageWithCost = costUsd !== undefined ? { ...finalUsage, costUsd } : finalUsage
        yield {
          type: "transcript",
          entry: timestamped({
            kind: "context_window_updated",
            usage: usageWithCost,
          }),
        }
      }

      seenAssistantUsageIds = new Set<string>()
      latestUsageSnapshot = null
    }

    for (const entry of normalizeClaudeStreamMessage(sdkMessage)) {
      if (entry.kind === "api_error") {
        apiErrorEmittedInTurn = true
      } else if (entry.kind === "result") {
        const scrubbed = entry.isError && apiErrorEmittedInTurn
          ? { ...entry, result: "" }
          : entry
        apiErrorEmittedInTurn = false
        const enriched = {
          ...scrubbed,
          ...(pendingResultUsage !== undefined ? { usage: pendingResultUsage } : {}),
          ...(pendingResultCost !== undefined ? { costUsd: pendingResultCost } : {}),
        }
        pendingResultUsage = undefined
        pendingResultCost = undefined
        yield { type: "transcript", entry: enriched }
        continue
      }
      yield { type: "transcript", entry }
    }
  }
}

class AsyncMessageQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = []
  private readonly waiters: Array<(result: IteratorResult<T, undefined>) => void> = []
  private closed = false

  push(value: T) {
    if (this.closed) {
      throw new Error("Cannot push to a closed queue")
    }

    const waiter = this.waiters.shift()
    if (waiter) {
      waiter({ done: false, value })
      return
    }

    this.values.push(value)
  }

  close() {
    if (this.closed) return
    this.closed = true
    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift()
      waiter?.({ done: true, value: undefined })
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T, undefined> {
    return {
      next: async (): Promise<IteratorResult<T, undefined>> => {
        if (this.values.length > 0) {
          return { done: false, value: this.values.shift()! }
        }

        if (this.closed) {
          return { done: true, value: undefined }
        }

        return await new Promise<IteratorResult<T, undefined>>((resolve) => {
          this.waiters.push(resolve)
        })
      },
    }
  }
}

/**
 * Native tools blocked while an autonomous loop is armed on the chat. The loop
 * orchestrator must delegate every code change to a subagent (fresh context
 * each iteration); letting it edit directly is exactly the drift that produced
 * the 7.5h marathon turn. `Task` (the native Agent tool) is blocked too — it
 * runs inline in the same turn with no /clear.
 */
export const LOOP_BLOCKED_NATIVE_TOOLS: readonly string[] = [
  "Edit",
  "Write",
  "MultiEdit",
  "NotebookEdit",
  "Task",
]

/** Cap on the <result> body inside a task-notification — bounds re-entry prompt size. */
const TASK_NOTIFICATION_RESULT_MAX_CHARS = 4_000

/**
 * Render a background-subagent outcome as the `<task-notification>` XML that
 * Claude Code's own LocalAgentTask uses for background-agent completion, so
 * the model parses task identity/status with a format it natively knows.
 * `includeResult: false` (armed loops) omits the result body — PROGRESS.md is
 * the loop's durability contract, not the re-entry prompt.
 */
export function buildTaskNotification(
  runId: string,
  outcome: BackgroundRunOutcome,
  opts: { includeResult: boolean },
): string {
  const status = outcome.status === "completed" ? "completed" : "failed"
  const summary = outcome.status === "completed"
    ? `Background subagent run ${runId} completed`
    : `Background subagent run ${runId} failed (${outcome.errorCode}): ${outcome.errorMessage}`
  let resultSection = ""
  if (opts.includeResult) {
    const body = outcome.status === "completed" ? outcome.text : outcome.errorMessage
    const trimmed = body.length > TASK_NOTIFICATION_RESULT_MAX_CHARS
      ? `${body.slice(0, TASK_NOTIFICATION_RESULT_MAX_CHARS)}\n[... truncated]`
      : body
    if (trimmed) resultSection = `\n<result>${trimmed}</result>`
  }
  return `<task-notification>
<task-id>${runId}</task-id>
<status>${status}</status>
<summary>${summary}</summary>${resultSection}
</task-notification>`
}

/** Args for the `buildCanUseTool` helper — exposed for unit testing. */
export interface BuildCanUseToolArgs {
  localPath: string
  chatId?: string
  sessionToken?: string | null
  onToolRequest: (request: HarnessToolRequest) => Promise<AnyValue>
  toolCallback?: ToolCallbackService
  chatPolicy?: ChatPermissionPolicy
  /** When present and returns true, block LOOP_BLOCKED_NATIVE_TOOLS (loop-armed turn). */
  isLoopArmed?: () => boolean
}

/**
 * Builds the `canUseTool` callback passed to the SDK `query()`.
 * Exported so unit tests can exercise the dual-routing logic without
 * going through the full `startClaudeSession` factory.
 */
export function buildCanUseTool(args: BuildCanUseToolArgs): CanUseTool {
  return async (toolName, input, options) => {
    // Loop-armed turns: the orchestrator may only Read/Bash(verify)/delegate.
    // Block direct edits + the native Agent tool so it cannot self-implement.
    if (args.isLoopArmed?.() && LOOP_BLOCKED_NATIVE_TOOLS.includes(toolName)) {
      return {
        behavior: "deny",
        message:
          `${toolName} is blocked while an autonomous loop is armed. You are the `
          + "orchestrator: delegate the next chunk with delegate_subagent "
          + "(run_in_background: true) and end your turn, or call stop_loop if the "
          + "goal is met. Do not edit files directly.",
      }
    }

    if (toolName !== "AskUserQuestion" && toolName !== "ExitPlanMode") {
      return { behavior: "allow", updatedInput: input }
    }

    const tool = normalizeToolCall({
      toolName,
      toolId: options.toolUseID,
      input: input ?? {},
    })

    if (tool.toolKind !== "ask_user_question" && tool.toolKind !== "exit_plan_mode") {
      return { behavior: "deny", message: "Unsupported tool request" }
    }

    // ── Flag-on path: route through tool-callback ──────────────────────────
    if (process.env.KANNA_MCP_TOOL_CALLBACKS === "1" && args.toolCallback) {
      const result = await args.toolCallback.submit({
        chatId: args.chatId ?? "",
        sessionId: args.sessionToken ?? "",
        toolUseId: options.toolUseID,
        toolName: `mcp__kanna__${tool.toolKind}`,
        args: isRecord(tool.rawInput) ? tool.rawInput : {},
        chatPolicy: args.chatPolicy ?? POLICY_DEFAULT,
        cwd: args.localPath,
      })

      if (result.decision.kind === "deny") {
        return { behavior: "deny", message: result.decision.reason ?? "denied" }
      }

      const payload: Record<string, unknown> = isRecord(result.decision.payload) ? result.decision.payload : {}

      if (tool.toolKind === "ask_user_question") {
        return {
          behavior: "allow",
          updatedInput: {
            ...(tool.rawInput ?? {}),
            questions: payload.questions ?? tool.input.questions,
            answers: payload.answers ?? result.decision.payload,
          },
        } satisfies PermissionResult
      }

      // exit_plan_mode
      if (payload.confirmed) {
        return {
          behavior: "allow",
          updatedInput: { ...(tool.rawInput ?? {}), ...payload },
        } satisfies PermissionResult
      }

      return {
        behavior: "deny",
        message: typeof payload.message === "string"
          ? `User wants to suggest edits to the plan: ${payload.message}`
          : "User wants to suggest edits to the plan before approving.",
      } satisfies PermissionResult
    }

    // ── Legacy path (flag off OR toolCallback not provided) ────────────────
    const result = await args.onToolRequest({ tool })

    if (tool.toolKind === "ask_user_question") {
      const record: Record<string, unknown> = isRecord(result) ? result : {}
      return {
        behavior: "allow",
        updatedInput: {
          ...(tool.rawInput ?? {}),
          questions: record.questions ?? tool.input.questions,
          answers: record.answers ?? result,
        },
      } satisfies PermissionResult
    }

    const record: Record<string, unknown> = isRecord(result) ? result : {}
    const confirmed = Boolean(record.confirmed)
    if (confirmed) {
      return {
        behavior: "allow",
        updatedInput: { ...(tool.rawInput ?? {}), ...record },
      } satisfies PermissionResult
    }

    return {
      behavior: "deny",
      message: typeof record.message === "string"
        ? `User wants to suggest edits to the plan: ${record.message}`
        : "User wants to suggest edits to the plan before approving.",
    } satisfies PermissionResult
  }
}

export function buildClaudeEnv(
  baseEnv: NodeJS.ProcessEnv,
  oauthToken: string | null,
  openrouter?: { apiKey: string } | null,
): NodeJS.ProcessEnv {
  const { CLAUDECODE: _unused, CLAUDE_CODE_OAUTH_TOKEN: _oauth, ...rest } = baseEnv
  if (openrouter) {
    // OpenRouter's Anthropic-compatible endpoint. ANTHROPIC_API_KEY MUST be
    // explicitly empty or the SDK prefers it over the auth token and 401s.
    return {
      ...rest,
      ANTHROPIC_BASE_URL: "https://openrouter.ai/api",
      ANTHROPIC_AUTH_TOKEN: openrouter.apiKey,
      ANTHROPIC_API_KEY: "",
    }
  }
  // Empty string is treated the same as null. Blank tokens are rejected at persistence time
  // by normalizeTokenEntry, so in practice oauthToken is either a non-empty string or null.
  if (!oauthToken) {
    return baseEnv.CLAUDE_CODE_OAUTH_TOKEN
      ? { ...rest, CLAUDE_CODE_OAUTH_TOKEN: baseEnv.CLAUDE_CODE_OAUTH_TOKEN }
      : rest
  }
  return { ...rest, CLAUDE_CODE_OAUTH_TOKEN: oauthToken }
}

async function startClaudeSession(args: {
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

const TOKEN_ROTATION_SCHEDULE_DELAY_MS = 100
// When a single OAuth token is shared by N chats (per
// adr-20260522-oauth-token-share-cap), all N chats can detect the same
// rate-limit / auth-error simultaneously. Each respawn (esp. under PTY) is
// expensive; offset them by this many ms per additional victim so the cold-
// boot herd spreads across roughly a second instead of stampeding.
const TOKEN_ROTATION_HERD_STAGGER_MS = 250
// Dedupe window for repeat rotation events on the same tokenId. Within this
// window, secondary detectors only increment the stagger counter; they do
// not double-mark the pool or double-pick a fresh target via pickActive().
const TOKEN_ROTATION_DEDUPE_WINDOW_MS = 5_000
const DEFAULT_CLAUDE_SESSION_IDLE_MS = 10 * 60 * 1000
const DEFAULT_CLAUDE_SESSION_MAX_RESIDENT = 4
const DEFAULT_CLAUDE_SESSION_SWEEP_INTERVAL_MS = 60 * 1000
// Keep a PTY session warm up to 30 min while a background Bash task is pending —
// comfortably longer than the 10-min idle window and typical CI durations.
const DEFAULT_PTY_BACKGROUND_TASK_MAX_MS = 30 * 60 * 1000
// OpenRouter-only watchdog: a stalled upstream leaves the SDK stream open but
// silent after the session-token handshake, so the runClaudeSession for-await
// never ends and the existing fail-close never fires. Abort if no transcript
// entry arrives within this window. system_init is the SDK init echo (precedes
// model inference), so 2 min is generous; env-tunable per deployment.
const DEFAULT_OPENROUTER_FIRST_ENTRY_TIMEOUT_MS = 2 * 60 * 1000

function positiveIntegerFromEnv(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

// Claude Code's BashTool emits this exact line in the tool_result when a command
// is launched with `run_in_background: true`. It is the only observable launch
// signal in Kanna's entry stream (the later `<task-notification>` line produces
// no transcript entry). The id is alphanumeric. Global flag: one result may
// report multiple launches in theory; capture every id.
const BACKGROUND_TASK_LAUNCH_RE = /Command running in background with ID:\s*(\w+)/g

/** Extract background-task ids from a tool_result entry's content (string or content blocks). */
export function backgroundTaskIdsFromToolResult<T>(content: T): string[] {
  let text = ""
  if (typeof content === "string") {
    text = content
  } else if (Array.isArray(content)) {
    for (const block of content) {
      if (isRecord(block)) {
        const blockText = block.text
        if (typeof blockText === "string") {
          text += `${blockText}\n`
        }
      }
    }
  } else {
    return []
  }
  const ids: string[] = []
  for (const match of text.matchAll(BACKGROUND_TASK_LAUNCH_RE)) {
    if (match[1]) ids.push(match[1])
  }
  return ids
}

// Thrown by Claude spawn paths when the OAuth pool has tokens but every one
// is currently unusable (rate-limited, errored, disabled, or reserved by
// another chat). `startTurnForChat` catches this and persists `message` as a
// `result` transcript entry instead of letting it surface as an ephemeral
// commandError that gets wiped by the next chat snapshot tick.
export class OAuthPoolUnavailableError extends Error {
  readonly kind = "oauth_pool_unavailable" as const
  constructor(message: string) {
    super(message)
    this.name = "OAuthPoolUnavailableError"
  }
}

export class AgentCoordinator {
  private readonly store: EventStore
  private readonly onStateChange: (chatId?: string, options?: { immediate?: boolean }) => void
  private readonly analytics: AnalyticsReporter
  private readonly codexManager: CodexAppServerManager
  private readonly generateTitle: (messageContent: string, cwd: string) => Promise<GenerateChatTitleResult>
  private readonly startClaudeSessionFn: NonNullable<AgentCoordinatorArgs["startClaudeSession"]>
  private readonly startClaudeSessionPTYFn: (args: StartClaudeSessionPtyArgs) => Promise<ClaudeSessionHandle>
  private reportBackgroundError: ((message: string) => void) | null = null
  readonly activeTurns = new Map<string, ActiveTurn>()
  readonly drainingStreams = new Map<string, { turn: HarnessTurn }>()
  readonly claudeSessions = new Map<string, ClaudeSessionState>()
  private readonly mentionedSubagentIdsByChat = new Map<string, string[]>()
  private readonly slashCommandsInFlight = new Set<string>()
  private readonly claudeLimitDetector: LimitDetector
  private readonly codexLimitDetector: LimitDetector
  private readonly claudeAuthErrorDetector: ClaudeAuthErrorDetector
  private readonly scheduleManager: ScheduleManager | null
  private readonly getAutoResumePreference: () => boolean
  private readonly getSubagents: () => Subagent[]
  private readonly getAppSettingsSnapshot: NonNullable<AgentCoordinatorArgs["getAppSettingsSnapshot"]>
  private readonly subagentOrchestrator: SubagentOrchestrator
  /** Public accessor for tests + the `delegate_subagent` MCP tool wiring. */
  getSubagentOrchestrator(): SubagentOrchestrator {
    return this.subagentOrchestrator
  }
  private readonly orchestrationQueue: OrchestrationQueue
  /** Public accessor for tests + the `orch_*` MCP tool + ws-router wiring. */
  getOrchestrationQueue(): OrchestrationQueue {
    return this.orchestrationQueue
  }
  private readonly throwOnClaudeSessionStart: boolean
  private readonly autoResumeByChat = new Map<string, boolean>()
  private readonly openrouterFirstEntryTimeoutMs: number
  // Per-tokenId rotation dedupe state. When a shared OAuth token throws
  // limit/auth-error against N chats simultaneously, only the first chat
  // pays the cost of marking the pool + picking a fresh target; subsequent
  // chats within TOKEN_ROTATION_DEDUPE_WINDOW_MS reuse the dedupe slot to
  // stagger their respawns by TOKEN_ROTATION_HERD_STAGGER_MS each.
  private readonly tokenRotationDedupe = new Map<string, { firstSeenAt: number; staggerCount: number }>()
  // Per-chat circuit breaker for proactive `/compact` injection lives in the
  // persisted ChatRecord (`compactFailureCount`): increments on every compact
  // attempt that fails (turn errored / cancelled) and resets on success.
  // After MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES, skip further proactive
  // compacts on this chat so doomed sessions don't hammer the API on every
  // turn (mirrors claude-code's autoCompact circuit breaker). Persisting it
  // means a server restart cannot reset a doomed chat's breaker to 0.
  private readonly tunnelGateway: TunnelGateway | null
  private readonly oauthPool: OAuthTokenPool | null
  private readonly toolCallback: ToolCallbackService | null
  private readonly chatPolicy: ChatPermissionPolicy
  private readonly claudeSessionLifecycle: ClaudeSessionLifecycleOptions
  private readonly claudeSessionSweepTimer: ReturnType<typeof setInterval> | null
  private readonly claudePtyRegistry: import("./claude-pty/pid-registry.adapter").ClaudePtyRegistry | null
  private readonly ptyInstanceRegistry: import("./claude-pty/pty-instance-registry").PtyInstanceRegistry | null
  private readonly workflowRegistry: import("./workflow-registry").WorkflowRegistry | null
  private readonly subagentTranscriptRegistry: import("./subagent-transcript-registry").SubagentTranscriptRegistry | null
  private readonly localCatalog: import("./local-catalog").LocalCatalogService | null
  private readonly readLlmProvider: () => Promise<LlmProviderSnapshot>
  private readonly listOpenRouterModelsFn: (() => Promise<import("../shared/types").OpenRouterModel[]>) | null
  private readonly persistOAuthStateFn: ((id: string, oauth: McpOAuthState) => void) | null
  private readonly subagentPendingResolvers = new Map<
    string,
    { resolve: (v: AnyValue) => void; reject: (e: Error) => void }
  >()

  constructor(args: AgentCoordinatorArgs) {
    this.store = args.store
    this.onStateChange = args.onStateChange
    this.analytics = args.analytics ?? NoopAnalyticsReporter
    this.codexManager = args.codexManager ?? new CodexAppServerManager()
    this.generateTitle = args.generateTitle ?? generateTitleForChatDetailed
    this.startClaudeSessionFn = args.startClaudeSession ?? startClaudeSession
    this.startClaudeSessionPTYFn = args.startClaudeSessionPTY ?? startClaudeSessionPTY
    this.claudeLimitDetector = args.claudeLimitDetector ?? new ClaudeLimitDetector()
    this.codexLimitDetector = args.codexLimitDetector ?? new CodexLimitDetector()
    this.claudeAuthErrorDetector = new ClaudeAuthErrorDetector()
    this.scheduleManager = args.scheduleManager ?? null
    this.getAutoResumePreference = args.getAutoResumePreference ?? (() => false)
    this.openrouterFirstEntryTimeoutMs =
      args.openrouterFirstEntryTimeoutMs ?? DEFAULT_OPENROUTER_FIRST_ENTRY_TIMEOUT_MS
    this.getSubagents = args.getSubagents ?? (() => [])
    this.getAppSettingsSnapshot = args.getAppSettingsSnapshot ?? (() => ({}))
    this.readLlmProvider = args.readLlmProvider ?? readLlmProviderSnapshot
    this.listOpenRouterModelsFn = args.listOpenRouterModels ?? null
    this.persistOAuthStateFn = args.persistOAuthState ?? null
    this.subagentOrchestrator = new SubagentOrchestrator({
      store: this.store,
      appSettings: { getSnapshot: () => ({ subagents: this.getSubagents() }) },
      startProviderRun: (a) => this.buildSubagentProviderRunForChat({
        subagent: a.subagent,
        chatId: a.chatId,
        primer: a.primer,
        userInstruction: a.userInstruction,
        runId: a.runId,
        abortSignal: a.abortSignal,
        depth: a.depth,
        ancestorSubagentIds: a.ancestorSubagentIds,
        parentUserMessageId: a.parentUserMessageId,
      }),
      onRunTerminal: (chatId, runId) => {
        this.rejectPendingResolversForRun(chatId, runId)
        // failRun appended the terminal event synchronously before invoking
        // this hook, so the store already has the new state. Emit now so
        // multi-subagent fan-outs do not have to wait for Promise.all.
        this.emitStateChange(chatId)
      },
      onRunProgress: (chatId) => {
        // Run start + every persisted subagent entry. Without this the
        // client only gets a snapshot at terminal, so a delegated run
        // renders blank until it finishes (delegate_subagent blocks the
        // main turn, which itself emits nothing meanwhile). ws-router
        // coalesces (16ms) and signature-dedups, so per-entry fan-out is
        // cheap.
        this.emitStateChange(chatId)
      },
      onBackgroundRunComplete: (chatId, runId, outcome) => {
        void this.deliverSubagentToMain(chatId, runId, outcome)
      },
      maxLive: positiveIntegerFromEnv(process.env.KANNA_SUBAGENT_MAX_LIVE, 0) || undefined,
      liveIdleTimeoutMs: positiveIntegerFromEnv(process.env.KANNA_SUBAGENT_IDLE_TIMEOUT_MS, 0) || undefined,
      // Stall/idle watchdog window. Precedence: app setting > env > orchestrator
      // default. The orchestrator reads this once at construction; a settings
      // change takes effect on next server start (acceptable — restart-scoped).
      runTimeoutMs: (this.getAppSettingsSnapshot().subagentRuntime?.runTimeoutMs
        ?? positiveIntegerFromEnv(process.env.KANNA_SUBAGENT_RUN_TIMEOUT_MS, 0))
        || undefined,
    })
    this.orchestrationQueue = new OrchestrationQueue({
      store: this.store,
      worktrees: createOrchWorktreeOps(),
      startWorker: (a) => this.buildOrchWorker(a),
      runVerify: runCommandInWorktree,
      runInit: runCommandInWorktree,
    })
    this.throwOnClaudeSessionStart = args.throwOnClaudeSessionStart ?? false
    this.tunnelGateway = args.tunnelGateway ?? null
    this.oauthPool = args.oauthPool ?? null
    this.toolCallback = args.toolCallback ?? null
    this.chatPolicy = args.chatPolicy ?? POLICY_DEFAULT
    this.claudeSessionLifecycle = {
      idleMs: args.claudeSessionLifecycle?.idleMs
        ?? positiveIntegerFromEnv(process.env.KANNA_CLAUDE_SESSION_IDLE_MS, DEFAULT_CLAUDE_SESSION_IDLE_MS),
      maxResidentSessions: args.claudeSessionLifecycle?.maxResidentSessions
        ?? positiveIntegerFromEnv(process.env.KANNA_CLAUDE_SESSION_MAX_RESIDENT, DEFAULT_CLAUDE_SESSION_MAX_RESIDENT),
      sweepIntervalMs: args.claudeSessionLifecycle?.sweepIntervalMs
        ?? positiveIntegerFromEnv(process.env.KANNA_CLAUDE_SESSION_SWEEP_INTERVAL_MS, DEFAULT_CLAUDE_SESSION_SWEEP_INTERVAL_MS),
      backgroundTaskMaxMs: args.claudeSessionLifecycle?.backgroundTaskMaxMs
        ?? positiveIntegerFromEnv(process.env.KANNA_PTY_BACKGROUND_TASK_MAX_MS, DEFAULT_PTY_BACKGROUND_TASK_MAX_MS),
    }
    this.claudeSessionSweepTimer = this.claudeSessionLifecycle.sweepIntervalMs > 0
      ? setInterval(() => { this.sweepIdleClaudeSessions() }, this.claudeSessionLifecycle.sweepIntervalMs)
      : null
    this.claudeSessionSweepTimer?.unref?.()
    this.claudePtyRegistry = args.claudePtyRegistry ?? null
    this.ptyInstanceRegistry = args.ptyInstanceRegistry ?? null
    this.workflowRegistry = args.workflowRegistry ?? null
    this.subagentTranscriptRegistry = args.subagentTranscriptRegistry ?? null
    this.localCatalog = args.localCatalog ?? null
  }

  setBackgroundErrorReporter(report: ((message: string) => void) | null) {
    this.reportBackgroundError = report
  }

  dispose() {
    if (this.claudeSessionSweepTimer) clearInterval(this.claudeSessionSweepTimer)
    for (const [chatId, session] of [...this.claudeSessions.entries()]) {
      this.closeClaudeSession(chatId, session)
    }
  }

  getActiveStatuses() {
    const statuses = new Map<string, KannaStatus>()
    for (const [chatId, turn] of this.activeTurns.entries()) {
      statuses.set(chatId, turn.status)
    }
    return statuses
  }

  getWaitStartedAtByChatId(): Map<string, number> {
    const out = new Map<string, number>()
    for (const [chatId, turn] of this.activeTurns.entries()) {
      if (turn.waitStartedAt != null) out.set(chatId, turn.waitStartedAt)
    }
    return out
  }

  getPendingTool(chatId: string): PendingToolSnapshot | null {
    const pending = this.activeTurns.get(chatId)?.pendingTool
    if (!pending) return null
    return { toolUseId: pending.toolUseId, toolKind: pending.tool.toolKind }
  }

  getDrainingChatIds(): Set<string> {
    return new Set(this.drainingStreams.keys())
  }

  getSlashCommandsLoadingChatIds(): Set<string> {
    return new Set(this.slashCommandsInFlight)
  }

  /**
   * Snapshot of live claude PTY session states per chat. Used by the
   * sidebar badge selector. Chats not present are implicitly `cold`.
   */
  getClaudeSessionStates(): Map<string, "warming" | "active" | "idle"> {
    const out = new Map<string, "warming" | "active" | "idle">()
    const now = Date.now()
    for (const [chatId, session] of this.claudeSessions) {
      const activeProv = this.activeTurns.get(chatId)?.provider
      if (activeProv !== undefined && isClaudeSdkProvider(activeProv)) {
        out.set(chatId, "active")
      } else if (this.hasPendingBackgroundTask(session, now)) {
        // Held warm for a background Bash task — surface as "warming", not "idle".
        out.set(chatId, "warming")
      } else if (now - session.lastUsedAt >= this.resolveClaudeIdleMs()) {
        out.set(chatId, "idle")
      } else {
        out.set(chatId, "warming")
      }
    }
    return out
  }

  get toolCallbackService(): ToolCallbackService | null {
    return this.toolCallback
  }

  private emitStateChange(chatId?: string, options?: { immediate?: boolean }) {
    this.onStateChange(chatId, options)
  }

  private resolveClaudeDriverPreference(): ClaudeDriverPreference {
    const fromSettings = this.getAppSettingsSnapshot().claudeDriver?.preference
    if (fromSettings === "pty" || fromSettings === "sdk") return fromSettings
    return process.env.KANNA_CLAUDE_DRIVER === "pty" ? "pty" : "sdk"
  }

  private getEnabledCustomMcpServers(): readonly McpServerConfig[] {
    const snap = this.getAppSettingsSnapshot()
    const list = snap.customMcpServers
    if (!Array.isArray(list)) return []
    return list.filter((s) => s.enabled)
  }

  private async buildOAuthBearers(servers: readonly McpServerConfig[]): Promise<Map<string, string>> {
    const bearers = new Map<string, string>()
    for (const s of servers) {
      if (s.transport === "stdio" || !s.oauth || s.oauth.status !== "authenticated") continue
      try {
        const token = await ensureFreshMcpToken(s, {
          persist: (oauth) => {
            if (this.persistOAuthStateFn) this.persistOAuthStateFn(s.id, oauth)
          },
        })
        bearers.set(s.id, token)
      } catch (err) {
        log.warn("[kanna/mcp-oauth] token refresh failed for", s.name, String(err))
      }
    }
    return bearers
  }

  /**
   * Resolves the effective ChatPermissionPolicy for a chat: starts from the
   * coordinator-wide default, overlays the chat's persisted policyOverride.
   */
  private resolveChatPolicy(chatId: string): ChatPermissionPolicy {
    // store.state may be absent in test fakes that don't implement the full
    // EventStore — fall through to the global default policy in that case.
    const override = this.store.state?.chatsById?.get(chatId)?.policyOverride ?? null
    return mergePolicyOverride(this.chatPolicy, override)
  }

  private resolveClaudeIdleMs(): number {
    const fromSettings = this.getAppSettingsSnapshot().claudeDriver?.lifecycle?.idleTimeoutMs
    if (typeof fromSettings === "number" && Number.isFinite(fromSettings) && fromSettings > 0) {
      return Math.round(fromSettings)
    }
    return this.claudeSessionLifecycle.idleMs
  }

  private resolveClaudeMaxResident(): number {
    const fromSettings = this.getAppSettingsSnapshot().claudeDriver?.lifecycle?.maxConcurrent
    if (typeof fromSettings === "number" && Number.isFinite(fromSettings) && fromSettings > 0) {
      return Math.round(fromSettings)
    }
    return this.claudeSessionLifecycle.maxResidentSessions
  }

  /**
   * True when the chat is hosting an in-flight background Workflow. A live
   * workflow runs inside the warm PTY claude process but registers no
   * activeTurn, pendingPromptSeq, or lastUsedAt bump, so without this signal
   * the idle reaper / budget enforcer would tear the process down mid-run and
   * abort the workflow.
   *
   * Liveness comes from the registry's live-run-dir probe, NOT the terminal
   * `wf_<runId>.json` sidecar: Claude only flushes that sidecar at/near
   * termination, so a sidecar-only check is blind for the entire run (the
   * window the guard must cover). `hasActiveRun` reads the live
   * `subagents/workflows/wf_*` transcript dirs (written from second one) and
   * requires activity within one idle window so a stalled/crashed run still
   * eventually reaps.
   */
  private hasLiveWorkflow(chatId: string): boolean {
    return this.workflowRegistry?.hasActiveRun(chatId, this.resolveClaudeIdleMs(), Date.now()) ?? false
  }

  private resolveBackgroundTaskMaxMs(): number {
    return this.claudeSessionLifecycle.backgroundTaskMaxMs
  }

  /**
   * True while the session has at least one Claude-Code background Bash task
   * that has not yet settled. Primary gate is set size > 0: settle events
   * (task_notification) remove their id from the set, so the guard clears the
   * moment the last task reports. The deadline is a zombie backstop only —
   * it fires when a settle notification is genuinely lost (SDK crash / dropped
   * message) and is reset on every launch and settle, so it never expires
   * during normal execution regardless of task duration.
   */
  private hasPendingBackgroundTask(session: ClaudeSessionState, now: number): boolean {
    if (session.backgroundTaskIds.size === 0) return false
    if (now < session.backgroundTaskDeadlineAt) return true
    session.backgroundTaskIds.clear()
    session.backgroundTaskDeadlineAt = 0
    return false
  }

  private isClaudeSessionIdle(chatId: string, session: ClaudeSessionState, now = Date.now()): boolean {
    const activeProv = this.activeTurns.get(chatId)?.provider
    if (activeProv !== undefined && isClaudeSdkProvider(activeProv)) return false
    if (session.pendingPromptSeqs.length > 0) return false
    if (this.hasLiveWorkflow(chatId)) return false
    if (this.hasPendingBackgroundTask(session, now)) return false
    return now - session.lastUsedAt >= this.resolveClaudeIdleMs()
  }

  /**
   * Tear down a Claude session and (by default) release the OAuth-pool
   * reservation owned by the chat.
   *
   * `keepReservation: true` — used by rate-limit / auth-error rotation
   * paths that have ALREADY claimed a fresh token via `pickActive(chatId)`
   * before calling close. Without this flag, `release(chatId)` would
   * scan reservedBy for `owner === chatId` and drop the *new* token the
   * rotation just claimed, leaking the rotation's reservation (audit #9d).
   */
  private closeClaudeSession(
    chatId: string,
    session: ClaudeSessionState,
    opts?: { keepReservation?: boolean },
  ): void {
    if (this.claudeSessions.get(chatId) === session) {
      this.claudeSessions.delete(chatId)
    }
    if (!opts?.keepReservation) {
      this.oauthPool?.release(chatId)
    }
    session.session.close()
    // For SDK sessions, unregister the workflow dir here. PTY sessions unregister
    // inside the driver's cleanupResources (driver.ts) — do not double-fire.
    if (this.resolveClaudeDriverPreference() !== "pty") {
      this.workflowRegistry?.unregister(chatId)
    }
  }

  /**
   * Register the workflow disk-watch dir for an SDK session once the session
   * token is known. No-op if the registry is absent, already registered, or
   * the driver preference is PTY (the PTY driver registers from its own
   * resolved transcript path in driver.ts cleanup and must not be double-fired).
   */
  private maybeRegisterSdkWorkflowsDir(session: ClaudeSessionState): void {
    if (!this.workflowRegistry) return
    if (session.workflowsDirRegistered) return
    // PTY registers from its own resolved transcript path; SDK derives from session_token.
    if (this.resolveClaudeDriverPreference() === "pty") return
    if (!session.sessionToken) return
    const dir = computeWorkflowsDir({
      homeDir: homedir(),
      cwd: session.localPath,
      sessionId: session.sessionToken,
    })
    this.workflowRegistry.register(session.chatId, dir)
    session.workflowsDirRegistered = true
  }

  private sweepIdleClaudeSessions(now = Date.now()): void {
    for (const [chatId, session] of [...this.claudeSessions.entries()]) {
      if (!this.isClaudeSessionIdle(chatId, session, now)) continue
      this.closeClaudeSession(chatId, session)
      this.emitStateChange(chatId)
    }
  }

  private enforceClaudeSessionBudget(protectedChatId?: string): void {
    const max = this.resolveClaudeMaxResident()
    if (max <= 0 || this.claudeSessions.size <= max) return

    const now = Date.now()
    const candidates = [...this.claudeSessions.entries()]
      .filter(([chatId, session]) => (
        chatId !== protectedChatId
        && !this.activeTurns.has(chatId)
        && session.pendingPromptSeqs.length === 0
        && !this.hasLiveWorkflow(chatId)
        && !this.hasPendingBackgroundTask(session, now)
      ))
      .sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt)

    while (this.claudeSessions.size > max && candidates.length > 0) {
      const next = candidates.shift()
      if (!next) break
      const [chatId, session] = next
      this.closeClaudeSession(chatId, session)
      this.emitStateChange(chatId)
    }
  }

  /**
   * Format a refusal message when `pickActive(chatId)` returned null but the
   * pool has tokens. Names the offending tokens so the user knows which
   * chat to close or which token to add a quota to, instead of seeing the
   * generic "all tokens unavailable" line that doesn't say what's holding
   * them. `scopeSuffix` lets the subagent path tag its variant.
   */
  private buildPoolUnavailableMessage(reservedFor: string, scopeSuffix: string): string {
    const pool = this.oauthPool
    if (!pool) {
      return `All OAuth tokens are unavailable${scopeSuffix} (rate-limited, errored, or in use).`
    }
    const now = Date.now()
    const fmtTime = (ms: number) => {
      const mins = Math.max(0, Math.round((ms - now) / 60_000))
      if (mins < 60) return `${mins}m`
      const h = Math.floor(mins / 60)
      const m = mins % 60
      return m === 0 ? `${h}h` : `${h}h${m}m`
    }
    const lines: string[] = []
    for (const u of pool.describeUnavailability(reservedFor)) {
      if (u.reason === "available") continue
      const label = u.label || u.tokenId.slice(0, 8)
      if (u.reason === "limited") {
        lines.push(`  - ${label}: rate-limited (~${fmtTime(u.until)} remaining)`)
      } else if (u.reason === "reserved") {
        const refs = u.byChatIds.map((id) => {
          const chat = this.store.getChat(id)
          const title = chat?.title || `chat ${id.slice(0, 8)}`
          return `[${title}](/chat/${id})`
        })
        const joined = refs.length === 0 ? "another chat" : refs.join(", ")
        lines.push(`  - ${label}: in use by ${joined}`)
      } else if (u.reason === "error") {
        lines.push(`  - ${label}: errored${u.message ? ` (${u.message})` : ""}`)
      } else if (u.reason === "disabled") {
        lines.push(`  - ${label}: disabled`)
      }
    }
    const header = `All OAuth tokens are unavailable${scopeSuffix}:`
    const footer = "Close the chat holding a contested token, wait for the rate-limit to reset, or add another token."
    return [header, ...lines, footer].join("\n")
  }

  private subagentPendingKey(chatId: string, runId: string, toolUseId: string): string {
    return `${chatId}::${runId}::${toolUseId}`
  }

  private rejectPendingResolvers(predicate: (key: string) => boolean, reason: string) {
    for (const [key, resolver] of this.subagentPendingResolvers) {
      if (!predicate(key)) continue
      this.subagentPendingResolvers.delete(key)
      resolver.reject(new Error(reason))
    }
  }

  private rejectPendingResolversForChat(chatId: string) {
    const prefix = `${chatId}::`
    this.rejectPendingResolvers((k) => k.startsWith(prefix), "chat cancelled")
  }

  private rejectPendingResolversForRun(chatId: string, runId: string) {
    const prefix = `${chatId}::${runId}::`
    this.rejectPendingResolvers((k) => k.startsWith(prefix), "subagent run terminated")
  }

  getActiveTurnProfile(chatId: string): SendToStartingProfile | null {
    const active = this.activeTurns.get(chatId)
    if (!active?.clientTraceId || active.profilingStartedAt === undefined) {
      return null
    }

    return {
      traceId: active.clientTraceId,
      startedAt: active.profilingStartedAt,
    }
  }

  private clearDrainingStream(chatId: string): void {
    this.drainingStreams.delete(chatId)
  }

  async stopDraining(chatId: string) {
    const draining = this.drainingStreams.get(chatId)
    if (!draining) return
    draining.turn.close()
    this.clearDrainingStream(chatId)
    this.emitStateChange(chatId)
  }

  async ensureSlashCommandsLoaded(chatId: string): Promise<void> {
    const chat = this.store.getChat(chatId)
    if (!chat) return
    if (chat.provider === "codex") return
    if (chat.slashCommands && chat.slashCommands.length > 0) return
    if (this.slashCommandsInFlight.has(chatId)) return

    const project = this.store.getProject(chat.projectId)
    if (!project) return

    this.slashCommandsInFlight.add(chatId)
    this.emitStateChange(chatId)
    try {
      let commands: SlashCommand[]
      const existing = this.claudeSessions.get(chatId)
      if (existing) {
        commands = await existing.session.getSupportedCommands()
      } else {
        const defaultModel = normalizeServerModel("claude")
        const defaultOptions = normalizeClaudeModelOptions(defaultModel)
        // Ephemeral spawn: reserve under a synthetic key so two concurrent
        // ensureSlashCommandsLoaded calls (different chats) cannot be handed
        // the same token by lastUsedAt ordering. The lease MUST be released
        // once the throwaway session closes (audit #2).
        const lease = this.oauthPool?.pickEphemeral() ?? null
        // Skip the ephemeral spawn entirely when the pool has tokens but
        // nothing is usable — avoids 401 against the CLI's keychain fallback
        // and an opaque "supportedCommands failed" warning. Slash commands
        // will load on the next turn once a token is available.
        if (this.oauthPool && this.oauthPool.hasAnyToken() && !lease) {
          return
        }
        const picked = lease?.token ?? null
        if (picked) this.oauthPool!.markUsed(picked.id)
        const usePtyEphemeral = this.resolveClaudeDriverPreference() === "pty"
        const ephemeralSystemPromptAppend = buildKannaSystemPromptAppend(this.getSubagents(), {
          globalPromptAppend: this.getAppSettingsSnapshot().globalPromptAppend,
        })
        try {
          const ephemeral = usePtyEphemeral
            ? await this.startClaudeSessionPTYFn({
                chatId,
                projectId: project.id,
                localPath: project.localPath,
                model: resolveClaudeApiModelId(defaultModel, defaultOptions.contextWindow),
                effort: defaultOptions.reasoningEffort,
                planMode: chat.planMode ?? false,
                sessionToken: chat.sessionTokensByProvider.claude ?? null,
                forkSession: false,
                oauthToken: picked?.token ?? null,
                oauthLabel: picked?.label,
                oauthKeyMasked: picked ? maskOauthKey(picked.token) : undefined,
                onToolRequest: async () => null,
                systemPromptAppend: ephemeralSystemPromptAppend,
                ptyRegistry: this.claudePtyRegistry ?? undefined,
                ptyInstanceRegistry: this.ptyInstanceRegistry ?? undefined,
                workflowRegistry: this.workflowRegistry ?? undefined,
                subagentTranscriptRegistry: this.subagentTranscriptRegistry ?? undefined,
                customMcpServers: this.getEnabledCustomMcpServers(),
                  })
            : await this.startClaudeSessionFn({
                projectId: project.id,
                localPath: project.localPath,
                model: resolveClaudeApiModelId(defaultModel, defaultOptions.contextWindow),
                effort: defaultOptions.reasoningEffort,
                planMode: chat.planMode ?? false,
                sessionToken: chat.sessionTokensByProvider.claude ?? null,
                forkSession: false,
                oauthToken: picked?.token ?? null,
                onToolRequest: async () => null,
                systemPromptAppend: ephemeralSystemPromptAppend,
                customMcpServers: this.getEnabledCustomMcpServers(),
              })
          try {
            commands = await ephemeral.getSupportedCommands()
          } finally {
            ephemeral.close()
          }
        } finally {
          lease?.release()
        }
      }
      const merged = this.mergeLocalCatalog(commands, project.localPath)
      await this.store.recordSessionCommandsLoaded(chatId, merged)
      this.emitStateChange(chatId)
    } catch (error) {
      log.warn("[kanna/agent] ensureSlashCommandsLoaded failed", String(error))
    } finally {
      this.slashCommandsInFlight.delete(chatId)
      this.emitStateChange(chatId)
    }
  }

  private mergeLocalCatalog(commands: SlashCommand[], cwd: string): SlashCommand[] {
    if (!this.localCatalog) return commands
    let local: SlashCommand[]
    try {
      local = this.localCatalog.list(cwd)
    } catch (error) {
      log.warn("[kanna/agent] localCatalog.list failed", String(error))
      return commands
    }
    const cliKeys = new Set(commands.map((c) => c.name.toLowerCase()))
    const filtered = local.filter((entry) => !cliKeys.has(entry.name.toLowerCase()))
    return [...commands, ...filtered]
  }

  async closeChat(chatId: string) {
    await this.stopDraining(chatId)
    const claudeSession = this.claudeSessions.get(chatId)
    if (claudeSession) {
      this.closeClaudeSession(chatId, claudeSession)
    }
    this.autoResumeByChat.delete(chatId)
    this.emitStateChange(chatId)
  }

  private resolveProvider(options: SendMessageOptions, currentProvider: AgentProvider | null) {
    return options.provider ?? currentProvider ?? "claude"
  }

  private getProviderSettings(provider: AgentProvider, options: SendMessageOptions) {
    const catalog = getServerProviderCatalog(provider)
    const customModels = this.getAppSettingsSnapshot().customModels ?? []
    if (provider === "claude") {
      const model = normalizeServerModel(provider, options.model, customModels)
      const modelOptions = normalizeClaudeModelOptions(model, options.modelOptions, options.effort, customModels)
      return {
        model: resolveClaudeApiModelId(model, modelOptions.contextWindow),
        effort: modelOptions.reasoningEffort,
        serviceTier: undefined,
        planMode: catalog.supportsPlanMode ? Boolean(options.planMode) : false,
      }
    }

    if (provider === "openrouter") {
      // OpenRouter's model list is fetched dynamically (settings.listOpenRouterModels),
      // so the static server catalog is empty and normalizeServerModel would collapse
      // every selection to the default. Trust the client-selected id — OpenRouter
      // rejects invalid ids at the API — falling back to the default only when blank.
      return {
        model: options.model?.trim() || catalog.defaultModel,
        effort: undefined,
        serviceTier: undefined,
        planMode: catalog.supportsPlanMode ? Boolean(options.planMode) : false,
      }
    }

    const modelOptions = normalizeCodexModelOptions(options.modelOptions, options.effort)
    return {
      model: normalizeServerModel(provider, options.model, customModels),
      effort: modelOptions.reasoningEffort,
      serviceTier: codexServiceTierFromModelOptions(modelOptions),
      planMode: catalog.supportsPlanMode ? Boolean(options.planMode) : false,
    }
  }

  private async enqueueMessage(chatId: string, content: string, attachments: ChatAttachment[], options?: SendMessageOptions) {
    const queued = await this.store.enqueueMessage(chatId, {
      content,
      attachments,
      provider: options?.provider,
      model: options?.model,
      modelOptions: options?.modelOptions,
      planMode: options?.planMode,
      autoContinue: options?.autoContinue,
    })
    this.emitStateChange(chatId)
    return queued
  }

  private async dequeueAndStartQueuedMessage(chatId: string, queuedMessage: QueuedChatMessage, options?: { steered?: boolean }) {
    await this.store.removeQueuedMessage(chatId, queuedMessage.id)
    const chat = this.store.requireChat(chatId)

    // Mentions no longer short-circuit the main turn (Anthropic-style
    // Task-tool pattern). The main agent always runs; mention metadata is
    // still attached to the user_prompt entry by `startTurnForChat` →
    // `appendUserPrompt`.
    const provider = this.resolveProvider(queuedMessage, chat.provider)
    const settings = this.getProviderSettings(provider, queuedMessage)
    // Auto-continue rate-limit recovery sends the literal "continue" as a
    // resume signal. Appending it as a user_prompt entry adds noise to the
    // transcript (shows as an "auto-sent" bubble right before a COMPACTED
    // divider, confusing the user). Suppress the entry for that fallback
    // case; agent-driven wakes with a meaningful custom prompt still appear.
    const isRateLimitFallback = queuedMessage.autoContinue !== undefined
      && queuedMessage.content === "continue"
    await this.startTurnForChat({
      chatId,
      provider,
      content: options?.steered ? buildSteeredMessageContent(queuedMessage.content) : queuedMessage.content,
      attachments: queuedMessage.attachments,
      model: settings.model,
      effort: settings.effort,
      serviceTier: settings.serviceTier,
      planMode: settings.planMode,
      appendUserPrompt: !isRateLimitFallback,
      steered: options?.steered,
      autoContinue: queuedMessage.autoContinue,
    })
  }

  private async maybeStartNextQueuedMessage(chatId: string) {
    if (this.activeTurns.has(chatId)) return false
    const nextQueuedMessage = typeof this.store.getQueuedMessages === "function"
      ? this.store.getQueuedMessages(chatId)[0]
      : undefined
    if (!nextQueuedMessage) return false
    await this.dequeueAndStartQueuedMessage(chatId, nextQueuedMessage)
    return true
  }

  private async startTurnForChat(args: {
    chatId: string
    provider: AgentProvider
    content: string
    attachments: ChatAttachment[]
    model: string
    effort?: string
    serviceTier?: "fast"
    planMode: boolean
    appendUserPrompt: boolean
    steered?: boolean
    autoContinue?: { scheduleId: string }
    userClearedContext?: boolean
    profile?: SendToStartingProfile | null
  }) {
    logSendToStartingProfile(args.profile, "start_turn.begin", {
      chatId: args.chatId,
      provider: args.provider,
      appendUserPrompt: args.appendUserPrompt,
      planMode: args.planMode,
    })

    // Close any lingering draining stream before starting a new turn.
    const draining = this.drainingStreams.get(args.chatId)
    if (draining) {
      draining.turn.close()
      this.clearDrainingStream(args.chatId)
    }

    // A new user turn implicitly clears any prior cancellation marker —
    // otherwise a Stop-then-resend cycle wedges every delegate_subagent
    // call in this chat with "Chat cancelled before run started" until
    // process restart. Mirrors the clear already done by
    // runMentionsForUserMessage for the @mention path.
    this.subagentOrchestrator.clearChatCancellation(args.chatId)

    const chat = this.store.requireChat(args.chatId)
    if (this.activeTurns.has(args.chatId)) {
      throw new Error("Chat is already running")
    }

    if (chat.provider !== args.provider) {
      await this.store.setChatProvider(args.chatId, args.provider)
      logSendToStartingProfile(args.profile, "start_turn.provider_set", {
        chatId: args.chatId,
        provider: args.provider,
      })
    }
    await this.store.setPlanMode(args.chatId, args.planMode)
    logSendToStartingProfile(args.profile, "start_turn.plan_mode_set", {
      chatId: args.chatId,
      planMode: args.planMode,
    })

    const existingMessages = this.store.getMessages(args.chatId)
    const shouldGenerateTitle = args.appendUserPrompt && chat.title === "New Chat" && existingMessages.length === 0
    const optimisticTitle = shouldGenerateTitle ? fallbackTitleFromMessage(args.content) : null

    if (optimisticTitle) {
      await this.store.renameChat(args.chatId, optimisticTitle)
      logSendToStartingProfile(args.profile, "start_turn.optimistic_title_set", {
        chatId: args.chatId,
        title: optimisticTitle,
      })
    }

    const project = this.store.getProject(chat.projectId)
    if (!project) {
      throw new Error("Project not found")
    }

    let appendedUserMessageId: string | null = null
    if (args.appendUserPrompt) {
      const parsedMentions = parseMentions(args.content, this.getSubagents())
      const subagentMentions = parsedMentions
        .filter((mention): mention is Extract<ParsedMention, { kind: "subagent" }> => mention.kind === "subagent")
        .map((mention) => ({ subagentId: mention.subagentId, raw: mention.raw }))
      this.mentionedSubagentIdsByChat.set(
        args.chatId,
        subagentMentions.map((m) => m.subagentId),
      )
      const unknownSubagentMentions = parsedMentions
        .filter((mention): mention is Extract<ParsedMention, { kind: "unknown-subagent" }> => mention.kind === "unknown-subagent")
        .map((mention) => ({ name: mention.name, raw: mention.raw }))
      const userPromptEntry = timestamped(
        {
          kind: "user_prompt",
          content: args.content,
          attachments: args.attachments,
          steered: args.steered,
          autoContinue: args.autoContinue,
          ...(subagentMentions.length > 0 ? { subagentMentions } : {}),
          ...(unknownSubagentMentions.length > 0 ? { unknownSubagentMentions } : {}),
        },
        Date.now()
      )
      await this.store.appendMessage(args.chatId, userPromptEntry)
      appendedUserMessageId = userPromptEntry._id
      logSendToStartingProfile(args.profile, "start_turn.user_prompt_appended", {
        chatId: args.chatId,
        entryId: userPromptEntry._id,
      })
    }
    await this.store.recordTurnStarted(args.chatId, {
      provider: args.provider,
      model: args.model,
      ...(args.effort !== undefined ? { effort: args.effort } : {}),
      ...(args.serviceTier !== undefined ? { serviceTier: args.serviceTier } : {}),
      planMode: args.planMode,
      driver: this.resolveClaudeDriverPreference(),
    })
    logSendToStartingProfile(args.profile, "start_turn.turn_started_recorded", {
      chatId: args.chatId,
    })

    try {
      await this.startTurnAfterTurnStarted({
        args,
        chat,
        project,
        existingMessages,
        shouldGenerateTitle,
        optimisticTitle,
        appendedUserMessageId,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const isOAuthRefusal = error instanceof OAuthPoolUnavailableError
      log.error(`${LOG_PREFIX} startTurnForChat failed after turn_started`, {
        chatId: args.chatId,
        provider: args.provider,
        model: args.model,
        planMode: args.planMode,
        error: message,
        stack: error instanceof Error ? error.stack : undefined,
        kind: isOAuthRefusal ? "oauth_pool_unavailable" : "unknown",
      })
      // OAuth-pool refusal: persist the formatted refusal (with chat-link
      // markdown produced by `buildPoolUnavailableMessage`) as a `result`
      // transcript entry so the UI's transcript renders it inline and
      // durably, instead of relying on the ephemeral commandError banner
      // that gets wiped by the next chat snapshot tick.
      if (isOAuthRefusal) {
        try {
          await this.store.appendMessage(
            args.chatId,
            timestamped({
              kind: "result",
              subtype: "error",
              isError: true,
              durationMs: 0,
              result: message,
            })
          )
        } catch (appendErr) {
          log.error(`${LOG_PREFIX} append refusal result entry failed`, {
            chatId: args.chatId,
            appendErr: appendErr instanceof Error ? appendErr.message : String(appendErr),
          })
        }
      }
      try {
        await this.store.recordTurnFailed(args.chatId, message)
      } catch (recordErr) {
        log.error(`${LOG_PREFIX} recordTurnFailed also failed`, {
          chatId: args.chatId,
          recordErr: recordErr instanceof Error ? recordErr.message : String(recordErr),
        })
      }
      this.activeTurns.delete(args.chatId)
      this.emitStateChange(args.chatId, { immediate: true })
      // Swallow refusals — the transcript entry above is the user-facing
      // signal. Re-throwing would surface a transient commandError banner
      // that races with snapshot ticks and visibly flickers (see #235).
      if (isOAuthRefusal) {
        return
      }
      throw error
    }
  }

  private async startTurnAfterTurnStarted(ctx: {
    args: {
      chatId: string
      provider: AgentProvider
      content: string
      attachments: ChatAttachment[]
      model: string
      effort?: string
      serviceTier?: "fast"
      planMode: boolean
      appendUserPrompt: boolean
      steered?: boolean
      autoContinue?: { scheduleId: string }
      userClearedContext?: boolean
      profile?: SendToStartingProfile | null
    }
    chat: ChatRecord
    project: ProjectRecord
    existingMessages: TranscriptEntry[]
    shouldGenerateTitle: boolean
    optimisticTitle: string | null
    appendedUserMessageId: string | null
  }): Promise<void> {
    const { args, chat, project, existingMessages, shouldGenerateTitle, optimisticTitle, appendedUserMessageId } = ctx
    if (shouldGenerateTitle) {
      void this.generateTitleInBackground(args.chatId, args.content, project.localPath, optimisticTitle ?? "New Chat")
    }

    const onToolRequest = async (request: HarnessToolRequest): Promise<AnyValue> => {
      let active = this.activeTurns.get(args.chatId)
      if (!active) {
        // The prior turn's `result` event already deleted the activeTurn, but
        // the Claude SDK fired another `canUseTool` — happens when the SDK
        // self-resumes after a background task notification. Re-promote a
        // minimal activeTurn from the live session so the question renders
        // instead of failing with "Chat turn ended unexpectedly".
        active = this.recreateActiveTurnFromSession(args)
        if (!active) {
          throw new Error("Chat turn ended unexpectedly")
        }
      }

      active.status = "waiting_for_user"
      active.waitStartedAt = Date.now()
      this.emitStateChange(args.chatId)

      return await new Promise<AnyValue>((resolve) => {
        active.pendingTool = {
          toolUseId: request.tool.toolId,
          tool: request.tool,
          resolve,
        }
      })
    }

    const targetProvider: AgentProvider = args.provider
    const existingToken = chat.sessionTokensByProvider[targetProvider] ?? null
    const pendingForkToken = chat.pendingForkSessionToken?.provider === targetProvider
      ? chat.pendingForkSessionToken.token
      : null
    const shouldPrime = shouldInjectPrimer(
      chat.sessionTokensByProvider,
      targetProvider,
      Boolean(args.userClearedContext),
    )
    const userPromptText = buildPromptText(args.content, args.attachments)
    const primer = shouldPrime
      ? buildHistoryPrimer(existingMessages, targetProvider, userPromptText)
      : null
    const promptContent = primer ?? userPromptText

    let turn: HarnessTurn
    if (isClaudeSdkProvider(args.provider)) {
      logSendToStartingProfile(args.profile, "start_turn.provider_boot.begin", {
        chatId: args.chatId,
        provider: args.provider,
        model: args.model,
      })
      const spawn = resolveSpawnPaths(chat, project.localPath)
      turn = await this.startClaudeTurn({
        chatId: args.chatId,
        projectId: project.id,
        localPath: spawn.cwd,
        additionalDirectories: spawn.additionalDirectories,
        stackProjects: resolveStackProjects(chat, (id) => this.store.getProject(id)?.title),
        model: args.model,
        effort: args.effort,
        planMode: args.planMode,
        sessionToken: pendingForkToken ?? existingToken,
        forkSession: pendingForkToken != null,
        onToolRequest,
        provider: args.provider,
      })
      logSendToStartingProfile(args.profile, "start_turn.provider_boot.ready", {
        chatId: args.chatId,
        provider: args.provider,
        model: args.model,
      })
    } else {
      logSendToStartingProfile(args.profile, "start_turn.provider_boot.begin", {
        chatId: args.chatId,
        provider: args.provider,
        model: args.model,
      })
      // Codex single-cwd: peer worktrees not passed to startSession. Cross-root writes use grantRoot.
      const sessionToken = await this.codexManager.startSession({
        chatId: args.chatId,
        cwd: resolveSpawnPaths(chat, project.localPath).cwd,
        projectId: project.id,
        model: args.model,
        serviceTier: args.serviceTier,
        sessionToken: existingToken,
        pendingForkSessionToken: pendingForkToken,
      })
      if (pendingForkToken && sessionToken) {
        await this.store.setPendingForkSessionToken(args.chatId, null)
      }
      logSendToStartingProfile(args.profile, "start_turn.session_ready", {
        chatId: args.chatId,
        provider: args.provider,
        model: args.model,
      })
      turn = await this.codexManager.startTurn({
        chatId: args.chatId,
        content: promptContent,
        model: args.model,
        effort: isCodexReasoningEffort(args.effort) ? args.effort : undefined,
        serviceTier: args.serviceTier,
        planMode: args.planMode,
        onToolRequest,
        developerInstructions: this.getAppSettingsSnapshot().globalPromptAppend,
      })
      logSendToStartingProfile(args.profile, "start_turn.provider_boot.ready", {
        chatId: args.chatId,
        provider: args.provider,
        model: args.model,
      })
    }

    const active: ActiveTurn = {
      chatId: args.chatId,
      provider: args.provider,
      turn,
      model: args.model,
      effort: args.effort,
      serviceTier: args.serviceTier,
      planMode: args.planMode,
      status: args.provider === "claude" ? "running" : "starting",
      pendingTool: null,
      postToolFollowUp: null,
      hasFinalResult: false,
      cancelRequested: false,
      cancelRecorded: false,
      clientTraceId: args.profile?.traceId,
      profilingStartedAt: args.profile?.startedAt,
      waitStartedAt: null,
      userMessageId: appendedUserMessageId ?? this.findLastUserMessageId(args.chatId),
    }
    this.activeTurns.set(args.chatId, active)
    logSendToStartingProfile(args.profile, "start_turn.active_turn_registered", {
      chatId: args.chatId,
      status: active.status,
    })
    this.emitStateChange(args.chatId, { immediate: active.status === "starting" })
    logSendToStartingProfile(args.profile, "start_turn.state_change_emitted", {
      chatId: args.chatId,
      status: active.status,
    })

    if (turn.getAccountInfo) {
      void turn.getAccountInfo()
        .then(async (accountInfo) => {
          const session = this.claudeSessions.get(args.chatId)
          let augmented: AccountInfo
          if (args.provider === "openrouter") {
            // OpenRouter routes through the SDK with ANTHROPIC_AUTH_TOKEN set to
            // the OpenRouter key, so the SDK self-reports tokenSource
            // "ANTHROPIC_AUTH_TOKEN" with no account — mislabeling the chat as
            // Anthropic. Override with the OpenRouter identity instead.
            if (!session) return
            if (session.accountInfoLoaded) return
            session.accountInfoLoaded = true
            augmented = {
              tokenSource: "openrouter",
              ...(session.openrouterKeyMasked ? { oauthKeyMasked: session.openrouterKeyMasked } : {}),
              ...(session.openrouterModel ? { organization: session.openrouterModel } : {}),
            }
          } else {
            if (!accountInfo) return
            augmented = accountInfo
            if (args.provider === "claude") {
              if (!session) return
              if (session.accountInfoLoaded) return
              session.accountInfoLoaded = true
              // Mirror the PTY driver's deriveAccountInfoFromOauth: when the
              // turn was started with a kanna OAuth-pool token, surface its
              // name as organization and tag the source so the UI renders
              // "Pool token" identically across drivers. SDK-reported extras
              // (email, subscriptionType) are preserved.
              if (session.activeTokenId) {
                augmented = {
                  ...accountInfo,
                  tokenSource: "kanna-oauth-pool",
                  ...(session.oauthLabel ? { organization: session.oauthLabel } : {}),
                  ...(session.oauthKeyMasked ? { oauthKeyMasked: session.oauthKeyMasked } : {}),
                }
              } else if (session.oauthKeyMasked && !accountInfo.oauthKeyMasked) {
                augmented = { ...accountInfo, oauthKeyMasked: session.oauthKeyMasked }
              }
            }
          }
          await this.store.appendMessage(args.chatId, timestamped({ kind: "account_info", accountInfo: augmented }))
          this.emitStateChange(args.chatId)
        })
        .catch(() => undefined)
    }

    if (providerUsesSdkSession(args.provider)) {
      // claude and openrouter both deliver their prompt through the SDK
      // session queue; gating this on `=== "claude"` is what left openrouter's
      // prompt undelivered, hanging every openrouter turn until the watchdog.
      const session = this.claudeSessions.get(args.chatId)
      if (!session) {
        throw new Error("SDK session was not initialized")
      }
      const promptSeq = session.nextPromptSeq + 1
      session.nextPromptSeq = promptSeq
      session.pendingPromptSeqs.push(promptSeq)
      // A new turn starts: clear any stale cancellation marker so a previous
      // cancel that never produced a tail result can't suppress this turn's
      // real result.
      session.cancelledResultPending = 0
      active.claudePromptSeq = promptSeq
      logClaudeSteer("claude_prompt_sent", {
        chatId: args.chatId,
        sessionId: session.id,
        promptSeq,
        activeStatus: active.status,
        contentPreview: args.content.slice(0, 160),
        pendingPromptSeqs: [...session.pendingPromptSeqs],
      })
      await session.session.sendPrompt(promptContent)
      session.lastUsedAt = Date.now()
      logSendToStartingProfile(args.profile, "start_turn.claude_prompt_sent", {
        chatId: args.chatId,
      })
      return
    }

    void this.runTurn(active)
  }

  private recreateActiveTurnFromSession(args: {
    chatId: string
    provider: AgentProvider
    model: string
    effort?: string
    serviceTier?: "fast"
    planMode: boolean
    clientTraceId?: string
  }): ActiveTurn | undefined {
    if (!providerUsesSdkSession(args.provider)) return undefined
    const session = this.claudeSessions.get(args.chatId)
    if (!session) return undefined

    const ghostTurn: HarnessTurn = {
      provider: args.provider,
      stream: { async *[Symbol.asyncIterator]() {} },
      getAccountInfo: session.session.getAccountInfo,
      interrupt: session.session.interrupt,
      close: () => {},
    }

    const active: ActiveTurn = {
      chatId: args.chatId,
      provider: args.provider,
      turn: ghostTurn,
      model: session.model,
      effort: session.effort,
      serviceTier: args.serviceTier,
      planMode: session.planMode,
      status: "waiting_for_user",
      pendingTool: null,
      postToolFollowUp: null,
      hasFinalResult: false,
      cancelRequested: false,
      cancelRecorded: false,
      clientTraceId: args.clientTraceId,
      waitStartedAt: null,
      userMessageId: this.findLastUserMessageId(args.chatId),
    }
    this.activeTurns.set(args.chatId, active)
    return active
  }

  private findLastUserMessageId(chatId: string): string | null {
    const messages = this.store.getMessages(chatId)
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const entry = messages[i]
      if (entry.kind === "user_prompt") return entry._id
    }
    return null
  }

  private async startClaudeTurn(args: {
    chatId: string
    projectId: string
    localPath: string
    additionalDirectories?: string[]
    stackProjects?: ResolvedStackBinding[]
    model: string
    effort?: string
    planMode: boolean
    sessionToken: string | null
    forkSession: boolean
    onToolRequest: (request: HarnessToolRequest) => Promise<AnyValue>
    provider: AgentProvider
  }): Promise<HarnessTurn> {
    let session = this.claudeSessions.get(args.chatId)

    const driverIsPty = args.provider !== "openrouter"
      && this.resolveClaudeDriverPreference() === "pty"
    const loopArmedNow = this.isLoopArmed(args.chatId) !== null

    if (
      !session ||
      session.localPath !== args.localPath ||
      session.effort !== args.effort ||
      args.forkSession ||
      session.additionalDirectories.join("|") !== (args.additionalDirectories ?? []).join("|") ||
      // Both drivers bake the loop tool-block into the spawn (PTY via
      // --disallowedTools CLI args, SDK via options.disallowedTools), so an
      // armed-state flip (arm OR disarm) requires a fresh session. The SDK's
      // dynamic canUseTool deny remains as belt-and-suspenders mid-turn.
      session.loopArmedAtSpawn !== loopArmedNow
    ) {
      if (session) {
        this.closeClaudeSession(args.chatId, session)
      }

      this.enforceClaudeSessionBudget(args.chatId)
      const isOpenRouter = args.provider === "openrouter"
      const openrouterApiKey = isOpenRouter ? (await this.readLlmProvider()).apiKey : null
      const picked = isOpenRouter ? null : (this.oauthPool?.pickActive(args.chatId) ?? null)
      // If the pool is populated but every token is currently unusable
      // (limited/error/disabled/reserved), refuse to spawn rather than let
      // the CLI fall back to its keychain auth — that path serves whichever
      // login the CLI binary's keychain holds, which is typically
      // expired in a pool-managed setup and produces opaque 401 loops.
      if (!isOpenRouter && this.oauthPool && this.oauthPool.hasAnyToken() && !picked) {
        throw new OAuthPoolUnavailableError(this.buildPoolUnavailableMessage(args.chatId, ""))
      }
      if (picked) this.oauthPool!.markUsed(picked.id)

      let openrouterTurnPrice: ModelPrice | null = null
      let openrouterContextWindow: number | undefined
      if (isOpenRouter && this.listOpenRouterModelsFn) {
        try {
          const models = await this.listOpenRouterModelsFn()
          // OpenRouter routing variants (":nitro", ":floor", ...) aren't their
          // own /models entries — fall back to the base id for pricing/context.
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
      const systemPromptAppend = buildKannaSystemPromptAppend(this.getSubagents(), {
        globalPromptAppend: this.getAppSettingsSnapshot().globalPromptAppend,
        stackProjects: args.stackProjects,
      })
      const chatIdForCtx = args.chatId
      const delegationContext: KannaMcpDelegationContext = {
        parentSubagentId: null,
        parentRunId: null,
        ancestorSubagentIds: [],
        depth: 0,
        getParentUserMessageId: () => this.activeTurns.get(chatIdForCtx)?.userMessageId ?? null,
        getMentionedSubagentIds: () => this.mentionedSubagentIdsByChat.get(chatIdForCtx) ?? [],
      }
      const enabledMcpServers = this.getEnabledCustomMcpServers()
      const oauthBearers = await this.buildOAuthBearers(enabledMcpServers)
      let started: ClaudeSessionHandle
      try {
        started = usePty
          ? await this.startClaudeSessionPTYFn({
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
              subagentOrchestrator: this.subagentOrchestrator,
              delegationContext,
              setupLoop: delegationContext.depth === 0
                ? (input) => this.setupLoop({ chatId: chatIdForCtx, input })
                : undefined,
              stopLoop: delegationContext.depth === 0
                ? () => this.stopLoop(chatIdForCtx, "goal_met")
                : undefined,
              isLoopArmed: delegationContext.depth === 0
                ? () => this.isLoopArmed(chatIdForCtx) !== null
                : undefined,
              runOrch: delegationContext.depth === 0
                ? (input) => this.runOrchestration(chatIdForCtx, input)
                : undefined,
              cancelOrchRun: delegationContext.depth === 0
                ? (runId) => this.cancelOrchRun(runId)
                : undefined,
              getOrchRunStatus: delegationContext.depth === 0
                ? (runId) => this.getOrchRunDetail(runId)
                : undefined,
              toolCallback: this.toolCallback ?? undefined,
              tunnelGateway: this.tunnelGateway,
              chatPolicy: this.resolveChatPolicy(args.chatId),
              ptyRegistry: this.claudePtyRegistry ?? undefined,
                ptyInstanceRegistry: this.ptyInstanceRegistry ?? undefined,
              workflowRegistry: this.workflowRegistry ?? undefined,
              subagentTranscriptRegistry: this.subagentTranscriptRegistry ?? undefined,
              customMcpServers: enabledMcpServers,
              oauthBearers,
            })
          : await this.startClaudeSessionFn({
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
              tunnelGateway: this.tunnelGateway,
              onToolRequest: args.onToolRequest,
              systemPromptAppend,
              subagentOrchestrator: this.subagentOrchestrator,
              delegationContext,
              setupLoop: delegationContext.depth === 0
                ? (input) => this.setupLoop({ chatId: chatIdForCtx, input })
                : undefined,
              stopLoop: delegationContext.depth === 0
                ? () => this.stopLoop(chatIdForCtx, "goal_met")
                : undefined,
              isLoopArmed: delegationContext.depth === 0
                ? () => this.isLoopArmed(chatIdForCtx) !== null
                : undefined,
              runOrch: delegationContext.depth === 0
                ? (input) => this.runOrchestration(chatIdForCtx, input)
                : undefined,
              cancelOrchRun: delegationContext.depth === 0
                ? (runId) => this.cancelOrchRun(runId)
                : undefined,
              getOrchRunStatus: delegationContext.depth === 0
                ? (runId) => this.getOrchRunDetail(runId)
                : undefined,
              toolCallback: this.toolCallback ?? undefined,
              chatPolicy: this.resolveChatPolicy(args.chatId),
              customMcpServers: enabledMcpServers,
              oauthBearers,
              turnPrice: openrouterTurnPrice,
              contextWindowOverride: openrouterContextWindow,
            })
      } catch (err) {
        // Spawn failed before we registered the session — release the OAuth
        // pool reservation we took at line ~2144. Without this the token
        // stays "in use" until process restart, eventually starving every
        // chat once all tokens are reserved.
        if (picked) this.oauthPool?.release(args.chatId)
        throw err
      }

      session = {
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
        backgroundTaskIds: new Set<string>(),
        backgroundTaskDeadlineAt: 0,
        loopArmedAtSpawn: loopArmedNow,
        cancelledResultPending: 0,
        suppressSessionTokenPersist: false,
      }
      this.claudeSessions.set(args.chatId, session)
      this.enforceClaudeSessionBudget(args.chatId)
      void this.runClaudeSession(session)
      void (async () => {
        try {
          const commands = await started.getSupportedCommands()
          const merged = this.mergeLocalCatalog(commands, args.localPath)
          await this.store.recordSessionCommandsLoaded(args.chatId, merged)
          this.emitStateChange(args.chatId)
        } catch (error) {
          log.warn("[kanna/agent] failed to load slash commands", String(error))
        }
      })()
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

  async send(command: Extract<ClientCommand, { type: "chat.send" }>) {
    const profile = command.clientTraceId
      ? { traceId: command.clientTraceId, startedAt: performance.now() }
      : null
    let chatId = command.chatId

    // A real user chat.send means the agent is active again — release any
    // background-task keep-alive guard so the session reaps normally afterward.
    // Auto-continue / agent wakes bypass `send` and intentionally do NOT clear it.
    const existingClaudeSession = chatId ? this.claudeSessions.get(chatId) : undefined
    if (existingClaudeSession) {
      existingClaudeSession.backgroundTaskIds.clear()
      existingClaudeSession.backgroundTaskDeadlineAt = 0
    }

    // A real user send is a takeover: disarm any armed loop so tools are
    // restored and the generic wake path resumes. Auto-continue / background
    // wakes bypass `send`, so they do NOT disarm.
    // Awaited so a failed event-log write surfaces instead of silently
    // leaving the loop armed (and tools blocked) after the takeover.
    if (chatId) await this.stopLoop(chatId, "user_send")

    logSendToStartingProfile(profile, "chat_send.received", {
      existingChatId: command.chatId ?? null,
      projectId: command.projectId ?? null,
    })

    if (!chatId) {
      if (!command.projectId) {
        throw new Error("Missing projectId for new chat")
      }
      const created = await this.store.createChat(command.projectId)
      chatId = created.id
      this.analytics.track("chat_created")
      logSendToStartingProfile(profile, "chat_send.chat_created", {
        chatId,
        projectId: command.projectId,
      })
    }

    if (typeof command.autoResumeOnRateLimit === "boolean" && chatId) {
      this.autoResumeByChat.set(chatId, command.autoResumeOnRateLimit)
    }

    const chat = this.store.requireChat(chatId)
    if (this.activeTurns.has(chatId)) {
      this.analytics.track("message_sent")
      const queuedMessage = await this.enqueueMessage(chatId, command.content, command.attachments ?? [], {
        provider: command.provider,
        model: command.model,
        modelOptions: command.modelOptions,
        effort: command.effort,
        planMode: command.planMode,
      })
      return { chatId, queuedMessageId: queuedMessage.id, queued: true as const }
    }

    // Mentions no longer short-circuit the main turn. The main agent always
    // runs and decides whether to delegate via `mcp__kanna__delegate_subagent`
    // (Anthropic-style Task-tool pattern). `parseMentions` still runs inside
    // `startTurnForChat` → `appendUserPrompt` so the user_prompt entry
    // continues to carry `subagentMentions` metadata for UI badges + analytics.
    const provider = this.resolveProvider(command, chat.provider)
    const settings = this.getProviderSettings(provider, command)
    this.analytics.track("message_sent")

    // Proactive compact: if the latest usage snapshot crossed claude-code's
    // auto-compact threshold, inject a synthetic `/compact` turn ahead of the
    // user's real message. The user's prompt sits in the queue and runs after
    // `/compact` produces its summary, so the next turn ships with a bounded
    // history instead of looping on "Prompt is too long".
    if (
      provider === "claude" // openrouter intentionally excluded: /compact is claude-CLI-specific
      && this.shouldInjectProactiveCompact(chatId, command.content)
    ) {
      const queuedMessage = await this.enqueueMessage(chatId, command.content, command.attachments ?? [], {
        provider: command.provider,
        model: command.model,
        modelOptions: command.modelOptions,
        effort: command.effort,
        planMode: command.planMode,
      })
      await this.startTurnForChat({
        chatId,
        provider,
        content: "/compact",
        attachments: [],
        model: settings.model,
        effort: settings.effort,
        serviceTier: settings.serviceTier,
        planMode: settings.planMode,
        // /compact is a slash command, not the user's actual message — don't
        // persist a user_prompt transcript entry for it.
        appendUserPrompt: false,
        profile,
      })
      // Tag the active turn so the result handler can update the circuit
      // breaker (reset on success / increment on failure).
      const compactActive = this.activeTurns.get(chatId)
      if (compactActive) compactActive.proactiveCompactInjection = true

      logSendToStartingProfile(profile, "chat_send.proactive_compact_injected", {
        chatId,
        provider,
        model: settings.model,
        queuedUserMessageId: queuedMessage.id,
      })

      return { chatId, queuedMessageId: queuedMessage.id, queued: true as const }
    }

    await this.startTurnForChat({
      chatId,
      provider,
      content: command.content,
      attachments: command.attachments ?? [],
      model: settings.model,
      effort: settings.effort,
      serviceTier: settings.serviceTier,
      planMode: settings.planMode,
      appendUserPrompt: true,
      profile,
    })

    logSendToStartingProfile(profile, "chat_send.ready_for_ack", {
      chatId,
      provider,
      model: settings.model,
    })

    return { chatId }
  }

  private shouldInjectProactiveCompact(chatId: string, content: string): boolean {
    // Never recurse — if the user (or Kanna itself) is already sending a
    // slash command, run it as-is. Compacting before `/clear` or another
    // `/compact` would be wasted work.
    if (content.trimStart().startsWith("/")) return false
    const failures = this.store.getChat(chatId)?.compactFailureCount ?? 0
    if (failures >= MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES) return false
    const usage = getLatestContextWindowUsage(this.store.getMessages(chatId))
    return shouldProactivelyCompact(usage)
  }

  /**
   * D6 — subagent Claude starter. When `KANNA_CLAUDE_DRIVER=pty` the
   * subagent turn runs through the PTY driver (subscription billing)
   * instead of always falling back to the SDK (API billing). Adapts the
   * SDK-shaped `startClaudeSession` arg to `StartClaudeSessionPtyArgs`,
   * injecting the coordinator-owned preflight / toolCallback / tunnel /
   * policy context and `oneShot: true` so the REPL closes after the
   * single subagent turn (depends on Phase 4 D7).
   */
  private buildClaudeSubagentStarter(): NonNullable<BuildSubagentProviderRunArgs["startClaudeSession"]> {
    return async (a) => {
      const enabledMcpServers = this.getEnabledCustomMcpServers()
      const oauthBearers = await this.buildOAuthBearers(enabledMcpServers)
      if (this.resolveClaudeDriverPreference() === "pty") {
        return this.startClaudeSessionPTYFn({
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
          toolCallback: this.toolCallback ?? undefined,
          tunnelGateway: this.tunnelGateway,
          chatPolicy: a.chatId ? this.resolveChatPolicy(a.chatId) : undefined,
          oneShot: true,
          ptyRegistry: this.claudePtyRegistry ?? undefined,
                ptyInstanceRegistry: this.ptyInstanceRegistry ?? undefined,
          workflowRegistry: this.workflowRegistry ?? undefined,
          customMcpServers: enabledMcpServers,
          oauthBearers,
          restrictedAllowedPaths: a.restrictedAllowedPaths,
          keepAlive: a.keepAlive,
        })
      }
      return this.startClaudeSessionFn({ ...a, customMcpServers: enabledMcpServers, oauthBearers })
    }
  }

  private buildSubagentProviderRunForChat(args: {
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
  }): ProviderRunStart {
    const chat = this.store.requireChat(args.chatId)
    const project = this.store.getProject(chat.projectId)
    if (!project) throw new Error(`Project ${chat.projectId} not found for chat ${args.chatId}`)
    const spawn = resolveSpawnPaths(chat, project.localPath)
    const restriction = args.cwdOverride === undefined
      && (args.subagent.workingDir !== undefined || args.subagent.allowedPaths !== undefined)
      ? resolveSubagentRoots(spawn.cwd, args.subagent.workingDir, args.subagent.allowedPaths, realpathAdapter)
      : null

    const onToolRequest = async (request: HarnessToolRequest): Promise<AnyValue> => {
      if (request.tool.toolKind !== "ask_user_question"
          && request.tool.toolKind !== "exit_plan_mode") {
        // Non-interactive tools (bash, read, write, ...) — SDK handles
        // them via canUseTool wrapper. No forwarding needed.
        return null
      }
      const toolUseId = request.tool.toolId
      const key = this.subagentPendingKey(args.chatId, args.runId, toolUseId)
      await this.store.appendSubagentEvent({
        v: 3,
        type: "subagent_tool_pending",
        timestamp: Date.now(),
        chatId: args.chatId,
        runId: args.runId,
        toolUseId,
        toolKind: request.tool.toolKind,
        input: request.tool.input,
      })
      this.emitStateChange(args.chatId)
      this.subagentOrchestrator.notifySubagentToolPending(args.runId)
      return await new Promise<AnyValue>((resolve, reject) => {
        // Defensive: if `canUseTool` somehow fires twice for the same
        // (chatId, runId, toolUseId) — e.g. SDK retry — reject the previous
        // resolver before overwriting so its Promise doesn't leak.
        const existing = this.subagentPendingResolvers.get(key)
        if (existing) {
          existing.reject(new Error("superseded by retry"))
        }
        this.subagentPendingResolvers.set(key, { resolve, reject })
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
      stackProjects: args.cwdOverride || restriction ? [] : resolveStackProjects(chat, (id) => this.store.getProject(id)?.title),
      allowedPaths: restriction?.allowedPaths,
      projectId: project.id,
      startClaudeSession: this.buildClaudeSubagentStarter(),
      // PTY claude has no native maxTurns (interactive CLI) — the orchestrator
      // applies a host-side tool-call-count backstop for PTY + Codex runs.
      claudeDriverIsPty: this.resolveClaudeDriverPreference() === "pty",
      subagentOrchestrator: this.subagentOrchestrator,
      delegationContext,
      codexManager: this.codexManager,
      onToolRequest,
      globalPromptAppend: this.getAppSettingsSnapshot().globalPromptAppend,
      authReady: async (provider) => {
        if (provider === "openrouter") {
          return openrouterAuthReady(await this.readLlmProvider())
        }
        if (provider === "claude") {
          const settings = this.getAppSettingsSnapshot()
          // Pass parent chat id so a token already reserved by the parent
          // counts as usable. Subagent runs are sequential under the parent
          // (parent's turn is paused), so sharing the parent's reservation
          // is correct — see oauth-token-pool isEligible.
          return Boolean(settings.claudeAuth?.authenticated || this.oauthPool?.hasUsable(args.chatId))
        }
        return true
      },
      pickOauthToken: () => {
        // Subagent inherits the parent chat's reservation by re-picking under
        // the same chatId. pickActive treats the parent's reservation as
        // owned-by-self (drops + re-binds to chatId), so the lifecycle stays
        // bound to the parent's close path — no separate subagent release.
        const picked = this.oauthPool?.pickActive(args.chatId) ?? null
        if (this.oauthPool && this.oauthPool.hasAnyToken() && !picked) {
          throw new OAuthPoolUnavailableError(this.buildPoolUnavailableMessage(args.chatId, " for subagent run"))
        }
        if (picked) this.oauthPool!.markUsed(picked.id)
        return picked?.token ?? null
      },
    })
  }

  /**
   * StartWorker adapter for the OrchestrationQueue: spawn the run's configured
   * worker subagent against the task worktree (`spawn.cwd`) with the phase
   * prompt. Origin chat + subagent are read from the persisted run config so
   * this resolves identically on a fresh run and after a restart.
   */
  private async buildOrchWorker(spawn: WorkerSpawnArgs): Promise<WorkerResult> {
    const run = this.store.getOrchRun(spawn.runId)
    const chatId = run?.config.originChatId
    const subagentId = run?.config.workerSubagentId
    if (!chatId || !subagentId) {
      return { kind: "failed", error: "orchestration run missing originChatId / workerSubagentId" }
    }
    const subagent = this.getSubagents().find((s) => s.id === subagentId)
    if (!subagent) return { kind: "failed", error: `orchestration worker subagent "${subagentId}" not found` }
    if (!this.store.getChat(chatId)) return { kind: "failed", error: `orchestration origin chat ${chatId} not found` }

    const providerRun = this.buildSubagentProviderRunForChat({
      subagent,
      chatId,
      primer: null,
      userInstruction: spawn.prompt,
      runId: `${spawn.runId}:${spawn.workerId}`,
      abortSignal: spawn.abortSignal,
      depth: 0,
      ancestorSubagentIds: [],
      parentUserMessageId: spawn.runId,
      cwdOverride: spawn.cwd,
    })
    try {
      if (!(await providerRun.authReady())) {
        return { kind: "failed", error: "orchestration worker auth not ready" }
      }
      const result = await providerRun.start(() => undefined, () => undefined)
      return { kind: "completed", text: result.text }
    } catch (err) {
      if (spawn.abortSignal.aborted) return { kind: "failed", error: "aborted" }
      return { kind: "failed", error: err instanceof Error ? err.message : String(err) }
    }
  }

  private buildOrchRunContext(chatId: string): OrchRunContext | null {
    const chat = this.store.getChat(chatId)
    if (!chat) return null
    const project = this.store.getProject(chat.projectId)
    if (!project) return null
    return {
      chatId,
      repoRoot: project.localPath,
      roster: this.getSubagents().map((s) => ({ id: s.id, name: s.name })),
      defaultOrchSubagentId: this.getAppSettingsSnapshot().subagentRuntime?.defaultOrchSubagentId ?? null,
    }
  }

  /**
   * User-callable entry point (MCP `orch_run` + ws `orch.run`). Validates the
   * task list into the fixed linear config, then starts the run. Returns the
   * runId or the flat validation error list — never a partial run.
   */
  async runOrchestration(
    chatId: string,
    input: OrchRunInput,
  ): Promise<{ ok: true; runId: string } | { ok: false; errors: string[] }> {
    const context = this.buildOrchRunContext(chatId)
    if (!context) return { ok: false, errors: [`chat ${chatId} not found or has no project`] }
    const validation = validateOrchRun(input, context)
    if (!validation.ok) return { ok: false, errors: validation.errors }
    const runId = await this.orchestrationQueue.createRun(validation.resolved.config, validation.resolved.tasks)
    return { ok: true, runId }
  }

  /** Cancel a run (MCP `orch_cancel_run` + ws `orch.cancelRun`). */
  async cancelOrchRun(runId: string): Promise<void> {
    await this.orchestrationQueue.cancelRun(runId)
  }

  /** Canonical run detail DTO (MCP `orch_run_status` + ws `orch.getRun`). */
  getOrchRunDetail(runId: string): OrchRunDetail | null {
    const snapshot = this.store.getOrchRun(runId)
    return snapshot ? toOrchRunDetail(snapshot) : null
  }

  async enqueue(command: Extract<ClientCommand, { type: "message.enqueue" }>) {
    if (typeof command.autoResumeOnRateLimit === "boolean") {
      this.autoResumeByChat.set(command.chatId, command.autoResumeOnRateLimit)
    }
    this.analytics.track("message_sent")
    const queuedMessage = await this.enqueueMessage(command.chatId, command.content, command.attachments ?? [], {
      provider: command.provider,
      model: command.model,
      modelOptions: command.modelOptions,
      planMode: command.planMode,
    })
    return { queuedMessageId: queuedMessage.id }
  }

  async steer(command: Extract<ClientCommand, { type: "message.steer" }>) {
    const queuedMessage = this.store.getQueuedMessage(command.chatId, command.queuedMessageId)
    if (!queuedMessage) {
      throw new Error("Queued message not found")
    }

    logClaudeSteer("steer_requested", {
      chatId: command.chatId,
      queuedMessageId: command.queuedMessageId,
      activeTurn: this.activeTurns.has(command.chatId),
      queuedMessagePreview: queuedMessage.content.slice(0, 160),
    })

    if (this.activeTurns.has(command.chatId)) {
      await this.cancel(command.chatId, { hideInterrupted: true, skipQueueDrain: true })
    }

    logClaudeSteer("steer_after_cancel", {
      chatId: command.chatId,
      stillActive: this.activeTurns.has(command.chatId),
    })

    if (this.activeTurns.has(command.chatId)) {
      throw new Error("Chat is still running")
    }

    await this.dequeueAndStartQueuedMessage(command.chatId, queuedMessage, { steered: true })
  }

  async dequeue(command: Extract<ClientCommand, { type: "message.dequeue" }>) {
    const queuedMessage = this.store.getQueuedMessage(command.chatId, command.queuedMessageId)
    if (!queuedMessage) {
      throw new Error("Queued message not found")
    }

    // Refuse to drop the queued message while a Kanna-injected `/compact`
    // turn is running. The compact was triggered specifically to make room
    // for this queued message; auto-draining it after compact completes
    // would silently lose user intent and waste the compact spend.
    const active = this.activeTurns.get(command.chatId)
    if (active?.proactiveCompactInjection) {
      throw new Error("Cannot remove queued message while compact is running")
    }

    await this.store.removeQueuedMessage(command.chatId, command.queuedMessageId)
  }

  async forkChat(chatId: string) {
    const chat = this.store.requireChat(chatId)
    if (this.activeTurns.has(chatId) || this.drainingStreams.has(chatId)) {
      throw new Error("Chat must be idle before forking")
    }
    if (!chat.provider) {
      throw new Error("Chat must have a provider before forking")
    }
    const currentProviderToken = chat.provider
      ? chat.sessionTokensByProvider[chat.provider] ?? null
      : null
    const pendingForkForProvider = chat.pendingForkSessionToken?.provider === chat.provider
      ? chat.pendingForkSessionToken.token
      : null
    if (!currentProviderToken && !pendingForkForProvider) {
      throw new Error("Chat has no session to fork")
    }

    const forked = await this.store.forkChat(chatId)
    this.analytics.track("chat_created")
    return { chatId: forked.id }
  }

  private async runClaudeSession(session: ClaudeSessionState) {
    // OpenRouter-only first-entry watchdog. OpenRouter routes through the
    // Claude SDK; a stalled upstream emits the session-token handshake then
    // goes silent — the stream stays open with no entry, so this for-await
    // never returns or throws and the chat hangs "running" until restart. The
    // existing catch/finally fail-close is claude-provider-gated and depends
    // on an active turn that the openrouter path tears down early, so the
    // watchdog records the failure itself, then interrupts + closes the
    // session to end the stream. `firstEntrySeen` guards against a late real
    // entry; close() prevents any further entry from being processed.
    const isOpenRouterSession = session.openrouterModel !== null
    let firstEntrySeen = false
    let firstEntryWatchdog: ReturnType<typeof setTimeout> | null = null
    const clearFirstEntryWatchdog = () => {
      if (firstEntryWatchdog !== null) {
        clearTimeout(firstEntryWatchdog)
        firstEntryWatchdog = null
      }
    }
    if (isOpenRouterSession) {
      firstEntryWatchdog = setTimeout(() => {
        if (firstEntrySeen) return
        if (this.claudeSessions.get(session.chatId) !== session) return
        firstEntrySeen = true
        const message = `OpenRouter produced no response within ${this.openrouterFirstEntryTimeoutMs}ms — the selected model may be invalid or the upstream stalled.`
        log.warn("[kanna/agent] openrouter stream produced no entry within watchdog window — failing turn", {
          chatId: session.chatId,
          sessionId: session.id,
          model: session.openrouterModel,
          timeoutMs: this.openrouterFirstEntryTimeoutMs,
        })
        void (async () => {
          await this.store.appendMessage(
            session.chatId,
            timestamped({
              kind: "result",
              subtype: "error",
              isError: true,
              durationMs: this.openrouterFirstEntryTimeoutMs,
              result: message,
            }),
          )
          await this.store.recordTurnFailed(session.chatId, message)
          const active = this.activeTurns.get(session.chatId)
          if (active) this.activeTurns.delete(session.chatId)
          this.emitStateChange(session.chatId)
          void session.session.interrupt().catch(() => {})
          session.session.close()
        })()
      }, this.openrouterFirstEntryTimeoutMs)
    }
    try {
      let simulateLimit = this.throwOnClaudeSessionStart
      for await (const event of session.session.stream) {
        if (simulateLimit) {
          simulateLimit = false
          throw new Error("simulated rate limit")
        }
        if (event.type === "session_token" && event.sessionToken) {
          session.sessionToken = event.sessionToken
          // Persist only when this session is still current, no cancel is in
          // flight, and no /clear suppressed it. A cancelled spawn can emit
          // its session_token AFTER the user interrupted — the CLI may never
          // persist that conversation, so storing the token would poison the
          // next `--resume` ("No conversation found with session ID"). A
          // /clear (setup_loop, background delivery) mid-stream must likewise
          // not be resurrected by the old conversation's next token event.
          const isCurrentSession = this.claudeSessions.get(session.chatId) === session
          if (
            isCurrentSession
            && session.cancelledResultPending === 0
            && !session.suppressSessionTokenPersist
          ) {
            await this.store.setSessionTokenForProvider(session.chatId, "claude", event.sessionToken)
          }
          this.maybeRegisterSdkWorkflowsDir(session)
          this.emitStateChange(session.chatId)
          continue
        }

        if (event.type === "rate_limit" && event.rateLimit) {
          // Stale rate_limit events from a session that has already been
          // rotated away must not trigger another rotation/continue.
          if (this.claudeSessions.get(session.chatId) !== session) continue
          await this.handleLimitDetection(session.chatId, {
            chatId: session.chatId,
            resetAt: event.rateLimit.resetAt,
            tz: event.rateLimit.tz,
            raw: event,
          })
          if (this.claudeSessions.get(session.chatId) !== session) break
          continue
        }

        if (!event.entry) continue
        firstEntrySeen = true
        clearFirstEntryWatchdog()
        if (this.claudeSessions.get(session.chatId) !== session) break
        // Suppress the interrupt-induced tail `result` of a cancelled turn.
        // cancel() already removed the active turn, recorded the cancellation,
        // and appended the `interrupted` entry; the SDK then emits one error
        // `result` (subtype error_during_execution, empty text) that would
        // otherwise render as "An unknown error occurred." Drop it (and skip
        // the seq shift — cancel() already spliced the cancelled seq).
        if (
          event.entry.kind === "result" &&
          event.entry.isError &&
          session.cancelledResultPending > 0
        ) {
          session.cancelledResultPending -= 1
          continue
        }
        if (event.entry.kind === "system_init") {
          const kannaNames = this.getSubagents().map((s) => s.name)
          if (kannaNames.length > 0) {
            const entry = event.entry
            const existing = new Set(entry.agents)
            const extra = kannaNames.filter((n) => !existing.has(n))
            if (extra.length > 0) {
              entry.agents = [...entry.agents, ...extra]
            }
          }
        }
        await this.store.appendMessage(session.chatId, event.entry)
        // Background-task keep-alive guard (SDK + PTY).
        // On launch: add the task id and refresh the zombie-backstop deadline.
        // On settle (task_notification): remove the id — gate primary signal is
        // set size>0, not the clock. The deadline (default 4h) is refreshed on
        // every launch and settle so it only fires when a notification is truly
        // lost (SDK crash / dropped message), never during normal execution.
        if (event.entry.kind === "tool_result") {
          const launchedIds = backgroundTaskIdsFromToolResult(
            event.entry.content,
          )
          if (launchedIds.length > 0) {
            for (const id of launchedIds) session.backgroundTaskIds.add(id)
            session.backgroundTaskDeadlineAt = Date.now() + this.resolveBackgroundTaskMaxMs()
            this.emitStateChange(session.chatId)
          }
        }
        if (event.entry.kind === "status" && event.entry.backgroundTaskId) {
          const settledId = event.entry.backgroundTaskId
          session.backgroundTaskIds.delete(settledId)
          if (session.backgroundTaskIds.size > 0) {
            session.backgroundTaskDeadlineAt = Date.now() + this.resolveBackgroundTaskMaxMs()
          } else {
            session.backgroundTaskDeadlineAt = 0
          }
          this.emitStateChange(session.chatId)
        }
        const active = this.activeTurns.get(session.chatId)
        if (event.entry.kind === "system_init" && active) {
          active.status = "running"
          const chat = this.store.getChat(session.chatId)
          if (
            chat?.pendingForkSessionToken
            && session.sessionToken
            && session.sessionToken !== chat.pendingForkSessionToken.token
          ) {
            await this.store.setPendingForkSessionToken(session.chatId, null)
          }
          // Refresh the chat's slashCommands from the live system_init list
          // every spawn. The cold-start `getSupportedCommands()` call right
          // after spawn often returns the static fallback because system_init
          // hadn't arrived yet; this overwrites that with the canonical list
          // (skills + plugins + built-ins, no `/` prefix).
          if (Array.isArray(event.entry.slashCommands)) {
            const names = event.entry.slashCommands
            const commands: SlashCommand[] = names.map((name) => ({
              name,
              description: "",
              argumentHint: "",
            }))
            const merged = this.mergeLocalCatalog(commands, session.localPath)
            await this.store.recordSessionCommandsLoaded(session.chatId, merged)
          }
          logClaudeSteer("claude_event_system_init", {
            chatId: session.chatId,
            sessionId: session.id,
            activePromptSeq: active.claudePromptSeq ?? null,
            pendingPromptSeqs: [...session.pendingPromptSeqs],
          })
        }

        const completedClaudePromptSeq = event.entry.kind === "result" || event.entry.kind === "interrupted"
          ? (session.pendingPromptSeqs.shift() ?? null)
          : null
        if (completedClaudePromptSeq !== null) {
          session.lastUsedAt = Date.now()
        }

        logClaudeSteer("claude_event", {
          chatId: session.chatId,
          sessionId: session.id,
          entryKind: event.entry.kind,
          activePromptSeq: active?.claudePromptSeq ?? null,
          completedPromptSeq: completedClaudePromptSeq,
          activeStatus: active?.status ?? null,
          pendingPromptSeqs: [...session.pendingPromptSeqs],
        })

        // PTY-only: the Kanna-injected proactive `/compact` turn never emits a
        // terminal `result`/`turn_duration` under the interactive TUI — it
        // writes only a `system/compact_boundary` line (confirmed in the
        // on-disk transcript). Without a result, the normal finalize path below
        // (kind === "result") never runs, so the active turn and its
        // `proactiveCompactInjection` flag linger forever — permanently wedging
        // `dequeue()` ("Cannot remove queued message while compact is running")
        // and the queued-message drain. Treat the boundary as the compact
        // turn's completion: finalize like the SDK result path and drain the
        // queued user message the compact made room for. The SDK driver is
        // excluded because there a real `result` still follows; finalizing here
        // would double-finalize and corrupt the trailing result's seq
        // accounting. See adr-20260608-pty-compact-boundary-dequeue-finalize.
        if (
          event.entry.kind === "compact_boundary"
          && active?.proactiveCompactInjection
          && !active.cancelRequested
          && this.resolveClaudeDriverPreference() === "pty"
        ) {
          active.hasFinalResult = true
          await this.store.recordTurnFinished(session.chatId)
          await this.store.setCompactFailureCount(session.chatId, 0)
          // The compact prompt's seq never gets shifted (no result event), so
          // drop it here — otherwise the next real turn's result would shift
          // this stale seq and FIFO-mismatch, wedging that turn. Mirrors
          // cancel()'s pending-seq drain.
          if (active.claudePromptSeq != null) {
            const idx = session.pendingPromptSeqs.indexOf(active.claudePromptSeq)
            if (idx >= 0) session.pendingPromptSeqs.splice(idx, 1)
          }
          this.activeTurns.delete(session.chatId)
          this.oauthPool?.release(session.chatId)
          await this.maybeStartNextQueuedMessage(session.chatId)
          this.emitStateChange(session.chatId)
          continue
        }

        if (event.entry.kind === "result" && active && completedClaudePromptSeq === (active.claudePromptSeq ?? null)) {
          active.hasFinalResult = true
          // True once a rate-limit / auth-error was routed through
          // handleLimitDetection / handleAuthFailure. Those paths already
          // marked the failed token limited/errored (dropping its
          // reservation) and, when a rotation target exists, pinned the
          // replacement token under this chatId for the scheduled
          // auto-continue to reuse. The turn-scoped release below MUST be
          // skipped in that case — otherwise it drops the freshly-pinned
          // rotation token and a concurrent chat can steal it before
          // fireAutoContinue spawns the replacement session (audit #1).
          let failureHandled = false
          if (event.entry.isError) {
            const resultText = event.entry.result || "Turn failed"
            const debugRaw = event.entry.debugRaw ?? ""
            const detection = this.claudeLimitDetector.detectFromResultText?.(session.chatId, resultText) ?? null
            const authDetection = this.claudeAuthErrorDetector.detectFromResultText(session.chatId, resultText)
              ?? this.claudeAuthErrorDetector.detectFromResultText(session.chatId, debugRaw)
            let handled = false
            if (detection) {
              handled = await this.handleLimitDetection(session.chatId, detection)
            } else if (authDetection) {
              handled = await this.handleAuthFailure(session, authDetection)
            }
            failureHandled = handled
            if (handled) {
              await this.store.recordTurnFailed(session.chatId, detection ? "rate_limit" : "auth_error")
            } else if (
              isPromptTooLongMessage(resultText)
              || isNoConversationFoundMessage(resultText)
              || isNoConversationFoundMessage(debugRaw)
            ) {
              await this.store.recordTurnFailed(session.chatId, resultText)
              this.closeClaudeSession(session.chatId, session)
              await this.store.setSessionTokenForProvider(session.chatId, "claude", null)
            } else {
              await this.store.recordTurnFailed(session.chatId, resultText)
            }
            if (active.proactiveCompactInjection) {
              const prev = this.store.getChat(session.chatId)?.compactFailureCount ?? 0
              await this.store.setCompactFailureCount(session.chatId, prev + 1)
            }
          } else if (!active.cancelRequested) {
            await this.store.recordTurnFinished(session.chatId)
            if (active.proactiveCompactInjection) {
              await this.store.setCompactFailureCount(session.chatId, 0)
            }
            // Note: pending-workflow harvest wake removed — workflow-completion
            // notification is a follow-up ADR. Model can delegate a status-check
            // subagent if it needs event-driven workflow wake.
          }
          this.activeTurns.delete(session.chatId)
          // Turn-scoped reservation: release on turn end so other chats can
          // claim the same token while this chat is idle. The next turn for
          // this chat reuses the same claude session (no re-pick); the
          // rotation race between in-flight turns is still serialized via
          // markLimited/markError (both drop the reservation) and the
          // atomic single-threaded pickActive(chatId) calls.
          //
          // Skip when a rotation handled the failure: the rotation already
          // pinned the replacement token under this chatId and the
          // scheduled auto-continue (TOKEN_ROTATION_SCHEDULE_DELAY_MS later)
          // depends on that pin still being held.
          if (!failureHandled) {
            this.oauthPool?.release(session.chatId)
          }
          if (!active.cancelRequested) {
            await this.maybeStartNextQueuedMessage(session.chatId)
          }
        }

        this.emitStateChange(session.chatId)
      }
    } catch (error) {
      const active = this.activeTurns.get(session.chatId)
      if (active && !active.cancelRequested) {
        const limitHandled = await this.handleLimitError(session.chatId, this.claudeLimitDetector, error)
        const authDetection = limitHandled
          ? null
          : this.claudeAuthErrorDetector.detect(session.chatId, error)
        const authHandled = authDetection
          ? await this.handleAuthFailure(session, authDetection)
          : false
        const handled = limitHandled || authHandled
        if (!handled) {
          const message = error instanceof Error ? error.message : String(error)
          await this.store.appendMessage(
            session.chatId,
            timestamped({
              kind: "result",
              subtype: "error",
              isError: true,
              durationMs: 0,
              result: message,
            })
          )
          await this.store.recordTurnFailed(session.chatId, message)
          if (isPromptTooLongMessage(message) || isNoConversationFoundMessage(message)) {
            this.closeClaudeSession(session.chatId, session)
            await this.store.setSessionTokenForProvider(session.chatId, "claude", null)
          }
        } else {
          await this.store.recordTurnFailed(session.chatId, limitHandled ? "rate_limit" : "auth_error")
        }
      }
    } finally {
      clearFirstEntryWatchdog()
      const active = this.activeTurns.get(session.chatId)
      const isCurrentSession = this.claudeSessions.get(session.chatId) === session
      // Trace point: stream-end-without-final-result is the hang signature.
      // If `hasActiveTurn=true` && `hasFinalResult=false` && this fires,
      // the user will see "still running" forever unless we fail-close.
      log.info("[kanna/agent] runClaudeSession stream ended", {
        chatId: session.chatId,
        sessionId: session.id,
        sessionToken: session.sessionToken,
        isCurrentSession,
        hasActiveTurn: Boolean(active),
        activeStatus: active?.status,
        cancelRequested: active?.cancelRequested,
        hasFinalResult: active?.hasFinalResult,
      })
      // Only clear chat state if it still points at us. A cancel-then-steer,
      // or an oauth-pool rotation that closes this session and schedules an
      // auto-continue, can install a fresh session (and activeTurn) under
      // the same chatId before this finally runs; wiping either
      // unconditionally would break the fresh session's bookkeeping and
      // leave its stream running headless (no isError branch fires →
      // sessionToken never cleared → next turn loops with the same
      // too-large --resume context).
      if (isCurrentSession) {
        this.claudeSessions.delete(session.chatId)
        this.oauthPool?.release(session.chatId)
        if (active?.provider === "claude") {
          if (active.cancelRequested && !active.cancelRecorded) {
            await this.store.recordTurnCancelled(session.chatId)
          } else if (!active.hasFinalResult) {
            // Stream ended without any terminal result event (PTY died,
            // SDK transport dropped, etc). Fail-close the turn so the UI
            // stops showing "running" forever. Without this the chat is
            // wedged until the user manually clicks Stop or reloads.
            log.warn("[kanna/agent] stream ended with no final result — recording turn failure", { chatId: session.chatId, sessionId: session.id })
            await this.store.recordTurnFailed(session.chatId, "session stream ended without a result")
          }
          this.activeTurns.delete(session.chatId)
        }
      }
      session.session.close()
      this.emitStateChange(session.chatId)
    }
  }

  private async generateTitleInBackground(chatId: string, messageContent: string, cwd: string, expectedCurrentTitle: string) {
    try {
      const result = await this.generateTitle(messageContent, cwd)
      if (result.failureMessage) {
        this.reportBackgroundError?.(
          `[title-generation] chat ${chatId} failed provider title generation: ${result.failureMessage}`
        )
      }
      if (!result.title || result.usedFallback) return

      const chat = this.store.requireChat(chatId)
      if (chat.title !== expectedCurrentTitle) return

      await this.store.renameChat(chatId, result.title)
      this.emitStateChange(chatId)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.reportBackgroundError?.(
        `[title-generation] chat ${chatId} failed background title generation: ${message}`
      )
    }
  }

  private async runTurn(active: ActiveTurn) {
    try {
      for await (const event of active.turn.stream) {
        // Once cancelled, stop processing further stream events.
        // cancel() already removed us from activeTurns and notified the UI.
        if (active.cancelRequested) break

        if (event.type === "session_token" && event.sessionToken) {
          await this.store.setSessionTokenForProvider(active.chatId, active.provider, event.sessionToken)
          const chat = this.store.getChat(active.chatId)
          if (
            chat?.pendingForkSessionToken
            && event.sessionToken !== chat.pendingForkSessionToken.token
          ) {
            await this.store.setPendingForkSessionToken(active.chatId, null)
          }
          this.emitStateChange(active.chatId)
          continue
        }

        if (!event.entry) continue
        await this.store.appendMessage(active.chatId, event.entry)

        if (event.entry.kind === "system_init") {
          active.status = "running"
        }

        if (event.entry.kind === "result") {
          active.hasFinalResult = true
          if (event.entry.isError) {
            await this.store.recordTurnFailed(active.chatId, event.entry.result || "Turn failed")
          } else if (!active.cancelRequested) {
            await this.store.recordTurnFinished(active.chatId)
          }
          // Remove from activeTurns as soon as the result arrives so the UI
          // transitions to idle immediately. The stream may still be open
          // (e.g. background tasks), but the user should be able to send
          // new messages without having to hit stop first.
          this.activeTurns.delete(active.chatId)
          this.drainingStreams.set(active.chatId, { turn: active.turn })
        }

        this.emitStateChange(active.chatId)
      }
    } catch (error) {
      if (!active.cancelRequested) {
        const handled = await this.handleLimitError(active.chatId, this.codexLimitDetector, error)
        if (!handled) {
          const message = error instanceof Error ? error.message : String(error)
          await this.store.appendMessage(
            active.chatId,
            timestamped({
              kind: "result",
              subtype: "error",
              isError: true,
              durationMs: 0,
              result: message,
            })
          )
          await this.store.recordTurnFailed(active.chatId, message)
        } else {
          await this.store.recordTurnFailed(active.chatId, "rate_limit")
        }
      }
    } finally {
      if (active.cancelRequested && !active.cancelRecorded) {
        await this.store.recordTurnCancelled(active.chatId)
      }
      active.turn.close()
      // Only remove if we're still the active turn for this chat.
      // We may have already been removed by result handling or cancel(),
      // and a new turn may have started for the same chatId.
      if (this.activeTurns.get(active.chatId) === active) {
        this.activeTurns.delete(active.chatId)
      }
      // Stream has fully ended — no longer draining.
      this.clearDrainingStream(active.chatId)
      // Turn-scoped reservation: release so another chat can claim this
      // token while this chat is idle. The rotation race between concurrent
      // in-flight turns is still serialized — both startClaudeTurn and the
      // pickActive() inside markLimited/markError run atomically in the JS
      // event loop, and a token marked limited/errored already drops its
      // reservation. The next turn for this chat reuses its existing claude
      // session (no re-pick) or pickActive again if it needs a fresh one.
      this.oauthPool?.release(active.chatId)
      this.emitStateChange(active.chatId)

      if (active.postToolFollowUp && !active.cancelRequested) {
        try {
          await this.startTurnForChat({
            chatId: active.chatId,
            provider: active.provider,
            content: active.postToolFollowUp.content,
            attachments: [],
            model: active.model,
            effort: active.effort,
            serviceTier: active.serviceTier,
            planMode: active.postToolFollowUp.planMode,
            appendUserPrompt: false,
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          await this.store.appendMessage(
            active.chatId,
            timestamped({
              kind: "result",
              subtype: "error",
              isError: true,
              durationMs: 0,
              result: message,
            })
          )
          await this.store.recordTurnFailed(active.chatId, message)
          this.emitStateChange(active.chatId)
        }
      } else if (!active.cancelRequested) {
        try {
          await this.maybeStartNextQueuedMessage(active.chatId)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          await this.store.appendMessage(
            active.chatId,
            timestamped({
              kind: "result",
              subtype: "error",
              isError: true,
              durationMs: 0,
              result: message,
            })
          )
          await this.store.recordTurnFailed(active.chatId, message)
          this.emitStateChange(active.chatId)
        }
      }
    }
  }

  private resolveAutoResumeFor(chatId: string): boolean {
    const cached = this.autoResumeByChat.get(chatId)
    if (typeof cached === "boolean") return cached
    return this.getAutoResumePreference()
  }

  private async emitAutoContinueEvent(event: AutoContinueEvent): Promise<void> {
    await this.store.appendAutoContinueEvent(event)
    this.scheduleManager?.onEvent(event)
    this.emitStateChange(event.chatId)
  }

  private getChatSchedule(chatId: string, scheduleId: string) {
    const events = this.store.getAutoContinueEvents(chatId)
    return deriveChatSchedules(events, chatId).schedules[scheduleId]
  }

  private requireFuture(scheduledAt: number): void {
    if (scheduledAt <= Date.now()) throw new Error("scheduledAt must be in the future")
  }

  /**
   * Returns the additional scheduling delay (ms) for a respawn caused by a
   * rotation event on `tokenId`. The first detector in a
   * TOKEN_ROTATION_DEDUPE_WINDOW_MS window gets 0; each later detector gets
   * an additional TOKEN_ROTATION_HERD_STAGGER_MS so PTY cold-boots spread
   * out instead of stampeding. Also reports whether this caller is the
   * first detector (used to skip duplicate markLimited/markError calls).
   */
  private acquireRotationSlot(tokenId: string | null): { extraDelayMs: number; isFirst: boolean } {
    if (!tokenId) return { extraDelayMs: 0, isFirst: true }
    const now = Date.now()
    const existing = this.tokenRotationDedupe.get(tokenId)
    if (!existing || now - existing.firstSeenAt > TOKEN_ROTATION_DEDUPE_WINDOW_MS) {
      this.tokenRotationDedupe.set(tokenId, { firstSeenAt: now, staggerCount: 0 })
      return { extraDelayMs: 0, isFirst: true }
    }
    existing.staggerCount += 1
    return { extraDelayMs: existing.staggerCount * TOKEN_ROTATION_HERD_STAGGER_MS, isFirst: false }
  }

  private async handleLimitError(chatId: string, detector: LimitDetector, error: AnyValue): Promise<boolean> {
    const detection = detector.detect(chatId, error)
    if (!detection) return false
    return this.handleLimitDetection(chatId, detection)
  }

  private async handleLimitDetection(chatId: string, detection: LimitDetection): Promise<boolean> {
    const live = deriveChatSchedules(this.store.getAutoContinueEvents(chatId), chatId).liveScheduleId
    if (live !== null) return true

    const session = this.claudeSessions.get(chatId)
    const limitedTokenId = session?.activeTokenId ?? null
    const slot = this.acquireRotationSlot(limitedTokenId)
    if (this.oauthPool && limitedTokenId && slot.isFirst) {
      this.oauthPool.markLimited(limitedTokenId, detection.resetAt)
    }
    const rotationTarget = this.oauthPool?.pickActive(chatId) ?? null
    const canRotate = rotationTarget !== null
      && (!limitedTokenId || rotationTarget.id !== limitedTokenId)

    if (this.oauthPool) {
      log.info("[oauth-pool] rate-limit detected", {
        chatId,
        markedLimitedTokenId: limitedTokenId,
        resetAt: new Date(detection.resetAt).toISOString(),
        tz: detection.tz,
        nextTokenId: rotationTarget?.id ?? null,
        canRotate,
        herdSlot: slot,
      })
    }

    const now = Date.now()
    const scheduleId = crypto.randomUUID()
    const base = { v: AUTO_CONTINUE_EVENT_VERSION, timestamp: now, chatId, scheduleId }

    // When no rotation is possible, "wait until rate-limit clears" means waiting
    // for the earliest token in the pool to become available again — not just
    // the current detection's resetAt, which would over-shoot if another pool
    // token has an earlier limitedUntil.
    const earliestPoolUnlimit = this.oauthPool?.earliestUnlimit() ?? null
    const waitUntil = earliestPoolUnlimit !== null
      ? Math.min(detection.resetAt, earliestPoolUnlimit)
      : detection.resetAt

    let event: AutoContinueEvent
    if (canRotate) {
      event = {
        ...base,
        kind: "auto_continue_accepted",
        scheduledAt: now + TOKEN_ROTATION_SCHEDULE_DELAY_MS + slot.extraDelayMs,
        tz: detection.tz,
        source: "token_rotation",
        resetAt: detection.resetAt,
        detectedAt: now,
      }
    } else if (this.resolveAutoResumeFor(chatId)) {
      event = {
        ...base,
        kind: "auto_continue_accepted",
        scheduledAt: waitUntil,
        tz: detection.tz,
        source: "auto_setting",
        resetAt: waitUntil,
        detectedAt: now,
      }
    } else {
      event = {
        ...base,
        kind: "auto_continue_proposed",
        detectedAt: now,
        resetAt: waitUntil,
        tz: detection.tz,
      }
    }

    await this.emitAutoContinueEvent(event)
    if (canRotate && session) {
      // Tear down the session bound to the limited token so the next turn
      // spawns a fresh subprocess with the rotated token's credentials.
      // Without this, startClaudeTurn reuses the cached session and
      // sendPrompt is routed to the still-limited token's subprocess.
      // keepReservation: true — the `pickActive(chatId)` above already
      // claimed `rotationTarget` under this chatId; the default `release`
      // path would scan reservedBy for owner===chatId and drop it,
      // leaking the rotation's reservation (audit #9d).
      this.closeClaudeSession(chatId, session, { keepReservation: true })
      const active = this.activeTurns.get(chatId)
      if (active) {
        await this.store.recordTurnFailed(chatId, "rate_limit")
        this.activeTurns.delete(chatId)
      }
    }
    if (!canRotate) {
      await this.store.appendMessage(chatId, timestamped({
        kind: "auto_continue_prompt",
        scheduleId,
      }))
    }

    return true
  }

  /**
   * Handle an OAuth 401 / authentication failure on a live Claude session:
   *   1. Mark the offending token as `error` in the pool so subsequent
   *      pickActive() calls skip it.
   *   2. Try to rotate to another usable token. If one exists, tear down
   *      the dead session and schedule an immediate auto-continue with
   *      source `token_rotation` (mirrors the rate-limit rotation path).
   *   3. If no rotation target exists, surface an auto_continue_proposed
   *      event so the UI can prompt the user to fix their token pool
   *      instead of looping silently.
   *
   * Returns true when the failure was handled (rotated or proposed),
   * false otherwise (caller logs the raw error).
   */
  private async handleAuthFailure(
    session: ClaudeSessionState,
    detection: AuthErrorDetection,
  ): Promise<boolean> {
    const chatId = session.chatId
    const live = deriveChatSchedules(this.store.getAutoContinueEvents(chatId), chatId).liveScheduleId
    if (live !== null) return true

    const erroredTokenId = session.activeTokenId
    const slot = this.acquireRotationSlot(erroredTokenId)
    if (this.oauthPool && erroredTokenId && slot.isFirst) {
      this.oauthPool.markError(erroredTokenId, detection.reason)
    }
    const rotationTarget = this.oauthPool?.pickActive(chatId) ?? null
    const canRotate = rotationTarget !== null
      && (!erroredTokenId || rotationTarget.id !== erroredTokenId)

    if (this.oauthPool) {
      log.info("[oauth-pool] auth-error detected", {
        chatId,
        markedErrorTokenId: erroredTokenId,
        reason: detection.reason,
        nextTokenId: rotationTarget?.id ?? null,
        canRotate,
        herdSlot: slot,
      })
    }

    const now = Date.now()
    const scheduleId = crypto.randomUUID()
    const base = { v: AUTO_CONTINUE_EVENT_VERSION, timestamp: now, chatId, scheduleId }

    // Auth errors mean the token is dead, not throttled — rotate
    // immediately when possible, no wait window.
    const event: AutoContinueEvent = canRotate
      ? {
          ...base,
          kind: "auto_continue_accepted",
          scheduledAt: now + TOKEN_ROTATION_SCHEDULE_DELAY_MS + slot.extraDelayMs,
          tz: "system",
          source: "token_rotation",
          resetAt: now,
          detectedAt: now,
        }
      : {
          ...base,
          kind: "auto_continue_proposed",
          detectedAt: now,
          resetAt: now,
          tz: "system",
        }

    await this.emitAutoContinueEvent(event)
    if (canRotate) {
      // Tear down the session bound to the dead token so the next turn
      // spawns a fresh subprocess with the rotated token in env.
      // keepReservation: true — `pickActive(chatId)` above already claimed
      // the rotation target under this chatId. The previous inline close +
      // delete pair sidestepped `closeClaudeSession` to avoid the
      // accidental release; route through the helper now that release is
      // opt-out, for symmetry with the rate-limit rotation path.
      this.closeClaudeSession(chatId, session, { keepReservation: true })
      const active = this.activeTurns.get(chatId)
      if (active) {
        await this.store.recordTurnFailed(chatId, "auth_error")
        this.activeTurns.delete(chatId)
      }
    }
    if (!canRotate) {
      await this.store.appendMessage(chatId, timestamped({
        kind: "auto_continue_prompt",
        scheduleId,
      }))
    }

    return true
  }

  async fireAutoContinue(chatId: string, scheduleId: string) {
    if (!this.store.getChat(chatId)) return

    // `subagent_background` deliveries carry the "Read PROGRESS.md" prompt;
    // provider-failure schedules carry none and fall back to the literal "continue".
    const schedule = this.getChatSchedule(chatId, scheduleId)
    const promptToReplay = schedule?.prompt ?? "continue"

    const event: AutoContinueEvent = {
      v: AUTO_CONTINUE_EVENT_VERSION,
      kind: "auto_continue_fired",
      timestamp: Date.now(),
      chatId,
      scheduleId,
    }
    try {
      await this.store.appendAutoContinueEvent(event)
      await this.enqueueMessage(chatId, promptToReplay, [], { autoContinue: { scheduleId } })
      await this.maybeStartNextQueuedMessage(chatId)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await this.store.appendMessage(chatId, timestamped({
        kind: "result",
        subtype: "error",
        isError: true,
        durationMs: 0,
        result: `Auto-continue failed: ${message}`,
      }))
    }

    this.emitStateChange(chatId)
  }

  async acceptAutoContinue(chatId: string, scheduleId: string, scheduledAt: number): Promise<void> {
    const schedule = this.getChatSchedule(chatId, scheduleId)
    if (!schedule) throw new Error("Schedule not found")
    if (schedule.state !== "proposed") throw new Error("Schedule not pending")
    this.requireFuture(scheduledAt)

    await this.emitAutoContinueEvent({
      v: AUTO_CONTINUE_EVENT_VERSION,
      kind: "auto_continue_accepted",
      timestamp: Date.now(),
      chatId,
      scheduleId,
      scheduledAt,
      tz: schedule.tz,
      source: "user",
      resetAt: schedule.resetAt,
      detectedAt: schedule.detectedAt,
    })
  }

  async rescheduleAutoContinue(chatId: string, scheduleId: string, scheduledAt: number): Promise<void> {
    const schedule = this.getChatSchedule(chatId, scheduleId)
    if (!schedule || schedule.state !== "scheduled") throw new Error("Schedule not active")
    this.requireFuture(scheduledAt)

    await this.emitAutoContinueEvent({
      v: AUTO_CONTINUE_EVENT_VERSION,
      kind: "auto_continue_rescheduled",
      timestamp: Date.now(),
      chatId,
      scheduleId,
      scheduledAt,
    })
  }

  async cancelAutoContinue(chatId: string, scheduleId: string, reason: "user" | "chat_deleted"): Promise<void> {
    const schedule = this.getChatSchedule(chatId, scheduleId)
    if (!schedule) return
    if (schedule.state !== "proposed" && schedule.state !== "scheduled") return

    await this.emitAutoContinueEvent({
      v: AUTO_CONTINUE_EVENT_VERSION,
      kind: "auto_continue_cancelled",
      timestamp: Date.now(),
      chatId,
      scheduleId,
      reason,
    })
  }

  /**
   * The /clear machinery for the loop-orchestration paths (setup_loop,
   * background delivery). Wiping the store token alone is not enough:
   * - an in-flight turn keeps streaming and its next `session_token` event
   *   would re-persist the OLD conversation's token over the wipe (observed
   *   121 ms after a setup_loop /clear) — so suppress persistence on the
   *   live session for the rest of its life;
   * - an idle warm SDK session would be reused in-band by the next turn,
   *   making the /clear a no-op — so tear it down when no turn is active.
   */
  private async clearClaudeSessionContext(chatId: string): Promise<void> {
    await this.store.setSessionTokenForProvider(chatId, "claude", null)
    const session = this.claudeSessions.get(chatId)
    if (!session) return
    session.suppressSessionTokenPersist = true
    if (!this.activeTurns.has(chatId)) {
      this.closeClaudeSession(chatId, session)
    }
  }

  /**
   * Deliver a finished `run_in_background` subagent's result back into the
   * main chat as a fresh turn AND clear the main-agent's Claude session so the
   * next turn starts with a fresh context window. Wired as the orchestrator's
   * `onBackgroundRunComplete` hook.
   *
   * Loop-orchestration invariant: main is stateless-in-context / stateful-in-file.
   * PROGRESS.md is the durability contract; every delivery re-reads it. Subagent
   * output is NOT carried forward as prompt content — the subagent is expected
   * to have written its findings into PROGRESS.md before terminating.
   *
   * See adr-20260711-notification-driven-loop-orchestration.
   */
  private async deliverSubagentToMain(
    chatId: string,
    runId: string,
    outcome: BackgroundRunOutcome,
  ): Promise<void> {
    if (!this.store.getChat(chatId)) return

    // Structured re-entry: the completion is delivered as the same
    // <task-notification> XML Claude Code's own background agents use
    // (LocalAgentTask), so the model parses task identity/status with the
    // format it already knows from native training.
    //
    // When a loop is armed, the FULL loop discipline prompt follows the
    // notification on every wake — not a generic "decide next action" string,
    // which drifted into self-implementation (the 7.5h marathon-turn bug).
    // Armed notifications carry NO <result> body: PROGRESS.md is the loop's
    // only durability contract. Non-loop deliveries include the (truncated)
    // result since ad-hoc background delegations have no tracking file.
    const armed = this.isLoopArmed(chatId)
    const notification = buildTaskNotification(runId, outcome, { includeResult: !armed })
    let prompt: string
    if (armed) {
      prompt = `${notification}\n\n${armed.prompt}`
    } else if (outcome.status === "completed") {
      prompt = `${notification}\n\nYour Claude context has been cleared. Read PROGRESS.md if present, then decide the next action.`
    } else {
      prompt = `${notification}\n\nYour Claude context has been cleared. Read PROGRESS.md if present; decide whether to retry, try another approach, or stop.`
    }

    try {
      // Wipe the main-agent's Claude session token so the next spawn starts
      // fresh (the /clear equivalent). Codex path is unaffected.
      await this.clearClaudeSessionContext(chatId)
      await this.store.appendMessage(chatId, timestamped({ kind: "context_cleared" }))

      const now = Date.now()
      const scheduleId = crypto.randomUUID()
      await this.emitAutoContinueEvent({
        v: AUTO_CONTINUE_EVENT_VERSION,
        kind: "auto_continue_accepted",
        timestamp: now,
        chatId,
        scheduleId,
        scheduledAt: now,
        tz: "system",
        source: "subagent_background",
        resetAt: now,
        detectedAt: now,
        prompt,
      })
    } catch (err) {
      log.warn(`${LOG_PREFIX} deliverSubagentToMain failed`, { chatId, runId, err })
    }
  }

  /**
   * Arm an autonomous loop on the main chat. Validates the loop spec, ensures
   * the tracking file exists (writes a skeleton if absent), then /clears the
   * main-agent Claude session and enqueues the templated recurring prompt so
   * the next turn starts the loop. Backs `mcp__kanna__setup_loop`. See
   * adr-20260711-setup-loop-template.
   */
  async setupLoop(args: {
    chatId: string
    input: LoopSetupInput
  }): Promise<SetupLoopHandlerResult> {
    const chat = this.store.getChat(args.chatId)
    if (!chat) return { ok: false, errors: [`chat ${args.chatId} not found`] }
    const project = this.store.getProject(chat.projectId)
    if (!project) return { ok: false, errors: [`project ${chat.projectId} not found`] }

    const validation = validateLoopSetup(args.input, project.localPath, {
      roster: this.getSubagents().map((s) => ({ id: s.id, name: s.name })),
      defaultLoopSubagentId: this.getAppSettingsSnapshot().subagentRuntime?.defaultLoopSubagentId ?? null,
    })
    if (!validation.ok) return { ok: false, errors: validation.errors }

    const resolved = validation.resolved
    let created: boolean
    let reconciled: boolean
    let reconcileActions: string[]
    try {
      const ensureResult = await ensureTrackingFile({
        absPath: resolved.trackingFileAbs,
        skeleton: resolved.skeleton,
        // Deterministic schema reconcile of an EXISTING tracking file: pure
        // string transform — server-owned sections rewritten to the inputs,
        // loop history preserved. No model judgement involved.
        reconcile: (existing) =>
          reconcileTrackingFile(existing, {
            goal: resolved.goal,
            verifyCommand: resolved.verifyCommand,
            chunkHint: resolved.chunkHint,
          }),
      })
      created = ensureResult.created
      reconciled = ensureResult.reconciled
      reconcileActions = ensureResult.actions
    } catch (err) {
      return {
        ok: false,
        errors: [`ensureTrackingFile failed: ${err instanceof Error ? err.message : String(err)}`],
      }
    }

    try {
      // Wipe main-agent Claude session so the next turn starts fresh with the
      // rendered loop prompt. Codex untouched. setup_loop runs from INSIDE a
      // live turn, so the suppression half of clearClaudeSessionContext is
      // what keeps the wipe from being overwritten by the in-flight stream.
      await this.clearClaudeSessionContext(args.chatId)
      await this.store.appendMessage(args.chatId, timestamped({ kind: "context_cleared" }))

      const now = Date.now()
      // Arm the loop durably: every subsequent background-completion wake
      // re-injects THIS prompt (not the generic one) and loop turns are
      // tool-blocked. Superseded by a later setup_loop or cleared by stop_loop
      // / a real user send. Replays from the auto-continue log on restart.
      await this.emitAutoContinueEvent({
        v: AUTO_CONTINUE_EVENT_VERSION,
        kind: "loop_armed",
        timestamp: now,
        chatId: args.chatId,
        scheduleId: crypto.randomUUID(),
        subagentId: resolved.subagentId,
        prompt: resolved.prompt,
      })

      const scheduleId = crypto.randomUUID()
      await this.emitAutoContinueEvent({
        v: AUTO_CONTINUE_EVENT_VERSION,
        kind: "auto_continue_accepted",
        timestamp: now,
        chatId: args.chatId,
        scheduleId,
        scheduledAt: now,
        tz: "system",
        source: "subagent_background",
        resetAt: now,
        detectedAt: now,
        prompt: resolved.prompt,
      })
    } catch (err) {
      return {
        ok: false,
        errors: [`enqueue failed: ${err instanceof Error ? err.message : String(err)}`],
      }
    }

    return {
      ok: true,
      trackingFileRel: resolved.trackingFileRel,
      created,
      reconciled,
      reconcileActions,
      prompt: resolved.prompt,
    }
  }

  /** Current armed-loop state for a chat, or null. Pure replay of the auto-continue log. */
  isLoopArmed(chatId: string): LoopState | null {
    return deriveLoopState(this.store.getAutoContinueEvents(chatId), chatId)
  }

  /**
   * Disarm an armed loop (restores tools + stops prompt re-injection). Backs
   * the `stop_loop` MCP tool (called by the model on GOAL MET) and the
   * user-send takeover path. No-op when no loop is armed.
   */
  async stopLoop(chatId: string, reason: "goal_met" | "user_send" | "chat_deleted"): Promise<void> {
    if (!this.isLoopArmed(chatId)) return
    await this.emitAutoContinueEvent({
      v: AUTO_CONTINUE_EVENT_VERSION,
      kind: "loop_disarmed",
      timestamp: Date.now(),
      chatId,
      scheduleId: crypto.randomUUID(),
      reason,
    })
  }

  listLiveSchedules(chatId: string): string[] {
    const { schedules } = deriveChatSchedules(this.store.getAutoContinueEvents(chatId), chatId)
    return Object.values(schedules)
      .filter((s) => s.state === "proposed" || s.state === "scheduled")
      .map((s) => s.scheduleId)
      .sort()
  }

  async killPtyInstance(chatId: string): Promise<void> {
    const instance = this.ptyInstanceRegistry?.snapshot().find((entry) => entry.chatId === chatId)
    if (!instance || instance.pid === null) {
      throw new Error("No live PTY instance for chat")
    }
    const { killProcessTree } = await import("./claude-pty/pid-registry.adapter")
    await killProcessTree(instance.pid)
    this.ptyInstanceRegistry?.markExitedIfCurrent(chatId, instance.pid, {
      phase: "exited",
      exitedAt: Date.now(),
      lastEventAt: Date.now(),
    })
  }

  async cancel(chatId: string, options?: { hideInterrupted?: boolean; skipQueueDrain?: boolean }) {
    // Also clean up any draining stream for this chat.
    const draining = this.drainingStreams.get(chatId)
    if (draining) {
      draining.turn.close()
      this.clearDrainingStream(chatId)
    }

    // Reject any subagent canUseTool Promises waiting on a user response in
    // this chat, and signal the orchestrator. Both happen unconditionally —
    // a chat may have no active main-turn (e.g. just an @mention with the
    // main turn already ended) while subagents are still running. Without
    // this, the SDK's canUseTool callback hangs forever, wedging the
    // subagent session and leaking the resolver entry.
    this.rejectPendingResolversForChat(chatId)
    this.subagentOrchestrator.cancelChat(chatId)

    const active = this.activeTurns.get(chatId)
    if (!active) return

    logClaudeSteer("cancel_requested", {
      chatId,
      provider: active.provider,
      activePromptSeq: active.claudePromptSeq ?? null,
    })

    // Guard against concurrent cancel() calls — only the first one does work.
    if (active.cancelRequested) return
    active.cancelRequested = true

    const pendingTool = active.pendingTool
    active.pendingTool = null

    if (pendingTool) {
      const result = discardedToolResult(pendingTool.tool)
      await this.store.appendMessage(
        chatId,
        timestamped({
          kind: "tool_result",
          toolId: pendingTool.toolUseId,
          content: result,
        })
      )
      if (active.provider === "codex" && pendingTool.tool.toolKind === "exit_plan_mode") {
        pendingTool.resolve(result)
      }
    }

    await this.store.appendMessage(chatId, timestamped({ kind: "interrupted", hidden: options?.hideInterrupted }))
    await this.store.recordTurnCancelled(chatId)
    active.cancelRecorded = true
    active.hasFinalResult = true

    // Remove from activeTurns immediately so the UI reflects the cancellation
    // right away, rather than waiting for interrupt() which may hang.
    this.activeTurns.delete(chatId)

    // Drain the cancelled prompt's seq from the Claude session's pending
    // queue. The SDK does not always echo a `result.subtype=cancelled` for
    // an interrupted prompt — when the stream just ends, the seq would
    // otherwise linger and cause a FIFO mismatch when the next turn's
    // result arrives, leaving the chat stuck in "running".
    if (active.provider === "claude" && active.claudePromptSeq != null) {
      const session = this.claudeSessions.get(chatId)
      if (session) {
        const idx = session.pendingPromptSeqs.indexOf(active.claudePromptSeq)
        if (idx >= 0) session.pendingPromptSeqs.splice(idx, 1)
        // The SDK driver's `interrupt()` emits a tail `result` with
        // subtype `error_during_execution` (empty text) after the splice
        // above. Mark it pending so runClaudeSession suppresses that one
        // result instead of rendering "An unknown error occurred." The
        // `interrupted` entry above is the user-visible cancellation.
        session.cancelledResultPending += 1
      }
    }

    this.emitStateChange(chatId)
    logClaudeSteer("cancel_active_turn_deleted", {
      chatId,
      provider: active.provider,
      activePromptSeq: active.claudePromptSeq ?? null,
    })

    // Now attempt to interrupt/close the underlying stream in the background.
    // This is best-effort — the turn is already removed from active state above,
    // and runTurn()'s finally block will also call close().
    try {
      await Promise.race([
        active.turn.interrupt(),
        new Promise((resolve) => setTimeout(resolve, 5_000)),
      ])
    } catch {
      // interrupt() failed — force close
    }
    active.turn.close()

    // For Claude under the PTY driver, `active.turn` is a ghost facade over
    // the long-lived `claudeSessions` entry and its `close()` is a no-op.
    // The PTY driver's `interrupt()` sends SIGINT which terminates the CLI,
    // so the underlying session is dead — drop it from the map so the next
    // turn respawns a fresh `claude --resume <sessionToken>` (preserves
    // transcript context). For the SDK driver, `interrupt()` is honored
    // in-band without killing the worker, so reuse is still valid.
    if (active.provider === "claude" && this.resolveClaudeDriverPreference() === "pty") {
      const session = this.claudeSessions.get(chatId)
      if (session) {
        this.closeClaudeSession(chatId, session)
      }
    }

    // Drain the queue. A queued message must auto-start after cancel; the
    // result-success branch in runClaudeSession is the only other place this
    // is called, and it can never fire for a cancelled turn (active has been
    // deleted above before the result event arrives).
    //
    // `skipQueueDrain` is passed by callers that handle dequeue themselves
    // (e.g. `steer`, which dequeues the head message with the steer wrapper).
    if (!options?.skipQueueDrain) {
      await this.maybeStartNextQueuedMessage(chatId)
    }
  }

  async respondTool(command: Extract<ClientCommand, { type: "chat.respondTool" }>) {
    const active = this.activeTurns.get(command.chatId)
    if (!active || !active.pendingTool) {
      throw new Error("No pending tool request")
    }

    const pending = active.pendingTool
    if (pending.toolUseId !== command.toolUseId) {
      throw new Error("Tool response does not match active request")
    }

    await this.store.appendMessage(
      command.chatId,
      timestamped({
        kind: "tool_result",
        toolId: command.toolUseId,
        content: normalizeToolContent(command.result),
      })
    )

    active.pendingTool = null
    active.status = "running"
    active.waitStartedAt = null

    if (pending.tool.toolKind === "exit_plan_mode") {
      const resultRec: Record<string, unknown> = isRecord(command.result) ? command.result : {}
      const confirmed = Boolean(resultRec.confirmed)
      const clearContext = Boolean(resultRec.clearContext)
      const message = typeof resultRec.message === "string" ? resultRec.message : ""
      if (confirmed && clearContext) {
        await this.store.setSessionTokenForProvider(command.chatId, active.provider, null)
        await this.store.appendMessage(command.chatId, timestamped({ kind: "context_cleared" }))
      }

      if (active.provider === "codex") {
        active.postToolFollowUp = confirmed
          ? {
              content: message
                ? `Proceed with the approved plan. Additional guidance: ${message}`
                : "Proceed with the approved plan.",
              planMode: false,
            }
          : {
              content: message
                ? `Revise the plan using this feedback: ${message}`
                : "Revise the plan using this feedback.",
              planMode: true,
            }
      }
    }

    pending.resolve(command.result)

    this.emitStateChange(command.chatId)
  }

  async respondSubagentTool(command: Extract<ClientCommand, { type: "chat.respondSubagentTool" }>) {
    const key = this.subagentPendingKey(command.chatId, command.runId, command.toolUseId)
    const resolver = this.subagentPendingResolvers.get(key)
    if (!resolver) {
      // Idempotent: a double-submit (client retry, concurrent WS messages, or
      // a response arriving after the run already terminated) should not
      // surface a confusing error to the UI. Resolver-absent = already
      // resolved or run died; nothing to do.
      return
    }
    this.subagentPendingResolvers.delete(key)
    await this.store.appendSubagentEvent({
      v: 3,
      type: "subagent_tool_resolved",
      timestamp: Date.now(),
      chatId: command.chatId,
      runId: command.runId,
      toolUseId: command.toolUseId,
      result: command.result,
      resolution: "user",
    })
    this.subagentOrchestrator.notifySubagentToolResolved(command.runId)
    resolver.resolve(command.result)
    this.emitStateChange(command.chatId)
  }

  async cancelSubagentRun(
    command: Extract<ClientCommand, { type: "chat.cancelSubagentRun" }>,
  ) {
    this.subagentOrchestrator.cancelRun(command.chatId, command.runId)
  }
}
