import type { ChatPermissionPolicyOverride } from "./permission-policy"

// Re-export domain-specific type modules — extracted to keep this barrel lean.
// All external consumers importing from "../shared/types" continue to work unchanged.
export * from "./core-types"
export * from "./provider-model-types"
export * from "./tool-call-types"
export * from "./transcript-types"
export * from "./mcp-types"
export * from "./subagent-types"
export * from "./app-settings-types"
export * from "./vapid-subject"
export * from "./git-diff-types"

// Import the re-exported names we reference in the body of this file.
// (export * makes them available to importers, but not within this file itself.)
import type { AgentProvider, KannaStatus, AttachmentKind, LlmProviderKind } from "./core-types"
import type {
  ModelOptions,
  ProviderCatalogEntry,
} from "./provider-model-types"
import type { TranscriptEntry } from "./transcript-types"
import type {
  ClaudeSessionLifecycleStatus,
  CloudflareTunnelRecord,
} from "./app-settings-types"
import type { SubagentErrorCode, SubagentRunSnapshot, LoopProgressSnapshot } from "./subagent-types"

export interface SkillSearchResult {
  id: string
  skillId: string
  name: string
  installs: number
  source: string
}

export interface SkillSearchSnapshot {
  query: string
  searchType: string
  skills: SkillSearchResult[]
  count: number
  duration_ms: number
}

export interface SkillInstallResult {
  source: string
  skillId: string
  command: string[]
  cwd: string
  stdout: string
  stderr: string
}

export interface SkillUninstallResult {
  skillId: string
  command: string[]
  cwd: string
  stdout: string
  stderr: string
}

export interface InstalledSkillSummary {
  name: string
  source: string
  sourceType: string
  sourceUrl: string
  skillPath?: string
  installedAt: string
  updatedAt: string
  pluginName?: string
}

export interface InstalledSkillsSnapshot {
  lockFilePath: string
  skills: InstalledSkillSummary[]
}

export interface GithubRelease {
  id: number
  name: string | null
  tag_name: string
  html_url: string
  published_at: string | null
  body: string | null
  prerelease: boolean
  draft: boolean
}

export interface ChatAttachment {
  id: string
  kind: AttachmentKind
  displayName: string
  absolutePath: string
  relativePath: string
  contentUrl: string
  mimeType: string
  size: number
}

export interface QueuedChatMessage {
  id: string
  content: string
  attachments: ChatAttachment[]
  createdAt: number
  provider?: AgentProvider
  model?: string
  modelOptions?: ModelOptions
  planMode?: boolean
  autoContinue?: { scheduleId: string }
  cronRun?: import("./cron/types").CronRunTag
}

export interface InternalUserAttachmentsData {
  userText: string
  attachments: ChatAttachment[]
  llmHintText: string
}

export type PushTransitionKind = "waiting_for_user" | "failed" | "completed"

export interface PushSubscriptionRecord {
  id: string
  endpoint: string
  keys: { p256dh: string; auth: string }
  label: string
  userAgent: string
  createdAt: number
  lastSeenAt: number
}

export interface PushPayload {
  v: 1
  kind: PushTransitionKind
  projectLocalPath: string
  projectTitle: string
  chatId: string
  chatTitle: string
  chatUrl: string
  ts: number
}

export interface PushPreferences {
  globalEnabled: boolean
  mutedProjectPaths: string[]
  mutedChatIds: string[]
}

export interface PushDeviceSummary {
  id: string
  label: string
  userAgent: string
  createdAt: number
  lastSeenAt: number
  isCurrentDevice: boolean
}

export interface PushConfigSnapshot {
  vapidPublicKey: string
  preferences: PushPreferences
  devices: PushDeviceSummary[]
}

