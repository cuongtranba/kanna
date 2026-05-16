import type {
  AgentProvider,
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

export type TurnEvent =
  | {
      v: 3
      type: "turn_started"
      timestamp: number
      chatId: string
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
      input: unknown
    }
  | {
      v: 3
      type: "subagent_tool_resolved"
      timestamp: number
      chatId: string
      runId: string
      toolUseId: string
      result: unknown
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

export type StoreEvent = ProjectEvent | ChatEvent | MessageEvent | QueuedMessageEvent | TurnEvent | StackEvent | AutoContinueEvent | SubagentRunEvent | ToolRequestEvent

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
  }
}

export function cloneTranscriptEntries(entries: TranscriptEntry[]): TranscriptEntry[] {
  return entries.map((entry) => ({ ...entry }))
}
