import type {
  AgentProvider,
  ClaudeDriverPreference,
  KannaStatus,
  ProjectSummary,
  ProviderUsage,
  QueuedChatMessage,
  SlashCommand,
  StackBinding,
  SubagentErrorCode,
  SubagentRunSnapshot,
  TranscriptEntry,
} from "../shared/types"
import type { AutoContinueEvent } from "./auto-continue/events"
import type { ChatPermissionPolicyOverride, ToolRequest, ToolRequestDecision, ToolRequestStatus } from "../shared/permission-policy"
import type {
  OrchGateDecision,
  OrchGateKind,
  OrchRunConfig,
  OrchRunStatus,
  OrchTaskSpec,
  OrchTaskState,
  OrchWorktreeSlot,
} from "../shared/orchestration-types"

export interface ProjectRecord extends ProjectSummary {
  deletedAt?: number
  starredAt?: number
}

export interface ChatRecord {
  id: string
  projectId: string
  title: string
  createdAt: number
  updatedAt: number
  deletedAt?: number
  archivedAt?: number
  unread: boolean
  provider: AgentProvider | null
  planMode: boolean
  sessionTokensByProvider: Partial<Record<AgentProvider, string | null>>
  sourceHash: string | null
  pendingForkSessionToken?: { provider: AgentProvider; token: string } | null
  hasMessages?: boolean
  lastMessageAt?: number
  lastTurnOutcome: "success" | "failed" | "cancelled" | null
  slashCommands?: SlashCommand[]
  stackId?: string
  stackBindings?: StackBinding[]
  /** Per-chat permission policy overlay; merges over the global defaults. */
  policyOverride?: ChatPermissionPolicyOverride | null
  // Consecutive failed proactive `/compact` injections. Persisted so the
  // circuit breaker survives a server restart instead of resetting to 0.
  compactFailureCount?: number
}

export interface ChatTimingState {
  status: Exclude<KannaStatus, "waiting_for_user">
  stateEnteredAt: number
  activeSessionStartedAt: number
  lastTurnStartedAt: number | null
  lastTurnDurationMs: number | null
  cumulativeMs: {
    idle: number
    starting: number
    running: number
    failed: number
  }
}

export interface StoreState {
  projectsById: Map<string, ProjectRecord>
  projectIdsByPath: Map<string, string>
  chatsById: Map<string, ChatRecord>
  queuedMessagesByChatId: Map<string, QueuedChatMessage[]>
  sidebarProjectOrder: string[]
  autoContinueEventsByChatId: Map<string, AutoContinueEvent[]>
  chatTimingsByChatId: Map<string, ChatTimingState>
  stacksById: Map<string, StackRecord>
  subagentRunsByChatId: Map<string, Map<string, SubagentRunSnapshot>>
  toolRequestsById: Map<string, ToolRequest>
  orchRunsById: Map<string, OrchRunRecord>
}

export interface SnapshotFile {
  v: 3
  generatedAt: number
  projects: ProjectRecord[]
  chats: ChatRecord[]
  sidebarProjectOrder?: string[]
  queuedMessages?: Array<{ chatId: string; entries: QueuedChatMessage[] }>
  messages?: Array<{ chatId: string; entries: TranscriptEntry[] }>
  autoContinueEvents?: Array<{ chatId: string; events: AutoContinueEvent[] }>
  stacks?: StackRecord[]
}

export type ProjectEvent = {
  v: 3
  type: "project_opened"
  timestamp: number
  projectId: string
  localPath: string
  title: string
} | {
  v: 3
  type: "project_removed"
  timestamp: number
  projectId: string
} | {
  v: 3
  type: "sidebar_project_order_set"
  timestamp: number
  projectIds: string[]
} | {
  v: 3
  type: "project_star_set"
  timestamp: number
  projectId: string
  starredAt: number | null
}