export interface PushSubscribeRequestPayload {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

export interface ProjectSummary {
  id: string
  localPath: string
  title: string
  createdAt: number
  updatedAt: number
}

export interface Stack {
  id: string
  title: string
  projectIds: string[]   // insertion order; drives sidebar order within the stack
  createdAt: number
  updatedAt: number
}

export interface StackSummary {
  id: string
  title: string
  projectIds: string[]
  memberCount: number
  createdAt: number
  updatedAt: number
}

export interface StackBinding {
  projectId: string
  worktreePath: string                          // absolute, matches agent SDK cwd input
  role: "primary" | "additional"
}

export interface ChatActivity {
  agents: number
  workflow: { name: string | null; agentCount: number } | null
  loop: { done: number; total: number } | null
  backgroundTasks: number
  cron: { nextFireAt: number | null; paused: boolean } | null
  awaitingAnswer: boolean
  lastRunFailure: { code: SubagentErrorCode | null } | null
}

export const EMPTY_CHAT_ACTIVITY: ChatActivity = {
  agents: 0,
  workflow: null,
  loop: null,
  backgroundTasks: 0,
  cron: null,
  awaitingAnswer: false,
  lastRunFailure: null,
}

export interface SidebarChatRow {
  _id: string
  _creationTime: number
  chatId: string
  title: string
  status: KannaStatus
  unread: boolean
  localPath: string
  provider: AgentProvider | null
  lastMessageAt?: number
  activity: ChatActivity
  canFork?: boolean
  stateEnteredAt?: number
  stackId?: string
  /** Live Claude PTY session lifecycle state for the sidebar badge. Missing implies "cold". */
  sessionState?: ClaudeSessionLifecycleStatus
  /** True when the chat has a non-null policyOverride. Missing implies false. */
  hasPolicyOverride?: boolean
}

export interface SidebarProjectGroup {
  groupKey: string
  localPath: string
  chats: SidebarChatRow[]
  previewChats: SidebarChatRow[]
  olderChats: SidebarChatRow[]
  archivedChats?: SidebarChatRow[]
  defaultCollapsed: boolean
  starredAt?: number
  sourceProvider?: AgentProvider | null
}

export interface SidebarData {
  starredProjectGroups: SidebarProjectGroup[]
  projectGroups: SidebarProjectGroup[]
  stacks: StackSummary[]
}

export interface LocalProjectSummary {
  localPath: string
  title: string
  source: "saved" | "discovered"
  lastOpenedAt?: number
  chatCount: number
}

export interface LocalProjectsSnapshot {
  machine: {
    id: "local"
    displayName: string
    platform: NodeJS.Platform
    homeDir: string
  }
  projects: LocalProjectSummary[]
}

export interface LlmProviderFile {
  provider?: LlmProviderKind
  apiKey?: string
  model?: string
  baseUrl?: string | null
}

export interface LlmProviderSnapshot {
  provider: LlmProviderKind
  apiKey: string
  model: string
  baseUrl: string
  resolvedBaseUrl: string
  enabled: boolean
  warning: string | null
  filePathDisplay: string
}

export interface LlmProviderValidationResult {
  ok: boolean
  error: unknown | null
}

export type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "up_to_date"
  | "updating"
  | "restart_pending"
  | "error"

export interface UpdateSnapshot {
  currentVersion: string
  latestVersion: string | null
  status: UpdateStatus
  updateAvailable: boolean
  lastCheckedAt: number | null
  error: string | null
  installAction: "restart" | "reload"
  reloadRequestedAt: number | null
}

export type UpdateInstallErrorCode =
  | "version_not_live_yet"
  | "install_failed"
  | "command_missing"

export interface UpdateInstallResult {
  ok: boolean
  action: "restart" | "reload"
  errorCode: UpdateInstallErrorCode | null
  userTitle: string | null
  userMessage: string | null
}

export interface ChatTimingCumulativeMs {
  idle: number
  starting: number
  running: number
  waiting_for_user: number
  failed: number
}

export interface ChatStateTimings {
  activeSessionStartedAt: number
  chatCreatedAt: number
  stateEnteredAt: number
  lastTurnDurationMs: number | null
  derivedAtMs: number
  cumulativeMs: ChatTimingCumulativeMs
}

/**
 * A live Claude-Code background task (`Bash(run_in_background: true)`,
 * background Agent run, workflow) tracked on the chat's warm session.
 * Mirrors Claude Code's own /tasks view: id + type + human description.
 */
export interface ChatBackgroundTask {
  id: string
  /** SDK `task_type` when known (e.g. "local_bash", "local_agent"); null when only the launch regex saw it. */
  taskType: string | null
  /** SDK payload description, else the launching tool call's description/command. */
  description: string | null
  /** Epoch ms the server first observed the task. */
  startedAt: number
  /** True when the server has an output file path and can stream content for this task. */
  hasOutput: boolean
}

export interface ChatRuntime {
  chatId: string
  projectId: string
  localPath: string
  title: string
  status: KannaStatus
  isDraining: boolean
  provider: AgentProvider | null
  planMode: boolean
  sessionTokensByProvider: Partial<Record<AgentProvider, string | null>>
  timings: ChatStateTimings
  /** Per-chat permission policy overlay. Null means "use global defaults". */
  policyOverride: ChatPermissionPolicyOverride | null
  /** Current claude PTY session lifecycle state for this chat. `cold` when no live session. */
  sessionState: ClaudeSessionLifecycleStatus
  /** Live Claude-Code background tasks on this chat's warm session. Empty when none. */
  backgroundTasks: ChatBackgroundTask[]
}

export interface ChatHistorySnapshot {
  hasOlder: boolean
  olderCursor: string | null
  recentLimit: number
}

export type SlashCommandKind = "command" | "skill"

export type SlashCommandScope = "builtin" | "personal" | "project" | "plugin"

export interface SlashCommand {
  name: string
  description: string
  argumentHint: string
  kind?: SlashCommandKind
  scope?: SlashCommandScope
}

/**
 * The composer `/` picker's catalog for one project. Keyed by project because
 * it is derived purely from that project's cwd (plus the user's own
 * `~/.claude`), never from a chat — so every chat in a project shares one list
 * and a freshly opened chat needs no load of its own.
 */
export interface ProjectCommandsSnapshot {
  projectId: string
  commands: SlashCommand[]
}

export interface ResolvedStackBinding {
  projectId: string
  projectTitle: string
  worktreePath: string
  role: "primary" | "additional"
  projectStatus: "active" | "missing"
}

export interface ChatSnapshot {
  runtime: ChatRuntime
  queuedMessages: QueuedChatMessage[]
  messages: TranscriptEntry[]
  history: ChatHistorySnapshot
  availableProviders: ProviderCatalogEntry[]
  schedules: Record<string, AutoContinueSchedule>
  liveScheduleId: string | null
  tunnels: Record<string, CloudflareTunnelRecord>
  liveTunnelId: string | null
  resolvedBindings?: ResolvedStackBinding[]
  subagentRuns: Record<string, SubagentRunSnapshot>
  /** Loop Progress panel view — armed state, per-round rows, rate-limit resume. */
  loopProgress: LoopProgressSnapshot
  /** Armed cron jobs on this chat — footer panel + run-card status joins. */
  cronJobs: readonly import("./cron/types").CronJobSnapshot[]
  /**
   * Chat op-log sequence this snapshot reflects. Absent when the producer
   * has no op-log (share page, legacy paths) — such snapshots never get
   * `chat.ops` deltas applied on top.
   */
  seq?: number
}

export interface ChatHistoryPage {
  messages: TranscriptEntry[]
  hasOlder: boolean
  olderCursor: string | null
}

export interface KannaSnapshot {
  sidebar: SidebarData
  chat?: ChatSnapshot | null
}

export interface PendingToolSnapshot {
  toolUseId: string
  toolKind: "ask_user_question" | "exit_plan_mode"
}

export type AutoContinueScheduleState = "proposed" | "scheduled" | "fired" | "cancelled"

export interface AutoContinueSchedule {
  scheduleId: string
  state: AutoContinueScheduleState
  scheduledAt: number | null
  tz: string
  resetAt: number
  detectedAt: number
  /**
   * Prompt replayed when a `subagent_background` delivery fires. Absent on
   * provider-failure schedules, which fire the literal `"continue"`.
   */
  prompt?: string
}

// Type guards for string literal unions — used by Select/SegmentedControl callbacks
// (Radix Select passes `string`; these guards narrow without an `as` cast)

export function isAgentProvider(value: string): value is AgentProvider {
  return value === "claude" || value === "codex" || value === "openrouter"
}
