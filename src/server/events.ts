import type {
  AgentProvider,
  KannaStatus,
  ModelOptions,
  ProjectSummary,
  ProviderUsage,
  QueuedChatMessage,
  StackBinding,
  SubagentErrorCode,
  SubagentRunSnapshot,
  TranscriptEntry,
} from "../shared/types"
import type { ChatAutomationEvent } from "./auto-continue/events"
import type { ChatTaskEvent } from "../shared/chat-tasks/types"
import type { ChatPermissionPolicyOverride, ToolRequest, ToolRequestDecision, ToolRequestStatus } from "../shared/permission-policy"
import type { JsonArray, JsonObject } from "../shared/json"
import type { STORE_VERSION } from "../shared/types"

type StoreVersion = typeof STORE_VERSION

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
  pinnedAt?: number
  unread: boolean
  provider: AgentProvider | null
  model?: string
  modelOptions?: ModelOptions
  planMode: boolean
  sessionTokensByProvider: Partial<Record<AgentProvider, string | null>>
  sourceHash: string | null
  pendingForkSessionToken?: { provider: AgentProvider; token: string } | null
  hasMessages?: boolean
  lastMessageAt?: number
  lastTurnOutcome: "success" | "failed" | "cancelled" | null
  stackId?: string
  stackBindings?: StackBinding[]
  policyOverride?: ChatPermissionPolicyOverride | null
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
  autoContinueEventsByChatId: Map<string, ChatAutomationEvent[]>
  chatTimingsByChatId: Map<string, ChatTimingState>
  stacksById: Map<string, StackRecord>
  subagentRunsByChatId: Map<string, Map<string, SubagentRunSnapshot>>
  chatTasksByChatId: Map<string, ChatTaskEvent[]>
  toolRequestsById: Map<string, ToolRequest>
}

export interface SnapshotFile {
  v: StoreVersion
  generatedAt: number
  projects: ProjectRecord[]
  chats: ChatRecord[]
  sidebarProjectOrder?: string[]
  queuedMessages?: Array<{ chatId: string; entries: QueuedChatMessage[] }>
  messages?: Array<{ chatId: string; entries: TranscriptEntry[] }>
  autoContinueEvents?: Array<{ chatId: string; events: ChatAutomationEvent[] }>
  chatTasks?: Array<{ chatId: string; events: ChatTaskEvent[] }>
  stacks?: StackRecord[]
}

export type ProjectEvent = {
  v: StoreVersion
  type: "project_opened"
  timestamp: number
  projectId: string
  localPath: string
  title: string
} | {
  v: StoreVersion
  type: "project_removed"
  timestamp: number
  projectId: string
} | {
  v: StoreVersion
  type: "project_deleted"
  timestamp: number
  projectId: string
} | {
  v: StoreVersion
  type: "sidebar_project_order_set"
  timestamp: number
  projectIds: string[]
} | {
  v: StoreVersion
  type: "project_star_set"
  timestamp: number
  projectId: string
  starredAt: number | null
} | {
  v: StoreVersion
  type: "project_instructions_set"
  timestamp: number
  projectId: string
  instructions: string
}

export type ChatEvent =
  | {
      v: StoreVersion
      type: "chat_created"
      timestamp: number
      chatId: string
      projectId: string
      title: string
      stackId?: string
      stackBindings?: StackBinding[]
    }
  | {
      v: StoreVersion
      type: "chat_projects_attached"
      timestamp: number
      chatId: string
      stackBindings: StackBinding[]
    }
  | {
      v: StoreVersion
      type: "chat_renamed"
      timestamp: number
      chatId: string
      title: string
    }
  | {
      v: StoreVersion
      type: "chat_deleted"
      timestamp: number
      chatId: string
    }
  | {
      v: StoreVersion
      type: "chat_archived"
      timestamp: number
      chatId: string
    }
  | {
      v: StoreVersion
      type: "chat_unarchived"
      timestamp: number
      chatId: string
    }
  | {
      v: StoreVersion
      type: "chat_pin_set"
      timestamp: number
      chatId: string
      pinnedAt: number | null
    }
  | {
      v: StoreVersion
      type: "chat_provider_set"
      timestamp: number
      chatId: string
      provider: AgentProvider
    }
  | {
      v: StoreVersion
      type: "chat_model_set"
      timestamp: number
      chatId: string
      model: string
      modelOptions?: ModelOptions
    }
  | {
      v: StoreVersion
      type: "chat_plan_mode_set"
      timestamp: number
      chatId: string
      planMode: boolean
    }
  | {
      v: StoreVersion
      type: "chat_read_state_set"
      timestamp: number
      chatId: string
      unread: boolean
    }
  | {
      v: StoreVersion
      type: "chat_source_hash_set"
      timestamp: number
      chatId: string
      sourceHash: string | null
    }
  | {
      v: StoreVersion
      type: "chat_policy_override_set"
      timestamp: number
      chatId: string
      policyOverride: ChatPermissionPolicyOverride | null
    }
  | {
      v: StoreVersion
      type: "chat_compact_failures_set"
      timestamp: number
      chatId: string
      compactFailureCount: number
    }

export type MessageEvent = {
  v: StoreVersion
  type: "message_appended"
  timestamp: number
  chatId: string
  entry: TranscriptEntry
}