export type ChatEvent =
  | {
      v: 3
      type: "chat_created"
      timestamp: number
      chatId: string
      projectId: string
      title: string
      stackId?: string
      stackBindings?: StackBinding[]
    }
  | {
      v: 3
      type: "chat_renamed"
      timestamp: number
      chatId: string
      title: string
    }
  | {
      v: 3
      type: "chat_deleted"
      timestamp: number
      chatId: string
    }
  | {
      v: 3
      type: "chat_archived"
      timestamp: number
      chatId: string
    }
  | {
      v: 3
      type: "chat_unarchived"
      timestamp: number
      chatId: string
    }
  | {
      v: 3
      type: "chat_provider_set"
      timestamp: number
      chatId: string
      provider: AgentProvider
    }
  | {
      v: 3
      type: "chat_plan_mode_set"
      timestamp: number
      chatId: string
      planMode: boolean
    }
  | {
      v: 3
      type: "chat_read_state_set"
      timestamp: number
      chatId: string
      unread: boolean
    }
  | {
      v: 3
      type: "chat_source_hash_set"
      timestamp: number
      chatId: string
      sourceHash: string | null
    }
  | {
      v: 3
      type: "chat_policy_override_set"
      timestamp: number
      chatId: string
      policyOverride: ChatPermissionPolicyOverride | null
    }
  | {
      v: 3
      type: "chat_compact_failures_set"
      timestamp: number
      chatId: string
      compactFailureCount: number
    }

export type MessageEvent = {
  v: 3
  type: "message_appended"
  timestamp: number
  chatId: string
  entry: TranscriptEntry
}

export type QueuedMessageEvent =
  | {
      v: 3
      type: "queued_message_enqueued"
      timestamp: number
      chatId: string
      message: QueuedChatMessage
    }
  | {
      v: 3
      type: "queued_message_removed"
      timestamp: number
      chatId: string
      queuedMessageId: string
    }

/**
 * Model + run config active when a turn starts. Recorded on `turn_started`
 * so a turns.jsonl trace shows exactly which provider/model/driver/config
 * executed each turn. Optional: historical events predate this field.
 */
export interface TurnRunConfig {
  provider: AgentProvider
  model: string
  effort?: string
  serviceTier?: "fast"
  planMode: boolean
  /** Resolved claude driver preference at turn start (claude turns only meaningful). */
  driver: ClaudeDriverPreference
}

export type TurnEvent =
  | {
      v: 3
      type: "turn_started"
      timestamp: number
      chatId: string
      runConfig?: TurnRunConfig
    }
  | {
      v: 3
      type: "turn_finished"
      timestamp: number
      chatId: string
    }
  | {
      v: 3
      type: "turn_failed"
      timestamp: number
      chatId: string
      error: string
    }
  | {
      v: 3
      type: "turn_cancelled"
      timestamp: number
      chatId: string
    }
  | {
      v: 3
      type: "session_token_set"
      timestamp: number
      chatId: string
      sessionToken: string | null
      provider?: AgentProvider
    }
  | {
      v: 3
      type: "session_commands_loaded"
      timestamp: number
      chatId: string
      commands: Array<{ name: string; description: string; argumentHint: string }>
    }
  | {
      v: 3
      type: "pending_fork_session_token_set"
      timestamp: number
      chatId: string
      pendingForkSessionToken: string | null
      provider?: AgentProvider
    }

export type StackEvent =
  | {
      v: 3
      type: "stack_added"
      timestamp: number
      stackId: string
      title: string
      projectIds: string[]    // ≥2 at creation; invariant enforced by the store, not the event
    }
  | {
      v: 3
      type: "stack_removed"
      timestamp: number
      stackId: string
    }
  | {
      v: 3
      type: "stack_renamed"
      timestamp: number
      stackId: string
      title: string
    }
  | {
      v: 3
      type: "stack_project_added"
      timestamp: number
      stackId: string
      projectId: string
    }
  | {
      v: 3
      type: "stack_project_removed"
      timestamp: number
      stackId: string
      projectId: string
    }

export type SubagentRunEvent =
  | {
      v: 3
      type: "subagent_run_started"
      timestamp: number
      chatId: string
      runId: string
      subagentId: string | null
      subagentName: string
      /** Short prompt-derived label (see SubagentRunSnapshot.label). Optional for
       *  back-compat: older events and error paths omit it. */
      label?: string
      provider: AgentProvider
      model: string
      parentUserMessageId: string
      parentRunId: string | null
      depth: number
    }
  | {
      v: 3
      type: "subagent_message_delta"
      timestamp: number
      chatId: string
      runId: string
      content: string
    }
  | {
      v: 3
      type: "subagent_run_completed"
      timestamp: number
      chatId: string
      runId: string
      finalContent: string
      usage?: ProviderUsage
    }
  | {
      v: 3
      type: "subagent_run_failed"
      timestamp: number
      chatId: string
      runId: string
      error: { code: SubagentErrorCode; message: string }
    }
  | {
      v: 3
      type: "subagent_run_cancelled"
      timestamp: number
      chatId: string
      runId: string
    }
  | {
      v: 3
      type: "subagent_entry_appended"
      timestamp: number
      chatId: string
      runId: string
      entry: TranscriptEntry
    }
  | {
      v: 3
      type: "subagent_tool_pending"
      timestamp: number
      chatId: string
      runId: string
      toolUseId: string
      toolKind: "ask_user_question" | "exit_plan_mode"
      input: Record<string, unknown>
    }
  | {
      v: 3
      type: "subagent_tool_resolved"
      timestamp: number
      chatId: string
      runId: string
      toolUseId: string
      result: string | Record<string, unknown> | readonly unknown[] | null
      resolution: "user" | "auto_deny" | "interrupted"
    }

export type ToolRequestEvent =
  | {
      v: 3
      type: "tool_request_put"
      timestamp: number
      request: ToolRequest
    }
  | {
      v: 3
      type: "tool_request_resolved"
      timestamp: number
      id: string
      status: ToolRequestStatus
      decision?: ToolRequestDecision
      resolvedAt: number
      mismatchReason?: string
    }

export type OrchestrationEvent =
  | {
      v: 3
      type: "orch_run_created"
      timestamp: number
      runId: string
      config: OrchRunConfig
      tasks: OrchTaskSpec[]
    }
  | {
      v: 3
      type: "orch_worktree_provisioned"
      timestamp: number
      runId: string
      index: number
      path: string
      branch: string
    }
  | {
      v: 3
      type: "orch_worktree_init_started"
      timestamp: number
      runId: string
      index: number
    }
  | {
      v: 3
      type: "orch_worktree_init_completed"
      timestamp: number
      runId: string
      index: number
      ok: boolean
      outputExcerpt: string
    }
  | {
      v: 3
      type: "orch_task_claimed"
      timestamp: number
      runId: string
      taskId: string
      workerId: string
      /** Worktree-branch HEAD at claim — the {{DIFF}} anchor for this task (F13). */
      baseSha: string
      worktreePath: string
      branch: string
    }
  | {
      v: 3
      type: "orch_phase_started"
      timestamp: number
      runId: string
      taskId: string
      phaseIndex: number
      phaseName: string
      workerIds: string[]
    }
  | {
      v: 3
      type: "orch_phase_completed"
      timestamp: number
      runId: string
      taskId: string
      phaseIndex: number
      /** Joined worker output, capped at 64k chars — the {{PRIOR}} context for the next phase, persisted so a gated/recovered task can resume (F2). */
      output: string
      outputChars: number
      /** Per-worker link to the subagent run that executed it (F10) — the panel drill-in reuses the existing subagent transcript viewer. Null for fake/unlinked workers. */
      workers: Array<{ workerId: string; subagentRunId: string | null }>
    }
  | {
      v: 3
      type: "orch_gate_opened"
      timestamp: number
      runId: string
      taskId: string
      phaseIndex: number
      phaseName: string
      gateKind: OrchGateKind
    }
  | {
      v: 3
      type: "orch_gate_resolved"
      timestamp: number
      runId: string
      taskId: string
      phaseIndex: number
      decision: OrchGateDecision
    }
  | {
      v: 3
      type: "orch_scope_overlap_flagged"
      timestamp: number
      runId: string
      taskIds: string[]
      paths: string[]
    }
  | {
      v: 3
      type: "orch_config_warning"
      timestamp: number
      runId: string
      message: string
    }
  | {
      v: 3
      type: "orch_verify_started"
      timestamp: number
      runId: string
      taskId: string
      attempt: number
    }
  | {
      v: 3
      type: "orch_verify_completed"
      timestamp: number
      runId: string
      taskId: string
      attempt: number
      passed: boolean
      outputExcerpt: string
    }
  | {
      v: 3
      type: "orch_task_committed"
      timestamp: number
      runId: string
      taskId: string
      commitSha: string | null
    }
  | {
      v: 3
      type: "orch_task_failed"
      timestamp: number
      runId: string
      taskId: string
      error: string
    }
  | {
      v: 3
      type: "orch_task_requeued"
      timestamp: number
      runId: string
      taskId: string
      reason: "handed_back" | "restart_recovery"
      detail: string | null
    }
  | {
      v: 3
      type: "orch_run_completed"
      timestamp: number
      runId: string
    }
  | {
      v: 3
      type: "orch_run_cancelled"
      timestamp: number
      runId: string
    }