export type QueuedMessageEvent =
  | {
      v: StoreVersion
      type: "queued_message_enqueued"
      timestamp: number
      chatId: string
      message: QueuedChatMessage
    }
  | {
      v: StoreVersion
      type: "queued_message_removed"
      timestamp: number
      chatId: string
      queuedMessageId: string
    }

export interface TurnRunConfig {
  provider: AgentProvider
  model: string
  effort?: string
  serviceTier?: "fast"
  planMode: boolean
  driver?: "sdk" | "pty"
}

export type TurnEvent =
  | {
      v: StoreVersion
      type: "turn_started"
      timestamp: number
      chatId: string
      runConfig?: TurnRunConfig
    }
  | {
      v: StoreVersion
      type: "turn_finished"
      timestamp: number
      chatId: string
    }
  | {
      v: StoreVersion
      type: "turn_failed"
      timestamp: number
      chatId: string
      error: string
    }
  | {
      v: StoreVersion
      type: "turn_cancelled"
      timestamp: number
      chatId: string
    }
  | {
      v: StoreVersion
      type: "session_token_set"
      timestamp: number
      chatId: string
      sessionToken: string | null
      provider?: AgentProvider
    }
  | {
      v: StoreVersion
      type: "pending_fork_session_token_set"
      timestamp: number
      chatId: string
      pendingForkSessionToken: string | null
      provider?: AgentProvider
    }

export type StackEvent =
  | {
      v: StoreVersion
      type: "stack_added"
      timestamp: number
      stackId: string
      title: string
      projectIds: string[]
    }
  | {
      v: StoreVersion
      type: "stack_removed"
      timestamp: number
      stackId: string
    }
  | {
      v: StoreVersion
      type: "stack_renamed"
      timestamp: number
      stackId: string
      title: string
    }
  | {
      v: StoreVersion
      type: "stack_project_added"
      timestamp: number
      stackId: string
      projectId: string
    }
  | {
      v: StoreVersion
      type: "stack_project_removed"
      timestamp: number
      stackId: string
      projectId: string
    }
  | {
      v: StoreVersion
      type: "stack_instructions_set"
      timestamp: number
      stackId: string
      instructions: string
    }

export type SubagentRunEvent =
  | {
      v: StoreVersion
      type: "subagent_run_started"
      timestamp: number
      chatId: string
      runId: string
      subagentId: string | null
      subagentName: string
      label?: string
      provider: AgentProvider
      model: string
      parentUserMessageId: string
      parentRunId: string | null
      depth: number
    }
  | {
      v: StoreVersion
      type: "subagent_message_delta"
      timestamp: number
      chatId: string
      runId: string
      content: string
    }
  | {
      v: StoreVersion
      type: "subagent_run_completed"
      timestamp: number
      chatId: string
      runId: string
      finalContent: string
      usage?: ProviderUsage
    }
  | {
      v: StoreVersion
      type: "subagent_run_failed"
      timestamp: number
      chatId: string
      runId: string
      error: { code: SubagentErrorCode; message: string }
    }
  | {
      v: StoreVersion
      type: "subagent_run_cancelled"
      timestamp: number
      chatId: string
      runId: string
    }
  | {
      v: StoreVersion
      type: "subagent_entry_appended"
      timestamp: number
      chatId: string
      runId: string
      entry: TranscriptEntry
    }
  | {
      v: StoreVersion
      type: "subagent_tool_pending"
      timestamp: number
      chatId: string
      runId: string
      toolUseId: string
      toolKind: "ask_user_question" | "exit_plan_mode"
      input: JsonObject
    }
  | {
      v: StoreVersion
      type: "subagent_tool_resolved"
      timestamp: number
      chatId: string
      runId: string
      toolUseId: string
      result: string | JsonObject | JsonArray | null
      resolution: "user" | "auto_deny" | "interrupted"
    }

export type ToolRequestEvent =
  | {
      v: StoreVersion
      type: "tool_request_put"
      timestamp: number
      request: ToolRequest
    }
  | {
      v: StoreVersion
      type: "tool_request_resolved"
      timestamp: number
      id: string
      status: ToolRequestStatus
      decision?: ToolRequestDecision
      resolvedAt: number
      mismatchReason?: string
    }

export type StoreEvent = ProjectEvent | ChatEvent | MessageEvent | QueuedMessageEvent | TurnEvent | StackEvent | ChatAutomationEvent | SubagentRunEvent | ToolRequestEvent | ChatTaskEvent

export type StoreEventKind =
  | Exclude<StoreEvent, ChatAutomationEvent>["type"]
  | ChatAutomationEvent["kind"]

export function isChatAutomationEvent(event: StoreEvent): event is ChatAutomationEvent {
  return "kind" in event
}

export function storeEventKind(event: StoreEvent): StoreEventKind {
  return isChatAutomationEvent(event) ? event.kind : event.type
}

export interface StackRecord {
  id: string
  title: string
  projectIds: string[]
  createdAt: number
  updatedAt: number
  deletedAt?: number
  instructions?: string
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
    chatTasksByChatId: new Map<string, ChatTaskEvent[]>(),
    toolRequestsById: new Map<string, ToolRequest>(),
  }
}

export function resetStoreState(state: StoreState): void {
  const { sidebarProjectOrder: _order, ...maps } = state
  for (const map of Object.values(maps)) map.clear()
  state.sidebarProjectOrder = []
}

export function cloneTranscriptEntries(entries: readonly TranscriptEntry[]): TranscriptEntry[] {
  return entries.map((entry) => ({ ...entry }))
}