export type StoreEvent = ProjectEvent | ChatEvent | MessageEvent | QueuedMessageEvent | TurnEvent | StackEvent | AutoContinueEvent | SubagentRunEvent | ToolRequestEvent | OrchestrationEvent

export interface OrchTaskRecord {
  taskId: string
  title: string
  prompt: string
  scopePaths: string[]
  state: OrchTaskState
  ownerWorkerId: string | null
  worktreePath: string | null
  branch: string | null
  /** Worktree-branch HEAD at claim — {{DIFF}} anchor (F13). */
  baseSha: string | null
  phaseIndex: number
  attempts: number
  error: string | null
  commitSha: string | null
  /** Last completed phase's joined output — resume context after gate/restart. */
  lastPhaseOutput: string | null
  /** True while a verify step is in flight (verify_started, cleared on completed/terminal). */
  verifying: boolean
  updatedAt: number
}

export interface OrchRunRecord {
  runId: string
  status: OrchRunStatus
  config: OrchRunConfig
  tasksById: Map<string, OrchTaskRecord>
  taskOrder: string[]
  /** Worktree pool (F13) — provisioned slots, hold state folded from events. */
  worktrees: OrchWorktreeSlot[]
  /**
   * Full ordered event timeline for this run (F8) — the rich drill-in source
   * (phase timings, gate history, requeue reasons, outputs). Rebuilt on
   * restart by replay. Memory bounded by the 64k phase-output cap.
   */
  eventLog: OrchestrationEvent[]
  createdAt: number
  updatedAt: number
}

export interface StackRecord {
  id: string
  title: string
  projectIds: string[]
  createdAt: number
  updatedAt: number
  deletedAt?: number
}

export function createEmptyState(): StoreState {
  return {
    projectsById: new Map(),
    projectIdsByPath: new Map(),
    chatsById: new Map(),
    queuedMessagesByChatId: new Map(),
    sidebarProjectOrder: [],
    autoContinueEventsByChatId: new Map(),
    chatTimingsByChatId: new Map(),
    stacksById: new Map(),
    subagentRunsByChatId: new Map(),
    toolRequestsById: new Map<string, ToolRequest>(),
    orchRunsById: new Map(),
  }
}

export function cloneTranscriptEntries(entries: readonly TranscriptEntry[]): TranscriptEntry[] {
  return entries.map((entry) => ({ ...entry }))
}
